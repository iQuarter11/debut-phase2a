begin;
-- Configure as the Before User Created hook in Supabase Auth.
-- The event email is checked against the same active roster used by RLS.
create function public.hook_allowlisted_signup(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if event -> 'user' -> 'app_metadata' ->> 'provider' = 'google'
 and exists (select 1 from public.team_members where active and email = lower(trim(event -> 'user' ->> 'email'))) then
 return '{}'::jsonb;
 end if;
 return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Your Google account is not on the active DEBUT team roster. Contact a team administrator.'));
end $$;
revoke all on function public.hook_allowlisted_signup(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_allowlisted_signup(jsonb) to supabase_auth_admin;
commit;
