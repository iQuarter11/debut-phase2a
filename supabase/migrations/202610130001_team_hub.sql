begin;
create table public.subteams (
 id uuid primary key default gen_random_uuid(), name text not null unique check (length(trim(name)) > 0)
);
create table public.team_members (
 id uuid primary key default gen_random_uuid(), email text unique check (email is null or email = lower(trim(email))),
 display_name text not null check (length(trim(display_name)) > 0),
 subteam_id uuid references public.subteams on delete set null,
 role text not null default 'member' check (role in ('member','admin')), active boolean not null default false,
 user_id uuid references auth.users on delete set null,
 check (not active or email is not null)
);
create table public.sprints (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) > 0),
 start_date date not null, end_date date not null, goal text not null default '', retrospective text not null default '',
 check (end_date = start_date + 13),
 exclude using gist (daterange(start_date, end_date, '[]') with &&)
);
create table public.work_items (
 id uuid primary key default gen_random_uuid(), title text not null check (length(trim(title)) > 0),
 description text not null default '', points integer not null check (points in (1,2,3,5,8,13)),
 subteam_id uuid references public.subteams on delete set null,
 assignee_id uuid references public.team_members on delete set null,
 sprint_id uuid references public.sprints on delete set null, due_date date,
 status text not null default 'Backlog' check (status in ('Backlog','In Progress','In Review','Done','Retired')),
 acceptance_criteria text not null default '', resource_url text check (resource_url is null or resource_url ~ '^https?://'),
 blocked boolean not null default false, blocker_reason text not null default '',
 carryover_from_id uuid references public.sprints on delete set null,
 check (not blocked or length(trim(blocker_reason)) > 0),
 check (carryover_from_id is null or (sprint_id is not null and carryover_from_id <> sprint_id))
);
create table public.priorities (
 id uuid primary key default gen_random_uuid(), sprint_id uuid not null references public.sprints on delete cascade,
 title text not null check (length(trim(title)) > 0), rank integer not null check (rank > 0),
 owner_id uuid not null references public.team_members,
 definition_of_done text not null check (length(trim(definition_of_done)) > 0),
 unique (sprint_id, rank) deferrable initially deferred
);
create table public.resources (
 id uuid primary key default gen_random_uuid(), title text not null check (length(trim(title)) > 0),
 type text not null check (type in ('Slide deck','Protocol','CAD file','Meeting notes')),
 owner_id uuid not null references public.team_members, date date not null,
 tags text[] not null default '{}', drive_url text check (drive_url is null or drive_url ~ '^https://(drive|docs)\.google\.com/')
);
create table public.purchases (
 id uuid primary key default gen_random_uuid(), item text not null check (length(trim(item)) > 0),
 quantity integer not null check (quantity > 0), estimated_cost numeric(12,2) not null check (estimated_cost >= 0),
 requester_id uuid not null references public.team_members, reason text not null check (length(trim(reason)) > 0),
 vendor text not null default '', url text check (url is null or url ~ '^https?://'),
 status text not null default 'Proposed' check (status in ('Proposed','Approved','Ordered','Received'))
);
-- SECURITY DEFINER functions avoid recursive membership policies. No caller-supplied identity.
create function public.is_active_member() returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.team_members m join auth.users u on lower(u.email) = m.email
 where u.id = auth.uid() and u.email_confirmed_at is not null and m.active);
$$;
create function public.is_team_admin() returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.team_members m join auth.users u on lower(u.email) = m.email
 where u.id = auth.uid() and u.email_confirmed_at is not null and m.active and m.role = 'admin');
$$;
revoke all on function public.is_active_member() from public;
revoke all on function public.is_team_admin() from public;
grant execute on function public.is_active_member(), public.is_team_admin() to authenticated;
-- Roster and subteam writes are admin-only; all team data reads require active membership.
do $$ declare t text; begin
 foreach t in array array['team_members','subteams','sprints','work_items','priorities','resources','purchases'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon',t);
 execute format('grant select, insert, update, delete on public.%I to authenticated',t);
 execute format('create policy member_read on public.%I for select to authenticated using (public.is_active_member())',t);
 if t in ('team_members','subteams') then
 execute format('create policy admin_insert on public.%I for insert to authenticated with check (public.is_team_admin())',t);
 execute format('create policy admin_update on public.%I for update to authenticated using (public.is_team_admin()) with check (public.is_team_admin())',t);
 execute format('create policy admin_delete on public.%I for delete to authenticated using (public.is_team_admin())',t);
 else
 execute format('create policy member_insert on public.%I for insert to authenticated with check (public.is_active_member())',t);
 execute format('create policy member_update on public.%I for update to authenticated using (public.is_active_member()) with check (public.is_active_member())',t);
 execute format('create policy member_delete on public.%I for delete to authenticated using (public.is_active_member())',t);
 end if;
 end loop;
end $$;
-- Keep one active admin. Table lock serializes concurrent demotions/removals.
create function public.protect_last_admin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 lock table public.team_members in share row exclusive mode;
 if old.role = 'admin' and old.active and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active or new.email is distinct from old.email) then
 if not exists (select 1 from public.team_members where id <> old.id and role = 'admin' and active) then
 raise exception 'Add another active admin before removing or changing the last admin.';
 end if;
 end if;
 if tg_op = 'DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.protect_last_admin() from public;
create trigger protect_last_admin before update or delete on public.team_members for each row execute function public.protect_last_admin();
create index work_sprint_idx on public.work_items(sprint_id);
create index work_assignee_idx on public.work_items(assignee_id);
create index priority_sprint_idx on public.priorities(sprint_id);
insert into public.subteams(name) values ('Mechanical'),('Electrical'),('Computational Integration'),('Software'),('Biological/Modeling');
-- Names only, inactive until an administrator adds each actual email. No guessed subteams.
insert into public.team_members(display_name) values ('Anna'),('Arya'),('Russell'),('Katherine'),('Liz'),('Paige'),('Rahul'),('Ian'),('Zach');
commit;
