-- 0253: putting from the fringe (Steve, 23 Nov 2026: 42 ft from the cup,
-- just off the green in the rough, and the putter was greyed out).
--
-- The putter now plays from the green or from just off it: fairway or
-- rough within 3 yards of the green's edge, not in the trees, a bunker
-- or water (golf_fringe; the app mirrors it, golfFringe in golfPutt.ts).
-- A putt from there rolls like one on the green (its length plus the
-- break). On the green it's still the putter only.
-- admin_golf_putting_overview adds putts from the fringe this week.
--
-- Run this once, after 0001-0252, in the SQL Editor.

-- Just off the green: where a putt is allowed but other clubs are too.
create or replace function public.golf_fringe(h jsonb, p_d numeric, p_lat numeric)
returns boolean
language sql
immutable
as $$
  select public.golf_lie(h, p_d, p_lat) in ('fairway', 'rough')
    and public.golf_hazard_at(h, p_d, p_lat, array['trees']) is null
    and sqrt(power(p_d - (h -> 'green' ->> 'd')::numeric, 2) + power(p_lat - (h -> 'green' ->> 'lat')::numeric, 2))
      <= (h -> 'green' ->> 'r')::numeric + 3;
$$;
revoke execute on function public.golf_fringe(jsonb, numeric, numeric) from public, anon, authenticated;

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
  h jsonb;
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
  select x.hole into h from public.golf_holes x where x.course_id = g.course_id and x.no = public.golf_course_no(pl.hole);
  if pl.lie <> 'green' and p_club = 'putter' and not public.golf_fringe(h, pl.ball_d, pl.ball_lat) then
    raise exception 'The putter''s for the green, or just off it.';
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
        public.golf_lie(x.hole, s.from_d, s.from_lat) <> 'green' as fringe,
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
      -- 0253: putts from just off the green.
      'fringe_putts_7d', (select count(*) from putts where fringe),
      'fringe_putters_7d', (select count(distinct user_id) from putts where fringe),
      'fringe_made_7d', (select count(*) from putts where fringe and holed),
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
