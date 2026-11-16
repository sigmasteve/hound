-- Hound: putting you can read and judge (Steve, 16 Nov 2026: "I'm not
-- sure if I need to hit to the middle of the black circle", and putts only
-- came in whole yards, 3 ft at a time).
--
-- The app now draws a real cup with a ring where the ball must stop to
-- drop (putt_cup, 0.6 yd, unchanged), the roll's line with the green's
-- break, and a pace meter for a putt's length instead of the pull. So:
--   golf_shot     takes yards as a number: a putt to two decimals of a
--                 yard (an inch or so), every other club rounded to whole
--                 yards as before. A putt is at least a foot.
--   golf_strike   the same, and the bank pays whole yards, at least one
--                 (golf_shots.yards stays whole yards; carry has the roll).
--                 A missed putt says where it stopped, in feet
--                 (golf_putt_words): "Left it 3 ft short." The pace meter
--                 sends timing 0, so a putt rolls exactly its length plus
--                 the break; older apps still send timing and still work.
--   admin_golf_putting_overview()  putts this week, made, by length, pace
--                 meter use, three-putts, for Admin → Overview → Games.
--
-- Run this once, after 0001-0213, in the SQL Editor.

drop function if exists public.golf_shot(uuid, text, int, numeric, int, numeric);
drop function if exists public.golf_strike(uuid, uuid, text, int, numeric, int, numeric, uuid, date);

-- Where a putt stopped, in words: short, past, or off to one side, and how
-- many feet from the cup.
create or replace function public.golf_putt_words(
  h jsonb, p_from_d numeric, p_from_lat numeric, p_to_d numeric, p_to_lat numeric, p_lie text
)
returns text
language plpgsql
immutable
as $$
declare
  pin_d numeric := (h -> 'pin' ->> 'd')::numeric;
  pin_lat numeric := (h -> 'pin' ->> 'lat')::numeric;
  ud numeric := pin_d - p_from_d;
  ul numeric := pin_lat - p_from_lat;
  vd numeric := p_to_d - p_from_d;
  vl numeric := p_to_lat - p_from_lat;
  far numeric := greatest(0.01, sqrt(ud * ud + ul * ul));
  along numeric := (vd * ud + vl * ul) / far;
  across numeric := (ud * vl - ul * vd) / far;
  miss int := greatest(1, round(sqrt(power(p_to_d - pin_d, 2) + power(p_to_lat - pin_lat, 2)) * 3))::int;
  t text;
begin
  if abs(across) > abs(along - far) then
    t := 'Missed ' || case when across > 0 then 'right' else 'left' end || ', ' || miss || ' ft from the cup.';
  elsif along < far then
    t := 'Left it ' || miss || ' ft short.';
  else
    t := 'Rolled ' || miss || ' ft past.';
  end if;
  if p_lie is distinct from 'green' then
    t := t || ' Off the green.';
  end if;
  return t;
end;
$$;
revoke execute on function public.golf_putt_words(jsonb, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;

-- ── A swing (0202's, with yards as a number) ──

create or replace function public.golf_strike(
  p_challenge_id uuid, p_user uuid, p_club text, p_yards numeric, p_aim numeric, p_power int, p_timing numeric,
  p_walk uuid, p_day date
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
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

  -- A birdie or better: everyone else in the game hears about it (in a
  -- global game, only your friends in it).
  if v_holed and v_score <= hpar - 1 then
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

-- ── A swing, by hand (0200's, with yards as a number) ──

create or replace function public.golf_shot(
  p_challenge_id uuid, p_club text, p_yards numeric, p_aim numeric, p_power int, p_timing numeric
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  pl public.golf_players%rowtype;
  today date;
  banks jsonb;
  res jsonb;
  -- A putt to the inch (two decimals of a yard); every other club whole yards.
  v_yards numeric := case when p_club = 'putter' then round(p_yards, 2) else round(p_yards) end;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  select * into pl from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller and p.joined for update;
  if c.id is null or g.challenge_id is null or pl.user_id is null then
    raise exception 'not authorized';
  end if;
  if g.status <> 'active' or now() >= c.ends_at then
    raise exception 'This round is over.';
  end if;
  today := public.soccer_today(caller);
  if today < public.soccer_first_day(c) then
    raise exception 'The course opens %.', to_char(public.soccer_first_day(c), 'FMDay, FMMonth FMDD');
  end if;
  if not g.hands_on then
    raise exception 'This game plays itself: every walk of 10 minutes or more is a shot.';
  end if;
  if pl.finished_at is not null then
    raise exception 'You''ve played every hole.';
  end if;
  if public.golf_club_max(p_club) is null then
    raise exception 'Pick a club.';
  end if;
  if pl.lie = 'green' and p_club <> 'putter' then
    raise exception 'That''s the putter''s job.';
  end if;
  if pl.lie <> 'green' and p_club = 'putter' then
    raise exception 'The putter''s for the green.';
  end if;
  if p_club = 'putter' and (v_yards is null or v_yards < 0.33) then
    raise exception 'Give it at least a foot.';
  end if;
  if p_club <> 'putter' and (v_yards is null or v_yards < 1) then
    raise exception 'Pull back for at least a yard.';
  end if;
  if v_yards > public.golf_club_max(p_club) then
    raise exception 'The % goes % yards at most.', lower(public.golf_club_name(p_club)), public.golf_club_max(p_club);
  end if;
  if p_aim is null or abs(p_aim) > 35 then
    raise exception 'Aim within 35 degrees of the pin.';
  end if;
  if p_power is null or p_power not in (0, 10, 20, 30) or p_power > (public.golf_cfg()).max_power then
    raise exception 'Power is 0, 10, 20 or 30, up to %.', (public.golf_cfg()).max_power;
  end if;
  if p_club = 'putter' and p_power > 0 then
    raise exception 'No power on a putt.';
  end if;
  if p_timing is null or abs(p_timing) > 0.5 then
    raise exception 'Timing is between -0.5 and 0.5.';
  end if;
  banks := public.golf_banks(p_challenge_id, caller);
  if greatest(1, round(v_yards)) > (banks ->> 'yards')::int then
    raise exception 'You have % yards banked.', to_char((banks ->> 'yards')::int, 'FM999,999,990');
  end if;
  if p_power > (banks ->> 'power')::int then
    raise exception 'You have % power banked.', (banks ->> 'power')::int;
  end if;
  if pl.strokes = 0 and g.holes_per_day > 0
     and public.golf_started_on(p_challenge_id, caller, today) >= g.holes_per_day then
    raise exception 'That''s % hole% today. More tomorrow.', g.holes_per_day, case when g.holes_per_day = 1 then '' else 's' end;
  end if;

  res := public.golf_strike(p_challenge_id, caller, p_club, v_yards, p_aim, p_power, p_timing, null, today);
  if (res ->> 'finished')::boolean then
    perform public.golf_check_end(p_challenge_id, true);
  end if;
  return res;
end;
$$;
revoke execute on function public.golf_shot(uuid, text, numeric, numeric, int, numeric) from public, anon;
grant execute on function public.golf_shot(uuid, text, numeric, numeric, int, numeric) to authenticated;

-- ── Admin: how putting's going ──

create or replace function public.admin_golf_putting_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  since timestamptz := now() - interval '7 days';
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with putts as (
      select s.challenge_id, s.user_id, s.hole, s.holed, s.timing,
        sqrt(power(s.from_d - (x.hole -> 'pin' ->> 'd')::numeric, 2) + power(s.from_lat - (x.hole -> 'pin' ->> 'lat')::numeric, 2)) * 3 as ft
      from public.golf_shots s
      join public.golf_games g on g.challenge_id = s.challenge_id
      join public.golf_holes x on x.course_id = g.course_id and x.no = public.golf_course_no(s.hole)
      where s.club = 'putter' and s.created_at > since
    ),
    holes as (
      select s.challenge_id, s.user_id, s.hole, count(*) filter (where s.club = 'putter') as n
      from public.golf_shots s
      where s.created_at > since
        and exists (select 1 from public.golf_shots f where f.challenge_id = s.challenge_id and f.user_id = s.user_id
                    and f.hole = s.hole and f.score is not null)
      group by s.challenge_id, s.user_id, s.hole
    )
    select jsonb_build_object(
      'putts_7d', (select count(*) from putts),
      'putters_7d', (select count(distinct user_id) from putts),
      'made_7d', (select count(*) from putts where holed),
      'pace_putts_7d', (select count(*) from putts where timing = 0),
      'pace_players_7d', (select count(distinct user_id) from putts where timing = 0),
      'holes_7d', (select count(*) from holes),
      'avg_putts_per_hole_7d', (select round(avg(n), 2) from holes),
      'three_putts_7d', (select count(*) from holes where n >= 3),
      'by_length', jsonb_build_array(
        jsonb_build_object('label', 'Inside 6 ft', 'putts', (select count(*) from putts where ft < 6), 'made', (select count(*) from putts where ft < 6 and holed)),
        jsonb_build_object('label', '6 to 15 ft', 'putts', (select count(*) from putts where ft >= 6 and ft < 15), 'made', (select count(*) from putts where ft >= 6 and ft < 15 and holed)),
        jsonb_build_object('label', '15 ft and more', 'putts', (select count(*) from putts where ft >= 15), 'made', (select count(*) from putts where ft >= 15 and holed)))
    )
  );
end;
$$;
revoke execute on function public.admin_golf_putting_overview() from public, anon;
grant execute on function public.admin_golf_putting_overview() to authenticated;
