-- Hound: swing with the meter or by tapping the ball (Steve, Nov 2026).
--
-- People found tapping the ball harder, in the Derby most of all, so the
-- at-bat and the Derby let each person choose: the timing meter (the
-- default, as before 0231) or tapping where the ball crosses. Nothing
-- changes in the game: baseball_swing and derby_swing already take a
-- swing with a timing and no tap (only the timing is judged). This only
-- adds the split to Admin → Overview → Games → Baseball.
--
-- Run this once, after 0244, in the SQL Editor.

create or replace function public.admin_baseball_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  return (
    with finished as (
      select g.* from public.baseball_games g where g.status = 'final'
    )
    select jsonb_build_object(
      'active', (select count(*) from public.baseball_games g where g.status = 'active'),
      'finished', (select count(*) from finished),
      'extra_innings', (select count(*) from finished f where f.inning - 1 > f.innings),
      'ties', (select count(*) from finished f where f.winner_team is null),
      'players', (select count(distinct p.user_id) from public.baseball_players p where p.user_id is not null and p.joined),
      'seats', (select count(*) from public.baseball_players p),
      'bot_seats', (select count(*) from public.baseball_players p where p.bot_id is not null),
      'avg_runs', (select coalesce(round(avg(f.runs_a + f.runs_b)::numeric, 1), 0) from finished f),
      'home_runs', (select count(*) from public.baseball_plays bp where bp.kind = 'home_run'),
      'stolen_bases', (select count(*) from public.baseball_plays bp where bp.kind = 'stolen_base'),
      'caught_stealing', (select count(*) from public.baseball_plays bp where bp.kind = 'caught_stealing'),
      'double_plays', (select count(*) from public.baseball_plays bp where bp.kind = 'double_play'),
      'picks_7d', jsonb_build_object(
        'aim', (select count(*) from public.baseball_picks k where k.aim is not null and k.updated_at > now() - interval '7 days'),
        'shift', (select count(*) from public.baseball_picks k where k.shift is not null and k.updated_at > now() - interval '7 days'),
        'approach', (select count(*) from public.baseball_picks k where k.approach is not null and k.updated_at > now() - interval '7 days'),
        'steal', (select count(*) from public.baseball_picks k where k.steal and k.updated_at > now() - interval '7 days')
      ),
      'pickers_7d', (select count(distinct k.player_id) from public.baseball_picks k where k.updated_at > now() - interval '7 days'),
      -- 0207: at-bats taken by hand.
      'live', jsonb_build_object(
        'games_hands_on', (select count(*) from public.baseball_games g where g.hands_on and g.status = 'active'),
        'people_7d', (select count(distinct a.user_id) from public.baseball_live_abs a where a.created_at > now() - interval '7 days'),
        'at_bats_7d', (select count(*) from public.baseball_live_abs a where a.status = 'done' and a.role = 'bat' and a.created_at > now() - interval '7 days'),
        'pitches_7d', (select count(*) from public.baseball_live_pitches lp where lp.created_at > now() - interval '7 days'),
        'avg_7d', (select round(avg(case when a.result in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                   from public.baseball_live_abs a
                   where a.status = 'done' and a.role = 'bat' and a.result <> 'walk' and a.created_at > now() - interval '7 days'),
        'auto_avg_7d', (select round(avg(case when bp.kind in ('single', 'double', 'triple', 'home_run') then 1.0 else 0.0 end), 3)
                        from public.baseball_plays bp
                        join public.baseball_games g on g.challenge_id = bp.challenge_id and g.hands_on
                        where not bp.by_hand and bp.created_at > now() - interval '7 days'
                          and bp.kind in ('strikeout', 'single', 'double', 'triple', 'home_run', 'ground_out', 'fly_out', 'double_play', 'sac_fly')
                          and exists (select 1 from public.baseball_players p where p.challenge_id = bp.challenge_id and p.user_id = bp.batter_id)),
        'hr_7d', (select count(*) from public.baseball_live_abs a where a.role = 'bat' and a.result = 'home_run' and a.created_at > now() - interval '7 days'),
        -- 0231: where they tapped, the curveball, the mound and steal jumps.
        'tapped_7d', (select count(*) from public.baseball_live_pitches lp where lp.tap_x is not null and lp.created_at > now() - interval '7 days'),
        'avg_miss_7d', (select round(avg(lp.miss)::numeric, 2) from public.baseball_live_pitches lp where lp.miss is not null and lp.created_at > now() - interval '7 days'),
        'curveballs_7d', (select count(*) from public.baseball_live_pitches lp
                          join public.baseball_live_abs a on a.id = lp.ab_id and a.role = 'bat'
                          where lp.kind = 'curveball' and lp.created_at > now() - interval '7 days'),
        'pitchers_7d', (select count(distinct a.user_id) from public.baseball_live_abs a where a.role = 'pitch' and a.created_at > now() - interval '7 days'),
        'pitched_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch' and a.status = 'done' and a.created_at > now() - interval '7 days'),
        'pitched_k_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch' and a.result = 'strikeout' and a.created_at > now() - interval '7 days'),
        'pitched_hits_7d', (select count(*) from public.baseball_live_abs a where a.role = 'pitch'
                            and a.result in ('single', 'double', 'triple', 'home_run') and a.created_at > now() - interval '7 days'),
        'painted_7d', (select count(*) from public.baseball_live_pitches lp where lp.ring is not null and lp.ring <= 0.08 and lp.created_at > now() - interval '7 days'),
        'mound_pitches_7d', (select count(*) from public.baseball_live_pitches lp where lp.ring is not null and lp.created_at > now() - interval '7 days'),
        'jumps_7d', (select count(*) from public.baseball_steal_jumps j where j.created_at > now() - interval '7 days'),
        'great_jumps_7d', (select count(*) from public.baseball_steal_jumps j where j.jump_ms between 0 and 200 and j.created_at > now() - interval '7 days'),
        'jump_steals_7d', (select count(*) from public.baseball_steal_jumps j where j.used_inning is not null and j.created_at > now() - interval '7 days'),
        'jump_safe_7d', (select count(*) from public.baseball_steal_jumps j where j.safe and j.created_at > now() - interval '7 days'),
        'derby_tapped_7d', (select count(*) from public.derby_swings s where s.tap_x is not null and s.swung_at > now() - interval '7 days'),
        -- 0245: the meter or tapping the ball (a meter swing has a timing
        -- and no tap), and how many people swung each way.
        'metered_7d', (select count(*) from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id and a.role = 'bat'
                       where lp.tap_x is null and lp.timing_ms is not null and lp.created_at > now() - interval '7 days'),
        'derby_metered_7d', (select count(*) from public.derby_swings s where s.tap_x is null and s.timing is not null and s.swung_at > now() - interval '7 days'),
        'meter_people_7d', (select count(distinct u) from (
            select a.user_id u from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id and a.role = 'bat'
              where lp.tap_x is null and lp.timing_ms is not null and lp.created_at > now() - interval '7 days'
            union select s.user_id from public.derby_swings s where s.tap_x is null and s.timing is not null and s.swung_at > now() - interval '7 days') m),
        'tap_people_7d', (select count(distinct u) from (
            select a.user_id u from public.baseball_live_pitches lp join public.baseball_live_abs a on a.id = lp.ab_id and a.role = 'bat'
              where lp.tap_x is not null and lp.created_at > now() - interval '7 days'
            union select s.user_id from public.derby_swings s where s.tap_x is not null and s.swung_at > now() - interval '7 days') t)
      )
    )
  );
end;
$$;
revoke execute on function public.admin_baseball_overview() from public, anon;
grant execute on function public.admin_baseball_overview() to authenticated;
