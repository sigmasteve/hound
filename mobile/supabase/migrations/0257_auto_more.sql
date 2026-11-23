-- 0257: more Auto (Steve, 23 Nov 2026), after 0256's ring and slots.
--
--   Home Run Derby  derby_swing_auto: swings at every pitch left, each at a
--                   random timing within 120 ms of the ball (times the
--                   stage's factor): a bit over half go out, fewer than a
--                   good hitter's, never aimed at the sign.
--   Hound Shootout  shootout_kick_auto: takes every kick left at the three
--                   low spots in a random mix (never the top bins, which
--                   count 2), with the power a little either side of right,
--                   so some are held or sail over.
--   Hound Bout      ring_defend_auto: faces every combination waiting,
--                   slipping each punch the right way a little over half
--                   the time and never tight, so no counters.
-- Each marks what it played (derby_swings.auto, shootout_kicks.auto,
-- ring_exchanges.auto_defended) for admin_auto_play_overview.
--
-- Run this once, after 0001-0256, in the SQL Editor.

alter table public.derby_swings add column if not exists auto boolean not null default false;
alter table public.shootout_kicks add column if not exists auto boolean not null default false;
alter table public.ring_exchanges add column if not exists auto_defended boolean not null default false;

-- ── Home Run Derby ──
create or replace function public.derby_swing_auto(p_challenge_id uuid, p_count int default 25)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  s public.derby_swings%rowtype;
  r jsonb;
  k int;
  t int;
  n int := 0;
  hrs int := 0;
  counts int := 0;
  longest int := 0;
  stop_reason text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  for k in 1..least(greatest(coalesce(p_count, 1), 1), 25) loop
    begin
      perform public.derby_pitch(p_challenge_id);
    exception when others then
      stop_reason := sqlerrm;
      exit;
    end;
    select * into s from public.derby_swings x
      where x.challenge_id = p_challenge_id and x.user_id = caller and x.result is null order by x.id desc limit 1;
    exit when s.id is null;
    t := round((random() * 2 - 1) * 120 * coalesce(s.factor, 1))::int;
    r := public.derby_swing(p_challenge_id, t);
    update public.derby_swings set auto = true where id = s.id;
    n := n + 1;
    if r ->> 'result' = 'hr' then
      hrs := hrs + 1;
      counts := counts + coalesce((r ->> 'counts')::int, 1);
      longest := greatest(longest, coalesce((r ->> 'ft')::int, 0));
    end if;
  end loop;
  if n = 0 and stop_reason is not null then
    raise exception '%', stop_reason;
  end if;
  return jsonb_build_object('swings', n, 'hrs', hrs, 'counts', counts, 'longest', longest, 'stopped', stop_reason);
end;
$$;
revoke execute on function public.derby_swing_auto(uuid, int) from public, anon;
grant execute on function public.derby_swing_auto(uuid, int) to authenticated;

-- ── Hound Shootout ──
create or replace function public.shootout_kick_auto(p_challenge_id uuid, p_count int default 25)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  r jsonb;
  k int;
  z int;
  pw int;
  n int := 0;
  goals int := 0;
  points int := 0;
  saved int := 0;
  off_target int := 0;
  stop_reason text;
  last_id bigint;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  for k in 1..least(greatest(coalesce(p_count, 1), 1), 25) loop
    -- The low spots: 3 bottom left, 4 bottom middle, 5 bottom right.
    z := 3 + floor(random() * 3)::int;
    pw := round(public.shootout_center() + (random() * 2 - 1) * public.shootout_width(z, 1) * 1.5)::int;
    begin
      r := public.shootout_kick(p_challenge_id, z, pw);
    exception when others then
      stop_reason := sqlerrm;
      exit;
    end;
    select max(x.id) into last_id from public.shootout_kicks x where x.challenge_id = p_challenge_id and x.user_id = caller;
    update public.shootout_kicks set auto = true where id = last_id;
    n := n + 1;
    case r ->> 'result'
      when 'goal' then goals := goals + 1; points := points + coalesce((r ->> 'points')::int, 1);
      when 'saved' then saved := saved + 1;
      else off_target := off_target + 1;
    end case;
  end loop;
  if n = 0 and stop_reason is not null then
    raise exception '%', stop_reason;
  end if;
  return jsonb_build_object('kicks', n, 'goals', goals, 'points', points, 'saved', saved, 'offTarget', off_target, 'stopped', stop_reason);
end;
$$;
revoke execute on function public.shootout_kick_auto(uuid, int) from public, anon;
grant execute on function public.shootout_kick_auto(uuid, int) to authenticated;

-- ── Hound Bout / Title Bout: facing their combinations ──
create or replace function public.ring_defend_auto(p_game text, p_challenge_id uuid, p_count int default 30)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  d jsonb;
  res jsonb;
  p jsonb;
  moves jsonb;
  xid bigint;
  k int;
  dirs text[] := array['left', 'right', 'duck', 'back'];
  right_dir text;
  n int := 0;
  faced int := 0;
  slipped int := 0;
  f_n int;
  s_n int;
  stop_reason text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  for k in 1..least(greatest(coalesce(p_count, 1), 1), 30) loop
    begin
      d := public.ring_defend_start(p_game, p_challenge_id);
    exception when others then
      stop_reason := sqlerrm;
      exit;
    end;
    xid := (d ->> 'id')::bigint;
    exit when xid is null;
    moves := '[]'::jsonb;
    for p in select * from jsonb_array_elements(coalesce(d -> 'punches', '[]'::jsonb)) loop
      right_dir := case
        when p ->> 'punch' = 'up' then 'back'
        when p ->> 'punch' = 'jab' then case when random() < 0.5 then 'left' else 'right' end
        when p ->> 'side' = 'L' then 'left'
        else 'right' end;
      -- The right way a little over half the time, in time but never
      -- tight (so no counters); otherwise a wrong guess.
      moves := moves || jsonb_build_array(jsonb_build_object(
        'dir', case when random() < 0.55 then right_dir else dirs[1 + floor(random() * 4)::int] end,
        'dt', -250));
    end loop;
    res := public.ring_defend_finish(xid, moves, 0);
    update public.ring_exchanges set auto_defended = true where id = xid;
    n := n + 1;
    select count(*)::int, (count(*) filter (where (e ->> 'slipped')::boolean))::int into f_n, s_n
      from jsonb_array_elements(coalesce(res -> 'results', '[]'::jsonb)) e;
    faced := faced + f_n;
    slipped := slipped + s_n;
  end loop;
  if n = 0 and stop_reason is not null then
    raise exception '%', stop_reason;
  end if;
  return jsonb_build_object('combos', n, 'slipped', slipped, 'faced', faced, 'stopped', stop_reason);
end;
$$;
revoke execute on function public.ring_defend_auto(text, uuid, int) from public, anon;
grant execute on function public.ring_defend_auto(text, uuid, int) to authenticated;

-- Admin: 0256's numbers, and the Derby, the Shootout and facing combinations.
create or replace function public.admin_auto_play_overview()
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
    'ring_auto_7d', (select count(*) from public.ring_exchanges x where x.auto and x.started_at > now() - interval '7 days'),
    'ring_all_7d', (select count(*) from public.ring_exchanges x where x.started_at > now() - interval '7 days'),
    'ring_auto_people_7d', (select count(distinct x.attacker) from public.ring_exchanges x where x.auto and x.started_at > now() - interval '7 days'),
    'ring_auto_people_ever', (select count(distinct x.attacker) from public.ring_exchanges x where x.auto),
    'slots_auto_7d', (select count(*) from public.slots_spins s where s.auto and s.created_at > now() - interval '7 days'),
    'slots_all_7d', (select count(*) from public.slots_spins s where s.created_at > now() - interval '7 days'),
    'slots_auto_people_7d', (select count(distinct s.user_id) from public.slots_spins s where s.auto and s.created_at > now() - interval '7 days'),
    'slots_auto_people_ever', (select count(distinct s.user_id) from public.slots_spins s where s.auto),
    -- 0257
    'derby_auto_7d', (select count(*) from public.derby_swings s where s.auto and s.swung_at > now() - interval '7 days'),
    'derby_all_7d', (select count(*) from public.derby_swings s where s.swung_at > now() - interval '7 days'),
    'derby_auto_people_7d', (select count(distinct s.user_id) from public.derby_swings s where s.auto and s.swung_at > now() - interval '7 days'),
    'derby_auto_people_ever', (select count(distinct s.user_id) from public.derby_swings s where s.auto),
    'shootout_auto_7d', (select count(*) from public.shootout_kicks k where k.auto and k.kicked_at > now() - interval '7 days'),
    'shootout_all_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days'),
    'shootout_auto_people_7d', (select count(distinct k.user_id) from public.shootout_kicks k where k.auto and k.kicked_at > now() - interval '7 days'),
    'shootout_auto_people_ever', (select count(distinct k.user_id) from public.shootout_kicks k where k.auto),
    'defend_auto_7d', (select count(*) from public.ring_exchanges x where x.auto_defended and x.defended_at > now() - interval '7 days'),
    'defend_all_7d', (select count(*) from public.ring_exchanges x where x.defended_at > now() - interval '7 days'),
    'defend_auto_people_7d', (select count(distinct x.defender) from public.ring_exchanges x where x.auto_defended and x.defended_at > now() - interval '7 days'));
end;
$$;
revoke execute on function public.admin_auto_play_overview() from public, anon;
grant execute on function public.admin_auto_play_overview() to authenticated;
