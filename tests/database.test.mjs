import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
let pg;
const admin = "00000000-0000-0000-0000-000000000001",
  member = "00000000-0000-0000-0000-000000000002",
  outsider = "00000000-0000-0000-0000-000000000003";
const sprint1 = "10000000-0000-0000-0000-000000000001",
  sprint2 = "10000000-0000-0000-0000-000000000002",
  sprint3 = "10000000-0000-0000-0000-000000000003";
before(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role supabase_auth_admin;
 create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  ).sort())
    await pg.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await pg.exec(`insert into auth.users values ('${admin}','admin@example.invalid',now()),('${member}','member@example.invalid',now()),('${outsider}','outsider@example.invalid',now());
 update public.team_members set email='admin@example.invalid',role='admin',active=true where display_name='Ian';
 update public.team_members set email='member@example.invalid',active=true where display_name='Anna';
 insert into public.sprints(id,name,start_date,end_date,goal) values
 ('${sprint1}','First sprint','2026-01-01','2026-01-14','First goal'),('${sprint2}','Second sprint','2026-01-15','2026-01-28','Second goal'),('${sprint3}','Third sprint','2026-01-29','2026-02-11','Third goal');`);
});
after(async () => await pg?.close());
async function as(role, id, fn) {
  await pg.exec("begin");
  try {
    await pg.exec(
      `set local role ${role}; select set_config('request.jwt.claim.sub','${id || ""}',true);`,
    );
    return await fn();
  } finally {
    await pg.exec("rollback");
  }
}
const exposed = [
  "subteams",
  "team_members",
  "sprints",
  "work_items",
  "priorities",
  "resources",
  "purchases",
  "work_item_history",
];
test("migration enables RLS on every exposed table", async () => {
  const { rows } = await pg.query(
    `select relname,relrowsecurity from pg_class where relname=any($1::text[])`,
    [exposed],
  );
  assert.equal(rows.length, exposed.length);
  assert.ok(rows.every((r) => r.relrowsecurity));
});
test("anonymous users cannot read any team table or membership helper", async () => {
  for (const table of exposed)
    await as("anon", null, () =>
      assert.rejects(
        pg.query(`select * from public.${table}`),
        /permission denied/,
      ),
    );
  await as("anon", null, () =>
    assert.rejects(
      pg.query("select public.is_active_member()"),
      /permission denied/,
    ),
  );
});
test("authenticated outsiders cannot read or insert team data", async () => {
  await as("authenticated", outsider, async () => {
    for (const table of exposed)
      assert.equal(
        (await pg.query(`select * from public.${table}`)).rows.length,
        0,
      );
    await assert.rejects(
      pg.query("insert into public.subteams(name) values ('Intrusion')"),
      /row-level security/,
    );
  });
});
test("outsider cannot activate their own roster membership", async () => {
  await as("authenticated", outsider, async () => {
    const { affectedRows } = await pg.query(
      "update public.team_members set email='outsider@example.invalid',active=true where display_name='Zach'",
    );
    assert.equal(affectedRows, 0);
  });
});
test("active member can read the roster but cannot administer it", async () => {
  await as("authenticated", member, async () => {
    assert.equal(
      (await pg.query("select * from public.team_members")).rows.length,
      9,
    );
    assert.equal(
      (
        await pg.query(
          "update public.team_members set role='admin' where email='member@example.invalid'",
        )
      ).affectedRows,
      0,
    );
    await assert.rejects(
      pg.query("insert into public.subteams(name) values ('Unauthorized')"),
      /row-level security/,
    );
  });
});
test("admin can add members and edit subteams", async () => {
  await as("authenticated", admin, async () => {
    await pg.query(
      "insert into public.team_members(display_name,email,active) values ('Test member','new@example.invalid',true)",
    );
    await pg.query(
      "insert into public.subteams(name) values ('Test discipline')",
    );
    assert.equal(
      (
        await pg.query(
          "select * from public.team_members where email='new@example.invalid'",
        )
      ).rows.length,
      1,
    );
  });
});
test("last active admin cannot be demoted or deactivated", async () => {
  await as("authenticated", admin, () =>
    assert.rejects(
      pg.query(
        "update public.team_members set active=false where role='admin'",
      ),
      /another active admin/,
    ),
  );
});
test("active member can create, update, move and delete work", async () => {
  await as("authenticated", member, async () => {
    const {
      rows: [w],
    } = await pg.query(
      `insert into public.work_items(title,description,points,sprint_id) values('Test task','Test description',3,'${sprint1}') returning *`,
    );
    await pg.query(
      "update public.work_items set status='In Progress' where id=$1",
      [w.id],
    );
    await pg.query(
      "update public.work_items set status='In Review' where id=$1",
      [w.id],
    );
    await pg.query("update public.work_items set status='Done' where id=$1", [
      w.id,
    ]);
    assert.equal(
      (
        await pg.query("select status from public.work_items where id=$1", [
          w.id,
        ])
      ).rows[0].status,
      "Done",
    );
    await pg.query("delete from public.work_items where id=$1", [w.id]);
    assert.equal(
      (
        await pg.query(
          "select outcome,points from public.work_item_history where work_item_id=$1",
          [w.id],
        )
      ).rows[0].outcome,
      "Completed",
    );
  });
});
test("multiple carryovers preserve every prior sprint outcome", async () => {
  await as("authenticated", member, async () => {
    const {
      rows: [w],
    } = await pg.query(
      `insert into public.work_items(title,points,sprint_id) values('Carryover task',5,'${sprint1}') returning *`,
    );
    await pg.query("update public.work_items set sprint_id=$1 where id=$2", [
      sprint2,
      w.id,
    ]);
    await pg.query("update public.work_items set sprint_id=$1 where id=$2", [
      sprint3,
      w.id,
    ]);
    const { rows } = await pg.query(
      "select * from public.work_item_history where work_item_id=$1",
      [w.id],
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((h) => h.outcome === "Carried over"));
    assert.equal(
      (
        await pg.query(
          "select carryover_from_id from public.work_items where id=$1",
          [w.id],
        )
      ).rows[0].carryover_from_id,
      sprint2,
    );
  });
});
test("history snapshots cannot be forged by a member", async () => {
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query(
        `insert into public.work_item_history(work_item_id,sprint_id,title,points,status,outcome) values(gen_random_uuid(),'${sprint1}','Forged',13,'Done','Completed')`,
      ),
      /permission denied/,
    ),
  );
});
test("deactivation revokes an existing signed-in identity immediately", async () => {
  await pg.exec("begin");
  try {
    await pg.query(
      "update public.team_members set active=false where email='member@example.invalid'",
    );
    await pg.exec(
      `set local role authenticated;select set_config('request.jwt.claim.sub','${member}',true);`,
    );
    assert.equal(
      (await pg.query("select public.is_active_member() as allowed")).rows[0]
        .allowed,
      false,
    );
    assert.equal(
      (await pg.query("select * from public.sprints")).rows.length,
      0,
    );
  } finally {
    await pg.exec("rollback");
  }
});
test("unverified email is insufficient for access", async () => {
  await pg.exec("begin");
  try {
    await pg.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [member],
    );
    await pg.exec(
      `set local role authenticated;select set_config('request.jwt.claim.sub','${member}',true);`,
    );
    assert.equal(
      (await pg.query("select public.is_active_member() as allowed")).rows[0]
        .allowed,
      false,
    );
  } finally {
    await pg.exec("rollback");
  }
});
test("signup hook admits only active allowlisted Google accounts", async () => {
  await as("supabase_auth_admin", null, async () => {
    const hook = async (email, provider = "google") =>
      (
        await pg.query(
          "select public.hook_allowlisted_signup($1::jsonb) as result",
          [JSON.stringify({ user: { email, app_metadata: { provider } } })],
        )
      ).rows[0].result;
    assert.deepEqual(await hook("member@example.invalid"), {});
    assert.equal((await hook("outsider@example.invalid")).error.http_code, 403);
    assert.equal(
      (await hook("member@example.invalid", "email")).error.http_code,
      403,
    );
  });
});
test("members cannot call the signup hook to enumerate the allowlist", async () => {
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query("select public.hook_allowlisted_signup('{}'::jsonb)"),
      /permission denied/,
    ),
  );
});
test("sprints enforce two-week duration and nonoverlap", async () => {
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query(
        "insert into public.sprints(name,start_date,end_date) values('Invalid','2026-03-01','2026-03-15')",
      ),
      /check constraint/,
    ),
  );
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query(
        "insert into public.sprints(name,start_date,end_date) values('Overlap','2026-01-03','2026-01-16')",
      ),
      /exclusion constraint/,
    ),
  );
});
test("story points and blocker descriptions are validated in the database", async () => {
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query(
        "insert into public.work_items(title,points) values('Invalid points',4)",
      ),
      /check constraint/,
    ),
  );
  await as("authenticated", member, () =>
    assert.rejects(
      pg.query(
        "insert into public.work_items(title,points,blocked) values('Missing blocker',3,true)",
      ),
      /check constraint/,
    ),
  );
});
test("active members can add resources and purchases", async () => {
  await as("authenticated", member, async () => {
    const {
      rows: [m],
    } = await pg.query(
      "select id from public.team_members where email='member@example.invalid'",
    );
    await pg.query(
      "insert into public.resources(title,type,owner_id,date,tags) values('Test protocol','Protocol',$1,'2026-01-01',ARRAY['test'])",
      [m.id],
    );
    await pg.query(
      "insert into public.purchases(item,quantity,estimated_cost,requester_id,reason) values('Test component',2,10.50,$1,'Test reason')",
      [m.id],
    );
    assert.equal(
      (
        await pg.query(
          "select quantity * estimated_cost as total from public.purchases",
        )
      ).rows[0].total,
      "21.00",
    );
  });
});

test("removing a sprint clears work assignments without violating snapshot references", async () => {
  await as("authenticated", member, async () => {
    await pg.query(
      `insert into public.work_items(title,points,sprint_id) values('Sprint removal task',2,'${sprint1}')`,
    );
    await pg.query("delete from public.sprints where id=$1", [sprint1]);
    assert.equal(
      (
        await pg.query(
          "select sprint_id from public.work_items where title='Sprint removal task'",
        )
      ).rows[0].sprint_id,
      null,
    );
  });
});
