-- 0197: Hoops fouls need a defender who walked.
--
-- A foul was "twice your defender's steps", so a defender with nothing
-- synced that day (0 steps) fouled you on your first shot every day. Now
-- the defender needs 1,000 steps or more that day for a foul to count.
-- hoops_play_day as in 0195, with that one condition added.

create or replace function public.hoops_play_day(p_challenge_id uuid, p_day date, p_day_no int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.hoops_games%rowtype;
  per int;
  def_home text;
  def_away text;
  team_steps jsonb;
  seats jsonb := '[]'::jsonb;
  s record;
  rnd int;
  t text;
  o text;
  seq int := 0;
  pts_home int := 0;
  pts_away int := 0;
  st jsonb;
  i int;
  mine int;
  theirs int;
  their_def text;
  kind text;
  dunk boolean;
  fire boolean;
  ch double precision;
  made boolean;
  p int;
  streaks jsonb := '{}'::jsonb;
  streak int;
  share double precision;
  reb text;
  seed text;
  steps_home numeric;
  steps_away numeric;
begin
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  per := public.hoops_period_of(p_day_no, g.days_per_quarter);
  def_home := public.hoops_defense(p_challenge_id, 'home', p_day);
  def_away := public.hoops_defense(p_challenge_id, 'away', p_day);

  -- Every joined seat's steps, its defender's, and its shots.
  for s in
    select hp.id, hp.team, hp.shot, public.hoops_steps(p_challenge_id, hp.player_id, p_day) as steps,
           public.hoops_defender_of(hp.id) as def_id
    from public.hoops_players hp
    where hp.challenge_id = p_challenge_id and hp.joined
    order by hp.team, hp.baseline desc, hp.seated_at, hp.id
  loop
    seats := seats || jsonb_build_object('id', s.id, 'team', s.team, 'shot', s.shot, 'steps', s.steps, 'def', s.def_id,
      'shots', least(5, floor(s.steps::numeric / g.shot_steps))::int);
  end loop;
  -- Defenders' steps (a defender who hasn't joined walks nothing).
  select coalesce(jsonb_agg(x || jsonb_build_object('def_steps',
      coalesce((select (y ->> 'steps')::int from jsonb_array_elements(seats) y where y ->> 'id' = x ->> 'def'), 0))), '[]'::jsonb)
    into seats from jsonb_array_elements(seats) x;
  select coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'home'), 0),
         coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'away'), 0)
    into steps_home, steps_away from jsonb_array_elements(seats) x;

  for rnd in 1..5 loop
    foreach t in array array['home', 'away'] loop
      o := case when t = 'home' then 'away' else 'home' end;
      their_def := case when t = 'home' then def_away else def_home end;
      share := case when steps_home + steps_away = 0 then 0.5
                    when t = 'home' then steps_home / (steps_home + steps_away) else steps_away / (steps_home + steps_away) end;
      for st in select x from jsonb_array_elements(seats) x where x ->> 'team' = t and (x ->> 'shots')::int >= rnd loop
        mine := (st ->> 'steps')::int;
        theirs := (st ->> 'def_steps')::int;
        streak := coalesce((streaks ->> (st ->> 'id'))::int, 0);
        seed := p_challenge_id::text || ':' || p_day || ':' || (st ->> 'id') || ':' || rnd;

        if rnd = 1 and mine >= 4000 and theirs >= 1000 and mine >= 2 * theirs then
          -- Fouled: two free throws.
          for i in 1..2 loop
            seq := seq + 1;
            made := public.rally_js_rand(public.rally_js_hash(seed || ':ft' || i)) < public.hoops_chance('ft', mine, theirs, their_def, false, false);
            p := case when made then 1 else 0 end;
            insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, shooter_steps, defender_steps, defense)
              values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'ft', made, p, mine, theirs, their_def);
            if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          end loop;
          continue;
        end if;

        kind := st ->> 'shot';
        dunk := kind = 'drive' and mine >= 15000;
        fire := streak >= 3;
        ch := public.hoops_chance(kind, mine, theirs, their_def, dunk, fire);
        made := public.rally_js_rand(public.rally_js_hash(seed || ':shot')) < ch;
        p := case when not made then 0 when kind = 'three' then 3 else 2 end;
        reb := null;
        if not made then
          reb := case when public.rally_js_rand(public.rally_js_hash(seed || ':reb')) < 0.6 * share then t else o end;
        end if;
        seq := seq + 1;
        insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, dunk, made, pts, on_fire, rebound, shooter_steps, defender_steps, defense)
          values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, kind, dunk and made, made, p, fire, reb, mine, theirs, their_def);
        if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
        streak := case when made then streak + 1 else 0 end;

        if reb = t then
          -- The putback.
          ch := public.hoops_chance('putback', mine, theirs, their_def, false, false);
          made := public.rally_js_rand(public.rally_js_hash(seed || ':putback')) < ch;
          p := case when made then 2 else 0 end;
          seq := seq + 1;
          insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, rebound, shooter_steps, defender_steps, defense)
            values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'putback', made, p,
                    case when made then null else o end, mine, theirs, their_def);
          if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          streak := case when made then streak + 1 else 0 end;
        end if;
        streaks := streaks || jsonb_build_object(st ->> 'id', streak);
      end loop;
    end loop;
  end loop;

  insert into public.hoops_days (challenge_id, day, day_no, period, label, home, away, defense_home, defense_away)
    values (p_challenge_id, p_day, p_day_no, per, public.hoops_label(per), pts_home, pts_away, def_home, def_away);
  update public.hoops_games
    set score_home = score_home + pts_home, score_away = score_away + pts_away, days_played = p_day_no, updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.hoops_play_day(uuid, date, int) from public, anon, authenticated;
