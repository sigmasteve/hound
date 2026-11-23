-- 0256: Auto, for Hound Bout and Paw Slots (Steve, 23 Nov 2026).
--
-- The ring: ring_exchange_auto throws your exchanges for you, up to the
-- actions you have left. Every punch lands clean, never perfect and never
-- with a star, so a clean punch into their guard is still blocked or
-- countered: playing by hand scores more. Combinations waiting for you to
-- face are still yours to slip.
-- Paw Slots: slots_spin_auto is one ordinary spin (the app repeats it
-- until the spins run out or you tap Stop), marked as auto.
-- Both mark what they did (ring_exchanges.auto, slots_spins.auto) for
-- admin_auto_play_overview (Admin → Games, on the Bout and Slots cards).
--
-- Run this once, after 0001-0255, in the SQL Editor.

alter table public.ring_exchanges add column if not exists auto boolean not null default false;
alter table public.slots_spins add column if not exists auto boolean not null default false;

create or replace function public.ring_exchange_auto(p_game text, p_challenge_id uuid, p_count int default 30)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ctx jsonb;
  ex jsonb;
  r jsonb;
  xid bigint;
  i int;
  k int;
  n int := 0;
  pts int := 0;
  landed int := 0;
  blocked int := 0;
  stop_reason text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  for k in 1..least(greatest(coalesce(p_count, 1), 1), 30) loop
    ctx := public.ring_ctx(p_game, p_challenge_id, caller);
    stop_reason := ctx ->> 'reason';
    exit when stop_reason is not null;
    ex := public.ring_exchange_start(p_game, p_challenge_id);
    xid := (ex ->> 'id')::bigint;
    update public.ring_exchanges set auto = true where id = xid;
    for i in 0..2 loop
      -- 0.7 of the way in: clean.
      r := public.ring_exchange_punch(xid, i, 0.7, false);
      pts := pts + coalesce((r ->> 'points')::int, 0);
      if (r ->> 'blocked')::boolean or (r ->> 'countered')::boolean then
        blocked := blocked + 1;
      elsif coalesce((r ->> 'points')::int, 0) > 0 then
        landed := landed + 1;
      end if;
    end loop;
    n := n + 1;
  end loop;
  if n = 0 and stop_reason is not null then
    raise exception '%', stop_reason;
  end if;
  return jsonb_build_object('exchanges', n, 'points', pts, 'landed', landed, 'blocked', blocked,
    'left', greatest(0, coalesce((public.ring_day(p_game, p_challenge_id, caller, public.soccer_today(caller)) ->> 'left')::int, 0)),
    'stopped', stop_reason);
end;
$$;
revoke execute on function public.ring_exchange_auto(text, uuid, int) from public, anon;
grant execute on function public.ring_exchange_auto(text, uuid, int) to authenticated;

create or replace function public.slots_spin_auto(p_challenge_id uuid, p_lines int, p_bet int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  res jsonb;
begin
  res := public.slots_spin(p_challenge_id, p_lines, p_bet);
  update public.slots_spins set auto = true
    where id = (select max(s.id) from public.slots_spins s where s.challenge_id = p_challenge_id and s.user_id = auth.uid());
  return res;
end;
$$;
revoke execute on function public.slots_spin_auto(uuid, int, int) from public, anon;
grant execute on function public.slots_spin_auto(uuid, int, int) to authenticated;

-- Admin: how much of the ring and the slots is played on Auto.
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
    'slots_auto_people_ever', (select count(distinct s.user_id) from public.slots_spins s where s.auto));
end;
$$;
revoke execute on function public.admin_auto_play_overview() from public, anon;
grant execute on function public.admin_auto_play_overview() to authenticated;
