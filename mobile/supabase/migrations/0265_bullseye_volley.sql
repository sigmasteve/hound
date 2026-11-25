-- 0265: Bullseye, a volley and fewer arrows (Steve, 25 Nov 2026: "the
-- game appears too easy... Can we shoot multiple arrows at once. Up to
-- 3... Maybe limiting number of shots per day").
--
--   A volley   bullseye_volley shoots 1 to 3 arrows off one draw, at the
--              same target, up to the arrows left in the round. The first
--              follows your sight pin; the others each wobble their own way
--              (their own sway, the same hold and the same release), so a
--              volley is quicker but each arrow after the first is a guess.
--              Each arrow is a normal shot (bullseye_shoot): its own score,
--              Robin Hoods (into another arrow of the volley counts), the
--              gold balloon and the tape. bullseye_aims.volley keeps how
--              many went, for Admin.
--   Fewer      max_ends 6 -> 4 a day (12 arrows) and carry_max 18 -> 6, so a
--              day is at most 18 arrows instead of 36. Still 1,500 steps a
--              round. Both stay in bullseye_settings.
--
-- Run this once, after 0001-0264, in the SQL Editor.

update public.bullseye_settings set max_ends = 4, carry_max = 6, updated_at = now() where id;

alter table public.bullseye_aims add column if not exists volley smallint not null default 1;

create or replace function public.bullseye_volley(
  p_challenge_id uuid, p_aim_id bigint, p_hold_x double precision, p_hold_y double precision, p_draw_ms int default null, p_count int default 1
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  s public.bullseye_settings%rowtype;
  a public.bullseye_aims%rowtype;
  used int;
  in_end int;
  n int;
  i int;
  aid bigint;
  r jsonb;
  shots jsonb := '[]';
  pts int := 0;
begin
  perform public.bullseye_live(p_challenge_id, me);
  select * into s from public.bullseye_settings;
  select * into a from public.bullseye_aims where id = p_aim_id and user_id = me and challenge_id = p_challenge_id;
  if not found then
    raise exception 'Step back up to the line and try again.';
  end if;
  if a.fired then
    raise exception 'That arrow''s already gone.';
  end if;
  perform public.bullseye_day_row(p_challenge_id, me, a.day);
  select coalesce(d.used, 0) into used from public.bullseye_days d where d.challenge_id = p_challenge_id and d.user_id = me and d.day = a.day;
  in_end := s.arrows_per_end - coalesce(used, 0) % s.arrows_per_end;
  n := least(greatest(coalesce(p_count, 1), 1), 3, in_end, greatest(public.bullseye_left(p_challenge_id, me, a.day), 1));
  update public.bullseye_aims set volley = n where id = a.id;

  for i in 1..n loop
    if i = 1 then
      aid := a.id;
    else
      -- The same draw for the next arrow, swaying its own way.
      insert into public.bullseye_aims (challenge_id, user_id, day, target, seed, amp, started_at, volley)
      values (a.challenge_id, me, a.day, a.target, ((a.seed::bigint + i * 7919) % 2000000000)::int, a.amp, a.started_at, n)
      returning id into aid;
    end if;
    r := public.bullseye_shoot(p_challenge_id, aid, p_hold_x, p_hold_y, p_draw_ms);
    shots := shots || jsonb_build_array(r);
    pts := pts + (r ->> 'points')::int;
  end loop;

  return jsonb_build_object('arrows', shots, 'points', pts, 'count', n);
end;
$$;
revoke execute on function public.bullseye_volley(uuid, bigint, double precision, double precision, int, int) from public, anon;
grant execute on function public.bullseye_volley(uuid, bigint, double precision, double precision, int, int) to authenticated;

-- Admin → Bullseye: how much volleys are used.
create or replace function public.admin_bullseye_volley_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return jsonb_build_object(
    'volleys_7d', (select count(*) from public.bullseye_aims a where a.fired and a.volley > 1 and a.started_at > now() - interval '7 days'
                   and a.id = (select min(b.id) from public.bullseye_aims b where b.user_id = a.user_id and b.started_at = a.started_at and b.volley = a.volley)),
    'people_7d', (select count(distinct user_id) from public.bullseye_aims where fired and volley > 1 and started_at > now() - interval '7 days'),
    'arrows_7d', (select count(*) from public.bullseye_aims where fired and started_at > now() - interval '7 days'),
    'volley_arrows_7d', (select count(*) from public.bullseye_aims where fired and volley > 1 and started_at > now() - interval '7 days'));
end;
$$;
revoke execute on function public.admin_bullseye_volley_overview() from public, anon;
grant execute on function public.admin_bullseye_volley_overview() to authenticated;
