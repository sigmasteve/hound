-- Hound: which golf scores send a push (Steve, Nov 2026: "limit it to
-- just eagles").
--
-- A good score on a hole sends everyone else in the game a push ("Ann
-- eagled the 3rd at Seaside Links"; in a Global game like the Hound Open,
-- only the player's friends in it). It was every birdie or better; now
-- it's Admin's, for every golf game (Admin → Overview → Games → Golf,
-- "Score pushes"):
--   birdie  a birdie or better (as before)
--   eagle   an eagle or better (a hole in one always counts)
--   ace     only a hole in one
--   none    no score pushes
-- golf_strike (0214's, with only the push's check changed) reads it, and
-- admin_set_golf_config (0200's) sets it.
--
-- Run this once, after 0283, in the SQL Editor.

alter table public.golf_config
  add column if not exists push_min text not null default 'birdie'
  check (push_min in ('birdie', 'eagle', 'ace', 'none'));

create or replace function public.golf_strike(
  p_challenge_id uuid, p_user uuid, p_club text, p_yards numeric, p_aim numeric, p_power int, p_timing numeric,
  p_walk uuid, p_day date
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_push text;
  g public.golf_games%rowtype;
  pl public.golf_players%rowtype;
  h jsonb;
  hpar int;
  cno int;
  cname text;
  w jsonb;
  f jsonb;
  v_to_d numeric;
  v_to_lat numeric;
  v_ball_d numeric;
  v_ball_lat numeric;
  v_lie text;
  v_rest_lie text;
  v_penalty int := 0;
  v_holed boolean;
  v_strokes int;
  v_score int;
  v_picked boolean := false;
  n_seq int;
  hz jsonb;
  msg text;
  word text;
  in_trees boolean;
  r record;
  finished boolean := false;
  banks jsonb;
  c public.challenges%rowtype;
  v_global boolean;
  v_bonus int;
  pos record;
  swung int;
  -- What the bank pays: whole yards, at least one (a 4 ft putt is a yard).
  v_spend int := greatest(1, round(p_yards))::int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  v_global := coalesce(c.is_global, false);
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  select * into pl from public.golf_players where challenge_id = p_challenge_id and user_id = p_user;
  cno := public.golf_course_no(pl.hole);
  select x.hole, x.par into h, hpar from public.golf_holes x where x.course_id = g.course_id and x.no = cno;
  select k.name into cname from public.golf_courses k where k.id = g.course_id;
  w := public.golf_wind(g.course_id, cno, p_day);
  f := public.golf_flight(h, pl.ball_d, pl.ball_lat, pl.lie, p_club, p_yards, p_aim, p_power, p_timing,
    (w ->> 'mph')::numeric, (w ->> 'deg')::numeric, (public.golf_cfg()).putt_cup, (public.golf_cfg()).cup);
  v_to_d := (f ->> 'to_d')::numeric;
  v_to_lat := (f ->> 'to_lat')::numeric;
  v_lie := f ->> 'lie';
  v_holed := (f ->> 'holed')::boolean;
  v_strokes := pl.strokes + 1;
  v_ball_d := v_to_d;
  v_ball_lat := v_to_lat;
  v_rest_lie := v_lie;

  if v_lie = 'water' then
    v_penalty := 1;
    hz := public.golf_hazard_at(h, v_to_d, v_to_lat, array['water']);
    if hz ? 'drop' then
      v_ball_d := (hz -> 'drop' ->> 'd')::numeric;
      v_ball_lat := (hz -> 'drop' ->> 'lat')::numeric;
      v_rest_lie := public.golf_lie(h, v_ball_d, v_ball_lat);
      if v_rest_lie in ('water', 'out', 'tee') then
        v_rest_lie := 'rough';
      end if;
    else
      v_ball_d := pl.ball_d;
      v_ball_lat := pl.ball_lat;
      v_rest_lie := pl.lie;
    end if;
  elsif v_lie = 'out' then
    v_penalty := 1;
    v_ball_d := pl.ball_d;
    v_ball_lat := pl.ball_lat;
    v_rest_lie := pl.lie;
  end if;
  v_strokes := v_strokes + v_penalty;

  if v_holed then
    v_score := v_strokes;
  elsif v_strokes >= hpar + 4 then
    v_score := hpar + 4;
    v_picked := true;
  end if;

  select coalesce(max(s.seq), 0) + 1 into n_seq from public.golf_shots s
    where s.challenge_id = p_challenge_id and s.user_id = p_user and s.hole = pl.hole;
  insert into public.golf_shots (challenge_id, user_id, hole, seq, club, yards, aim, power, timing,
    from_d, from_lat, to_d, to_lat, ball_d, ball_lat, carry, lie, penalty, holed, picked_up, par, score,
    wind_mph, wind_deg, walk_id, day)
  values (p_challenge_id, p_user, pl.hole, n_seq, p_club, v_spend, p_aim, p_power, p_timing,
    pl.ball_d, pl.ball_lat, v_to_d, v_to_lat, v_ball_d, v_ball_lat, (f ->> 'carry')::numeric, v_lie, v_penalty, v_holed, v_picked, hpar, v_score,
    (w ->> 'mph')::int, (w ->> 'deg')::int, p_walk, p_day);

  if v_score is not null then
    finished := pl.hole >= g.holes;
    update public.golf_players p set
      scores[pl.hole] = v_score,
      hole = least(pl.hole + 1, g.holes),
      strokes = 0, ball_d = 0, ball_lat = 0, lie = 'tee',
      yards_spent = p.yards_spent + v_spend, power_spent = p.power_spent + p_power,
      finished_at = case when finished then now() else null end
    where p.challenge_id = p_challenge_id and p.user_id = p_user;
  else
    update public.golf_players p set
      strokes = v_strokes, ball_d = v_ball_d, ball_lat = v_ball_lat, lie = v_rest_lie,
      yards_spent = p.yards_spent + v_spend, power_spent = p.power_spent + p_power
    where p.challenge_id = p_challenge_id and p.user_id = p_user;
  end if;

  -- What to tell them.
  in_trees := v_lie = 'rough' and public.golf_hazard_at(h, v_to_d, v_to_lat, array['trees']) is not null;
  if v_holed then
    word := case
      when v_score = 1 then 'Hole in one!'
      when v_score - hpar <= -3 then 'Albatross!'
      when v_score - hpar = -2 then 'Eagle!'
      when v_score - hpar = -1 then 'Birdie!'
      when v_score - hpar = 0 then 'Par.'
      when v_score - hpar = 1 then 'Bogey.'
      when v_score - hpar = 2 then 'Double bogey.'
      else 'In at last.' end;
    msg := word || ' In the hole in ' || v_score || '.';
  elsif p_club = 'putter' then
    -- A putt says where it stopped: short, past or to the side, in feet.
    msg := public.golf_putt_words(h, pl.ball_d, pl.ball_lat, v_to_d, v_to_lat, v_lie);
    if v_picked then
      msg := msg || ' That''s ' || v_score || ': picked up.';
    end if;
  else
    msg := case
      when abs(p_timing) < 0.06 then 'Pure.'
      when p_timing < -0.2 then 'Hooked it.'
      when p_timing < 0 then 'A little left.'
      when p_timing > 0.2 then 'Sliced it.'
      else 'A little right.' end
      || ' ' || round((f ->> 'carry')::numeric) || ' yd, '
      || case v_lie
        when 'fairway' then 'fairway.'
        when 'rough' then case when in_trees then 'in the trees.' else 'rough.' end
        when 'bunker' then case when public.golf_hazard_at(h, v_to_d, v_to_lat, array['waste']) is not null then 'in the waste area.' else 'in the bunker.' end
        when 'green' then 'on the green.'
        when 'tee' then 'still on the tee.'
        when 'water' then 'in the water: a penalty stroke, dropped short of it.'
        when 'out' then 'out of bounds: a penalty stroke, play it again.'
        else v_lie || '.' end;
    if v_picked then
      msg := msg || ' That''s ' || v_score || ': picked up.';
    end if;
  end if;

  -- The sponsor's hole (a global game's): birdie or better and the
  -- sponsor adds Bones, paid with the rest at the end.
  if v_global and v_holed and v_score <= hpar - 1 and c.sponsor_name is not null and c.sponsor_hole = cno then
    v_bonus := coalesce(c.sponsor_hole_bones, 5);
    if v_bonus > 0 then
      update public.golf_players p set sponsor_bones = p.sponsor_bones + v_bonus
        where p.challenge_id = p_challenge_id and p.user_id = p_user;
      msg := msg || ' ' || c.sponsor_name || ' adds ' || v_bonus || ' Bones.';
    else
      v_bonus := null;
    end if;
  end if;

  -- A good score: everyone else in the game hears about it (in a global
  -- game, only your friends in it). How good is Admin's (0284,
  -- golf_config.push_min): a birdie or better, an eagle or better, only a
  -- hole in one, or none.
  v_push := coalesce((select gc.push_min from public.golf_config gc where gc.id), 'birdie');
  if v_holed and (case v_push
        when 'birdie' then v_score <= hpar - 1
        when 'eagle' then v_score <= hpar - 2 or v_score = 1
        when 'ace' then v_score = 1
        else false end) then
    for r in select p.user_id from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined and p.user_id <> p_user
        and (not v_global or public.golf_are_friends(p.user_id, p_user)) loop
      perform public.golf_notify(case when v_score = 1 then 'ace' else 'birdie' end, p_challenge_id, r.user_id, jsonb_build_object(
        'player_id', p_user, 'player_name', public.golf_name(p_user), 'hole', pl.hole, 'to_par', v_score - hpar,
        'score', v_score, 'course_name', cname));
    end loop;
  end if;

  if v_score is not null then
    perform public.golf_settle_skins(p_challenge_id, false);
  end if;

  -- Into the top 10 of a global game, once, when the field's 20 or more.
  if v_global and v_score is not null and pl.top10_at is null then
    select count(*) into swung from public.golf_positions(p_challenge_id);
    if swung >= 20 then
      select * into pos from public.golf_positions(p_challenge_id) x where x.user_id = p_user;
      if pos.pos is not null and pos.pos <= 10 then
        update public.golf_players set top10_at = now() where challenge_id = p_challenge_id and user_id = p_user;
        perform public.golf_notify('top10', p_challenge_id, p_user, jsonb_build_object(
          'pos', pos.pos, 'tied', pos.tied, 'thru', pos.thru, 'to_par', pos.to_par,
          'challenge_name', c.name, 'course_name', cname));
      end if;
    end if;
  end if;

  banks := public.golf_banks(p_challenge_id, p_user);
  return jsonb_build_object(
    'hole', pl.hole,
    'from', jsonb_build_object('d', pl.ball_d, 'lat', pl.ball_lat),
    'to', jsonb_build_object('d', v_to_d, 'lat', v_to_lat),
    'ball', jsonb_build_object('d', v_ball_d, 'lat', v_ball_lat),
    'carry', round((f ->> 'carry')::numeric),
    'lie', v_lie,
    'penalty', v_penalty,
    'holed', v_holed,
    'picked_up', v_picked,
    'hole_score', v_score,
    'strokes_on_hole', case when v_score is not null then v_score else v_strokes end,
    'next_hole', case when v_score is not null and not finished then pl.hole + 1 end,
    'finished', finished,
    'banks', jsonb_build_object('yards', banks -> 'yards', 'power', banks -> 'power'),
    'wind', w,
    'message', msg,
    'sponsor_bonus', v_bonus);
end;
$$;
revoke execute on function public.golf_strike(uuid, uuid, text, numeric, numeric, int, numeric, uuid, date) from public, anon, authenticated;

create or replace function public.admin_set_golf_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  if p ? 'push_min' and (p ->> 'push_min') not in ('birdie', 'eagle', 'ace', 'none') then
    raise exception 'Score pushes: birdie, eagle, ace or none.';
  end if;
  update public.golf_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    steps_per_yard = coalesce((p ->> 'steps_per_yard')::int, c.steps_per_yard),
    strength_mult = coalesce((p ->> 'strength_mult')::int, c.strength_mult),
    golf_mult = coalesce((p ->> 'golf_mult')::int, c.golf_mult),
    other_mult = coalesce((p ->> 'other_mult')::int, c.other_mult),
    max_power = coalesce((p ->> 'max_power')::int, c.max_power),
    skin_bones = coalesce((p ->> 'skin_bones')::int, c.skin_bones),
    win_bones = coalesce((p ->> 'win_bones')::int, c.win_bones),
    play_bones = coalesce((p ->> 'play_bones')::int, c.play_bones),
    putt_cup = coalesce((p ->> 'putt_cup')::numeric, c.putt_cup),
    cup = coalesce((p ->> 'cup')::numeric, c.cup),
    push_min = coalesce(p ->> 'push_min', c.push_min),
    updated_at = now(), updated_by = auth.uid()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_golf_config(jsonb) from public, anon;
grant execute on function public.admin_set_golf_config(jsonb) to authenticated;

-- To undo: golf_strike as in 0214, admin_set_golf_config as in 0200, then
--   alter table public.golf_config drop column push_min;
