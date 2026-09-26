-- Hound: Hound Score + Level/XP — Phase 1 of the gamification workshop
-- (see GitHub discussion). Two deliberately separate numbers on
-- `profiles`, both purely additive/cached totals kept in sync by one
-- settlement function below, never computed live client-side:
--   hound_score — lifetime, never decreases. "How much winning have you
--     done, ever." Built from per-kind placement/result bonuses.
--   xp_total — lifetime, participation-driven. Climbs from just playing,
--     regardless of whether you won. A person's "level" is a pure
--     function of xp_total (see src/challenges/leveling.ts) — never
--     stored, so it can't drift out of sync with the number it's derived
--     from, same "null means the old-only meaning"/derive-don't-duplicate
--     discipline distanceGoalUnit and isChallengeFinished already follow.
--
-- Every award is a real, append-only row in activity_events first, with
-- profiles.hound_score/xp_total updated in the same statement — an
-- auditable ledger, not a bare counter, so "why did my score change" is
-- always answerable and the formula can be revised later without losing
-- history. Same shape as this app's own recent medal-tally fix flagged as
-- the right pattern: never recompute a lifetime aggregate by walking a
-- user's entire challenge history live (that cost grows without bound —
-- see ChallengesScreen's own lazy-finished-details comment).
--
-- This is entirely additive: two new nullable/defaulted columns, one new
-- table, one new function. No existing column, constraint, or table is
-- touched, and nothing here is called by any code path that ships before
-- this migration does — an app that gets this migration applied before
-- its own matching client update (or the reverse) sees no behavior
-- change at all until both are in place.
--
-- Run this once, in the SQL Editor.

alter table public.profiles
  add column hound_score int not null default 0,
  add column xp_total int not null default 0;

-- One row per awarding moment — a challenge's settlement is the only
-- source right now, but this is deliberately generic (`kind` is a free
-- label, not an enum) so a future non-challenge award (e.g. a daily-goal
-- streak bonus) can reuse the same table without a migration.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete cascade,
  kind text not null,
  score_points int not null default 0,
  xp_points int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.activity_events enable row level security;

-- A private ledger for now — "why did my score change" is a personal
-- question, not a shared leaderboard feed (that's what hound_score
-- itself, readable via profiles' own existing "viewable by any signed-in
-- user" policy, is for). No insert/update/delete policy at all: every
-- write goes through settle_challenge_score below, same shape as
-- tag_rounds/tictacgo_games.
create policy "Users can view their own activity"
  on public.activity_events for select
  to authenticated
  using (user_id = auth.uid());

-- Marks a challenge as fully awarded — guards settle_challenge_score
-- against ever double-awarding the same challenge, whether it's called
-- twice from one screen's own retry or from two different screens at
-- once (Home and Challenges can both trigger a settle on the same
-- finished challenge).
alter table public.challenges add column score_settled_at timestamptz;

-- Callable by any signed-in user for any challenge id, same "safe to
-- call speculatively, no-ops unless something real happened" shape as
-- tag_settle_timeout/tictacgo_settle. Never trusts anything the client
-- computed (board.ts's own ranking, a claimed placement, anything) —
-- everything here is re-derived from the same source-of-truth tables the
-- client's own display already reads (progress_snapshots,
-- challenge_participants.role, bingo_progress, tictacgo_games), because
-- hound_score is a public, comparable number: a client-trusted "credit
-- me" call would just be a way to fabricate it.
--
-- `for update` on the challenges row makes concurrent calls for the same
-- challenge serialize on that row — the second caller's transaction
-- blocks until the first one commits (with score_settled_at now set),
-- then sees it's already settled and returns, so no exact-once race is
-- possible even from two screens settling at once.
--
-- Deliberately does NOT try to replicate every nuance of this challenge
-- kind's own live board (board.ts) — bot inclusion, head-start credit,
-- hunt-catch timing all matter for what the *display* shows *during* a
-- challenge, but scoring only needs the plain final facts once it's
-- genuinely over, most of which are already sitting in real columns
-- (challenge_participants.role, tags_made, tictacgo_games.status) rather
-- than needing recomputation at all.
create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  concluded boolean;
  hunt_fully_caught boolean := false;
  goal numeric;
  total numeric;
  ttt public.tictacgo_games%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  -- A tag game's group goal (same shared target Distance Pool's own
  -- distance_goal_unit/mi/steps columns hold — see
  -- 0045_tag_game_state.sql) can end it before its schedule does, same
  -- as tagGroupGoalMet (board.ts) already checks client-side.
  if not concluded and c.kind = 'tag' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    if goal is not null then
      select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
        into total
        from public.progress_snapshots ps
        where ps.challenge_id = p_challenge_id;
      if total >= goal then
        concluded := true;
      end if;
    end if;
  end if;

  -- Same condition as isHuntConcluded (board.ts): at least one real
  -- Hunted ever existed, and none of them still hold that role (every
  -- one of them is now a caught Zombie).
  if c.kind = 'hunt' then
    hunt_fully_caught :=
      exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role in ('hunted', 'zombie'))
      and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role = 'hunted');
    if hunt_fully_caught then
      concluded := true;
    end if;
  end if;

  -- Tic-Tac-Go already has its own real conclusion state (0057) — no
  -- schedule to wait on at all; a live game's challenge.ends_at is the
  -- far-future default until a win/draw pulls it in (see
  -- tictacgo_claim_square/tictacgo_settle).
  if c.kind = 'tictacgo' then
    select * into ttt from public.tictacgo_games where challenge_id = p_challenge_id;
    concluded := found and ttt.status in ('won', 'draw');
  end if;

  if not concluded then
    return;
  end if;

  update public.challenges set score_settled_at = now() where id = p_challenge_id;

  if c.kind = 'hunt' then
    with awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select
        cp.user_id,
        p_challenge_id,
        'hunt_result',
        case cp.role
          when 'hunter' then case when hunt_fully_caught then 40 else 10 end
          when 'zombie' then 10
          when 'hunted' then 30
          else 5
        end,
        25
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'tag' then
    -- Deliberately not ranked (see 0045's own "anti-competitive" note) —
    -- everyone shares in the group's result; tags_made (already a real,
    -- durable column) rewards having actually caught people along the
    -- way, capped so one big number can't dominate the whole score.
    with awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select cp.user_id, p_challenge_id, 'tag_result', 10 + least(cp.tags_made, 5) * 5, 25
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'distance' then
    -- A Distance Pool is cooperative, not ranked (see present.ts's own
    -- "isn't a ranked leaderboard at all") — same flat-participation
    -- shape as Tag, with a small bonus if the group actually hit its
    -- shared target.
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
      into total
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id;
    with awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select cp.user_id, p_challenge_id, 'distance_result',
        case when goal is not null and total >= goal then 15 else 10 end,
        25
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'steps' then
    -- The one genuinely head-to-head ranked kind — 1st/2nd/3rd/other,
    -- same ordinal bands the Finished list's own medal tally uses.
    with totals as (
      -- Not named `total` — that's also this function's own declared
      -- numeric variable (used by the tag/distance branches above), and
      -- plpgsql resolves a bare identifier against its own variables
      -- before table/CTE columns, silently picking the wrong one instead
      -- of erroring... except when it's genuinely ambiguous (a
      -- row_number() OVER referencing it), which is exactly what
      -- surfaced this the first time this branch actually ran.
      select cp.user_id, coalesce(sum(ps.steps), 0) as total_steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, row_number() over (order by total_steps desc) as rnk from totals
    ),
    awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select user_id, p_challenge_id, 'steps_result',
        case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
        25
      from ranked
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'streak' and c.daily_goal_steps is not null then
    -- "Survived" means computeStreakStatus (streak.ts) would show
    -- eliminatedOnDay: null at the end — no fully-elapsed day (from
    -- whichever of join/challenge-start came later, through the day
    -- before the challenge ended) where logged steps fell short of the
    -- daily goal. Uses this session's own server timezone for the day
    -- boundary rather than each participant's local one (the display's
    -- own source of truth, computeStreakStatus, already gets that right
    -- client-side) — an acceptable one-day fuzziness for a scoring bonus
    -- specifically, not for the streak-status display itself.
    with survival as (
      select cp.user_id,
        not exists (
          select 1
          from generate_series(
            greatest(cp.joined_at, c.starts_at)::timestamp,
            (c.ends_at - interval '1 day')::timestamp,
            interval '1 day'
          ) d
          left join public.progress_snapshots ps
            on ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = to_char(d, 'YYYY-MM-DD')
          where coalesce(ps.steps, 0) < c.daily_goal_steps
        ) as survived
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    ),
    awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select user_id, p_challenge_id, 'streak_result',
        case when survived then 40 else 10 end,
        case when survived then 30 else 25 end
      from survival
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'bingo' then
    with counts as (
      select cp.user_id, count(bp.category) as n
      from public.challenge_participants cp
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select user_id, p_challenge_id, 'bingo_result',
        case when n = 9 then 40 else n * 4 end,
        25 + n
      from counts
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  elsif c.kind = 'tictacgo' then
    with awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select uid, p_challenge_id, 'tictacgo_result',
        case
          when ttt.status = 'draw' then 15
          when uid = ttt.winner_user_id then 35
          else 5
        end,
        25
      from (values (ttt.x_user_id), (ttt.o_user_id)) as players (uid)
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;

  else
    -- Any other kind (or 'streak' with no daily goal ever set, which
    -- shouldn't happen — the column's nullable defensively, same as
    -- computeStreakStatus's own "no goal, no-op" fallback) gets flat
    -- participation credit rather than nothing.
    with awarded as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points)
      select cp.user_id, p_challenge_id, 'participation', 10, 25
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
      returning user_id, score_points, xp_points
    )
    update public.profiles p
      set hound_score = p.hound_score + awarded.score_points, xp_total = p.xp_total + awarded.xp_points
      from awarded where p.id = awarded.user_id;
  end if;
end;
$$;

grant execute on function public.settle_challenge_score(uuid) to authenticated;
