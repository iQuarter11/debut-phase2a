import {
  useEffect,
  useRef,
  useState,
  useId,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  Columns3,
  Flag,
  FolderOpen,
  ShoppingCart,
  History,
  Users,
  ArrowUpRight,
  Plus,
  LogOut,
  RefreshCw,
  Search,
  X,
  Check,
  AlertCircle,
  Leaf,
  ChevronRight,
} from "lucide-react";
import {
  db,
  configured,
  statuses,
  purchaseStatuses,
  emptyData,
  tables,
  activeSprint,
  dateLabel,
  safeURL,
  today,
  type Dataset,
  type Member,
  type Work,
  type Sprint,
} from "./data";
const sections = [
  "Overview",
  "Sprint Board",
  "Sprint Priorities",
  "Resources",
  "Buy List",
  "Sprint History",
  "Team Admin",
] as const;
type Section = (typeof sections)[number];
type Table = Exclude<keyof Dataset, "work_item_history">;
type Row = Record<string, unknown>;
type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
};
const icons = [
  LayoutDashboard,
  Columns3,
  Flag,
  FolderOpen,
  ShoppingCart,
  History,
  Users,
];
const money = (n: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(n);
function Link({ url, children }: { url: string | null; children: ReactNode }) {
  const safe = safeURL(url);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children} <ArrowUpRight size={14} />
    </a>
  ) : null;
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!db) {
      setReady(true);
      return;
    }
    let alive = true;
    db.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setSession(data.session);
        setError(error?.message || "");
        setReady(true);
      }
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        setSession(next);
        setReady(true);
      }
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);
  async function signIn() {
    setError("");
    const { error } = await db!.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }
  if (!ready)
    return (
      <div className="gate">
        <p role="status">Opening your workspace…</p>
      </div>
    );
  if (!session || !configured)
    return (
      <div className="gate">
        <div className="login">
          <Brand />
          <div className="eyebrow">THE TEAM, IN SYNC</div>
          <h1>
            Good work starts
            <br />
            with a shared plan.
          </h1>
          <p>
            One place for DEBUT sprints, team resources, and the next things to
            build.
          </p>
          {!configured ? (
            <div className="notice">
              Add the Supabase URL and publishable key to .env.local. See the
              README for setup.
            </div>
          ) : (
            <>
              <button className="primary" onClick={signIn}>
                Continue with Google <ArrowUpRight size={18} />
              </button>
              <small>
                Access is limited to active members of the DEBUT team.
              </small>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="login-foot">DEBUT / INTERNAL TEAM WORKSPACE</div>
        </div>
        <div className="login-art">
          <img
            className="team-photo"
            src="/brand/debut-team.jpeg"
            alt="The DEBUT team gathered outside Weill Hall"
            width="2200"
            height="1652"
          />
          <div className="team-photo-caption">
            <div className="eyebrow light">ONE TEAM. A SHARED PURPOSE.</div>
            <h2>
              Small steps.
              <br />
              Meaningful progress.
            </h2>
            <p>Plan together. Build with purpose.</p>
          </div>
        </div>
      </div>
    );
  return <Hub key={session.user.id} session={session} />;
}
function Brand() {
  return (
    <div className="brand brand-supplied">
      <span className="debut-logo-frame">
        <img src="/brand/debut-logo.png" alt="DEBUT" width="750" height="750" />
      </span>
      <small>TEAM HUB</small>
    </div>
  );
}
function Hub({ session }: { session: Session }) {
  const [data, setData] = useState<Dataset>(emptyData),
    [loading, setLoading] = useState(true),
    [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [section, setSection] = useState<Section>("Overview"),
    [selectedSprint, setSelectedSprint] = useState(""),
    [subteam, setSubteam] = useState(""),
    [assignee, setAssignee] = useState(""),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ table: Table; row: Row } | null>(null),
    [confirm, setConfirm] = useState<{
      table: Table;
      id: string;
      label: string;
    } | null>(null),
    [saving, setSaving] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  async function load() {
    const turn = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const permission = await db!.rpc("is_active_member");
      if (permission.error) throw permission.error;
      if (!permission.data) {
        if (turn === generation.current) {
          setAllowed(false);
          setData(emptyData);
        }
        return;
      }
      const result = await Promise.all(
        tables.map(async (table) => {
          const rows: unknown[] = [];
          for (let offset = 0; ; offset += 1000) {
            const { data: page, error } = await db!
              .from(table)
              .select("*")
              .order("id")
              .range(offset, offset + 999);
            if (error) throw error;
            rows.push(...page);
            if (page.length < 1000) break;
          }
          return [table, rows];
        }),
      );
      const recheck = await db!.rpc("is_active_member");
      if (recheck.error) throw recheck.error;
      if (turn === generation.current) {
        if (!recheck.data) {
          setAllowed(false);
          setData(emptyData);
          return;
        }
        const next = Object.fromEntries(result) as Dataset;
        setData(next);
        setAllowed(true);
        setSelectedSprint(
          (previous) =>
            previous ||
            activeSprint(next.sprints)?.id ||
            [...next.sprints].sort((a, b) =>
              b.start_date.localeCompare(a.start_date),
            )[0]?.id ||
            "",
        );
      }
    } catch (e) {
      if (turn === generation.current) {
        setError(
          e instanceof Error
            ? e.message
            : (e as { message?: string }).message ||
                "Unable to load team data.",
        );
        setData(emptyData);
        setAllowed(false);
      }
    } finally {
      if (turn === generation.current) setLoading(false);
    }
  }
  const me = data.team_members.find(
    (m) => m.email?.toLowerCase() === session.user.email?.toLowerCase(),
  );
  const admin = me?.role === "admin",
    current = activeSprint(data.sprints),
    sprint = data.sprints.find((s) => s.id === selectedSprint);
  const memberName = (id: unknown) =>
    data.team_members.find((m) => m.id === id)?.display_name || "Unassigned";
  const teamName = (id: unknown) =>
    data.subteams.find((t) => t.id === id)?.name || "No subteam";
  const sprintName = (id: unknown) =>
    data.sprints.find((s) => s.id === id)?.name || "No sprint";
  const go = (next: Section) => {
    setSection(next);
    setSearch("");
  };
  const edit = (table: Table, row: unknown = {}) => {
    setEditor({ table, row: row as Row });
    setError("");
  };
  const workFor = (id?: string) =>
    data.work_items.filter((w) => w.sprint_id === id);
  const filtered = data.work_items.filter(
    (w) =>
      (!selectedSprint || w.sprint_id === selectedSprint) &&
      (!subteam || w.subteam_id === subteam) &&
      (!assignee || w.assignee_id === assignee) &&
      (!status || w.status === status),
  );
  async function save(table: Table, payload: Row, id?: string) {
    setSaving(true);
    setError("");
    try {
      const query = id
        ? db!.from(table).update(payload).eq("id", id)
        : db!.from(table).insert(payload);
      const result = await query.select("id");
      if (result.error) throw result.error;
      if (!result.data?.length)
        throw new Error(
          "No changes saved. Your access may have changed; refresh the workspace.",
        );
      setEditor(null);
      setNotice("Changes saved.");
      await load();
    } catch (e) {
      setError((e as { message?: string }).message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (!confirm) return;
    setSaving(true);
    setError("");
    const result = await db!
      .from(confirm.table)
      .delete()
      .eq("id", confirm.id)
      .select("id");
    if (result.error || !result.data?.length) {
      setError(
        result.error?.message ||
          "Nothing deleted. Refresh to check your access.",
      );
    } else {
      setConfirm(null);
      setNotice("Record removed.");
      await load();
    }
    setSaving(false);
  }
  const members = data.team_members
    .filter((m) => m.active)
    .map((m) => ({ value: m.id, label: m.display_name }));
  const withExisting = (
    options: { value: string; label: string }[],
    value: unknown,
    label: string,
  ) =>
    value && !options.some((o) => o.value === value)
      ? [...options, { value: String(value), label }]
      : options;
  function fields(table: Table, row: Row): Field[] {
    const owners = withExisting(
      members,
      row.assignee_id || row.owner_id || row.requester_id,
      memberName(row.assignee_id || row.owner_id || row.requester_id) +
        " (inactive)",
    );
    const teams = data.subteams.map((t) => ({ value: t.id, label: t.name }));
    const sprints = [...data.sprints]
      .sort((a, b) => b.start_date.localeCompare(a.start_date))
      .map((s) => ({ value: s.id, label: s.name }));
    const owner = (key: string, label: string): Field => ({
      key,
      label,
      type: "select",
      required: true,
      options: owners,
    });
    switch (table) {
      case "work_items":
        return [
          { key: "title", label: "Title", required: true },
          {
            key: "description",
            label: "Description",
            type: "textarea",
            required: true,
          },
          {
            key: "points",
            label: "Story points",
            type: "select",
            required: true,
            options: [1, 2, 3, 5, 8, 13].map((n) => ({
              value: String(n),
              label: String(n),
            })),
          },
          {
            key: "subteam_id",
            label: "Subteam",
            type: "select",
            required: true,
            options: teams,
          },
          owner("assignee_id", "Assignee"),
          {
            key: "sprint_id",
            label: "Sprint",
            type: "select",
            required: true,
            options: sprints,
          },
          { key: "due_date", label: "Due date", type: "date", required: true },
          {
            key: "status",
            label: "Status",
            type: "select",
            required: true,
            options: statuses.map((s) => ({ value: s, label: s })),
          },
          {
            key: "acceptance_criteria",
            label: "Acceptance criteria",
            type: "textarea",
          },
          { key: "resource_url", label: "Related resource URL", type: "url" },
          { key: "blocked", label: "This item is blocked", type: "checkbox" },
          {
            key: "blocker_reason",
            label: "Blocker / help needed",
            type: "textarea",
          },
          {
            key: "carryover_from_id",
            label: "Carried over from",
            type: "select",
            options: sprints.filter((s) => s.value !== row.sprint_id),
            hint: "Records which earlier sprint this work was carried over from.",
          },
        ];
      case "sprints":
        return [
          { key: "name", label: "Sprint name", required: true },
          {
            key: "start_date",
            label: "Start date",
            type: "date",
            required: true,
          },
          {
            key: "end_date",
            label: "End date",
            type: "date",
            required: true,
            hint: "Two weeks, inclusive: start date + 13 days.",
          },
          {
            key: "goal",
            label: "Sprint goal",
            type: "textarea",
            required: true,
          },
          {
            key: "retrospective",
            label: "Retrospective notes",
            type: "textarea",
          },
        ];
      case "priorities":
        return [
          { key: "title", label: "Priority", required: true },
          {
            key: "sprint_id",
            label: "Sprint",
            type: "select",
            required: true,
            options: sprints,
          },
          { key: "rank", label: "Rank", type: "number", required: true },
          owner("owner_id", "Owner"),
          {
            key: "definition_of_done",
            label: "Definition of done",
            type: "textarea",
            required: true,
          },
        ];
      case "resources":
        return [
          { key: "title", label: "Resource title", required: true },
          {
            key: "type",
            label: "Type",
            type: "select",
            required: true,
            options: [
              "Slide deck",
              "Protocol",
              "CAD file",
              "Meeting notes",
            ].map((s) => ({ value: s, label: s })),
          },
          owner("owner_id", "Owner"),
          { key: "date", label: "Date", type: "date", required: true },
          { key: "tags", label: "Tags", hint: "Separate tags with commas." },
          {
            key: "drive_url",
            label: "Google Drive URL",
            type: "url",
            hint: "A drive.google.com or docs.google.com link. Files stay in Drive.",
          },
        ];
      case "purchases":
        return [
          { key: "item", label: "Item", required: true },
          {
            key: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
          },
          {
            key: "estimated_cost",
            label: "Estimated unit cost (USD)",
            type: "money",
            required: true,
          },
          owner("requester_id", "Requester"),
          { key: "reason", label: "Reason", type: "textarea", required: true },
          { key: "vendor", label: "Vendor" },
          { key: "url", label: "Vendor URL", type: "url" },
          {
            key: "status",
            label: "Status",
            type: "select",
            required: true,
            options: purchaseStatuses.map((s) => ({ value: s, label: s })),
          },
        ];
      case "team_members":
        return [
          { key: "display_name", label: "Display name", required: true },
          {
            key: "email",
            label: "Google account email",
            type: "email",
            hint: "Required for active members. Use the exact account they sign in with.",
          },
          {
            key: "subteam_id",
            label: "Subteam (optional)",
            type: "select",
            options: teams,
          },
          {
            key: "role",
            label: "Role",
            type: "select",
            required: true,
            options: [
              { value: "member", label: "Member" },
              { value: "admin", label: "Admin" },
            ],
          },
          {
            key: "active",
            label: "Active — allow this member access",
            type: "checkbox",
          },
        ];
      case "subteams":
        return [{ key: "name", label: "Subteam name", required: true }];
    }
  }
  function initial(table: Table, row: Row) {
    const defaults: Record<Table, Row> = {
      work_items: {
        points: 1,
        status: "Backlog",
        sprint_id: selectedSprint,
        assignee_id: me?.id,
        blocked: false,
      },
      sprints: {},
      priorities: {
        sprint_id: selectedSprint,
        rank:
          data.priorities
            .filter((p) => p.sprint_id === selectedSprint)
            .reduce((n, p) => Math.max(n, p.rank), 0) + 1,
        owner_id: me?.id,
      },
      resources: { type: "Slide deck", date: today(), owner_id: me?.id },
      purchases: {
        quantity: 1,
        estimated_cost: 0,
        requester_id: me?.id,
        status: "Proposed",
      },
      team_members: { role: "member", active: false },
      subteams: {},
    };
    return { ...defaults[table], ...row };
  }
  function Card({ w }: { w: Work }) {
    return (
      <button className="work-card" onClick={() => edit("work_items", w)}>
        <div className="card-top">
          <span className="tag">{teamName(w.subteam_id)}</span>
          <span className="points">{w.points} pt</span>
        </div>
        <h3>{w.title}</h3>
        {w.blocked && (
          <span className="blocked">
            <AlertCircle size={13} /> Blocked · {w.blocker_reason}
          </span>
        )}
        {w.carryover_from_id && (
          <span className="muted">
            ↳ From {sprintName(w.carryover_from_id)}
          </span>
        )}
        <div className="card-footer">
          <span>
            <span className="avatar small">
              {memberName(w.assignee_id).slice(0, 1)}
            </span>
            {memberName(w.assignee_id)}
          </span>
          <time
            className={
              w.due_date &&
              w.due_date < today() &&
              !["Done", "Retired"].includes(w.status)
                ? "overdue"
                : ""
            }
          >
            {dateLabel(w.due_date)}
          </time>
        </div>
      </button>
    );
  }
  function WorkList({ items, empty }: { items: Work[]; empty: string }) {
    return items.length ? (
      <div className="record-list">
        {items.map((w) => (
          <button
            key={w.id}
            className="record-row"
            onClick={() => edit("work_items", w)}
          >
            <span>
              <strong>{w.title}</strong>
              <small>
                {memberName(w.assignee_id)} · {dateLabel(w.due_date)}
              </small>
            </span>
            <Badge value={w.status} />
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    ) : (
      <Empty text={empty} />
    );
  }
  function SprintSelect() {
    return (
      <select
        aria-label="Select sprint"
        value={selectedSprint}
        onChange={(e) => setSelectedSprint(e.target.value)}
      >
        <option value="">All sprints</option>
        {[...data.sprints]
          .sort((a, b) => b.start_date.localeCompare(a.start_date))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.id === current?.id ? " · Current" : ""}
            </option>
          ))}
      </select>
    );
  }
  if (loading && !allowed)
    return (
      <div className="gate">
        <p role="status">Loading your team workspace…</p>
      </div>
    );
  if (!allowed)
    return (
      <div className="gate">
        <div className="login">
          <Brand />
          <h1>
            {error ? "Workspace unavailable" : "Your team access is pending."}
          </h1>
          <p>
            {error ||
              "An administrator needs to add your Google account to the active-member roster before you can access team data."}
          </p>
          <p className="muted">Signed in as {session.user.email}</p>
          <button onClick={() => void load()}>
            <RefreshCw size={16} />
            Try again
          </button>
          <button onClick={() => void db!.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  const sprintWork = workFor(current?.id);
  const done = sprintWork.filter((w) => w.status === "Done"),
    blocked = sprintWork.filter(
      (w) => w.blocked && !["Done", "Retired"].includes(w.status),
    ),
    review = sprintWork.filter((w) => w.status === "In Review");
  const priorities = data.priorities
    .filter((p) => p.sprint_id === current?.id)
    .sort((a, b) => a.rank - b.rank);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Workspace sections">
          {sections.map((s, i) => {
            const Icon = icons[i];
            return (
              <button
                key={s}
                className={section === s ? "nav-item active" : "nav-item"}
                onClick={() => go(s)}
                aria-current={section === s ? "page" : undefined}
              >
                <Icon size={18} />
                {s}
                {s === "Buy List" && (
                  <span className="nav-count">
                    {
                      data.purchases.filter((p) => p.status !== "Received")
                        .length
                    }
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <span className="online-dot" />
            Private team workspace
          </div>
          <div className="user">
            <span className="avatar">{me?.display_name.slice(0, 1)}</span>
            <div>
              <strong>{me?.display_name}</strong>
              <small>{admin ? "Team admin" : "Team member"}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => void db!.auth.signOut()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} /> <strong>{section}</strong>
          </span>
          <div className="topbar-actions">
            <button
              className="refresh"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              {loading ? "Refreshing" : "Refresh"}
            </button>
            <button
              className="icon-button mobile-signout"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => void db!.auth.signOut()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">DEBUT TEAM WORKSPACE</div>
              <h1>
                {section === "Overview"
                  ? `Let's move things forward${me ? ", " + me.display_name : ""}.`
                  : section}
              </h1>
              <p>
                {
                  {
                    Overview:
                      "A clear view of the sprint. A shared focus for the team.",
                    "Sprint Board":
                      "From first idea to finished work. Keep the next step visible.",
                    "Sprint Priorities":
                      "Agree on what matters, and what done looks like.",
                    Resources:
                      "The right context, without another copy of the file.",
                    "Buy List":
                      "Track what the team needs, from proposal to receipt.",
                    "Sprint History":
                      "A record of progress, learnings, and what comes next.",
                    "Team Admin": "Keep the roster and team access up to date.",
                  }[section]
                }
              </p>
            </div>
            {section === "Sprint Board" && (
              <button className="primary" onClick={() => edit("work_items")}>
                <Plus size={17} />
                New work item
              </button>
            )}
            {section === "Resources" && (
              <button className="primary" onClick={() => edit("resources")}>
                <Plus size={17} />
                Add resource
              </button>
            )}
            {section === "Buy List" && (
              <button className="primary" onClick={() => edit("purchases")}>
                <Plus size={17} />
                Request purchase
              </button>
            )}
            {section === "Sprint Priorities" && (
              <button className="primary" onClick={() => edit("sprints")}>
                <Plus size={17} />
                New sprint
              </button>
            )}
            {section === "Team Admin" && admin && (
              <button className="primary" onClick={() => edit("team_members")}>
                <Plus size={17} />
                Add member
              </button>
            )}
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice success" role="status">
              <Check size={16} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {section === "Overview" && (
            <>
              <div className="project-identity">
                <span className="eyebrow">PROJECT WORKSPACE</span>
                <img
                  src="/brand/ivie-logo.png"
                  alt="IVIE"
                  width="2172"
                  height="724"
                />
              </div>
              <section className="sprint-banner">
                <div>
                  <span className="eyebrow light">
                    <span className="online-dot" /> CURRENT SPRINT
                  </span>
                  <h2>{current?.name || "Your next sprint starts here"}</h2>
                  <p>
                    {current?.goal ||
                      "Create a two-week sprint and give the team a shared goal."}
                  </p>
                  <span className="banner-date">
                    {current
                      ? `${dateLabel(current.start_date)} — ${dateLabel(current.end_date)}`
                      : "No sprint is active today"}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelectedSprint(current?.id || "");
                    go("Sprint Priorities");
                  }}
                >
                  View sprint <ArrowUpRight size={17} />
                </button>
              </section>
              <div className="stats">
                <Stat
                  label="Sprint work items"
                  value={sprintWork.length}
                  detail="A shared plan for the team"
                />
                <Stat
                  label="Completed"
                  value={`${done.length} / ${sprintWork.length}`}
                  detail={`${done.reduce((n, w) => n + w.points, 0)} story points delivered`}
                />
                <Stat
                  label="Blocked"
                  value={blocked.length}
                  detail="Work that needs a hand"
                  danger={blocked.length > 0}
                />
                <Stat
                  label="Waiting for review"
                  value={review.length}
                  detail="Ready for another pair of eyes"
                />
              </div>
              <div className="overview-grid">
                <section className="panel">
                  <PanelTitle
                    title="Sprint priorities"
                    detail="The work that matters most"
                    action={() => go("Sprint Priorities")}
                  />
                  {priorities.length ? (
                    priorities.map((p) => (
                      <button
                        className="priority-row"
                        key={p.id}
                        onClick={() => edit("priorities", p)}
                      >
                        <span className="rank">
                          {String(p.rank).padStart(2, "0")}
                        </span>
                        <span>
                          <strong>{p.title}</strong>
                          <small>
                            {memberName(p.owner_id)} · {p.definition_of_done}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <Empty text="Set a few priorities to focus this sprint." />
                  )}
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Upcoming due dates"
                    detail="Keep the next handoff in sight"
                    action={() => go("Sprint Board")}
                  />
                  <WorkList
                    items={sprintWork
                      .filter(
                        (w) =>
                          w.due_date && !["Done", "Retired"].includes(w.status),
                      )
                      .sort((a, b) => a.due_date!.localeCompare(b.due_date!))
                      .slice(0, 5)}
                    empty="No upcoming deadlines in this sprint."
                  />
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Blockers"
                    detail="Clear a path for progress"
                  />
                  <WorkList
                    items={blocked}
                    empty="All clear. No blocked work right now."
                  />
                </section>
                <section className="panel">
                  <PanelTitle
                    title="Ready for review"
                    detail="Help the team finish strong"
                  />
                  <WorkList
                    items={review}
                    empty="No work is waiting for review."
                  />
                </section>
              </div>
            </>
          )}
          {section === "Sprint Board" && (
            <>
              <div className="filters">
                <SprintSelect />
                <SelectFilter
                  label="Subteam"
                  value={subteam}
                  set={setSubteam}
                  options={data.subteams.map((t) => ({
                    value: t.id,
                    label: t.name,
                  }))}
                />
                <SelectFilter
                  label="Assignee"
                  value={assignee}
                  set={setAssignee}
                  options={data.team_members.map((m) => ({
                    value: m.id,
                    label: m.display_name,
                  }))}
                />
                <SelectFilter
                  label="Status"
                  value={status}
                  set={setStatus}
                  options={statuses.map((s) => ({ value: s, label: s }))}
                />
                <button
                  onClick={() => {
                    setSelectedSprint("");
                    setSubteam("");
                    setAssignee("");
                    setStatus("");
                  }}
                >
                  Clear filters
                </button>
                <span className="muted">{filtered.length} items</span>
              </div>
              <div className="board">
                {statuses.map((s) => (
                  <section className="column" key={s}>
                    <h2>
                      <span className={`status-dot ${slug(s)}`} />
                      {s}
                      <span className="count">
                        {filtered.filter((w) => w.status === s).length}
                      </span>
                    </h2>
                    {filtered
                      .filter((w) => w.status === s)
                      .map((w) => (
                        <Card key={w.id} w={w} />
                      ))}
                    <button
                      className="column-add"
                      onClick={() => edit("work_items", { status: s })}
                    >
                      <Plus size={15} />
                      Add item
                    </button>
                  </section>
                ))}
              </div>
              <p className="muted">
                Open a card to review its details, change status, or move it to
                another sprint.
              </p>
            </>
          )}
          {section === "Sprint Priorities" && (
            <>
              <div className="filters">
                <SprintSelect />
                {sprint && (
                  <button onClick={() => edit("sprints", sprint)}>
                    Edit sprint & notes
                  </button>
                )}
              </div>
              {sprint ? (
                <>
                  <section className="panel sprint-detail">
                    <div className="eyebrow">
                      {dateLabel(sprint.start_date)} —{" "}
                      {dateLabel(sprint.end_date)}
                    </div>
                    <h2>{sprint.name}</h2>
                    <p>{sprint.goal}</p>
                  </section>
                  <section className="panel">
                    <PanelTitle
                      title="Ranked priorities"
                      detail="Every priority has an owner and a clear finish line"
                      action={() => edit("priorities")}
                      actionLabel="Add priority"
                    />
                    {data.priorities
                      .filter((p) => p.sprint_id === sprint.id)
                      .sort((a, b) => a.rank - b.rank)
                      .map((p) => (
                        <button
                          className="priority-row"
                          key={p.id}
                          onClick={() => edit("priorities", p)}
                        >
                          <span className="rank">
                            {String(p.rank).padStart(2, "0")}
                          </span>
                          <span>
                            <strong>{p.title}</strong>
                            <small>{memberName(p.owner_id)}</small>
                            <p>{p.definition_of_done}</p>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    {!data.priorities.some(
                      (p) => p.sprint_id === sprint.id,
                    ) && (
                      <Empty text="Add the first priority for this sprint." />
                    )}
                  </section>
                  <div className="overview-grid">
                    <section className="panel">
                      <PanelTitle title="Blocked work" />
                      <WorkList
                        items={workFor(sprint.id).filter(
                          (w) =>
                            w.blocked &&
                            !["Done", "Retired"].includes(w.status),
                        )}
                        empty="No blockers for this sprint."
                      />
                    </section>
                    <section className="panel">
                      <PanelTitle title="Carried into this sprint" />
                      <WorkList
                        items={workFor(sprint.id).filter(
                          (w) => w.carryover_from_id,
                        )}
                        empty="No carryovers into this sprint."
                      />
                    </section>
                  </div>
                </>
              ) : (
                <Empty text="Select a sprint or create your first two-week sprint." />
              )}
            </>
          )}
          {section === "Resources" && (
            <>
              <SearchBox
                value={search}
                set={setSearch}
                placeholder="Search titles, types, owners, and tags…"
              />
              <div className="resource-grid">
                {data.resources
                  .filter((r) =>
                    [r.title, r.type, memberName(r.owner_id), ...r.tags]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <article className="panel resource-card" key={r.id}>
                      <div className="resource-icon">
                        <FolderOpen size={25} />
                      </div>
                      <span className="eyebrow">{r.type}</span>
                      <h2>{r.title}</h2>
                      <p>
                        {memberName(r.owner_id)} · {dateLabel(r.date)}
                      </p>
                      <div className="tags">
                        {r.tags.map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="resource-actions">
                        <Link url={r.drive_url}>Open in Drive</Link>
                        <button onClick={() => edit("resources", r)}>
                          Details / edit
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              {!data.resources.length && (
                <Empty text="Add a resource to keep useful team links close at hand." />
              )}
              {data.resources.length > 0 &&
                !data.resources.some((r) =>
                  [r.title, r.type, memberName(r.owner_id), ...r.tags]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                ) && <Empty text="No resources match your search." />}
            </>
          )}
          {section === "Buy List" && (
            <>
              <div className="purchase-summary">
                <div>
                  <span className="eyebrow">OUTSTANDING ESTIMATE</span>
                  <h2>
                    {money(
                      data.purchases
                        .filter((p) => p.status !== "Received")
                        .reduce(
                          (n, p) => n + p.quantity * Number(p.estimated_cost),
                          0,
                        ),
                    )}
                  </h2>
                  <p>
                    Quantity × estimated unit cost for items not yet received.
                  </p>
                </div>
                <ShoppingCart size={38} strokeWidth={1} />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item / reason</th>
                      <th>Requester</th>
                      <th>Quantity</th>
                      <th>Estimate</th>
                      <th>Status</th>
                      <th>Vendor</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.purchases.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.item}</strong>
                          <small>{p.reason}</small>
                        </td>
                        <td>{memberName(p.requester_id)}</td>
                        <td>{p.quantity}</td>
                        <td>
                          {money(p.quantity * Number(p.estimated_cost))}
                          <small>{money(Number(p.estimated_cost))} each</small>
                        </td>
                        <td>
                          <Badge value={p.status} />
                        </td>
                        <td>
                          {p.vendor}
                          <Link url={p.url}>Visit</Link>
                        </td>
                        <td>
                          <button onClick={() => edit("purchases", p)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.purchases.length && (
                  <Empty text="No purchase requests yet. Add what the team needs next." />
                )}
              </div>
            </>
          )}
          {section === "Sprint History" && (
            <div className="history-list">
              {[...data.sprints]
                .filter((s) => s.end_date < today())
                .sort((a, b) => b.start_date.localeCompare(a.start_date))
                .map((s) => {
                  const completed = workFor(s.id).filter(
                      (w) => w.status === "Done",
                    ),
                    archived = data.work_item_history.filter(
                      (h) => h.sprint_id === s.id,
                    ),
                    archivedDone = archived.filter(
                      (h) => h.outcome === "Completed",
                    ),
                    carry = archived.filter(
                      (h) => h.outcome === "Carried over",
                    );
                  return (
                    <section className="panel" key={s.id}>
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">
                            {dateLabel(s.start_date)} — {dateLabel(s.end_date)}
                          </span>
                          <h2>{s.name}</h2>
                        </div>
                        <button onClick={() => edit("sprints", s)}>
                          Edit retrospective
                        </button>
                      </div>
                      <p>{s.goal}</p>
                      <div className="history-stats">
                        <span>
                          <strong>
                            {completed.length + archivedDone.length}
                          </strong>{" "}
                          completed items
                        </span>
                        <span>
                          <strong>
                            {completed.reduce((n, w) => n + w.points, 0) +
                              archivedDone.reduce((n, h) => n + h.points, 0)}
                          </strong>{" "}
                          completed points
                        </span>
                        <span>
                          <strong>{carry.length}</strong> carried over
                        </span>
                      </div>
                      <div className="overview-grid">
                        <div>
                          <h3>Completed work</h3>
                          <WorkList
                            items={completed}
                            empty={
                              archivedDone.length
                                ? "Completed items recorded below."
                                : "No completed work recorded."
                            }
                          />
                          {archivedDone.map((h) => (
                            <div className="record-row" key={h.id}>
                              <span>
                                <strong>{h.title}</strong>
                                <small>
                                  {memberName(h.assignee_id)} · Archived outcome
                                </small>
                              </span>
                              <span className="tag">{h.points} pt</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <h3>Carried into later sprints</h3>
                          {carry.length ? (
                            carry.map((h) => (
                              <div className="record-row" key={h.id}>
                                <span>
                                  <strong>{h.title}</strong>
                                  <small>
                                    {memberName(h.assignee_id)} · Moved to{" "}
                                    {sprintName(h.next_sprint_id)}
                                  </small>
                                </span>
                                <span className="tag">{h.points} pt</span>
                              </div>
                            ))
                          ) : (
                            <Empty text="No carryovers recorded." />
                          )}
                        </div>
                      </div>
                      <div className="retro">
                        <h3>Retrospective</h3>
                        <p className="prewrap">
                          {s.retrospective || "No retrospective notes yet."}
                        </p>
                      </div>
                    </section>
                  );
                })}
              {!data.sprints.some((s) => s.end_date < today()) && (
                <Empty text="Past sprints will appear here after their end date." />
              )}
            </div>
          )}
          {section === "Team Admin" &&
            (admin ? (
              <>
                <div className="notice">
                  Active members can read and edit team work. Only admins can
                  manage the roster and subteams. Inactive members lose database
                  access.
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Subteam</th>
                        <th>Role</th>
                        <th>Access</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.team_members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.display_name}</strong>
                            <small>{m.email || "Email not configured"}</small>
                          </td>
                          <td>{teamName(m.subteam_id)}</td>
                          <td>{m.role}</td>
                          <td>
                            <Badge value={m.active ? "Active" : "Inactive"} />
                          </td>
                          <td>
                            <button onClick={() => edit("team_members", m)}>
                              Edit access
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <section className="panel">
                  <PanelTitle
                    title="Subteams"
                    detail="Keep disciplines useful; membership is assigned explicitly"
                    action={() => edit("subteams")}
                    actionLabel="Add subteam"
                  />
                  <div className="team-list">
                    {data.subteams.map((t) => (
                      <button key={t.id} onClick={() => edit("subteams", t)}>
                        {t.name}
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <Empty text="Only team admins can manage access and subteams. Contact an admin to update the roster." />
            ))}
          <footer>
            DEBUT <span>Made for the work we do together.</span>
            <span>Private workspace</span>
          </footer>
        </div>
      </main>
      {editor && (
        <Editor
          key={`${editor.table}-${String(editor.row.id || "new")}`}
          table={editor.table}
          row={initial(editor.table, editor.row)}
          fields={fields(editor.table, editor.row)}
          saving={saving}
          error={error}
          onClose={() => {
            if (!saving) {
              setEditor(null);
              setError("");
            }
          }}
          onSave={(payload) =>
            void save(
              editor.table,
              payload,
              editor.row.id as string | undefined,
            )
          }
          onDelete={
            editor.row.id && editor.table !== "team_members"
              ? () => {
                  setConfirm({
                    table: editor.table,
                    id: String(editor.row.id),
                    label: String(
                      editor.row.title || editor.row.name || editor.row.item,
                    ),
                  });
                  setEditor(null);
                }
              : undefined
          }
        />
      )}
      {confirm && (
        <Modal
          title="Remove this record?"
          onClose={() => !saving && setConfirm(null)}
        >
          <p>
            Remove “{confirm.label}”? This cannot be undone.
            {confirm.table === "sprints" &&
              " Its priorities will be deleted and work items will become unassigned to a sprint."}
            {confirm.table === "subteams" &&
              " Members and work items will lose this subteam assignment."}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button onClick={() => setConfirm(null)} disabled={saving}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => void remove()}
              disabled={saving}
            >
              {saving ? "Removing…" : "Remove record"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function slug(value: string) {
  return value.toLowerCase().replaceAll(" ", "-");
}
function Badge({ value }: { value: string }) {
  return <span className={`badge ${slug(value)}`}>{value}</span>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Leaf size={24} strokeWidth={1.4} />
      <p>{text}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  danger = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={danger ? "red" : ""}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function PanelTitle({
  title,
  detail,
  action,
  actionLabel = "View all",
}: {
  title: string;
  detail?: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={action}>
          {actionLabel}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
function SelectFilter({
  label,
  value,
  set,
  options,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
    >
      <option value="">
        All {label === "Status" ? "statuses" : `${label.toLowerCase()}s`}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
function SearchBox({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={18} />
      <input
        aria-label="Search resources"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Editor({
  table,
  row,
  fields,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  table: Table;
  row: Row;
  fields: Field[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (v: Row) => void;
  onDelete?: () => void;
}) {
  const [values, setValues] = useState<Row>(row),
    [validation, setValidation] = useState("");
  const labels: Record<Table, string> = {
    work_items: "work item",
    sprints: "sprint",
    priorities: "priority",
    resources: "resource",
    purchases: "purchase request",
    team_members: "team member",
    subteams: "subteam",
  };
  function change(key: string, value: unknown) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (table === "sprints" && key === "start_date" && value) {
        const date = new Date(String(value) + "T12:00:00Z");
        date.setUTCDate(date.getUTCDate() + 13);
        next.end_date = date.toISOString().slice(0, 10);
      }
      if (
        table === "work_items" &&
        key === "sprint_id" &&
        previous.sprint_id &&
        value !== previous.sprint_id &&
        row.id &&
        !["Done", "Retired"].includes(String(previous.status))
      )
        next.carryover_from_id =
          previous.carryover_from_id || previous.sprint_id;
      return next;
    });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setValidation("");
    const payload: Row = {};
    for (const f of fields) {
      let value = values[f.key];
      if (f.type === "checkbox") value = Boolean(value);
      else if (f.key === "tags")
        value = Array.isArray(value)
          ? value
          : String(value || "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
      else if (["points", "rank", "quantity", "estimated_cost"].includes(f.key))
        value = Number(value);
      else value = typeof value === "string" ? value.trim() : value;
      if (value === "" || value === undefined)
        value = [
          "email",
          "subteam_id",
          "assignee_id",
          "sprint_id",
          "due_date",
          "resource_url",
          "drive_url",
          "url",
          "carryover_from_id",
        ].includes(f.key)
          ? null
          : "";
      payload[f.key] = value;
    }
    if (table === "work_items" && payload.blocked && !payload.blocker_reason) {
      setValidation("Describe the blocker so the team can help.");
      return;
    }
    if (
      table === "work_items" &&
      payload.carryover_from_id === payload.sprint_id
    ) {
      setValidation("Carryover must refer to a different sprint.");
      return;
    }
    if (table === "team_members") {
      if (payload.active && !payload.email) {
        setValidation("Active members need a Google account email.");
        return;
      }
      if (payload.email) payload.email = String(payload.email).toLowerCase();
    }
    if (
      table === "resources" &&
      payload.drive_url &&
      !/^https:\/\/(drive|docs)\.google\.com\//.test(String(payload.drive_url))
    ) {
      setValidation(
        "Use a https://drive.google.com/ or https://docs.google.com/ link.",
      );
      return;
    }
    onSave(payload);
  }
  return (
    <Modal
      title={`${row.id ? "Edit" : "New"} ${labels[table]}`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="form-fields">
          {fields.map((f) => (
            <label
              className={`field ${f.type === "textarea" ? "wide" : ""} ${f.type === "checkbox" ? "checkbox" : ""}`}
              key={f.key}
            >
              <span>
                {f.label}
                {f.required && (
                  <span className="required" aria-hidden="true">
                    {" "}
                    *
                  </span>
                )}
              </span>
              {f.type === "textarea" ? (
                <textarea
                  aria-label={f.label}
                  aria-describedby={
                    f.hint ? `${table}-${f.key}-hint` : undefined
                  }
                  value={String(values[f.key] || "")}
                  onChange={(e) => change(f.key, e.target.value)}
                  required={f.required}
                  rows={3}
                />
              ) : f.type === "select" ? (
                <select
                  aria-label={f.label}
                  aria-describedby={
                    f.hint ? `${table}-${f.key}-hint` : undefined
                  }
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => change(f.key, e.target.value)}
                  required={f.required}
                >
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option value={o.value} key={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "checkbox" ? (
                <input
                  aria-label={f.label}
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => change(f.key, e.target.checked)}
                />
              ) : (
                <input
                  aria-label={f.label}
                  aria-describedby={
                    f.hint ? `${table}-${f.key}-hint` : undefined
                  }
                  type={f.type === "money" ? "number" : f.type || "text"}
                  value={
                    Array.isArray(values[f.key])
                      ? (values[f.key] as string[]).join(", ")
                      : String(values[f.key] ?? "")
                  }
                  onChange={(e) => change(f.key, e.target.value)}
                  required={f.required}
                  min={
                    f.type === "money" ? 0 : f.type === "number" ? 1 : undefined
                  }
                  step={
                    f.type === "money"
                      ? "0.01"
                      : f.type === "number"
                        ? 1
                        : undefined
                  }
                />
              )}{" "}
              {f.hint && <small id={`${table}-${f.key}-hint`}>{f.hint}</small>}
            </label>
          ))}
        </div>
        {(validation || error) && (
          <p className="error" role="alert">
            {validation || error}
          </p>
        )}
        <div className="modal-actions">
          {onDelete && (
            <button
              type="button"
              className="delete-button"
              onClick={onDelete}
              disabled={saving}
            >
              Remove
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
