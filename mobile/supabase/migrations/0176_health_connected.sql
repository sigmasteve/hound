-- Hound: "Connect your health data" ticks when Health is connected, not
-- only once a day with steps has synced. 0074 checked daily_step_totals
-- for a day over 0 steps, so someone who connected before walking (or on
-- an iPad, which counts no steps of its own) stayed unticked under Finish
-- setting up.
--
--   profiles.health_connected_at   when the phone first reported Health
--                                  connected (mark_health_connected);
--                                  trusted like a water day (0153).
--   onboarding_status()            0074's, with health_connected true for
--                                  either that or a synced day of steps.
--
-- Run this once, after 0175, in the SQL Editor.

alter table public.profiles add column if not exists health_connected_at timestamptz;
revoke update (health_connected_at) on public.profiles from authenticated, anon;

create or replace function public.mark_health_connected()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  update public.profiles p set health_connected_at = now()
    where p.id = auth.uid() and p.health_connected_at is null;
end;
$$;

revoke execute on function public.mark_health_connected() from public, anon;
grant execute on function public.mark_health_connected() to authenticated;

create or replace function public.onboarding_status()
returns table (
  health_connected boolean,
  has_friend boolean,
  joined_challenge boolean,
  reward_claimed boolean,
  reward_bones int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.health_connected_at is not null
      or exists (select 1 from public.daily_step_totals d where d.user_id = auth.uid() and d.steps > 0),
    exists (
      select 1
      from public.friendships f
      join public.profiles other
        on other.id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
      where (f.requester_id = auth.uid() or (f.recipient_id = auth.uid() and f.status = 'accepted'))
        and not other.is_default_friend
    ),
    exists (
      select 1 from public.challenge_participants cp where cp.user_id = auth.uid()
    ),
    p.onboarding_reward_claimed_at is not null,
    public.onboarding_reward_bones()
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke execute on function public.onboarding_status() from public, anon;
grant execute on function public.onboarding_status() to authenticated;
