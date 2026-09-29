-- Hound: Global Hound Challenges — challenges an admin publishes to
-- everyone, shown on Today under "Global Hound Challenges", that anyone
-- signed in can join with one tap until the challenge's own join window
-- closes.
--
-- A global challenge is an ordinary challenges row with is_global set,
-- so everything that already works on a challenge (leaderboards, device
-- sync, settlement, achievements, the friend feed, adding friends from
-- the leaderboard) works on one unchanged. What's new is who can see and
-- join it:
--   * any signed-in user can read a global challenge's row (not its
--     participants or progress — those stay members-only, as now);
--   * joining goes only through join_global_challenge(), which enforces
--     join_closes_at server-side;
--   * only an admin can create one (publish_global_challenge), and only
--     for the kinds that make sense with an open-ended crowd: Step Race,
--     Daily Streak, Distance pool, Bingo, and 75 Day. Chase, Tag, and
--     Tic-Tac-Go all depend on a small, known group (roles, turns, 1v1).
--
-- This also closes a gap in 0001's "Users can join a challenge as
-- themselves" policy, which let anyone add themselves to any challenge
-- whose id they knew. That never mattered while ids only reached
-- members and invitees; a global challenge's id reaches everyone, so
-- self-joining now requires being the challenge's creator or holding an
-- invite to it — exactly the two paths the app already uses
-- (createChallenge and acceptChallengeInvite) — and never works on a
-- global challenge, whose only way in is join_global_challenge().
--
-- Run this once, after 0001-0074, in the SQL Editor.

alter table public.challenges
  add column is_global boolean not null default false,
  -- When joining closes. Only set (and only read) for a global
  -- challenge — never earlier than it's published, never later than it
  -- ends.
  add column join_closes_at timestamptz;

create index challenges_global_idx on public.challenges (ends_at) where is_global;

-- ── Who can see / create ────────────────────────────────────────────

create policy "Anyone signed in can view global challenges"
  on public.challenges for select
  to authenticated
  using (is_global);

-- A global row only ever comes from publish_global_challenge below —
-- the app's own insert path can't set the flag itself.
drop policy if exists "Signed-in users can create challenges" on public.challenges;
create policy "Signed-in users can create challenges"
  on public.challenges for insert
  to authenticated
  with check (created_by = auth.uid() and not is_global);

-- The publishing admin can already delete it (0005's creator policy);
-- this lets any admin take one down.
create policy "Admins can delete global challenges"
  on public.challenges for delete
  to authenticated
  using (is_global and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── Who can join ────────────────────────────────────────────────────

-- Security definer so the check reads challenges/challenge_invites
-- directly rather than through their own RLS (same reason as 0002's
-- is_challenge_participant).
create or replace function public.can_self_join_challenge(p_challenge_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id
      and not c.is_global
      and (
        c.created_by = auth.uid()
        or exists (
          select 1 from public.challenge_invites ci
          where ci.challenge_id = c.id and ci.invitee_id = auth.uid()
        )
      )
  );
$$;

drop policy if exists "Users can join a challenge as themselves" on public.challenge_participants;
create policy "Users can join a challenge as themselves"
  on public.challenge_participants for insert
  to authenticated
  with check (user_id = auth.uid() and public.can_self_join_challenge(challenge_id));

-- Everyone can already join a global challenge from Today, so an invite
-- to one has nothing to do — and accepting it would skip the join
-- window.
create policy "No invites to global challenges"
  on public.challenge_invites as restrictive for insert
  to authenticated
  with check (not exists (select 1 from public.challenges c where c.id = challenge_id and c.is_global));

-- ── Publish ─────────────────────────────────────────────────────────

create or replace function public.publish_global_challenge(
  p_name text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, or 75 Day.';
  end if;
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 365 then
    raise exception 'A global challenge runs between 1 and 365 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' then
    raise exception 'Pick a start date from today on.';
  end if;
  ends := p_starts_at + make_interval(days => p_duration_days);
  if p_join_closes_at is null or p_join_closes_at <= now() or p_join_closes_at > ends then
    raise exception 'Joining has to close after now and no later than the challenge ends.';
  end if;
  if p_kind = 'streak' and coalesce(p_daily_goal_steps, 0) <= 0 then
    raise exception 'A Daily Streak needs a daily step goal.';
  end if;
  if p_kind = 'distance' and not (
    (p_distance_goal_unit = 'miles' and coalesce(p_distance_goal_mi, 0) > 0)
    or (p_distance_goal_unit = 'steps' and coalesce(p_distance_goal_steps, 0) > 0)
  ) then
    raise exception 'A Distance challenge needs a group target.';
  end if;

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type,
    is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ── List / join ─────────────────────────────────────────────────────

-- Today's list (running or upcoming global challenges) and, with
-- p_include_ended, the admin's list (everything, newest first). The
-- participant count is the one thing about a challenge's membership a
-- non-member sees.
create or replace function public.list_global_challenges(p_include_ended boolean default false)
returns table (
  id uuid,
  name text,
  kind public.challenge_kind,
  duration_days int,
  starts_at timestamptz,
  ends_at timestamptz,
  join_closes_at timestamptz,
  created_at timestamptz,
  daily_goal_steps int,
  distance_goal_unit text,
  distance_goal_mi numeric,
  distance_goal_steps int,
  bingo_card_type text,
  participant_count int,
  joined boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.kind, c.duration_days, c.starts_at, c.ends_at, c.join_closes_at, c.created_at,
    c.daily_goal_steps, c.distance_goal_unit, c.distance_goal_mi, c.distance_goal_steps, c.bingo_card_type,
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id),
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = auth.uid())
  from public.challenges c
  where c.is_global
    and auth.uid() is not null
    and (c.ends_at > now() or p_include_ended)
  order by case when p_include_ended then c.created_at end desc, c.starts_at asc
  limit 50;
$$;

create or replace function public.join_global_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id and is_global;
  if not found then
    raise exception 'That challenge isn''t available anymore.';
  end if;
  if now() >= c.join_closes_at or now() >= c.ends_at then
    raise exception 'Joining for this challenge has closed.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id)
    values (p_challenge_id, auth.uid())
    on conflict (challenge_id, user_id) do nothing;
end;
$$;

revoke execute on function public.can_self_join_challenge(uuid) from public, anon;
grant execute on function public.can_self_join_challenge(uuid) to authenticated;
revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text) to authenticated;
revoke execute on function public.list_global_challenges(boolean) from public, anon;
grant execute on function public.list_global_challenges(boolean) to authenticated;
revoke execute on function public.join_global_challenge(uuid) from public, anon;
grant execute on function public.join_global_challenge(uuid) to authenticated;
