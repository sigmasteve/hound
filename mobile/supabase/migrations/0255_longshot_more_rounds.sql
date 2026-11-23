-- 0255: more Long Shot rounds (Steve, 23 Nov 2026: "this game is more
-- challenging, maybe 10 rounds can be lifted to 15", and a way to earn
-- extra). Steps now give up to 15 a day (1 per 1,000), and the day's
-- workouts add a round per 20 minutes, counting up to 100 minutes: 20 min
-- is 1, 40 min 2, two 30-minute workouts (60) 3, and 100 minutes or more
-- 5. So up to 20 a day. Unused rounds still carry over a day, up to 10.
-- longshot_state says how many came from workouts; Admin → Long Shot
-- counts today's workout rounds.
--
-- Run this once, after 0001-0254, in the SQL Editor.

alter table public.longshot_settings
  add column if not exists workout_round_min int not null default 20 check (workout_round_min between 5 and 120),
  add column if not exists workout_max_min int not null default 100 check (workout_max_min between 0 and 600);
alter table public.longshot_settings alter column max_rounds set default 15;
update public.longshot_settings set max_rounds = 15 where max_rounds = 10;

-- Rounds a day's workout minutes earn: one per 20 minutes, counting up
-- to 100 minutes.
create or replace function public.longshot_workout_rounds(p_min int)
returns int
language sql
stable
security definer set search_path = public
as $$
  select (least(greatest(coalesce(p_min, 0), 0), s.workout_max_min) / s.workout_round_min)::int from public.longshot_settings s;
$$;
revoke execute on function public.longshot_workout_rounds(int) from public, anon, authenticated;

-- What a day gives: steps (up to max_rounds) and workouts.
create or replace function public.longshot_granted(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select least(s.max_rounds, public.chess_steps(p_user, p_day) / s.steps_per_round)
    + public.longshot_workout_rounds(public.chess_workout_min(p_user, p_day))
  from public.longshot_settings s;
$$;
revoke execute on function public.longshot_granted(uuid, date) from public, anon, authenticated;

create or replace function public.longshot_state(p_challenge_id uuid, p_steps int default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  s public.longshot_settings%rowtype;
  p public.longshot_players%rowtype;
  today date;
  day_no int;
  d public.longshot_days%rowtype;
  joined boolean;
  steps int;
  wmin int;
  from_steps int;
  from_workout int;
  n int;
  pool int;
  my_rank int;
  places_w int;
  w_total int;
  rest_n int;
  cond jsonb;
  world text;
  game_steps int;
  board jsonb;
  plates jsonb;
  rifles jsonb;
  card jsonb;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'longshot' then
    raise exception 'That isn''t a Long Shot challenge.';
  end if;
  joined := exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me);
  if not joined and not c.is_global then
    raise exception 'Join the challenge to see it.';
  end if;
  select * into s from public.longshot_settings;
  today := public.soccer_today(me);
  if p_steps is not null and p_steps between 0 and 150000 then
    insert into public.chess_claims (user_id, day, steps) values (me, today, p_steps)
    on conflict (user_id, day) do update set steps = greatest(public.chess_claims.steps, excluded.steps);
  end if;
  day_no := today - public.soccer_first_day(c) + 1;
  if joined then
    insert into public.longshot_players (challenge_id, user_id) values (p_challenge_id, me) on conflict do nothing;
  end if;
  if day_no between 1 and c.duration_days and c.score_settled_at is null and joined then
    d := public.longshot_day_row(p_challenge_id, me, today);
  end if;
  select * into p from public.longshot_players where challenge_id = p_challenge_id and user_id = me;
  steps := public.chess_steps(me, today);
  wmin := public.chess_workout_min(me, today);
  from_steps := least(s.max_rounds, steps / s.steps_per_round);
  from_workout := public.longshot_workout_rounds(wmin);
  select count(*)::int into n from public.challenge_participants cp where cp.challenge_id = p_challenge_id;
  pool := public.longshot_pool(p_challenge_id);
  select 1 + count(*) into my_rank from public.longshot_players x where x.challenge_id = p_challenge_id and x.points > coalesce(p.points, 0);
  places_w := (select coalesce(sum(public.longshot_place_weight(i)), 0) from generate_series(1, least(n, 10)) i);
  rest_n := greatest(0, n - 10);
  w_total := places_w + case when rest_n > 0 then 12 else 0 end;
  cond := public.longshot_conditions(p_challenge_id, today);
  world := cond ->> 'world';
  game_steps := case when joined then public.longshot_game_steps(p_challenge_id, me) else 0 end;

  with ranked as (
    select x.user_id, x.points, x.hits, x.shots, x.longest, rank() over (order by x.points desc) as rnk,
           row_number() over (order by x.points desc, x.longest desc, x.updated_at, x.user_id) as rn
    from public.longshot_players x where x.challenge_id = p_challenge_id
  ),
  mine as (select rn from ranked where user_id = me)
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rnk, 'tied', (select count(*) from ranked y where y.rnk = r.rnk) > 1,
           'userId', r.user_id, 'name', public.horse_name(r.user_id), 'points', r.points, 'hits', r.hits, 'shots', r.shots,
           'longest', r.longest, 'me', r.user_id = me) order by r.rn), '[]'::jsonb)
    into board
  from ranked r
  where r.rn <= 10 or abs(r.rn - coalesce((select rn from mine), -100)) <= 1;

  select coalesce(jsonb_agg(jsonb_build_object('dist', x.dist, 'size', x.size, 'pts', x.pts,
           'gold', (cond ->> 'bounty')::boolean and x.dist = (cond ->> 'gold')::int,
           'hitToday', exists (select 1 from public.longshot_shots y where y.challenge_id = p_challenge_id and y.user_id = me
                                and y.day = today and y.dist = x.dist and y.hit)) order by x.dist), '[]'::jsonb)
    into plates
  from public.longshot_plates((cond ->> 'far')::int, world) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'bullet', k.bullet, 'barrels', to_jsonb(k.barrels),
           'refBarrel', k.ref_barrel, 'unlockSteps', k.unlock_steps, 'unlocked', k.unlock_steps <= game_steps,
           'mv', k.mv, 'fpsInch', k.fps_inch, 'sway', k.sway,
           'at1000', jsonb_build_object('drop', round((public.longshot_book_get(k.id, k.ref_barrel, 'earth', 1000)).drop_mil::numeric, 1),
                       'wind10', round(((public.longshot_book_get(k.id, k.ref_barrel, 'earth', 1000)).lag * 4.4704 / 914.4 * 1000)::numeric, 1)),
           'drops', (select jsonb_agg(round((public.longshot_book_get(k.id, k.ref_barrel, 'earth', dd)).drop_mil::numeric, 1) order by dd)
                     from unnest(array[300, 600, 1000, 1500, 2000, 2500, 3000]) dd),
           'subsonicAt', (select min(dd) from unnest(array[300, 600, 1000, 1500, 2000, 2500, 3000]) dd
                          where (public.longshot_book_get(k.id, k.ref_barrel, 'earth', dd)).v_end < 1125))
           order by k.sort), '[]'::jsonb)
    into rifles
  from public.longshot_calibers k;

  if p.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('dist', x.dist,
             'elev', round(public.longshot_dial(me, p.caliber, p.barrel, cond ->> 'place', world, x.dist)::numeric, 1),
             'book', round((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).drop_mil::numeric, 1),
             'learned', exists (select 1 from public.longshot_cards k where k.user_id = me and k.caliber = p.caliber and k.barrel = p.barrel
                                  and k.place = cond ->> 'place' and k.world = world and k.dist = x.dist),
             'wind10', round(((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).lag * 4.4704 / (x.dist * 0.9144) * 1000)::numeric, 2),
             'tof', round((public.longshot_book_get(p.caliber, p.barrel, world, x.dist)).tof::numeric, 2)) order by x.dist), '[]'::jsonb)
      into card
    from public.longshot_plates((cond ->> 'far')::int, world) x;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object('stepsPerRound', s.steps_per_round, 'maxRounds', s.max_rounds, 'carryMax', s.carry_max,
                  'workoutRoundMin', s.workout_round_min, 'workoutMaxMin', s.workout_max_min,
                  'workoutMin', s.workout_min, 'coldBore', s.cold_bore, 'bountyBones', s.bounty_bones, 'finishDays', s.finish_days),
    'name', c.name,
    'isGlobal', c.is_global,
    'dayNo', day_no,
    'days', c.duration_days,
    'endsAt', c.ends_at,
    'over', c.score_settled_at is not null or day_no > c.duration_days,
    'players', n,
    'pool', pool,
    'prizes', jsonb_build_object(
      'places', (select coalesce(jsonb_agg(case when w_total > 0 then floor(pool * public.longshot_place_weight(i)::numeric / w_total)::int else 0 end order by i), '[]'::jsonb)
                 from generate_series(1, least(n, 10)) i),
      'rest', case when rest_n > 0 then floor(pool * 12::numeric / w_total)::int end,
      'restMin', s.finish_min_bones),
    'conditions', cond,
    'goldTaker', (select jsonb_build_object('name', public.horse_name(b.user_id), 'me', b.user_id = me, 'dist', b.dist, 'bones', b.bones)
                  from public.longshot_bounties b where b.challenge_id = p_challenge_id and b.day = today),
    'plates', plates,
    'rifles', rifles,
    'card', coalesce(card, '[]'::jsonb),
    'me', jsonb_build_object('joined', joined, 'points', coalesce(p.points, 0), 'rank', my_rank, 'hits', coalesce(p.hits, 0),
            'shots', coalesce(p.shots, 0), 'longest', coalesce(p.longest, 0), 'caliber', coalesce(p.caliber, '65'),
            'barrel', coalesce(p.barrel, 24), 'gameSteps', game_steps,
            'shotDays', (select count(distinct x.day) from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = me)),
    'today', jsonb_build_object('steps', steps, 'fromSteps', from_steps, 'fromWorkout', from_workout, 'workoutMin', wmin, 'steady', wmin >= s.workout_min,
               'carried', coalesce(d.carried_in, 0), 'used', coalesce(d.used, 0),
               'left', case when d.challenge_id is null then 0 else greatest(0, d.carried_in - d.used + public.longshot_granted(me, today)) end,
               'nextAt', case when from_steps >= s.max_rounds then null else (from_steps + 1) * s.steps_per_round end),
    'board', board,
    'feed', coalesce((select jsonb_agg(jsonb_build_object('name', public.horse_name(x.user_id), 'dist', x.dist, 'center', x.center,
                        'gold', x.bounty, 'points', x.points, 'at', x.created_at) order by x.created_at desc)
                      from (select * from public.longshot_shots x where x.challenge_id = p_challenge_id and x.hit and x.dist >= 1500
                            and x.created_at > now() - interval '1 day' order by x.created_at desc limit 5) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('dist', x.dist, 'hit', x.hit, 'center', x.center, 'points', x.points,
                          'xIn', x.impact_x, 'yIn', x.impact_y, 'at', x.created_at) order by x.created_at desc)
                        from (select * from public.longshot_shots x where x.challenge_id = p_challenge_id and x.user_id = me
                              order by x.created_at desc limit 6) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.longshot_state(uuid, int) from public, anon;
grant execute on function public.longshot_state(uuid, int) to authenticated;

create or replace function public.admin_longshot_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'games', (select count(*) from public.challenges c where c.kind::text = 'longshot'),
    'live', (select count(*) from public.challenges c where c.kind::text = 'longshot' and c.score_settled_at is null and now() < c.ends_at),
    'tried', (select count(distinct s.user_id) from public.longshot_shots s),
    'active7d', (select count(distinct s.user_id) from public.longshot_shots s where s.created_at > now() - interval '7 days'),
    'rounds7d', (select count(*) from public.longshot_shots s where s.created_at > now() - interval '7 days'),
    'hits7d', (select count(*) from public.longshot_shots s where s.hit and s.created_at > now() - interval '7 days'),
    'moon7d', (select count(*) from public.longshot_shots s where s.world = 'moon' and s.created_at > now() - interval '7 days'),
    'gold7d', (select count(*) from public.longshot_bounties b where b.created_at > now() - interval '7 days'),
    'goldBones', (select coalesce(sum(b.bones), 0) from public.longshot_bounties b),
    'plates', coalesce((
      select jsonb_agg(jsonb_build_object('dist', x.dist, 'shots', x.n, 'hits', x.h) order by x.dist)
      from (select s.dist, count(*) as n, count(*) filter (where s.hit) as h
            from public.longshot_shots s where s.world = 'earth' and s.created_at > now() - interval '7 days' group by s.dist) x
    ), '[]'::jsonb),
    'rifles', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.caliber, 'name', k.name, 'shots', x.n) order by x.n desc)
      from (select s.caliber, count(*) as n from public.longshot_shots s where s.created_at > now() - interval '7 days' group by s.caliber) x
      join public.longshot_calibers k on k.id = x.caliber
    ), '[]'::jsonb),
    'cards', (select count(distinct k.user_id) from public.longshot_cards k),
    -- 0255: rounds from workouts today, among players in live games.
    'workoutRoundsToday', (select coalesce(sum(x.r), 0) from (
        select distinct cp.user_id, public.longshot_workout_rounds(public.chess_workout_min(cp.user_id, public.soccer_today(cp.user_id))) as r
        from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
        where c.kind::text = 'longshot' and c.score_settled_at is null and now() < c.ends_at) x),
    'workoutPeopleToday', (select count(*) from (
        select distinct cp.user_id from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
        where c.kind::text = 'longshot' and c.score_settled_at is null and now() < c.ends_at
          and public.longshot_workout_rounds(public.chess_workout_min(cp.user_id, public.soccer_today(cp.user_id))) > 0) x)
  );
end;
$$;
revoke execute on function public.admin_longshot_overview() from public, anon;
grant execute on function public.admin_longshot_overview() to authenticated;
