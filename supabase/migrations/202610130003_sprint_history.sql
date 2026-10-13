begin;
-- Preserve an outcome whenever work moves out of a sprint or is removed.
-- No public writes: the work-item trigger is the sole writer.
create table public.work_item_history (
 id uuid primary key default gen_random_uuid(), work_item_id uuid not null,
 sprint_id uuid not null references public.sprints on delete cascade,
 title text not null, points integer not null, status text not null,
 assignee_id uuid references public.team_members on delete set null,
 outcome text not null check (outcome in ('Completed','Carried over','Retired','Removed')),
 next_sprint_id uuid references public.sprints on delete set null,
 recorded_at timestamptz not null default now(), unique(work_item_id,sprint_id)
);
alter table public.work_item_history enable row level security;
revoke all on public.work_item_history from anon, authenticated;
grant select on public.work_item_history to authenticated;
create policy member_read on public.work_item_history for select to authenticated using (public.is_active_member());
create function public.record_sprint_outcome() returns trigger language plpgsql security definer set search_path = '' as $$
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
 insert into public.work_item_history(work_item_id,sprint_id,title,points,status,assignee_id,outcome,next_sprint_id)
 values(old.id,old.sprint_id,old.title,old.points,old.status,old.assignee_id,result,next_id)
 on conflict(work_item_id,sprint_id) do update set title=excluded.title,points=excluded.points,status=excluded.status,assignee_id=excluded.assignee_id,outcome=excluded.outcome,next_sprint_id=excluded.next_sprint_id,recorded_at=now();
 if tg_op = 'UPDATE' then
 -- A returned item is live again in its destination sprint.
 delete from public.work_item_history where work_item_id=old.id and sprint_id=new.sprint_id;
 if result = 'Carried over' then new.carryover_from_id := old.sprint_id; end if;
 return new;
 end if;
 return old;
end $$;
revoke all on function public.record_sprint_outcome() from public, anon, authenticated;
create trigger record_sprint_outcome before update or delete on public.work_items for each row execute function public.record_sprint_outcome();
commit;
