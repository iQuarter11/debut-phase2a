# Pre-rollout manual checks

Use a configured Supabase project and two active member accounts, one admin, one inactive account, and one nonmember. Use disposable test records, not important project data.

- [ ] Signed out: only the Google sign-in screen appears. Direct anonymous REST reads/writes to every exposed table fail; no roster names appear in frontend source or the initial page.
- [ ] New nonmember Google sign-in is refused by the Before User Created hook. An already-existing Auth nonmember sees pending access and receives no rows from any table; inserts fail and updates/deletes affect zero rows.
- [ ] Admin activates a member using their real Google email. The member signs in successfully. Unverified accounts cannot access data. Nonmembers cannot self-activate or self-promote through REST.
- [ ] A member cannot change the roster/subteams through the UI or a direct API call. Admin can add/update/deactivate members and edit subteams; removing a subteam clears assignments. Last active admin cannot be removed or demoted.
- [ ] Create a two-week sprint spanning today with name and goal; a non-two-week or overlapping sprint is rejected. Overview shows its dates and goal. Navigate previous/upcoming sprints.
- [ ] Add ranked priorities with owners and definitions of done. Edit rank/title/owner, reject duplicate ranks, remove a priority, and reopen from Overview.
- [ ] Create assigned work with title, description, valid points, subteam, sprint, due date, acceptance criteria, and optional resource. Edit and move Backlog → In Progress → In Review → Done; also check Retired. Verify all four filters and clear filters.
- [ ] Mark work blocked and provide a reason. Card and Overview show the blocker; deadlines and review items open their records. Clear the blocker.
- [ ] Carry unfinished work from sprint A to B and then C. History for A and B retains the appropriate carried-over outcome. Move completed work and confirm its source sprint retains completed points. Add retrospective notes and reopen them. Returning work to a sprint does not double-count it.
- [ ] Add/search/edit/remove a resource with type, owner, date, and tags. Drive link opens in a new tab; an invalid or non-Drive resource URL is rejected. Drive still requires its own access permissions.
- [ ] Add/edit/remove a purchase request. Verify all four statuses. For quantity 3 and unit cost $12.50, the outstanding total includes $37.50 until Received, then excludes it.
- [ ] Make a change as one member, refresh as the other, and see shared data. Deactivate the second member while signed in; their next data request has no access and refreshing clears the workspace.
- [ ] At phone and desktop sizes, navigate all sections. Tab through controls, open a dialog, confirm focus stays inside, use Escape to close, and confirm focus returns. Check loading, empty, network-error, unauthorized, and failed-save states.
- [ ] Production Vercel origin completes Google OAuth; unknown redirect origins are not allowed. Confirm `.env.local` is ignored and no secret/service-role key exists in the build or repository.
