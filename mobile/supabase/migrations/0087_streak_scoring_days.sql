-- Hound: Daily Streak scoring works again, and counts the challenge's
-- own calendar days.
--
-- Two problems in settle_challenge_score's Daily Streak branch (0058,
-- carried through 0066):
--
--   1. It compared progress_snapshots.day (a date) with to_char(...)
--      (text). Postgres has no date = text comparison, so settling any
--      finished Daily Streak failed with an error and awarded nothing —
--      no "survived" bonus, no XP, no Bones, for anyone.
--   2. It walked the days from starts_at in UTC. For a challenge created
--      east of the Atlantic (starts_at the evening before in UTC) that
--      started a day early — a day progress_snapshots no longer keeps
--      (0085) — so everyone would have been counted out.
--
-- Now it checks start_day through start_day + duration_days - 1, the
-- same days every phone counts. Everything else is exactly 0066's.
--
-- Finished Daily Streak challenges that never settled because of (1)
-- are settled at the end, so their players get what they earned.
--
-- Run this once, after 0001-0086, in the SQL Editor.

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
  first_day date;
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
    -- Every day from the challenge's first day (or the day they joined,
    -- if later) through its last day. The join day is taken in UTC,
    -- which never makes someone west of UTC answer for a day before
    -- they joined.
    first_day := coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
    with survival as (
      select cp.user_id,
        not exists (
          select 1
          from generate_series(
            greatest(first_day, (cp.joined_at at time zone 'UTC')::date)::timestamp,
            (first_day + c.duration_days - 1)::timestamp,
            interval '1 day'
          ) d
          left join public.progress_snapshots ps
            on ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = d::date
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
        bones_balance = p.bones_balance + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level,
        bones_earned_total = p.bones_earned_total + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level
    from per_user pu
    where p.id = pu.user_id;
end;
$$;

grant execute on function public.settle_challenge_score(uuid) to authenticated;

-- Settle the ones (1) left unsettled.
select public.settle_challenge_score(c.id)
from public.challenges c
where c.kind = 'streak'
  and c.score_settled_at is null
  and c.ends_at <= now();
