# DEBUT Team Hub

A private React + TypeScript + Vite workspace backed by Supabase Auth and Postgres. The seven sections cover sprint planning, work tracking, priorities, linked resources, purchase requests, historical outcomes, and team administration.

## Local setup

Requires Node.js 20.19+ (Node 22 recommended) and npm.

```sh
npm ci
cp .env.example .env.local
# Fill in the two browser-safe values below.
npm run dev
```

Open the local URL printed by Vite. This checkout already has the supplied project values in ignored `.env.local`.

| Variable                        | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Your Supabase project URL                          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key (`sb_publishable_…`) |

Vite embeds these values at build time. Never place a secret key, service-role key, database password, or Google client secret in a `VITE_` variable. `.env.local` is ignored; `.env.example` contains blank placeholders. No roster, real emails, project data, or Drive links are bundled in the frontend.

## Database setup

In your Supabase project's SQL Editor, run the files under `supabase/migrations` **in filename order**, once each:

1. `202610130001_team_hub.sql`: schema, validations, membership/admin policies, inactive roster, subteams.
2. `202610130002_signup_allowlist.sql`: server-side Google signup allowlist hook.
3. `202610130003_sprint_history.sql`: protected historical outcome snapshots.

Alternatively, with the Supabase CLI authenticated to your project:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The browser's publishable key cannot apply migrations or configure Auth. These setup steps require a project owner in the dashboard or an authenticated CLI.

Every exposed table has RLS. Signed-out accounts have no table privileges. A confirmed Auth account must match an active roster email for any team reads or writes. Roster and subteam writes require an admin. Membership is checked from the live database on each request, so deactivation also blocks existing sessions. The last active admin cannot be demoted, deactivated, removed, or have their email changed until another active admin exists.

The initial roster contains Anna, Arya, Russell, Katherine, Liz, Paige, Rahul, Ian, and Zach, with **no emails, no subteam assignments, and inactive access**. These names are only stored in the database and are only readable by authorized members.

## Google OAuth and restricted signup

Follow Supabase's [Google sign-in configuration](https://supabase.com/docs/guides/auth/social-login/auth-google) and [Before User Created hook documentation](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook).

1. Create a Google OAuth web client. Set the authorized JavaScript origins to your local origin (`http://localhost:5173`) and your production Vercel origin. Set the Google authorized redirect URI to `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` (for the supplied project: `https://xxaboxkjvgghyrjsygen.supabase.co/auth/v1/callback`). Configure the consent screen; if Google is in testing mode, add your team as test users.
2. In Supabase Authentication → Providers, enable Google and enter its client ID and secret **in the dashboard only**. Disable other unused providers, email authentication, and anonymous sign-ins.
3. In Authentication → URL Configuration, set Site URL to your production origin. Add the exact production origin and `http://localhost:5173` to Redirect URLs. Add a specific preview origin only when testing it; avoid unrestricted production wildcard redirects. The app redirects back to the origin it was opened on.
4. Before anyone signs in, pre-allowlist the intended first administrator with the SQL below. This grants ordinary membership, not the admin role. Then enable Authentication → Hooks → **Before User Created**, choosing the Postgres function `public.hook_allowlisted_signup`.
5. Allow new account creation in Auth **only with this hook enabled**. The hook refuses accounts outside the active roster and non-Google providers. Do not open unrestricted signup or temporarily disable the hook. No public registration UI exists.

### First administrator — one-time SQL

Run this **before the first Google sign-in**, substituting the real intended email and seeded display name. This is a privileged dashboard operation; placeholders are not real team data:

```sql
update public.team_members
set email = lower('YOUR_GOOGLE_EMAIL'), active = true
where display_name = 'YOUR_SEEDED_DISPLAY_NAME';
```

Enable the hook as above, then sign in through the app using that Google account. Once Auth contains that confirmed user, run this **one-time promotion after sign-in**:

```sql
update public.team_members m
set role = 'admin', user_id = u.id
from auth.users u
where u.id = 'AUTH_USER_UUID_FROM_AUTH_DASHBOARD'
  and u.email_confirmed_at is not null
  and m.email = lower(u.email)
  and m.active;
```

Confirm exactly one row updated. Refresh the app. The user can now use Team Admin. Access relies on the verified live Auth email, not client metadata or the optional `user_id` reference. If no seeded row represents your first admin, insert a roster row with the correct name and email through the SQL Editor before signing in.

### Adding and deactivating members

In Team Admin, edit a seeded member or add a new one. Enter the **exact Google account email**, choose Member/Admin, optionally select a subteam, and enable Active. Save before their first sign-in. Do not guess subteams. Deactivating a member revokes team data access immediately at the database; their next refresh shows the pending-access screen. Keep at least two admins to avoid a single point of administration.

## Using the workspace

- **Overview** automatically picks today's active sprint using New York team dates. Its summaries open the relevant work or priority record.
- **Sprint Board** filters by sprint, subteam, assignee, and status. Open a card to edit its details, status, blocker, or sprint assignment. New items require all core fields; acceptance criteria and resource URLs are optional. Remove requires confirmation. Story points are 1, 2, 3, 5, 8, 13.
- **Sprint Priorities** lets members create nonoverlapping two-week sprints. Start date automatically proposes end date +13 days. Edit the goal, retrospective, and numbered priority ranks (unique per sprint), each with an owner and definition of done.
- Moving unfinished work to another sprint automatically records the source as carryover. Database snapshots preserve each sprint's outcome across multiple moves or deletion. Moving completed work preserves its completed points in the source sprint's history. Returning an item to a sprint makes it live there again.
- **Resources** searches titles, types, owner names, and tags. Only `drive.google.com` and `docs.google.com` URLs are accepted for Drive links; links open in a new tab. File access remains controlled by Google Drive.
- **Buy List** uses estimated **unit cost in USD**, with quantity × unit cost summed for requests not Received.
- **Sprint History** shows past goals, completed work/points, carried-over outcomes, and retrospective notes. Snapshots are read-only; live records remain editable.
- Team changes appear after **Refresh** or a browser refresh. There are no realtime subscriptions, chat, notifications, calendar integrations, AI features, or Drive indexing.

## Checks

```sh
npm run build           # Strict TypeScript check and production build
npm test                # Execute all migrations and test actual Postgres RLS/constraints/triggers
npx playwright install chromium  # One-time browser installation
npm run test:browser    # Browser workflows, isolated mocked API on port 5175
```

Database tests use ephemeral PGlite Postgres, with Auth schema and roles modeled locally. They test actual SQL policies and functions; they do not connect to or change the remote Supabase project. Browser tests use synthetic fixtures scoped to tests, never shipped in the app. Run the manual checklist against the real configured Supabase project before rollout; local policy tests do not verify its dashboard configuration or Google OAuth.

## Vercel deployment

1. Push this app to `iQuarter11/debut-phase2a` on GitHub.
2. In Vercel, import that repository. Select **Vite**, root directory `.`, build command `npm run build`, output directory `dist` (also declared in `vercel.json`).
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Production environment (and explicitly approved previews). Do not put Google secrets or Supabase secret keys there.
4. Deploy, then set the deployed origin as Supabase Site URL/allowed redirect and Google authorized JavaScript origin. Redeploy whenever a Vite environment value changes.
5. Apply all migrations, enable the signup hook, finish first-admin setup, and complete [the manual checklist](MANUAL_TESTS.md) before sharing the app with the team.

This repository contains frontend and database source; applying migrations, changing Auth dashboard settings, and initiating a Vercel deployment require account access. A publishable Supabase key supplies none of those permissions.

## Source map

- `src/App.tsx`: authorization gate, shared-data loading, navigation and seven workflows.
- `src/data.ts`: Supabase client, typed entities, date and URL helpers.
- `src/styles.css`: responsive light workspace, restrained red accents, keyboard focus and dialog styling.
- `supabase/migrations/`: schema, RLS, signup allowlist, historical outcome trigger.
- `tests/`: database and browser verification.
- `vercel.json`: Vite deployment settings and security headers.

The app intentionally uses last-save-wins editing without optimistic concurrency, and no audit trail for ordinary edits. Historic outcomes snapshot work when it leaves a sprint; a still-assigned work item reflects its current status. Plan future immutable sprint closure or edit conflict handling separately if the team needs them.

Sprints become In progress automatically on their start date; there is no manual Start action. Upcoming, In progress, and Ended labels and inclusive day counts are displayed on the overview, board, and priorities pages. All team dates use America/New_York to keep members in different time zones consistent.

## Upgrade an existing app to multiple assignees (preserves data)

For a project already running migrations 001–003, run **only** `supabase/migrations/202610140001_multiple_assignees.sql` in the Supabase SQL Editor, once. Do not rerun the original migrations or reset the database. Apply this migration before merging/deploying the multiple-assignees frontend update.

The migration adds assignment arrays, backfills each existing primary assignee as the first person, and preserves historical assignments. No records or original columns are dropped. An RLS-protected, trigger-maintained mirror uses foreign keys to keep assignment references valid. Older deployed app versions remain compatible: edits to the legacy primary assignee preserve secondary assignees. Members referenced by work or historical assignments should be deactivated rather than deleted.

After deployment, open a work item and select one or more people under **Assignees**. Current assignees remain checked, including deactivated members so an unrelated edit never silently removes ownership. Cards and summaries list all assignees; filtering by any assigned member finds the item. Purchase requesters and priority/resource owners remain single-person fields.

Verify after upgrading: open an existing assigned item and confirm its owner is checked; add a second person, save, refresh, and filter by each person. Check Sprint History retains prior ownership. The new frontend can read legacy rows if the migration is pending, but saving assignments requires the new migration and shows a setup error if it is missing.
