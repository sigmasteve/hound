-- Hound: 75 Day Challenge — a personal-accountability challenge run
-- alongside friends, not ranked against them (same "flat participation"
-- shape Daily Streak/Distance Pool/Tag already use). Loosely modeled on
-- "75 Hard": every day has a 6-item checklist —
--   - workout1 / workout2Outdoor: device-tracked (at least one workout
--     logged that day; at least two, with one flagged/guessed outdoor —
--     see src/challenges/deviceSync.ts's syncSeventyFiveFromDevice for
--     exactly how, reusing the same isOutdoor-or-name-guess signal a
--     'gps_distance' challenge already relies on)
--   - diet / water / reading / photo: self-report checkboxes — Hound has
--     no sensor for "followed your diet" or "read 10 pages," so these
--     are honor-system, same trust boundary progress_snapshots' own
--     direct client writes already have (see that table's own comment
--     in 0001_challenges_schema.sql)
--
-- Deliberately "current streak resets on a miss, doesn't eliminate you"
-- rather than the real 75 Hard's "miss a day, start the whole 75 over"
-- or Daily Streak's permanent elimination — softer than either: everyone
-- keeps playing for the challenge's full (configurable, defaults to 75
-- days in CreateScreen) duration regardless of how many resets they hit.
-- See src/challenges/seventyFive.ts's computeSeventyFiveStatus for the
-- actual current/longest-streak math — this migration only needs to
-- know a day's raw checklist state, not streak logic, since scoring
-- below counts total complete days rather than replicating the reset
-- rule in SQL.
--
-- Run this once, after 0061 (which must already have committed on its
-- own — see that file's own comment), in the SQL Editor.

create table public.seventyfive_checkins (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  workout1_done boolean not null default false,
  workout2_outdoor_done boolean not null default false,
  diet_done boolean not null default false,
  water_done boolean not null default false,
  reading_done boolean not null default false,
  photo_done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

alter table public.seventyfive_checkins enable row level security;

-- Same "any participant can see the whole challenge's progress" shape
-- progress_snapshots already has (is_challenge_participant, from
-- 0002_fix_challenge_participants_recursion.sql) — the whole point of a
-- shared accountability challenge is seeing how everyone else is doing,
-- not just your own row.
create policy "Participants can view seventyfive checkins"
  on public.seventyfive_checkins for select
  to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));

-- Direct client writes to your own row only — both the device-synced
-- columns (syncSeventyFiveFromDevice) and the self-report toggles
-- (seventyFiveApi.ts's setSelfReportCheckin) upsert only the columns
-- they own, same disjoint-columns-same-row shape as two independent
-- writers touching progress_snapshots would need, so neither ever
-- clobbers the other's fields on the same day's row.
create policy "Users can record their own seventyfive checkins"
  on public.seventyfive_checkins for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own seventyfive checkins"
  on public.seventyfive_checkins for update
  to authenticated
  using (user_id = auth.uid());

-- Same conclusion-detection logic as 0058/0060, byte-for-byte — a 75 Day
-- Challenge has no early-conclusion condition (like hunt/tag/tictacgo
-- do), it just runs its full scheduled duration, same as steps/distance/
-- streak/bingo. Only the awarding half gains one more branch.
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
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

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

  if c.kind = 'hunt' then
    hunt_fully_caught :=
      exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role in ('hunted', 'zombie'))
      and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.role = 'hunted');
    if hunt_fully_caught then
      concluded := true;
    end if;
  end if;

  if c.kind = 'tictacgo' then
    select * into ttt from public.tictacgo_games where challenge_id = p_challenge_id;
    concluded := found and ttt.status in ('won', 'draw');
  end if;

  if not concluded then
    return;
  end if;

  update public.challenges set score_settled_at = now() where id = p_challenge_id;

  if c.kind = 'hunt' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
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
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'tag' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'tag_result', 10 + least(cp.tags_made, 5) * 5, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'distance' then
    goal := case when c.distance_goal_unit = 'steps' then c.distance_goal_steps else c.distance_goal_mi end;
    select coalesce(sum(case when c.distance_goal_unit = 'steps' then ps.steps else ps.distance_mi end), 0)
      into total
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'distance_result',
      case when goal is not null and total >= goal then 15 else 10 end,
      25,
      bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind = 'steps' then
    with totals as (
      -- Not named `total` — see 0058's own comment on why that collides
      -- with this function's declared `total` variable.
      select cp.user_id, coalesce(sum(ps.steps), 0) as total_steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, row_number() over (order by total_steps desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'steps_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'streak' and c.daily_goal_steps is not null then
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
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'streak_result',
      case when survived then 40 else 10 end,
      case when survived then 30 else 25 end,
      bones_trickle
    from survival;

  elsif c.kind = 'bingo' then
    with counts as (
      select cp.user_id, count(bp.category) as n
      from public.challenge_participants cp
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case when n = 9 then 40 else n * 4 end,
      25 + n,
      bones_trickle
    from counts;

  elsif c.kind = 'tictacgo' then
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select uid, p_challenge_id, 'tictacgo_result',
      case
        when ttt.status = 'draw' then 15
        when uid = ttt.winner_user_id then 35
        else 5
      end,
      25,
      bones_trickle
    from (values (ttt.x_user_id), (ttt.o_user_id)) as players (uid);

  elsif c.kind = 'seventyfive' then
    -- Total complete days (all 6 items true), not the reset-on-a-miss
    -- streak computeSeventyFiveStatus tracks client-side — same
    -- acceptable divergence Daily Streak's own "survived" scoring
    -- already has from its own richer client display: scoring reads a
    -- simpler, independently-derived signal from the same durable rows
    -- rather than replicating the display's own reset logic in SQL.
    with counts as (
      select cp.user_id,
        count(*) filter (
          where sc.workout1_done and sc.workout2_outdoor_done and sc.diet_done
            and sc.water_done and sc.reading_done and sc.photo_done
        ) as complete_days
      from public.challenge_participants cp
      left join public.seventyfive_checkins sc
        on sc.challenge_id = cp.challenge_id and sc.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'seventyfive_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  else
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'participation', 10, 25, bones_trickle
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;
  end if;

  -- Safe to read activity_events back by challenge_id alone: the
  -- score_settled_at guard above means a challenge is only ever settled
  -- once, so every row here was inserted by this exact call, not a mix
  -- with some earlier run.
  with events as (
    select user_id, score_points, xp_points, bones_points
    from public.activity_events
    where challenge_id = p_challenge_id
  ),
  per_user as (
    select
      e.user_id, e.score_points, e.xp_points, e.bones_points,
      public.level_for_xp(p.xp_total) as old_level,
      public.level_for_xp(p.xp_total + e.xp_points) as new_level
    from events e
    join public.profiles p on p.id = e.user_id
  )
  update public.profiles p
    set hound_score = p.hound_score + pu.score_points,
        xp_total = p.xp_total + pu.xp_points,
        bones_balance = p.bones_balance + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level
    from per_user pu
    where p.id = pu.user_id;
end;
$$;

grant execute on function public.settle_challenge_score(uuid) to authenticated;
