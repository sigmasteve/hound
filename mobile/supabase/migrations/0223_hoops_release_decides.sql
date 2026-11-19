-- Hound: Hoops, your release decides the shot (Steve, Nov 2026: shots in
-- the orange were going in and shots in the green missing).
--
-- Before, the meter only nudged the roll (+20 dark green, +10 green, -10
-- orange, -30 red on the shot's chance), so a three released in the green
-- went in 45% of the time and a drive in the orange 45%. Now, like the
-- Derby and the Shootout, the release decides and the shot sets the rest:
--
--   dark green (swish)   97%
--   green                the shot's chance + 35, between 80% and 95%
--                        (even steps: drive 90%, mid-range 80%, three 80%)
--   orange (near)        the shot's chance - 30, between 10% and 25%
--                        (even steps: drive 25%, mid-range 14%, three 10%)
--   red (off)            3%
--
-- The shot's chance (hoops_chance: the kind, your steps against your
-- defender's, their defense, a dunk, on fire) still moves a release
-- within its band, and steps still narrow the green (hoops_window).
-- Hands-off games and the shots nobody took are rolled as before.
-- H-O-R-S-E already lets the release decide (0209: no roll).
--
-- Run this once, after 0001-0222, in the SQL Editor.

create or replace function public.hoops_release_chance(p_chance double precision, p_quality text)
returns double precision
language sql
immutable
as $$
  select (case p_quality
    when 'swish' then 0.97
    when 'green' then least(0.95, greatest(0.80, p_chance + 0.35))
    when 'near' then least(0.25, greatest(0.10, p_chance - 0.30))
    else 0.03 end)::double precision;
$$;
revoke execute on function public.hoops_release_chance(double precision, text) from public, anon, authenticated;

create or replace function public.hoops_take_shot(p_challenge_id uuid, p_kind text, p_timing numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s jsonb;
  seat uuid;
  team text;
  o text;
  n int;
  mine int;
  theirs int;
  their_def text;
  gd double precision;
  tm numeric;
  w double precision;
  q text;
  dunk boolean;
  fire boolean;
  ch double precision;
  made boolean;
  p int;
  reb text;
  pb_made boolean;
  pb_pts int;
  seed text;
  msg text;
  pts_word text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  if p_kind is null or p_kind not in ('drive', 'mid', 'three') then
    raise exception 'Pick drive, mid-range or three.';
  end if;
  if p_timing is null then
    raise exception 'Release the shot first.';
  end if;
  -- One shot at a time per seat, and not while the day is being played.
  perform 1 from public.challenges where id = p_challenge_id for share;
  perform 1 from public.hoops_players hp where hp.challenge_id = p_challenge_id and hp.user_id = caller for update;

  s := public.hoops_live_state(p_challenge_id, caller);
  if not (s ->> 'can_shoot')::boolean then
    raise exception '%', s ->> 'reason';
  end if;
  seat := (s ->> '_seat')::uuid;
  team := s ->> '_team';
  o := case when team = 'home' then 'away' else 'home' end;
  n := (s ->> 'taken')::int + 1;
  mine := (s ->> 'steps')::int;
  theirs := (s ->> '_theirs')::int;
  their_def := s ->> 'their_defense';
  gd := (s ->> '_gd')::double precision;
  tm := least(0.5, greatest(-0.5, p_timing));
  w := public.hoops_window(p_kind, mine, theirs);
  q := public.hoops_quality(tm, w);
  dunk := p_kind = 'drive' and mine >= 15000;
  fire := (s ->> 'streak')::int >= 3;
  -- 0223: the release decides; the shot and the steps set the rest.
  ch := public.hoops_release_chance(least(0.95, public.hoops_chance(p_kind, mine, theirs, their_def, dunk, fire) + gd), q);
  seed := p_challenge_id::text || ':' || (s ->> 'day') || ':' || seat || ':live:' || n;
  made := public.rally_js_rand(public.rally_js_hash(seed)) < ch;
  p := case when not made then 0 when p_kind = 'three' then 3 else 2 end;
  if not made then
    reb := case when public.rally_js_rand(public.rally_js_hash(seed || ':reb')) < 0.6 * (s ->> '_share')::double precision then team else o end;
    if reb = team then
      pb_made := public.rally_js_rand(public.rally_js_hash(seed || ':putback'))
                 < least(0.95, public.hoops_chance('putback', mine, theirs, their_def, false, false) + gd);
      pb_pts := case when pb_made then 2 else 0 end;
    end if;
  end if;

  insert into public.hoops_live_shots (challenge_id, day, seat, user_id, n, kind, timing, quality, window_size, chance, made, pts,
                                       dunk, on_fire, rebound, putback_made, putback_pts, mine_steps, theirs_steps, defense)
    values (p_challenge_id, (s ->> 'day')::date, seat, caller, n, p_kind, tm, q, w, ch, made, p,
            dunk, fire, reb, pb_made, pb_pts, mine, theirs, their_def);

  pts_word := case when p = 3 then 'Three points.' else 'Two points.' end;
  msg := case
    when made and dunk then 'Dunk!'
    when made and q = 'swish' then 'Swish! ' || pts_word
    when made then 'In off the rim. ' || pts_word
    when pb_made then 'Rims out. Your side grabs it… putback, two points.'
    when pb_made is not null then 'Rims out. Your side grabs it… the putback rolls off.'
    when q in ('swish', 'green') then 'Rims out.'
    when tm < 0 then 'Short.'
    else 'Long.'
  end;

  return jsonb_build_object(
    'n', n, 'kind', p_kind, 'quality', q, 'chance', round(ch::numeric, 2), 'made', made, 'pts', p,
    'dunk', dunk and made, 'on_fire', fire,
    'putback', case when pb_made is not null then jsonb_build_object('made', pb_made, 'pts', pb_pts) end,
    'ready', greatest(0, (s ->> 'ready')::int - 1),
    'today_pts', (s ->> 'today_pts')::int + p + coalesce(pb_pts, 0),
    'message', msg);
end;
$$;
revoke execute on function public.hoops_take_shot(uuid, text, numeric) from public, anon;
grant execute on function public.hoops_take_shot(uuid, text, numeric) to authenticated;
