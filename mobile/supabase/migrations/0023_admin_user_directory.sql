-- Admin user directory: lets an admin look up any user's activity, not
-- just their own (profiles.select is already open to any signed-in user
-- — see 0001_challenges_schema.sql — so name/email search needs nothing
-- new). What 0001's RLS does NOT allow is seeing a stranger's challenge
-- participation or progress rows ("Participants can view each other" /
-- "...challenge progress" both require the caller to be a co-participant),
-- so an admin needs a security-definer escape hatch for those two counts,
-- same shape as add_friend_by_code (0019_friend_codes.sql) needing one to
-- insert a row the caller's own insert policy wouldn't otherwise allow.

create or replace function public.admin_user_overview(target_user_id uuid)
returns table (
  active_challenges_count bigint,
  last_health_sync_at timestamptz
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
      -- There's no dedicated "health sync configured" signal anywhere
      -- yet — recordProgress() only ever writes a progress_snapshots row
      -- once a device sync actually happens, so its most recent
      -- recorded_at across every challenge is the closest thing to "last
      -- synced" that exists today. It's an approximation (challenge-
      -- scoped, not a standalone connection flag) and the UI labels it
      -- as such.
      select max(ps.recorded_at)
      from public.progress_snapshots ps
      where ps.user_id = target_user_id
    );
end;
$$;

grant execute on function public.admin_user_overview(uuid) to authenticated;
