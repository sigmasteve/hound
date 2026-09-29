-- Hound: the new-user "Get started" checklist on Today — three first
-- steps, and a one-time Bones reward for finishing all three.
--
-- Every step is checked server-side from data that already exists, the
-- same "the client asks, the server decides" shape as 0072's
-- achievements:
--   health_connected — at least one day of real steps has synced
--                      (daily_step_totals, 0027: Home records the
--                      device's step count on every load).
--   has_friend       — a friendship the user took part in: a request
--                      they sent, or an accepted one. A friendship with a
--                      default-friend account (0034, auto-added to every
--                      signup during testing) doesn't count — it's not
--                      something the user did.
--   joined_challenge — a challenge_participants row (they started one or
--                      accepted an invite).
--
-- The reward is claimed explicitly (the checklist's own "Claim" button)
-- rather than auto-awarded, so the moment reads as a small celebration.
-- It's recorded in activity_events (kind 'onboarding_reward') and — like
-- the daily bonus and achievements — credited to bones_balance only,
-- never bones_earned_total.
--
-- Run this once, after 0001-0073, in the SQL Editor.

alter table public.profiles add column onboarding_reward_claimed_at timestamptz;
-- Only claim_onboarding_reward() below may set this (same restricted-
-- column shape as is_admin / is_default_friend).
revoke update (onboarding_reward_claimed_at) on public.profiles from authenticated, anon;

-- A single place for the reward amount, read by both functions below.
create or replace function public.onboarding_reward_bones()
returns int
language sql
immutable
as $$ select 50 $$;

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
    exists (
      select 1 from public.daily_step_totals d where d.user_id = auth.uid() and d.steps > 0
    ),
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

-- Returns the Bones awarded. Refuses if any step is still open or the
-- reward was already claimed; `for update` makes a double-tap claim once.
create or replace function public.claim_onboarding_reward()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  claimed_at timestamptz;
  st record;
  reward int := public.onboarding_reward_bones();
begin
  if caller is null then
    raise exception 'Sign in to do that.';
  end if;

  select p.onboarding_reward_claimed_at into claimed_at
    from public.profiles p where p.id = caller
    for update;
  if not found then
    raise exception 'No profile for this account.';
  end if;
  if claimed_at is not null then
    raise exception 'You already claimed this reward.';
  end if;

  select * into st from public.onboarding_status();
  if not (st.health_connected and st.has_friend and st.joined_challenge) then
    raise exception 'Finish all three steps first.';
  end if;

  update public.profiles
    set onboarding_reward_claimed_at = now(),
        bones_balance = bones_balance + reward
    where id = caller;

  insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
    values (caller, 'onboarding_reward', 0, 0, reward);

  return reward;
end;
$$;

revoke execute on function public.onboarding_status() from public, anon;
grant execute on function public.onboarding_status() to authenticated;
revoke execute on function public.claim_onboarding_reward() from public, anon;
grant execute on function public.claim_onboarding_reward() to authenticated;
