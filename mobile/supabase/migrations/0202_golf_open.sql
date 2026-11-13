-- Hound: the Hound Open — Golf as a Global Hound Challenge.
--
-- Everyone plays the same course in a week, stroke play, each taking
-- their own shots (no hands-off), and a public leaderboard ranks the
-- field. What changes from a friends' game (0200):
--   - publish_global_challenge takes 'golf' (3 to 30 days), and
--     golf_setup_global (admins) picks the course, 9 or 18 holes, the
--     daily hole limit and the Bones for finishing. No player list.
--   - No 12-player cap and no match rule when it's global; joining's
--     window stays join_global_challenge's.
--   - A global game's banks count from the day you join: steps and
--     workouts before it don't count.
--   - It ends at ends_at only (not when everyone so far has finished).
--   - Birdie and hole-in-one pushes go to your friends in it only, plus
--     a one-time "you're into the top 10" once the field has 20+.
--   - A sponsored hole (challenges.sponsor_hole, 0203 fills in the rest
--     of the sponsor): birdie it or better and the sponsor adds Bones,
--     paid with the rest at the end.
--   - golf_open_board reads the leaderboard: the top 25, your friends
--     or your club, where you stand, how far you moved today, and at
--     the end the podium and the week's best shots.
--   - pay_global_places places golf by total strokes; a tie shares the
--     places it covers, split evenly.
--   - Settlement: in a global game the prizes are the places, so no
--     win Bones; finishing pays the game's own finish Bones.

-- ── Columns ──

alter table public.golf_games
  add column if not exists finish_bones integer check (finish_bones is null or finish_bones between 0 and 500);

alter table public.golf_players
  add column if not exists top10_at timestamptz,
  add column if not exists pos_mark integer,
  add column if not exists pos_mark_day date,
  add column if not exists sponsor_bones integer not null default 0;

-- The sponsored hole lives on the challenge with the rest of the sponsor
-- (0203 adds the others); here so a shot can read it from now on.
alter table public.challenges
  add column if not exists sponsor_hole integer check (sponsor_hole is null or sponsor_hole between 1 and 9),
  add column if not exists sponsor_hole_bones integer check (sponsor_hole_bones is null or sponsor_hole_bones between 0 and 100);

create index if not exists golf_shots_holed_idx on public.golf_shots (challenge_id) where holed;

-- ── Small helpers ──

create or replace function public.golf_is_global(p_challenge_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select c.is_global from public.challenges c where c.id = p_challenge_id), false);
$$;
revoke execute on function public.golf_is_global(uuid) from public, anon, authenticated;

create or replace function public.golf_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.recipient_id = b) or (f.requester_id = b and f.recipient_id = a)));
$$;
revoke execute on function public.golf_are_friends(uuid, uuid) from public, anon, authenticated;

-- The first day a player's steps and workouts count: the game's first
-- day, or in a global game the day they joined (their local day), if
-- later.
create or replace function public.golf_bank_from(p_challenge_id uuid, p_user uuid)
returns date
language sql
stable
security definer set search_path = public
as $$
  select case
    when c.is_global then greatest(lower(public.golf_days(c)), coalesce((
      select (p.seated_at at time zone coalesce(pr.time_zone, 'America/New_York'))::date
      from public.golf_players p join public.profiles pr on pr.id = p.user_id
      where p.challenge_id = c.id and p.user_id = p_user), lower(public.golf_days(c))))
    else lower(public.golf_days(c)) end
  from public.challenges c where c.id = p_challenge_id;
$$;
revoke execute on function public.golf_bank_from(uuid, uuid) from public, anon, authenticated;

-- Where everyone who's swung stands: by score to par over the holes
-- they've finished, a tie sharing a place.
create or replace function public.golf_positions(p_challenge_id uuid)
returns table (user_id uuid, pos integer, tied boolean, to_par integer, thru integer, total integer)
language sql
stable
security definer set search_path = public
as $$
  with g as (select * from public.golf_games where challenge_id = p_challenge_id),
  s as (
    select p.user_id, public.golf_to_par(g.course_id, p.scores) as to_par,
      (select count(*) from unnest(p.scores) x where x is not null)::int as thru,
      public.golf_total(p.scores) as total
    from public.golf_players p, g
    where p.challenge_id = p_challenge_id and p.joined
      and exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id)
  ),
  r as (select s.*, rank() over (order by s.to_par) as pos from s)
  select r.user_id, r.pos::int, (count(*) over (partition by r.pos)) > 1, r.to_par, r.thru, r.total from r;
$$;
revoke execute on function public.golf_positions(uuid) from public, anon, authenticated;


-- ── Publishing: 0179's, with Golf ──

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
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null,
  -- 0179: the hound card's size (3, 4 or 5), or null to size it by length.
  p_bingo_size int default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if p_bingo_size is not null and p_bingo_size not in (3, 4, 5) then
    raise exception 'A Bingo card is 3×3, 4×4 or 5×5.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars or Golf.';
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
  if p_kind = 'packs' and (p_duration_days < 7 or p_duration_days > 30) then
    raise exception 'Pack Wars runs 7 to 30 days.';
  end if;
  if p_kind = 'doors' and (p_duration_days < 3 or p_duration_days > 60) then
    raise exception 'Daily Doors runs 3 to 60 days, a door a day.';
  end if;
  if p_kind::text = 'golf' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'A Global Golf runs 3 to 30 days.';
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
  if p_kind = 'journey' and (p_course_id is null or coalesce(p_distance_goal_mi, 0) <= 0) then
    raise exception 'A Journey needs a course.';
  end if;
  if p_distance_source is not null and p_distance_source not in ('workouts', 'all') then
    raise exception 'Miles count from logged workouts or every mile.';
  end if;

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, bingo_size, is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    case when p_kind = 'bingo' and coalesce(p_bingo_card_type, 'variety') = 'hound' then p_bingo_size end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;
revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text, int) to authenticated;

-- Right after publishing a Global Golf, an admin sets the course: 9 or 18
-- holes, holes a day (0 = no limit) and the Bones for finishing (null =
-- Admin → Golf's play Bones). Stroke play, everyone takes their own shots.
create or replace function public.golf_setup_global(
  p_challenge_id uuid, p_course text, p_holes int, p_holes_per_day int, p_finish_bones int default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can set up a Global Golf.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'golf' or not c.is_global then
    raise exception 'That isn''t a Global Golf challenge.';
  end if;
  if exists (select 1 from public.golf_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  if not exists (select 1 from public.golf_courses k where k.id = p_course) then
    raise exception 'Pick a course.';
  end if;
  if p_holes is null or p_holes not in (9, 18) then
    raise exception 'A round is 9 holes or 18.';
  end if;
  if p_holes_per_day is null or p_holes_per_day not between 0 and 18 then
    raise exception 'Holes a day is a number, or 0 for no limit.';
  end if;
  if p_finish_bones is not null and p_finish_bones not between 0 and 500 then
    raise exception 'Bones for finishing are 0 to 500.';
  end if;
  insert into public.golf_games (challenge_id, course_id, holes, format, hands_on, holes_per_day, finish_bones)
  values (p_challenge_id, p_course, p_holes, 'stroke', true, p_holes_per_day, p_finish_bones);
end;
$$;
revoke execute on function public.golf_setup_global(uuid, text, int, int, int) from public, anon;
grant execute on function public.golf_setup_global(uuid, text, int, int, int) to authenticated;


-- ── Joining: no cap and no match rule in a global game ──

create or replace function public.golf_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'golf') then
    return new;
  end if;
  select * into g from public.golf_games where challenge_id = new.challenge_id;
  if not found and public.golf_is_global(new.challenge_id) then
    raise exception 'This game isn''t set up yet.';
  end if;
  if not found then
    if exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
      raise exception 'This game isn''t set up yet.';
    end if;
    return new;
  end if;
  if g.status <> 'active' then
    raise exception 'This round is over.';
  end if;
  if not public.golf_is_global(new.challenge_id)
     and not exists (select 1 from public.golf_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
    if g.format = 'match' then
      raise exception 'This match is already one on one.';
    end if;
    if (select count(*) from public.golf_players p where p.challenge_id = new.challenge_id) >= 12 then
      raise exception 'This game is full.';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.golf_before_join() from public, anon, authenticated;


-- ── Banks: in a global game, from the day you joined ──

create or replace function public.golf_workouts(p_challenge_id uuid, p_user uuid)
returns table (name text, minutes int, mult int, power int)
language sql
stable
security definer set search_path = public
as $$
  with c as (select * from public.challenges where id = p_challenge_id),
  cfg as (select * from public.golf_config where id),
  tz as (select coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York') as z),
  w as (
    select w.name, least(greatest(coalesce(w.duration_min, 0), 0), 180) as minutes,
      case
        when w.name ~* 'golf' then cfg.golf_mult
        when w.name ~* '(strength|weight|functional|lift|resistance|crossfit|cross training|core training|kettlebell)' then cfg.strength_mult
        else cfg.other_mult end as mult
    from public.workout_history w, c, cfg, tz
    where w.user_id = p_user
      and w.occurred_at >= (lower(public.golf_days(c)) - 1)::timestamp at time zone 'utc'
      and w.occurred_at < (upper(public.golf_days(c)) + 1)::timestamp at time zone 'utc'
      and (w.occurred_at at time zone tz.z)::date <@ public.golf_days(c)
      and (w.occurred_at at time zone tz.z)::date >= public.golf_bank_from(p_challenge_id, p_user)
  )
  select w.name, sum(w.minutes)::int, w.mult, sum(w.minutes * w.mult)::int
  from w group by w.name, w.mult order by sum(w.minutes * w.mult) desc, w.name;
$$;
revoke execute on function public.golf_workouts(uuid, uuid) from public, anon, authenticated;

create or replace function public.golf_banks(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  p public.golf_players%rowtype;
  steps int;
  earned int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into p from public.golf_players where challenge_id = p_challenge_id and user_id = p_user;
  select coalesce(sum(ps.steps), 0)::int into steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_user and ps.day <@ public.golf_days(c)
      and ps.day >= public.golf_bank_from(p_challenge_id, p_user);
  select coalesce(sum(w.power), 0)::int into earned from public.golf_workouts(p_challenge_id, p_user) w;
  return jsonb_build_object(
    'steps', steps,
    'yards', greatest(0, steps / (public.golf_cfg()).steps_per_yard - coalesce(p.yards_spent, 0)),
    'power', greatest(0, earned - coalesce(p.power_spent, 0)));
end;
$$;
revoke execute on function public.golf_banks(uuid, uuid) from public, anon, authenticated;


-- ── The end of a global game: the field is whoever swung ──

create or replace function public.golf_finish(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.golf_games%rowtype;
  win uuid;
  r record;
  cname text;
begin
  select * into g from public.golf_games where challenge_id = p_challenge_id for update;
  if not found or g.status <> 'active' then
    return;
  end if;
  update public.golf_players p
    set scores = (select array_agg(coalesce(p.scores[k], public.golf_par(g.course_id, k) + 4) order by k)
                  from generate_series(1, g.holes) k)
    where p.challenge_id = p_challenge_id and p.joined and p.finished_at is null;
  perform public.golf_settle_skins(p_challenge_id, true);
  select * into g from public.golf_games where challenge_id = p_challenge_id;

  if public.golf_is_global(p_challenge_id) then
    -- The field: everyone who swung. The lowest total alone wins.
    with s as (
      select p.user_id, public.golf_total(p.scores) as v
      from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined
        and exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id)
    )
    select s.user_id into win from s
    where s.v = (select min(v) from s) and (select count(*) from s s2 where s2.v = s.v) = 1;
  elsif (select count(*) from public.golf_players p where p.challenge_id = p_challenge_id and p.joined) >= 2 then
    with s as (
      select p.user_id,
        case g.format
          when 'stroke' then -public.golf_total(p.scores)
          when 'skins' then public.golf_skin_bones(g.skins, p.user_id) * 100
            + (select count(*) from jsonb_array_elements(g.skins) e where e ->> 'winner' = p.user_id::text)
          else public.golf_match_up(p_challenge_id, p.user_id) end as v
      from public.golf_players p where p.challenge_id = p_challenge_id and p.joined
    )
    select s.user_id into win from s
    where s.v = (select max(v) from s) and (select count(*) from s s2 where s2.v = s.v) = 1;
  end if;

  update public.golf_games set status = 'final', winner = win, finished_at = now(), updated_at = now()
    where challenge_id = p_challenge_id;
  select k.name into cname from public.golf_courses k where k.id = g.course_id;
  for r in select p.user_id, p.scores from public.golf_players p where p.challenge_id = p_challenge_id and p.joined
    and (not public.golf_is_global(p_challenge_id)
         or exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id)) loop
    perform public.golf_notify('final', p_challenge_id, r.user_id, jsonb_build_object(
      'winner_id', win, 'winner_name', case when win is null then null else public.golf_name(win) end,
      'total', public.golf_total(r.scores), 'to_par', public.golf_to_par(g.course_id, r.scores), 'course_name', cname));
  end loop;
end;
$$;
revoke execute on function public.golf_finish(uuid) from public, anon, authenticated;


-- ── A swing: the sponsor's hole, friends-only pushes and the top 10 in a
-- global game ──

create or replace function public.golf_strike(
  p_challenge_id uuid, p_user uuid, p_club text, p_yards int, p_aim numeric, p_power int, p_timing numeric,
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
  values (p_challenge_id, p_user, pl.hole, n_seq, p_club, p_yards, p_aim, p_power, p_timing,
    pl.ball_d, pl.ball_lat, v_to_d, v_to_lat, v_ball_d, v_ball_lat, (f ->> 'carry')::numeric, v_lie, v_penalty, v_holed, v_picked, hpar, v_score,
    (w ->> 'mph')::int, (w ->> 'deg')::int, p_walk, p_day);

  if v_score is not null then
    finished := pl.hole >= g.holes;
    update public.golf_players p set
      scores[pl.hole] = v_score,
      hole = least(pl.hole + 1, g.holes),
      strokes = 0, ball_d = 0, ball_lat = 0, lie = 'tee',
      yards_spent = p.yards_spent + p_yards, power_spent = p.power_spent + p_power,
      finished_at = case when finished then now() else null end
    where p.challenge_id = p_challenge_id and p.user_id = p_user;
  else
    update public.golf_players p set
      strokes = v_strokes, ball_d = v_ball_d, ball_lat = v_ball_lat, lie = v_rest_lie,
      yards_spent = p.yards_spent + p_yards, power_spent = p.power_spent + p_power
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
  else
    msg := case
      when p_club = 'putter' then case when abs(p_timing) < 0.06 then 'Good putt.' when p_timing < 0 then 'Pulled it.' else 'Pushed it.' end
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
revoke execute on function public.golf_strike(uuid, uuid, text, int, numeric, int, numeric, uuid, date) from public, anon, authenticated;


-- ── A global game ends at its end, not when everyone so far is done ──

create or replace function public.golf_check_end(p_challenge_id uuid, p_settle boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not exists (select 1 from public.golf_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    return false;
  end if;
  if now() >= c.ends_at
     or (not c.is_global and exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.joined)
         and not exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.joined and p.finished_at is null)) then
    perform public.golf_finish(p_challenge_id);
    if p_settle then
      perform public.settle_challenge_score_core(p_challenge_id);
    end if;
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.golf_check_end(uuid, boolean) from public, anon, authenticated;


-- ── The nightly job: also marks where everyone stands in a global game ──

create or replace function public.golf_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.id from public.challenges c
    join public.golf_games g on g.challenge_id = c.id
    where c.kind::text = 'golf' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.golf_advance(r.id, true);
    exception when others then
      raise warning 'golf_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- Once a day, where everyone in a live global game stands, so the board
  -- can say how far they've moved since.
  for r in
    select g.challenge_id as id from public.golf_games g
    join public.challenges c on c.id = g.challenge_id
    where c.is_global and g.status = 'active'
  loop
    update public.golf_players p set pos_mark = x.pos, pos_mark_day = current_date
      from public.golf_positions(r.id) x
      where p.challenge_id = r.id and p.user_id = x.user_id and p.pos_mark_day is distinct from current_date;
  end loop;
  return n;
end;
$$;
revoke execute on function public.golf_advance_all() from public, anon, authenticated;


-- ── The game: a global game's players list is just you (the board is
-- golf_open_board) ──

create or replace function public.golf_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  me public.golf_players%rowtype;
  today date;
  status text;
  started int := 0;
  banks jsonb;
  k public.golf_courses%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
     and not exists (select 1 from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller) then
    raise exception 'not authorized';
  end if;
  select * into k from public.golf_courses where id = g.course_id;
  select * into me from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  today := public.soccer_today(caller);
  status := case when g.status = 'final' or now() >= c.ends_at then 'final'
                 when today < public.soccer_first_day(c) then 'upcoming' else 'live' end;
  if me.user_id is not null then
    banks := public.golf_banks(p_challenge_id, caller) || jsonb_build_object('power_from', (
      select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'minutes', w.minutes, 'mult', w.mult, 'power', w.power)), '[]'::jsonb)
      from public.golf_workouts(p_challenge_id, caller) w));
    started := public.golf_started_on(p_challenge_id, caller, today);
  end if;

  return jsonb_build_object(
    'course', jsonb_build_object('id', k.id, 'name', k.name, 'style', k.style, 'note', k.note,
      'holes', (select jsonb_agg(h.hole order by h.no) from public.golf_holes h where h.course_id = k.id)),
    'holes', g.holes,
    'is_global', coalesce(c.is_global, false),
    'finish_bones', coalesce(g.finish_bones, (public.golf_cfg()).play_bones),
    'pars', (select jsonb_agg(public.golf_par(g.course_id, x) order by x) from generate_series(1, g.holes) x),
    'format', g.format,
    'hands_on', g.hands_on,
    'holes_per_day', g.holes_per_day,
    'status', status,
    'first_day', public.soccer_first_day(c),
    'last_day', upper(public.golf_days(c)) - 1,
    'me', me.user_id,
    'banks', banks,
    'today', case when me.user_id is null then null else jsonb_build_object(
      'holes_started', started,
      'can_start', status = 'live' and me.finished_at is null and g.hands_on
        and (g.holes_per_day = 0 or me.strokes > 0 or started < g.holes_per_day)) end,
    'wind', case when me.user_id is null or me.finished_at is not null then null
      else public.golf_wind(g.course_id, public.golf_course_no(me.hole), today) end,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'name', public.golf_name(p.user_id),
        'initials', pr.initials,
        'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
        'joined', p.joined,
        'hole', p.hole,
        'strokes_on_hole', p.strokes,
        'ball', jsonb_build_object('d', p.ball_d, 'lat', p.ball_lat),
        'lie', p.lie,
        'scores', to_jsonb(p.scores),
        'total', public.golf_total(p.scores),
        'to_par', public.golf_to_par(g.course_id, p.scores),
        'thru', (select count(*) from unnest(p.scores) s where s is not null),
        'skins', (select count(*) from jsonb_array_elements(g.skins) e where e ->> 'winner' = p.user_id::text),
        'skin_bones', public.golf_skin_bones(g.skins, p.user_id),
        'match', case when g.format = 'match' then public.golf_match_text(public.golf_match_up(p_challenge_id, p.user_id)) end,
        'done', p.finished_at is not null or g.status = 'final')
      order by p.seated_at, p.user_id), '[]'::jsonb)
      from public.golf_players p
      join public.profiles pr on pr.id = p.user_id
      where p.challenge_id = p_challenge_id and (not c.is_global or p.user_id = caller)),
    'skins', g.skins,
    'carry', g.carry,
    'winner', g.winner
  );
end;
$$;
revoke execute on function public.golf_view(uuid) from public, anon;
grant execute on function public.golf_view(uuid) to authenticated;


-- ── Watching a hole: anyone signed in, in a global game ──

create or replace function public.golf_shots(p_challenge_id uuid, p_user uuid, p_hole int)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null or (not public.golf_is_global(p_challenge_id)
     and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid())) then
    raise exception 'not authorized';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'seq', s.seq, 'club', s.club, 'yards', s.yards, 'power', s.power,
      'from', jsonb_build_object('d', s.from_d, 'lat', s.from_lat),
      'to', jsonb_build_object('d', s.to_d, 'lat', s.to_lat),
      'ball', jsonb_build_object('d', s.ball_d, 'lat', s.ball_lat),
      'carry', s.carry, 'lie', s.lie, 'penalty', s.penalty, 'holed', s.holed, 'picked_up', s.picked_up,
      'score', s.score, 'walk', s.walk_id is not null)
    order by s.seq), '[]'::jsonb)
    from public.golf_shots s
    where s.challenge_id = p_challenge_id and s.user_id = p_user and s.hole = p_hole);
end;
$$;
revoke execute on function public.golf_shots(uuid, uuid, int) from public, anon;
grant execute on function public.golf_shots(uuid, uuid, int) to authenticated;


-- ── The leaderboard ──

-- A global game's board, for anyone signed in (joined or not):
--   'top'     the top 25, then you if you're further down;
--   'friends' you and your friends in it;
--   'club'    you and your club's members in it (the club with the most
--             of them playing, then the oldest).
-- Where you stand, how far you've moved since the night's mark, and how
-- many shots you are off the top 10. At the end, the podium (with the
-- Bones each place pays, a tie sharing) and the week's best shots.
create or replace function public.golf_open_board(p_challenge_id uuid, p_tab text default 'top')
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.golf_games%rowtype;
  k public.golf_courses%rowtype;
  today date;
  v_status text;
  v_field int;
  v_swung int;
  v_me jsonb;
  mine record;
  me_row public.golf_players%rowtype;
  v_idx int;
  v_tenth int;
  v_club uuid;
  v_club_json jsonb;
  v_rows jsonb;
  v_more int;
  v_more_range jsonb;
  v_podium jsonb;
  v_high jsonb;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.golf_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null or not c.is_global then
    raise exception 'not authorized';
  end if;
  if p_tab is null or p_tab not in ('top', 'friends', 'club') then
    raise exception 'Pick Top, Friends or My club.';
  end if;
  select * into k from public.golf_courses where id = g.course_id;
  today := public.soccer_today(caller);
  v_status := case when g.status = 'final' or now() >= c.ends_at then 'final'
                   when today < public.soccer_first_day(c) then 'upcoming' else 'live' end;

  select count(*) into v_field from public.golf_players p where p.challenge_id = p_challenge_id and p.joined;
  select count(*) into v_swung from public.golf_positions(p_challenge_id);

  -- Me.
  select * into me_row from public.golf_players p where p.challenge_id = p_challenge_id and p.user_id = caller and p.joined;
  if me_row.user_id is not null then
    select x.*, o.idx into mine
    from public.golf_positions(p_challenge_id) x
    join (select y.user_id, row_number() over (order by y.pos, y.thru desc, y.total, y.user_id) as idx
          from public.golf_positions(p_challenge_id) y) o on o.user_id = x.user_id
    where x.user_id = caller;
    v_idx := mine.idx;
    select y.to_par into v_tenth from (
      select x.to_par, row_number() over (order by x.pos, x.thru desc, x.total, x.user_id) as idx
      from public.golf_positions(p_challenge_id) x) y where y.idx = 10;
    v_me := jsonb_build_object(
      'pos', mine.pos, 'tied', coalesce(mine.tied, false),
      'to_par', public.golf_to_par(g.course_id, me_row.scores),
      'thru', (select count(*) from unnest(me_row.scores) s where s is not null),
      'hole', me_row.hole,
      'total', public.golf_total(me_row.scores),
      'moved', case when mine.pos is not null and me_row.pos_mark is not null then me_row.pos_mark - mine.pos end,
      'behind_top10', case when mine.pos is null or v_tenth is null then null
                           when mine.pos <= 10 then 0 else greatest(0, mine.to_par - v_tenth) end,
      'finished', me_row.finished_at is not null);
  end if;

  -- My club: the one with the most members in this game, then the oldest.
  select cl.id into v_club
  from public.club_members cm
  join public.clubs cl on cl.id = cm.club_id and cl.removed_at is null
  where cm.user_id = caller
  order by (select count(*) from public.club_members m2
            join public.golf_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id and p.joined
            where m2.club_id = cl.id) desc, cl.created_at, cl.id
  limit 1;
  if v_club is not null then
    select jsonb_build_object('id', cl.id, 'name', cl.name, 'playing', (
        select count(*) from public.club_members m2
        join public.golf_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id and p.joined
        where m2.club_id = cl.id))
      into v_club_json from public.clubs cl where cl.id = v_club;
  end if;

  with ord as (
    select x.*, row_number() over (order by x.pos, x.thru desc, x.total, x.user_id) as idx
    from public.golf_positions(p_challenge_id) x
  ),
  base as (
    select p.user_id, p.hole, p.strokes, p.scores, p.finished_at, o.pos, o.tied, o.idx
    from public.golf_players p
    left join ord o on o.user_id = p.user_id
    where p.challenge_id = p_challenge_id and p.joined
      and case p_tab
        when 'top' then o.idx <= 25 or p.user_id = caller
        when 'friends' then p.user_id = caller or public.golf_are_friends(p.user_id, caller)
        else p.user_id = caller or (v_club is not null and exists (
          select 1 from public.club_members m where m.club_id = v_club and m.user_id = p.user_id))
      end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'pos', b.pos, 'tied', coalesce(b.tied, false),
      'user_id', b.user_id, 'name', public.golf_name(b.user_id), 'initials', pr.initials,
      'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
      'to_par', public.golf_to_par(g.course_id, b.scores),
      'thru', (select count(*) from unnest(b.scores) s where s is not null),
      'hole', b.hole, 'strokes_on_hole', b.strokes,
      'total', public.golf_total(b.scores),
      'finished', b.finished_at is not null,
      'is_me', b.user_id = caller,
      'is_friend', b.user_id <> caller and public.golf_are_friends(b.user_id, caller),
      'best', (select jsonb_build_object('hole', z.k, 'diff', z.d) from (
          select x.k::int as k, x.s - public.golf_par(g.course_id, x.k::int) as d
          from unnest(b.scores) with ordinality x(s, k) where x.s is not null
          order by x.s - public.golf_par(g.course_id, x.k::int), x.k limit 1) z where z.d <= -1))
    order by b.idx nulls last, public.golf_name(b.user_id)), '[]'::jsonb)
    into v_rows
  from base b join public.profiles pr on pr.id = b.user_id;

  -- 'top': how many sit between the 25th and me, and their scores.
  if p_tab = 'top' and v_swung > 25 and (v_idx is null or v_idx > 26) then
    with ord as (
      select x.*, row_number() over (order by x.pos, x.thru desc, x.total, x.user_id) as idx
      from public.golf_positions(p_challenge_id) x
    )
    select count(*), case when count(*) > 0 then jsonb_build_object('best', min(o.to_par), 'worst', max(o.to_par)) end
      into v_more, v_more_range
    from ord o where o.idx > 25 and (v_idx is null or o.idx < v_idx);
  end if;

  if v_status = 'final' then
    with s as (
      select p.user_id, public.golf_total(p.scores) as total, public.golf_to_par(g.course_id, p.scores) as to_par
      from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined
        and exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id)
    ),
    placed as (
      select s.*, rank() over (order by s.total) as place, count(*) over (partition by s.total) as n from s
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'place', z.place, 'tied', z.n > 1, 'user_id', z.user_id, 'name', public.golf_name(z.user_id),
        'initials', pr.initials, 'icon_id', pr.equipped_icon_id, 'to_par', z.to_par, 'total', z.total,
        'bones', case when c.prize_bones is null then 0 else
          (select coalesce(sum(c.prize_bones[q]), 0) from generate_series(z.place::int, least(z.place + z.n - 1, 3)::int) q
           where q <= 3 and c.prize_bones[q] is not null)::int / z.n end)
      order by z.place, z.user_id), '[]'::jsonb)
      into v_podium
    from placed z join public.profiles pr on pr.id = z.user_id
    where z.place <= 3;

    with h as (
      select sh.user_id, sh.hole, 1 as prio, sh.created_at as at, null::int as feet
      from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.holed and sh.score = 1
      union all
      select sh.user_id, sh.hole, 2, sh.created_at, null
      from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.holed and sh.score > 1 and sh.score <= sh.par - 2
      union all
      (select sh.user_id, sh.hole, 3, sh.created_at,
         round(sqrt(power((gh.hole -> 'pin' ->> 'd')::numeric - sh.from_d, 2) + power((gh.hole -> 'pin' ->> 'lat')::numeric - sh.from_lat, 2)) * 3)::int
       from public.golf_shots sh
       join public.golf_holes gh on gh.course_id = g.course_id and gh.no = public.golf_course_no(sh.hole)
       where sh.challenge_id = p_challenge_id and sh.holed and sh.club = 'putter'
       order by sqrt(power((gh.hole -> 'pin' ->> 'd')::numeric - sh.from_d, 2) + power((gh.hole -> 'pin' ->> 'lat')::numeric - sh.from_lat, 2)) desc, sh.created_at
       limit 1)
    )
    select coalesce(jsonb_agg(jsonb_build_object('user_id', t.user_id, 'name', public.golf_name(t.user_id), 'hole', t.hole,
        'kind', case t.prio when 1 then 'ace' when 2 then 'eagle' else 'putt' end, 'feet', t.feet)
      order by t.prio, t.at), '[]'::jsonb)
      into v_high
    from (select * from h order by prio, at limit 3) t;
  end if;

  return jsonb_build_object(
    'field', v_field, 'swung', v_swung, 'status', v_status,
    'course', jsonb_build_object('id', k.id, 'name', k.name),
    'holes', g.holes,
    'ends_at', c.ends_at, 'join_closes_at', c.join_closes_at,
    'joined', me_row.user_id is not null,
    'me', v_me,
    'rows', v_rows,
    'more', v_more,
    'more_range', v_more_range,
    'club', v_club_json,
    'prizes', to_jsonb(c.prize_bones),
    'finish_bones', coalesce(g.finish_bones, (public.golf_cfg()).play_bones),
    'podium', v_podium,
    'highlights', v_high);
end;
$$;
revoke execute on function public.golf_open_board(uuid, text) from public, anon;
grant execute on function public.golf_open_board(uuid, text) to authenticated;


-- ── Global places: 0136's, with Golf (ties share) ──

create or replace function public.pay_global_places(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global or c.places_paid_at is not null or c.score_settled_at is null then
    return;
  end if;
  update public.challenges x set places_paid_at = now() where x.id = p_challenge_id;
  if c.kind::text in ('seventyfive', 'checklist') or c.prize_bones is null then
    return;
  end if;

  -- Golf: fewest strokes first among everyone who swung. A tie covering
  -- places p to p + n - 1 shares those places' Bones (the ones in the top
  -- three), split evenly.
  if c.kind::text = 'golf' then
    with s as (
      select p.user_id, public.golf_total(p.scores) as total
      from public.golf_players p
      where p.challenge_id = p_challenge_id and p.joined
        and exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id)
    ),
    placed as (
      select s.user_id, rank() over (order by s.total) as place, count(*) over (partition by s.total) as n
      from s
    ),
    prizes as (
      select z.user_id,
        (select coalesce(sum(c.prize_bones[k]), 0) from generate_series(z.place::int, least(z.place + z.n - 1, 3)::int) k
         where k <= 3 and c.prize_bones[k] is not null)::int / z.n as bones
      from placed z
      where z.place <= 3
    ),
    paid as (
      update public.profiles p
        set bones_balance = p.bones_balance + z.bones,
            bones_earned_total = p.bones_earned_total + z.bones
        from prizes z
        where p.id = z.user_id and z.bones > 0
        returning p.id, z.bones
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
      select id, p_challenge_id, 'global_place', 0, 0, bones from paid;
    return;
  end if;

  with scores as (
    select cp.user_id,
      -- What decides the order first.
      case
        -- Hound Bingo: a BINGO beats any number of squares, and an
        -- earlier one beats a later one.
        when c.kind::text = 'bingo' and c.bingo_card_type = 'hound' then coalesce((
          select case
            when bc.bingo_at is not null then 1e12 - extract(epoch from bc.bingo_at)
            else (select count(*) from public.bingo_progress bp
                  where bp.challenge_id = p_challenge_id and bp.user_id = cp.user_id and bp.category = any (bc.squares))
          end
          from public.bingo_cards bc where bc.challenge_id = p_challenge_id and bc.user_id = cp.user_id), 0)
        when c.kind::text in ('streak', 'bingo') then coalesce((
          select max(a.score_points) from public.activity_events a
          where a.challenge_id = p_challenge_id and a.user_id = cp.user_id and a.kind in ('streak_result', 'bingo_result')), 0)
        when c.kind::text = 'houndopoly' then public.houndopoly_net_worth(p_challenge_id, cp.user_id)
        when c.kind::text = 'journey' then coalesce(sum(ps.distance_mi), 0)
        when c.kind::text = 'distance' and c.distance_goal_unit = 'miles' then coalesce(sum(ps.distance_mi), 0)
        else coalesce(sum(ps.steps), 0)
      end as main,
      coalesce(sum(ps.steps), 0) as steps
    from public.challenge_participants cp
    left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
    group by cp.user_id
  ),
  placed as (
    select user_id, rank() over (order by main desc, steps desc) as place
    from scores
    where main > 0 or steps > 0
  ),
  prizes as (
    select user_id, c.prize_bones[place::int] as bones
    from placed
    where place <= 3 and c.prize_bones[place::int] > 0
  ),
  paid as (
    update public.profiles p
      set bones_balance = p.bones_balance + z.bones,
          bones_earned_total = p.bones_earned_total + z.bones
      from prizes z
      where p.id = z.user_id
      returning p.id, z.bones
  )
  insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select id, p_challenge_id, 'global_place', 0, 0, bones from paid;
end;
$$;
revoke execute on function public.pay_global_places(uuid) from public, anon, authenticated;


-- ── Settling: 0200's core; a global game pays its finish Bones and the
-- sponsor's hole, and no win Bones (its places pay instead) ──

create or replace function public.settle_challenge_score_core(p_challenge_id uuid)
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
  rg public.rally_games%rowtype;
  sg public.soccer_games%rowtype;
  cg public.cricket_games%rowtype;
  bg public.baseball_games%rowtype;
  hg public.hoops_games%rowtype;
  xg public.horse_games%rowtype;
  hcfg public.hoops_config%rowtype;
  gg public.golf_games%rowtype;
  gcfg public.golf_config%rowtype;
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  if not concluded and c.kind = 'tag' and c.tag_mode is distinct from 'chase' then
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

  -- A Journey ends the moment someone reaches the end of the course.
  if not concluded and c.kind = 'journey' and c.distance_goal_mi is not null then
    if exists (
      select 1 from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id
      group by ps.user_id
      having coalesce(sum(ps.distance_mi), 0) >= c.distance_goal_mi
    ) then
      concluded := true;
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

  -- A Cricket match ends once the second innings is over: that can be
  -- well before ends_at, or the morning after it.
  if c.kind = 'cricket' then
    perform public.cricket_advance(p_challenge_id);
    select * into cg from public.cricket_games where challenge_id = p_challenge_id;
    concluded := found and cg.status = 'final';
  end if;

  -- A Tag chase (0181) ends once its last day is settled, the morning
  -- after ends_at.
  if c.kind = 'tag' and c.tag_mode = 'chase' then
    perform public.tag_chase_advance(p_challenge_id);
    concluded := (select count(*) from public.tag_chase_days d where d.challenge_id = p_challenge_id) >= c.duration_days;
  end if;

  -- A Baseball game ends after its last inning, which can be days past
  -- ends_at in extra innings, or before it on a skipped bottom half.
  if c.kind = 'baseball' then
    perform public.baseball_advance(p_challenge_id);
    select * into bg from public.baseball_games where challenge_id = p_challenge_id;
    concluded := found and bg.status = 'final';
  end if;

  -- A Hoops game ends after its last quarter, or its last overtime: the
  -- morning after ends_at at the earliest.
  if c.kind::text = 'hoops' then
    perform public.hoops_advance(p_challenge_id);
    select * into hg from public.hoops_games where challenge_id = p_challenge_id;
    concluded := found and hg.status = 'final';
  end if;

  -- H-O-R-S-E ends when someone spells the word, or after its last day.
  if c.kind::text = 'horse' then
    perform public.horse_advance(p_challenge_id);
    select * into xg from public.horse_games where challenge_id = p_challenge_id;
    concluded := found and xg.status = 'final';
  end if;

  -- Golf ends once everyone's holed out, or at ends_at with every
  -- unfinished hole at par + 4 (hands-off walks played first).
  if c.kind::text = 'golf' then
    perform public.golf_advance(p_challenge_id, false);
    select * into gg from public.golf_games where challenge_id = p_challenge_id;
    concluded := found and gg.status = 'final';
  end if;

  -- A Soccer match ends after its last day is resolved, which can be the
  -- morning after ends_at — never before.
  if c.kind = 'soccer' then
    perform public.soccer_advance(p_challenge_id);
    select * into sg from public.soccer_games where challenge_id = p_challenge_id;
    concluded := found and sg.status = 'final';
  end if;

  -- A Rally ends on two games, or on time with the leading team winning.
  if c.kind = 'rally' then
    perform public.rally_settle(p_challenge_id);
    select * into rg from public.rally_games where challenge_id = p_challenge_id;
    concluded := found and rg.status in ('won', 'draw');
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

  elsif c.kind = 'tag' and c.tag_mode = 'chase' then
    -- Placed by points (+3 a tag, +1 a day got away), fewer days as IT
    -- breaking a tie, and scored like a Step Race.
    with ranked as (
      select s.user_id, row_number() over (order by s.points desc, s.days_it asc) as rnk
      from public.tag_chase_standings(p_challenge_id) s
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'tag_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

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

  elsif c.kind = 'journey' then
    -- Furthest along the course places first, like a Step Race by
    -- miles; finishing the course is worth a little more on top.
    with totals as (
      select cp.user_id, coalesce(sum(ps.distance_mi), 0) as total_mi
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    ),
    ranked as (
      select user_id, total_mi, row_number() over (order by total_mi desc) as rnk from totals
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'journey_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end
        + case when c.distance_goal_mi is not null and total_mi >= c.distance_goal_mi then 10 else 0 end,
      25,
      bones_trickle
    from ranked;

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

  elsif c.kind = 'bingo' and c.bingo_card_type = 'hound' then
    -- Squares count only if they're on the player's card. BINGOs are
    -- placed in the order Hound saw them.
    with st as (
      select cp.user_id, bc.bingo_at, bc.blackout_at,
        count(bp.category) filter (where bp.category = any (bc.squares)) as n
      from public.challenge_participants cp
      left join public.bingo_cards bc on bc.challenge_id = cp.challenge_id and bc.user_id = cp.user_id
      left join public.bingo_progress bp on bp.challenge_id = cp.challenge_id and bp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id, bc.bingo_at, bc.blackout_at
    ),
    placed as (
      select st.*, case when st.bingo_at is not null then rank() over (order by st.bingo_at) end as place
      from st
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'bingo_result',
      case
        when blackout_at is not null then 40
        when place = 1 then 35
        when place = 2 then 30
        when place = 3 then 25
        when bingo_at is not null then 20
        else least(n, 15)
      end,
      25 + n::int,
      bones_trickle
    from placed;

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

  elsif c.kind = 'rally' then
    -- The winning team scores like a Tic-Tac-Go winner, a draw on time
    -- like a Tic-Tac-Go draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'rally_result',
      case
        when rg.status = 'draw' then 15
        when p.team = rg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.rally_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'cricket' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'cricket_result',
      case
        when cg.winner_team is null then 15
        when p.team = cg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.cricket_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind = 'baseball' then
    -- The winning side scores like a Soccer winner, a tie like a draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'baseball_result',
      case
        when bg.winner_team is null then 15
        when p.team = bg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.baseball_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'hoops' then
    -- The winning side scores like a Soccer winner and gets Admin's win
    -- Bones; everyone who played gets the play Bones.
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'hoops_result',
      case
        when hg.winner_team is null then 15
        when p.team = hg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when p.team = hg.winner_team then coalesce(hcfg.win_bones, 40) else 0 end
    from public.hoops_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

  elsif c.kind::text = 'horse' then
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'horse_result',
      case
        when xg.winner is null then 15
        when cp.user_id = xg.winner then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when cp.user_id = xg.winner then coalesce(hcfg.win_bones, 40) else 0 end
    from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id;

  elsif c.kind::text = 'golf' then
    -- The winner scores like a Soccer winner and gets Admin's win Bones;
    -- everyone who finished every hole gets the play Bones, and each
    -- player their skins (a round alone has neither win nor skins).
    select * into gcfg from public.golf_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'golf_result',
      case
        when gg.winner is null then 15
        when p.user_id = gg.winner then 35
        else 5
      end,
      25,
      bones_trickle
        + case when p.finished_at is not null then coalesce(gg.finish_bones, gcfg.play_bones, 10) else 0 end
        -- In a global game the prizes are the places (pay_global_places).
        + case when p.user_id = gg.winner and not c.is_global then coalesce(gcfg.win_bones, 40) else 0 end
        + public.golf_skin_bones(gg.skins, p.user_id)
        + p.sponsor_bones
    from public.golf_players p
    where p.challenge_id = p_challenge_id and p.joined
      -- A global game pays the field: whoever swung.
      and (not c.is_global
           or exists (select 1 from public.golf_shots sh where sh.challenge_id = p_challenge_id and sh.user_id = p.user_id));

  elsif c.kind = 'soccer' then
    -- The winning side scores like a Rally winner, a draw like a Rally draw.
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select p.user_id, p_challenge_id, 'soccer_result',
      case
        when sg.winner_team is null then 15
        when p.team = sg.winner_team then 35
        else 5
      end,
      25,
      bones_trickle
    from public.soccer_players p
    where p.challenge_id = p_challenge_id and p.joined and p.user_id is not null;

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

  elsif c.kind = 'checklist' then
    -- Complete days: every shared item ticked, and the person's own
    -- line too if they wrote one. Same shape as 75 Day above: total
    -- complete days, not the reset-on-a-miss streak the app shows.
    with days as (
      select ck.user_id, ck.day, count(distinct ck.item_id) as ticked
      from public.checklist_checkins ck
      where ck.challenge_id = p_challenge_id and ck.done
      group by ck.user_id, ck.day
    ),
    counts as (
      select cp.user_id,
        -- Every shared item, plus your own line from the day you wrote
        -- it (so a line added on day 10 doesn't undo days 1 to 9).
        count(d.day) filter (where d.ticked >= (
          select count(*) from public.checklist_items i
          where i.challenge_id = p_challenge_id
            and (i.owner_id is null
              or (i.owner_id = cp.user_id
                  and coalesce(i.from_day, (i.created_at at time zone 'utc')::date) <= d.day))
        )) as complete_days
      from public.challenge_participants cp
      left join days d on d.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
      group by cp.user_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'checklist_result', complete_days * 3, 25 + complete_days, bones_trickle
    from counts;

  elsif c.kind = 'houndopoly' then
    -- Every day rolled first, then richest wins: net worth is cash plus
    -- the price of every square owned. Places like a Step Race.
    perform public.houndopoly_advance(p_challenge_id);
    with worth as (
      select cp.user_id, public.houndopoly_net_worth(p_challenge_id, cp.user_id) as net
      from public.challenge_participants cp
      where cp.challenge_id = p_challenge_id
    ),
    ranked as (
      select user_id, rank() over (order by net desc) as rnk from worth
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'houndopoly_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

  elsif c.kind = 'doors' then
    -- Most points wins, placed like a Step Race, and everyone gets the
    -- Bones for finishing. Every door's day is past by now, so each is
    -- counted as done, opened or missed.
    with ranked as (
      select b.user_id, rank() over (order by s.points desc, s.done desc) as rnk
      from public.challenge_participants b
      cross join lateral public.doors_points(p_challenge_id, b.user_id, public.doors_first_day(c) + c.duration_days) s
      where b.challenge_id = p_challenge_id
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'doors_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      -- Everyone gets Admin's Bones for finishing, on top of the trickle.
      bones_trickle + coalesce((select d.finish_bones from public.doors_settings d), 25)
    from ranked;

  elsif c.kind = 'packs' then
    -- Every day played first, then the pack with the most ground wins (a
    -- tie shares it). Its members get Admin's win Bones, everyone else the
    -- finishing Bones, all on top of the trickle.
    perform public.pack_advance(p_challenge_id);
    with held as (
      select p as pack, (select count(*) from public.pack_territories t where t.challenge_id = p_challenge_id and t.owner = p) as n
      from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p
    ),
    top as (select max(n) as n from held)
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select m.user_id, p_challenge_id, 'packs_result',
      case when h.n = (select n from top) and h.n > 0 then 40 else 10 end,
      25,
      bones_trickle + case when h.n = (select n from top) and h.n > 0
        then coalesce((select s.win_bones from public.pack_settings s), 50)
        else coalesce((select s.finish_bones from public.pack_settings s), 20) end
    from public.pack_members m
    join held h on h.pack = m.pack
    join public.challenge_participants cp on cp.challenge_id = m.challenge_id and cp.user_id = m.user_id
    where m.challenge_id = p_challenge_id;

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
revoke execute on function public.settle_challenge_score_core(uuid) from public, anon, authenticated;


-- ── Admin → Overview → Golf, with the Open ──

create or replace function public.admin_golf_overview()
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
  return jsonb_build_object(
    'config', to_jsonb(public.golf_cfg()),
    'games_live', (select count(*) from public.golf_games g where g.status = 'active'),
    'games_7d', (select count(*) from public.golf_games g where g.created_at > since),
    'games_all', (select count(*) from public.golf_games),
    'players_7d', (select count(distinct s.user_id) from public.golf_shots s where s.created_at > since),
    'players_all', (select count(distinct s.user_id) from public.golf_shots s),
    'shots_7d', (select count(*) from public.golf_shots s where s.created_at > since),
    'walk_shots_7d', (select count(*) from public.golf_shots s where s.walk_id is not null and s.created_at > since),
    'holes_7d', (select count(*) from public.golf_shots s where s.score is not null and s.created_at > since),
    'birdies_7d', (select count(*) from public.golf_shots s where s.holed and s.score = s.par - 1 and s.created_at > since),
    'eagles_7d', (select count(*) from public.golf_shots s where s.holed and s.score <= s.par - 2 and s.created_at > since),
    'hole_in_ones_all', (select count(*) from public.golf_shots s where s.holed and s.score = 1),
    'pick_ups_7d', (select count(*) from public.golf_shots s where s.picked_up and s.created_at > since),
    'avg_to_par_7d', (select round(avg(s.score - s.par), 2) from public.golf_shots s where s.score is not null and s.created_at > since),
    'hands_on_share', (select round(avg(case when g.hands_on then 1 else 0 end), 2) from public.golf_games g),
    'by_course', (select coalesce(jsonb_object_agg(k.id, (select count(*) from public.golf_games g where g.course_id = k.id)), '{}'::jsonb)
                  from public.golf_courses k),
    'by_format', jsonb_build_object(
      'stroke', (select count(*) from public.golf_games g where g.format = 'stroke'),
      'skins', (select count(*) from public.golf_games g where g.format = 'skins'),
      'match', (select count(*) from public.golf_games g where g.format = 'match')),
    'power_spent_7d', (select coalesce(sum(s.power), 0) from public.golf_shots s where s.created_at > since),
    'yards_spent_7d', (select coalesce(sum(s.yards), 0) from public.golf_shots s where s.created_at > since),
    'open', jsonb_build_object(
      'live', (select count(*) from public.golf_games g join public.challenges c on c.id = g.challenge_id
               where c.is_global and g.status = 'active'),
      'players', (select count(*) from public.golf_players p join public.golf_games g on g.challenge_id = p.challenge_id
                  join public.challenges c on c.id = g.challenge_id where c.is_global and g.status = 'active' and p.joined),
      'finished', (select count(*) from public.golf_players p join public.golf_games g on g.challenge_id = p.challenge_id
                   join public.challenges c on c.id = g.challenge_id where c.is_global and g.status = 'active' and p.finished_at is not null),
      'games_all', (select count(*) from public.golf_games g join public.challenges c on c.id = g.challenge_id where c.is_global)),
    'bones_7d', (select coalesce(sum(e.bones_points), 0) from public.activity_events e
                 where e.kind = 'golf_result' and e.created_at > since)
  );
end;
$$;
revoke execute on function public.admin_golf_overview() from public, anon;
grant execute on function public.admin_golf_overview() to authenticated;
