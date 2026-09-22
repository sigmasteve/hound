-- admin_ban_user (0031_admin_ban_user.sql) set banned_until to the literal
-- 'infinity' timestamptz for a permanent ban. That value is valid in
-- Postgres but GoTrue scans banned_until into a Go time.Time, which has no
-- representation for infinity — the scan fails and login for that user (or
-- any lookup GoTrue does of that row) errors out as an opaque "Database
-- error querying schema" instead of surfacing the real "user_banned" error
-- code the client could otherwise show a clear message for.
--
-- Fixes it at the source: a permanent ban now sets banned_until 100 years
-- out instead of to infinity — effectively permanent, but a value Go's
-- time.Time can actually hold — and backfills any row already broken by
-- the old behavior.

update auth.users set banned_until = now() + interval '100 years' where banned_until = 'infinity';

create or replace function public.admin_ban_user(target_user_id uuid, ban_duration interval default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;

  update auth.users
  set banned_until = now() + coalesce(ban_duration, interval '100 years')
  where id = target_user_id;

  delete from auth.sessions where user_id = target_user_id;
end;
$$;

grant execute on function public.admin_ban_user(uuid, interval) to authenticated;
