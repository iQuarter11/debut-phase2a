import { test, expect, type Page } from "@playwright/test";
const localDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function setup(
  page: Page,
  { allowed = true, admin = true, signedIn = true } = {},
) {
  const user = {
    id: "fixture-user",
    email: "fixture@example.invalid",
    app_metadata: { provider: "google" },
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  };
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
      email: user.email,
    }),
  ).toString("base64url");
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`;
  const session = {
    access_token: token,
    refresh_token: "fixture-refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
  if (signedIn)
    await page.addInitScript(
      (session) =>
        localStorage.setItem(
          "sb-test-project-auth-token",
          JSON.stringify(session),
        ),
      session,
    );
  const data: Record<string, any[]> = {
    team_members: [
      {
        id: "member-1",
        email: user.email,
        display_name: "Fixture Contributor",
        role: admin ? "admin" : "member",
        active: true,
        subteam_id: null,
        user_id: user.id,
      },
      {
        id: "member-2",
        email: "other@example.invalid",
        display_name: "Fixture Colleague",
        role: "member",
        active: true,
        subteam_id: "team-1",
        user_id: null,
      },
    ],
    subteams: [{ id: "team-1", name: "Fixture Discipline" }],
    sprints: [
      {
        id: "sprint-1",
        name: "Build sprint",
        start_date: localDate(-3),
        end_date: localDate(10),
        goal: "Validate a shared engineering workflow.",
        retrospective: "",
      },
      {
        id: "sprint-old",
        name: "Previous sprint",
        start_date: localDate(-17),
        end_date: localDate(-4),
        goal: "Establish the plan.",
        retrospective: "Keep handoffs clear.",
      },
    ],
    work_items: [
      {
        id: "work-1",
        title: "Review prototype",
        description: "Confirm the prototype criteria.",
        points: 3,
        subteam_id: "team-1",
        assignee_id: "member-1",
        sprint_id: "sprint-1",
        due_date: localDate(2),
        status: "In Review",
        acceptance_criteria: "Peer review complete",
        resource_url: null,
        blocked: false,
        blocker_reason: "",
        carryover_from_id: null,
      },
    ],
    priorities: [
      {
        id: "priority-1",
        sprint_id: "sprint-1",
        title: "Finish the prototype",
        rank: 1,
        owner_id: "member-1",
        definition_of_done: "Prototype reviewed",
      },
    ],
    resources: [],
    purchases: [],
    work_item_history: [
      {
        id: "snapshot-1",
        work_item_id: "moved-work",
        sprint_id: "sprint-old",
        title: "Historical task",
        points: 5,
        status: "Done",
        assignee_id: "member-2",
        outcome: "Completed",
        next_sprint_id: "sprint-1",
        recorded_at: new Date().toISOString(),
      },
    ],
  };
  let permitted = allowed;
  const calls: string[] = [];
  await page.route("https://test-project.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      name = url.pathname.split("/").at(-1)!;
    calls.push(name);
    if (url.pathname.includes("/auth/"))
      return route.fulfill({ status: 200, json: user });
    if (name === "is_active_member") return route.fulfill({ json: permitted });
    if (!data[name])
      return route.fulfill({
        status: 404,
        json: { message: "Unknown table" },
      });
    const id = url.searchParams.get("id")?.replace("eq.", "");
    if (request.method() === "GET")
      return route.fulfill({ json: permitted ? data[name] : [] });
    if (!permitted)
      return route.fulfill({
        status: 403,
        json: { message: "Access revoked" },
      });
    const body = request.postDataJSON();
    let result;
    if (request.method() === "POST") {
      const values = Array.isArray(body) ? body : [body];
      result = values.map((v: any) => ({ id: crypto.randomUUID(), ...v }));
      data[name].push(...result);
    } else if (request.method() === "PATCH") {
      result = data[name].filter((v) => v.id === id);
      result.forEach((v) => Object.assign(v, body));
    } else {
      result = data[name].filter((v) => v.id === id);
      data[name] = data[name].filter((v) => v.id !== id);
    }
    return route.fulfill({
      status: request.method() === "POST" ? 201 : 200,
      json: result,
    });
  });
  await page.goto("/");
  return {
    data,
    calls,
    revoke: () => {
      permitted = false;
    },
  };
}
test("signed-out and nonmember states never load team tables", async ({
  page,
}) => {
  const signedOut = await setup(page, { signedIn: false });
  await expect(
    page.getByRole("button", { name: /Continue with Google/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "DEBUT", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "The DEBUT team gathered outside Weill Hall",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/debut-signin.png",
    fullPage: true,
  });
  expect(signedOut.calls).toEqual([]);
  const pending = await setup(page, { allowed: false });
  await expect(
    page.getByRole("heading", { name: "Your team access is pending." }),
  ).toBeVisible();
  expect(
    pending.calls.filter((c) => c !== "is_active_member" && c !== "user"),
  ).toEqual([]);
});
test("overview links and work-item creation, editing, filtering, deletion", async ({
  page,
}) => {
  const { data } = await setup(page);
  await expect(
    page.getByRole("heading", { name: "Build sprint", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/debut-overview.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sprint Board" })
    .click();
  await page.getByRole("button", { name: "New work item" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Title", { exact: false })
    .fill("Build a test fixture");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("A shared fixture for the team.");
  await dialog.getByLabel("Subteam", { exact: false }).selectOption("team-1");
  await dialog.getByLabel("Due date", { exact: false }).fill(localDate(4));
  await dialog.getByLabel("Acceptance criteria").fill("Fixture assembled");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).not.toBeVisible();
  expect(data.work_items).toHaveLength(2);
  await page.getByRole("button", { name: /Build a test fixture/ }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Status", { exact: false })
    .selectOption("In Progress");
  await page.getByRole("dialog").getByLabel("This item is blocked").check();
  await page
    .getByRole("dialog")
    .getByLabel("Blocker / help needed")
    .fill("Waiting for a component");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Blocked · Waiting for a component"),
  ).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("Done");
  await expect(
    page.getByRole("button", { name: /Build a test fixture/ }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /Build a test fixture/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove record" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(data.work_items).toHaveLength(1);
});
test("resource and purchase workflows persist and calculate totals", async ({
  page,
}) => {
  const { data } = await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Resources", exact: true })
    .click();
  await page.getByRole("button", { name: "Add resource" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Resource title").fill("Fixture protocol");
  await d.getByLabel("Tags", { exact: false }).fill("assembly, testing");
  await d
    .getByLabel("Google Drive URL", { exact: false })
    .fill("https://docs.google.com/document/d/fixture");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Drive" }),
  ).toHaveAttribute("target", "_blank");
  expect(data.resources[0].tags).toEqual(["assembly", "testing"]);
  await page.getByRole("textbox", { name: "Search resources" }).fill("missing");
  await expect(page.getByText("No resources match your search.")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Buy List/ })
    .click();
  await page.getByRole("button", { name: "Request purchase" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Item", { exact: false }).fill("Fixture part");
  await d.getByLabel("Quantity").fill("3");
  await d.getByLabel("Estimated unit cost").fill("12.50");
  await d.getByLabel("Reason", { exact: false }).fill("Complete the fixture");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(d).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "$37.50" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Status", { exact: false })
    .selectOption("Received");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(page.getByRole("heading", { name: "$0.00" })).toBeVisible();
});
test("sprint creation, priorities, history, and admin editing", async ({
  page,
}) => {
  const { data } = await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sprint Priorities" })
    .click();
  await page.getByRole("button", { name: "New sprint" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Sprint name").fill("Upcoming sprint");
  await d.getByLabel("Start date").fill(localDate(11));
  await expect(d.getByLabel("End date", { exact: false })).toHaveValue(
    localDate(24),
  );
  await d.getByLabel("Sprint goal").fill("Build next iteration");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(d).not.toBeVisible();
  expect(data.sprints).toHaveLength(3);
  await page.getByRole("button", { name: "Add priority" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Priority", { exact: false }).fill("Validate fixture");
  await d.getByLabel("Definition of done").fill("All checks pass");
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(d).not.toBeVisible();
  expect(data.priorities).toHaveLength(2);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sprint History" })
    .click();
  await expect(page.getByText("Historical task")).toBeVisible();
  await expect(page.getByText("Keep handoffs clear.")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Team Admin" })
    .click();
  await page.getByRole("button", { name: "Add member" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Display name").fill("New Fixture Member");
  await d.getByLabel("Google account email").fill("new@example.invalid");
  await d.getByLabel("Active — allow this member access").check();
  await d.getByRole("button", { name: "Save changes" }).click();
  await expect(d).not.toBeVisible();
  expect(data.team_members).toHaveLength(3);
  await expect(page.getByText("New Fixture Member")).toBeVisible();
});
test("member admin state, revocation, keyboard dialog, and mobile layout", async ({
  page,
}) => {
  const state = await setup(page, { admin: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Team Admin" })
    .click();
  await expect(
    page.getByText(/Only team admins can manage access/),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sprint Board" })
    .click();
  const trigger = page.getByRole("button", { name: "New work item" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.screenshot({
    path: "test-results/debut-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  state.revoke();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your team access is pending." }),
  ).toBeVisible();
  await expect(page.getByText("Review prototype")).not.toBeVisible();
});
test("failed saves stay open with an actionable error", async ({ page }) => {
  await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sprint Board" })
    .click();
  await page.getByRole("button", { name: /Review prototype/ }).click();
  await page.route("**/rest/v1/work_items?**", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 400,
          json: { message: "Database validation failed" },
        })
      : route.fallback(),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "Database validation failed",
  );
  await expect(page.getByRole("dialog")).toBeVisible();
});
