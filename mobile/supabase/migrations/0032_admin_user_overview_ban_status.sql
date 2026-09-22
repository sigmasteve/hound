-- Surfaces ban status alongside the rest of admin_user_overview
-- (0023_admin_user_directory.sql) so AdminUserDetailScreen can render a
-- Ban/Unban action without a second round trip. banned_until lives on
-- auth.users (see admin_ban_user/admin_unban_user, 0031_admin_ban_user.sql),
-- which profiles.select can't reach on its own.
--
-- The return row shape is changing (one more column), so the function
-- has to be dropped first — CREATE OR REPLACE can't change a RETURNS
-- TABLE column list.

drop function if exists public.admin_user_overview(uuid);

create function public.admin_user_overview(target_user_id uuid)
returns table (
  active_challenges_count bigint,
  last_health_sync_at timestamptz,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  return query
  select
    (
      select count(*)
      from public.challenge_participants cp
      join public.challenges c on c.id = cp.challenge_id
      where cp.user_id = target_user_id and c.ends_at > now()
    ),
    (
      select max(ps.recorded_at)
      from public.progress_snapshots ps
      where ps.user_id = target_user_id
    ),
    (
      select u.banned_until from auth.users u where u.id = target_user_id
    );
end;
$$;

grant execute on function public.admin_user_overview(uuid) to authenticated;
