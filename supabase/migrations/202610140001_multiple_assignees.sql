begin;
-- Additive migration: preserve all existing records and the legacy primary assignee.
alter table public.work_items add column assignee_ids uuid[] not null default '{}';
alter table public.work_item_history add column assignee_ids uuid[] not null default '{}';
update public.work_items set assignee_ids = array[assignee_id] where assignee_id is not null;
update public.work_item_history set assignee_ids = array[assignee_id] where assignee_id is not null;

-- Synchronize old clients and the new editor atomically in the existing RLS-protected row.
create function public.sync_work_assignees() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   if cardinality(new.assignee_ids) = 0 and new.assignee_id is not null then
     new.assignee_ids := array[new.assignee_id];
   end if;
 elsif new.assignee_ids is not distinct from old.assignee_ids and new.assignee_id is distinct from old.assignee_id then
   if new.assignee_id is null then new.assignee_ids := '{}';
   else new.assignee_ids := array[new.assignee_id] || coalesce(old.assignee_ids[2:cardinality(old.assignee_ids)],'{}'::uuid[]);
   end if;
 end if;
 if new.assignee_ids is null or array_position(new.assignee_ids,null) is not null then
   raise exception 'Assignee list cannot contain null values.';
 end if;
 if exists(select 1 from unnest(new.assignee_ids) as a(id) where not exists(select 1 from public.team_members m where m.id=a.id)) then
   raise exception 'Every assignee must be a team member.';
 end if;
 -- Retain selection order and remove duplicates.
 select coalesce(array_agg(id order by first_position),'{}'::uuid[]) into new.assignee_ids
 from (select id,min(position) as first_position from unnest(new.assignee_ids) with ordinality as a(id,position) group by id) deduplicated;
 new.assignee_id := new.assignee_ids[1];
 return new;
end $$;
revoke all on function public.sync_work_assignees() from public, anon, authenticated;
create trigger a_sync_work_assignees before insert or update on public.work_items for each row execute function public.sync_work_assignees();
create index work_assignee_ids_idx on public.work_items using gin(assignee_ids);

-- Foreign-key-backed mirror keeps array membership valid even during concurrent writes.
create table public.work_item_assignees (
 work_item_id uuid not null references public.work_items on delete cascade,
 member_id uuid not null references public.team_members on delete restrict,
 primary key(work_item_id, member_id)
);
alter table public.work_item_assignees enable row level security;
revoke all on public.work_item_assignees from public, anon, authenticated;
grant select on public.work_item_assignees to authenticated;
create policy member_read on public.work_item_assignees for select to authenticated using(public.is_active_member());
insert into public.work_item_assignees(work_item_id,member_id)
select w.id,a.id from public.work_items w cross join lateral unnest(w.assignee_ids) as a(id);
create index work_item_assignees_member_idx on public.work_item_assignees(member_id);
create function public.mirror_work_assignees() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.work_item_assignees where work_item_id=new.id and not(member_id=any(new.assignee_ids));
 insert into public.work_item_assignees(work_item_id,member_id) select new.id,id from unnest(new.assignee_ids) as a(id) on conflict do nothing;
 return new;
end $$;
revoke all on function public.mirror_work_assignees() from public, anon, authenticated;
create trigger mirror_work_assignees after insert or update on public.work_items for each row execute function public.mirror_work_assignees();

-- Preserve historical ownership: deactivate assigned members instead of deleting their identity.
create function public.protect_assigned_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.work_items where old.id = any(assignee_ids))
 or exists(select 1 from public.work_item_history where old.id = any(assignee_ids)) then
   raise exception 'This member has work assignments or sprint history. Deactivate them instead of deleting them.';
 end if;
 return old;
end $$;
revoke all on function public.protect_assigned_member() from public, anon, authenticated;
create trigger protect_assigned_member before delete on public.team_members for each row execute function public.protect_assigned_member();

create or replace function public.record_sprint_outcome() returns trigger language plpgsql security definer set search_path = '' as $$
declare next_id uuid; result text;
begin
 if old.sprint_id is null or not exists (select 1 from public.sprints where id=old.sprint_id) then
 if tg_op = 'DELETE' then return old; end if;
 return new;
 end if;
 if tg_op = 'UPDATE' then
 if new.sprint_id is not distinct from old.sprint_id then return new; end if;
 next_id := new.sprint_id;
 end if;
 result := case when old.status = 'Done' then 'Completed' when old.status = 'Retired' then 'Retired' when tg_op = 'DELETE' or next_id is null then 'Removed' else 'Carried over' end;
 insert into public.work_item_history(work_item_id,sprint_id,title,points,status,assignee_id,assignee_ids,outcome,next_sprint_id)
 values(old.id,old.sprint_id,old.title,old.points,old.status,old.assignee_id,old.assignee_ids,result,next_id)
 on conflict(work_item_id,sprint_id) do update set title=excluded.title,points=excluded.points,status=excluded.status,assignee_id=excluded.assignee_id,assignee_ids=excluded.assignee_ids,outcome=excluded.outcome,next_sprint_id=excluded.next_sprint_id,recorded_at=now();
 if tg_op = 'UPDATE' then
 -- A returned item is live again in its destination sprint.
 delete from public.work_item_history where work_item_id=old.id and sprint_id=new.sprint_id;
 if result = 'Carried over' then new.carryover_from_id := old.sprint_id; end if;
 return new;
 end if;
 return old;
end $$;
commit;
