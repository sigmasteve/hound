-- Hound: Hound Roulette (0235 adds the kind). Mockup:
-- claude.ai/artifact/HfDqdw7FaXZmCeDy68pJcX.
--
-- Every day, on each member's own date:
--
--   bank        before you spin, cash the ride: banked += floor(ride x
--               the multiplier). The multiplier grows with each day riding:
--               x1, x1.5, x2, x2.5, then x3.
--   the stake   Safe (+1), Bold (+3) or All in (doubles the ride, from at
--               least 2). Picked before the spin.
--   the spin    the wheel lands on today's task, seeded by the challenge,
--               the member and the day (the same answer however often it's
--               asked, and the same whatever the stake): steps (two
--               slots), a workout, water, all your goals, a hound walk,
--               cheering friends, Free Day (the points now), Double (a
--               steps task worth double; All in triples the ride) or Pick
--               Yours (choose from five). Targets are sized by the stake
--               and, for steps, from your own last seven days.
--   done        scored from what Hound already keeps (the same evidence
--               Daily Doors reads), the moment it lands: the points go on
--               the ride.
--   missed      a spin not done by the end of its day, or a day with no
--               spin, and the whole ride is gone. Banked points are safe.
--
-- Against each other:
--
--   a Raid      spend 2 banked points on someone riding 2 or more today
--               (not yet done): if they miss, their lost ride comes to you
--               (up to 25), and your 2 back; if they make it, your 2 go to
--               them; if they banked before it was lost, your 2 come back.
--               One Raid sent a day, one Raid on a person a day.
--   a Duel      call someone out for 2 to 25 banked points. If they accept
--               within a day, both stakes are held and tomorrow is a step-off,
--               each on their own date: who beats their own seven-day
--               average by more takes both. Level: both back.
--
-- Nothing here can be bought, and Bones never come in: points come only
-- from doing the tasks, and go out only as Bones and the Lucky Bandana at
-- the end. When it's over: the rest of a ride is banked, most banked
-- wins (placed like a Step Race), everyone gets the usual 5 Bones plus 10
-- for finishing plus one Bone a banked point (up to 100), and the winner's
-- hound gets the Lucky Bandana (never sold). Admin's numbers are in
-- roulette_settings.
--
-- Resolving: your own spin or bank first settles your past days (after the
-- phone has claimed its own step count, roulette_claim_steps); a sweep at
-- 11:50 UTC settles anyone two days behind, resolves duels whose days are
-- over everywhere, and drops calls nobody answered in a day.
--
-- Pushes through send-golf-notification's 'roulette' kind (worded here):
-- a Raid on you, a Duel call, its answer and result, and a morning "Spin"
-- to anyone in a live game who hasn't spun.
--
-- Run this once, after 0235 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification.

-- ── The prize ──

insert into public.kennel_items (id, slot, name, cost_bones, available_until)
  values ('bandana_lucky', 'neck', 'Lucky Bandana', 0, '2000-01-01')
  on conflict (id) do nothing;

-- ── Settings ──

create table public.roulette_settings (
  id boolean primary key default true,
  constraint roulette_settings_singleton check (id),
  safe_points int not null default 1 check (safe_points between 0 and 20),
  bold_points int not null default 3 check (bold_points between 0 and 50),
  raid_cost int not null default 2 check (raid_cost between 1 and 20),
  raid_cap int not null default 25 check (raid_cap between 1 and 200),
  duel_min int not null default 2 check (duel_min between 1 and 50),
  duel_max int not null default 25 check (duel_max between 1 and 200),
  bones_per_point int not null default 1 check (bones_per_point between 0 and 10),
  bones_cap int not null default 100 check (bones_cap between 0 and 1000),
  finish_bones int not null default 10 check (finish_bones between 0 and 500),
  updated_at timestamptz not null default now()
);
insert into public.roulette_settings (id) values (true);
alter table public.roulette_settings enable row level security;
create policy "Anyone signed in can read the Roulette settings"
  on public.roulette_settings for select to authenticated using (true);
create policy "Only admins can change the Roulette settings"
  on public.roulette_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.roulette_settings from anon;
revoke insert, delete on public.roulette_settings from authenticated;

-- ── Tables ──

create table public.roulette_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  banked int not null default 0 check (banked >= 0),
  ride int not null default 0 check (ride >= 0),
  ride_days int not null default 0 check (ride_days >= 0),
  last_done_day date,
  -- The last day settled: misses and Raids up to it are done.
  settled_through date,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.roulette_spins (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  stake text not null check (stake in ('safe', 'bold', 'allin')),
  segment text not null check (segment in ('steps', 'workout', 'water', 'free', 'goals', 'walk', 'double', 'cheer', 'steps2', 'pick')),
  -- Null until a Pick Yours is picked.
  task text check (task in ('steps', 'workout', 'water', 'goals', 'walk', 'cheer', 'free')),
  target int,
  double boolean not null default false,
  status text not null default 'open' check (status in ('open', 'done', 'missed')),
  points int not null default 0,
  spun_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (challenge_id, user_id, day)
);
create index roulette_spins_open on public.roulette_spins (user_id) where status = 'open';

create table public.roulette_raids (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  raider uuid not null references public.profiles (id) on delete cascade,
  target uuid not null references public.profiles (id) on delete cascade,
  -- The raider's date (one sent a day) and the target's (one on them a day).
  raider_day date not null,
  day date not null,
  cost int not null,
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'void')),
  points int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (raider <> target),
  unique (challenge_id, raider, raider_day),
  unique (challenge_id, target, day)
);

create table public.roulette_duels (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  caller uuid not null references public.profiles (id) on delete cascade,
  opponent uuid not null references public.profiles (id) on delete cascade,
  stake int not null check (stake > 0),
  status text not null default 'open' check (status in ('open', 'on', 'declined', 'expired', 'done')),
  caller_day date,
  opponent_day date,
  caller_avg int,
  opponent_avg int,
  caller_steps int,
  opponent_steps int,
  winner uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  resolved_at timestamptz,
  check (caller <> opponent)
);
create index roulette_duels_live on public.roulette_duels (challenge_id) where status in ('open', 'on');

-- What happened, for the challenge page's feed (worded in the app).
create table public.roulette_events (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  other_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  points int not null default 0,
  detail text,
  created_at timestamptz not null default now()
);
create index roulette_events_challenge on public.roulette_events (challenge_id, created_at desc);

alter table public.roulette_players enable row level security;
alter table public.roulette_spins enable row level security;
alter table public.roulette_raids enable row level security;
alter table public.roulette_duels enable row level security;
alter table public.roulette_events enable row level security;
revoke all on public.roulette_players, public.roulette_spins, public.roulette_raids, public.roulette_duels, public.roulette_events from anon;
revoke insert, update, delete on public.roulette_players, public.roulette_spins, public.roulette_raids, public.roulette_duels, public.roulette_events from authenticated;
-- Everything is read through roulette_state.

-- ── The wheel ──

create or replace function public.roulette_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$ select public.horse_name(p_user); $$;
revoke execute on function public.roulette_name(uuid) from public, anon, authenticated;

create or replace function public.roulette_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('roulette', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.roulette_notify(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.roulette_log(p_challenge_id uuid, p_user uuid, p_other uuid, p_kind text, p_points int, p_detail text default null)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.roulette_events (challenge_id, user_id, other_id, kind, points, detail)
  values (p_challenge_id, p_user, p_other, p_kind, coalesce(p_points, 0), p_detail);
$$;
revoke execute on function public.roulette_log(uuid, uuid, uuid, text, int, text) from public, anon, authenticated;

-- The ten slots, in wheel order (the app draws them in this order), and
-- their weights out of 86.
create or replace function public.roulette_segment(p_challenge_id uuid, p_user uuid, p_day date)
returns text
language plpgsql
immutable
as $$
declare
  segs text[] := array['steps', 'workout', 'water', 'free', 'goals', 'walk', 'double', 'cheer', 'steps2', 'pick'];
  w int[] := array[10, 10, 10, 5, 10, 10, 5, 10, 10, 6];
  r int := abs(hashtext('roulette:' || p_challenge_id::text || ':' || p_user::text || ':' || p_day::text)) % 86;
  i int;
begin
  for i in 1 .. 10 loop
    r := r - w[i];
    if r < 0 then
      return segs[i];
    end if;
  end loop;
  return 'steps';
end;
$$;
revoke execute on function public.roulette_segment(uuid, uuid, date) from public, anon, authenticated;

-- The member's average daily steps over the seven days before, or 5,000.
create or replace function public.roulette_avg(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(round(avg(d.steps))::int, 5000)
  from public.daily_step_totals d
  where d.user_id = p_user and d.day between p_day - 7 and p_day - 1 and d.steps > 0;
$$;
revoke execute on function public.roulette_avg(uuid, date) from public, anon, authenticated;

-- A task's target for a stake: steps, minutes, ml or cheers (goals: none).
create or replace function public.roulette_target(p_task text, p_stake text, p_user uuid, p_day date)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
declare
  si int := case p_stake when 'safe' then 1 when 'bold' then 2 else 3 end;
  water int;
begin
  case p_task
    when 'steps' then
      return least(30000, greatest(2000, (round(public.roulette_avg(p_user, p_day) * (array[1.0, 1.25, 1.6])[si] / 500) * 500)::int));
    when 'workout' then
      return (array[10, 20, 35])[si];
    when 'water' then
      water := coalesce((select w.target_ml from public.water_goals w where w.user_id = p_user), 1893);
      return round(water * (array[0.5, 1.0, 1.25])[si])::int;
    when 'walk' then
      return (array[10, 20, 30])[si];
    when 'cheer' then
      return (array[1, 2, 4])[si];
    else
      return null;
  end case;
end;
$$;
revoke execute on function public.roulette_target(text, text, uuid, date) from public, anon, authenticated;

-- How far along a task is on a day: steps, minutes, ml, cheers, or 1/0 for
-- goals.
create or replace function public.roulette_progress(p_user uuid, p_task text, p_day date)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
declare
  tz text := coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York');
begin
  case p_task
    when 'steps' then
      return greatest(
        coalesce((select d.steps from public.daily_step_totals d where d.user_id = p_user and d.day = p_day), 0),
        coalesce((select max(ps.steps) from public.progress_snapshots ps where ps.user_id = p_user and ps.day = p_day), 0));
    when 'workout' then
      return coalesce((
        select sum(coalesce(w.duration_min, w.logged_min, 0))::int from public.workout_history w
        where w.user_id = p_user
          and w.occurred_at >= (p_day - 1)::timestamp at time zone 'utc'
          and w.occurred_at < (p_day + 2)::timestamp at time zone 'utc'
          and (w.occurred_at at time zone tz)::date = p_day), 0);
    when 'water' then
      return coalesce((select sum(l.ml)::int from public.water_log l where l.user_id = p_user and l.day = p_day), 0);
    when 'walk' then
      return coalesce((select floor(sum(extract(epoch from (w.ended_at - w.started_at))) / 60)::int from public.hound_walks w where w.user_id = p_user and w.day = p_day), 0);
    when 'cheer' then
      return (select count(*)::int from public.challenge_reactions r where r.from_user = p_user and r.day = p_day)
        + (select count(*)::int from public.nudges n
           where n.from_user = p_user
             and n.created_at >= (p_day - 1)::timestamp at time zone 'utc'
             and n.created_at < (p_day + 2)::timestamp at time zone 'utc'
             and (n.created_at at time zone tz)::date = p_day);
    when 'goals' then
      return case when public.doors_evidence(p_user, 'goal_day', p_day, null) then 1 else 0 end;
    else
      return 0;
  end case;
end;
$$;
revoke execute on function public.roulette_progress(uuid, text, date) from public, anon, authenticated;

create or replace function public.roulette_mult(p_days int)
returns numeric language sql immutable as $$ select least(3, 1 + 0.5 * greatest(0, coalesce(p_days, 0) - 1))::numeric; $$;
revoke execute on function public.roulette_mult(int) from public, anon;
grant execute on function public.roulette_mult(int) to authenticated;

create or replace function public.roulette_player(p_challenge_id uuid, p_user uuid)
returns public.roulette_players
language plpgsql
security definer set search_path = public
as $$
declare
  r public.roulette_players;
begin
  insert into public.roulette_players (challenge_id, user_id) values (p_challenge_id, p_user) on conflict do nothing;
  select * into r from public.roulette_players where challenge_id = p_challenge_id and user_id = p_user for update;
  return r;
end;
$$;
revoke execute on function public.roulette_player(uuid, uuid) from public, anon, authenticated;

-- A spin done: its points on the ride. Returns the points it added.
create or replace function public.roulette_credit(p_challenge_id uuid, p_user uuid, p_day date)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  s public.roulette_spins;
  pl public.roulette_players;
  cfg public.roulette_settings;
  before int;
  after int;
begin
  select * into s from public.roulette_spins where challenge_id = p_challenge_id and user_id = p_user and day = p_day for update;
  if not found or s.status <> 'open' then
    return 0;
  end if;
  select * into cfg from public.roulette_settings;
  pl := public.roulette_player(p_challenge_id, p_user);
  before := pl.ride;
  if s.stake = 'allin' then
    after := greatest(before, 2) * case when s.double then 3 else 2 end;
  else
    after := before + (case when s.stake = 'safe' then cfg.safe_points else cfg.bold_points end) * case when s.double then 2 else 1 end;
  end if;
  update public.roulette_players
    set ride = after, ride_days = ride_days + 1, last_done_day = greatest(coalesce(last_done_day, p_day), p_day), updated_at = now()
    where challenge_id = p_challenge_id and user_id = p_user;
  update public.roulette_spins set status = 'done', done_at = now(), points = after - before
    where challenge_id = p_challenge_id and user_id = p_user and day = p_day;
  perform public.roulette_log(p_challenge_id, p_user, null, case when s.task = 'free' then 'free' else 'done' end, after - before, s.stake);
  return after - before;
end;
$$;
revoke execute on function public.roulette_credit(uuid, uuid, date) from public, anon, authenticated;

-- Marks any of a member's open spins (last few days) whose task is now done.
create or replace function public.roulette_recheck(p_user uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  s record;
  n int := 0;
begin
  for s in
    select x.challenge_id, x.day from public.roulette_spins x
    where x.user_id = p_user and x.status = 'open' and x.task is not null and x.task <> 'free'
      and x.day >= (now() at time zone 'utc')::date - 3
      and (x.task = 'goals' and public.roulette_progress(p_user, 'goals', x.day) >= 1
           or x.task <> 'goals' and public.roulette_progress(p_user, x.task, x.day) >= x.target)
    order by x.day
  loop
    perform public.roulette_credit(s.challenge_id, p_user, s.day);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.roulette_recheck(uuid) from public, anon, authenticated;

create or replace function public.roulette_on_evidence()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  who uuid;
begin
  begin
    who := case when tg_table_name in ('nudges', 'challenge_reactions') then (to_jsonb(new) ->> 'from_user')::uuid
                else (to_jsonb(new) ->> 'user_id')::uuid end;
    if who is not null and exists (select 1 from public.roulette_spins s where s.user_id = who and s.status = 'open') then
      perform public.roulette_recheck(who);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.roulette_on_evidence() from public, anon, authenticated;

create trigger roulette_on_steps after insert or update of steps on public.daily_step_totals
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_snapshot after insert or update of steps on public.progress_snapshots
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_workout after insert on public.workout_history
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_water after insert on public.water_log
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_goal_day after insert on public.activity_events
  for each row when (new.kind = 'goal_day') execute procedure public.roulette_on_evidence();
create trigger roulette_on_walk after insert or update on public.hound_walks
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_nudge after insert on public.nudges
  for each row execute procedure public.roulette_on_evidence();
create trigger roulette_on_reaction after insert on public.challenge_reactions
  for each row execute procedure public.roulette_on_evidence();

-- ── Settling the days behind ──

-- Settles a member's days before p_through + 1: open spins become misses,
-- a ride not done on its last day is lost (to a Raider, if there is one),
-- and that day's Raids are paid out. Returns the points lost.
create or replace function public.roulette_settle_member(p_challenge_id uuid, p_user uuid, p_through date)
returns int
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare
  pl public.roulette_players;
  cfg public.roulette_settings;
  rd public.roulette_raids;
  lost int := 0;
  lost_day date;
  take int;
  s record;
begin
  select * into cfg from public.roulette_settings;
  pl := public.roulette_player(p_challenge_id, p_user);
  if pl.settled_through is not null and pl.settled_through >= p_through then
    return 0;
  end if;

  for s in
    select x.day from public.roulette_spins x
    where x.challenge_id = p_challenge_id and x.user_id = p_user and x.status = 'open' and x.day <= p_through
    order by x.day
  loop
    update public.roulette_spins set status = 'missed' where challenge_id = p_challenge_id and user_id = p_user and day = s.day;
    perform public.roulette_log(p_challenge_id, p_user, null, 'missed', 0, null);
  end loop;

  -- A ride survives only while every day is done.
  if pl.ride > 0 and (pl.last_done_day is null or pl.last_done_day < p_through) then
    lost := pl.ride;
    lost_day := coalesce(pl.last_done_day, p_through - 1) + 1;
    update public.roulette_players set ride = 0, ride_days = 0, updated_at = now()
      where challenge_id = p_challenge_id and user_id = p_user;
    perform public.roulette_log(p_challenge_id, p_user, null, 'lost', lost, null);
    -- The first Raid on a day it went: the ride (up to the cap) and the cost back.
    select * into rd from public.roulette_raids r
      where r.challenge_id = p_challenge_id and r.target = p_user and r.status = 'pending' and r.day between lost_day and p_through
      order by r.day limit 1;
    if rd.id is not null then
      take := least(lost, cfg.raid_cap);
      update public.roulette_raids set status = 'won', points = take, resolved_at = now() where id = rd.id;
      perform public.roulette_player(p_challenge_id, rd.raider);
      update public.roulette_players set banked = banked + take + rd.cost, updated_at = now()
        where challenge_id = p_challenge_id and user_id = rd.raider;
      perform public.roulette_log(p_challenge_id, rd.raider, p_user, 'raid_won', take, null);
      perform public.roulette_notify(p_challenge_id, rd.raider, 'Raid!',
        public.roulette_name(p_user) || ' missed: you take ' || take || ' points from their ride.');
    end if;
  end if;

  -- Every other Raid on those days: made it (the cost to them), or banked
  -- first (the cost back).
  for rd in
    select * from public.roulette_raids r
    where r.challenge_id = p_challenge_id and r.target = p_user and r.status = 'pending' and r.day <= p_through
  loop
    if exists (select 1 from public.roulette_spins x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.day = rd.day and x.status = 'done') then
      update public.roulette_raids set status = 'lost', points = rd.cost, resolved_at = now() where id = rd.id;
      update public.roulette_players set banked = banked + rd.cost, updated_at = now()
        where challenge_id = p_challenge_id and user_id = p_user;
      perform public.roulette_log(p_challenge_id, p_user, rd.raider, 'raid_held', rd.cost, null);
      perform public.roulette_notify(p_challenge_id, rd.raider, 'Raid',
        public.roulette_name(p_user) || ' made their task: your ' || rd.cost || ' points go to them.');
    else
      update public.roulette_raids set status = 'void', resolved_at = now() where id = rd.id;
      perform public.roulette_player(p_challenge_id, rd.raider);
      update public.roulette_players set banked = banked + rd.cost, updated_at = now()
        where challenge_id = p_challenge_id and user_id = rd.raider;
      perform public.roulette_log(p_challenge_id, rd.raider, p_user, 'raid_void', rd.cost, null);
    end if;
  end loop;

  update public.roulette_players set settled_through = p_through, updated_at = now()
    where challenge_id = p_challenge_id and user_id = p_user;
  return lost;
end;
$$;
revoke execute on function public.roulette_settle_member(uuid, uuid, date) from public, anon, authenticated;

-- The challenge's days, and a member's today within it (null outside it).
create or replace function public.roulette_day_no(p_challenge_id uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select p_day - public.soccer_first_day(c) + 1 from public.challenges c where c.id = p_challenge_id;
$$;
revoke execute on function public.roulette_day_no(uuid, date) from public, anon, authenticated;

-- Why the caller can't spin now (null: they can).
create or replace function public.roulette_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  today date := public.soccer_today(p_user);
  no int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'roulette' then
    return 'That isn''t a Hound Roulette.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user) then
    return 'Join the challenge to spin.';
  end if;
  if c.score_settled_at is not null then
    return 'This one''s over.';
  end if;
  no := today - public.soccer_first_day(c) + 1;
  if no < 1 then
    return 'The wheel opens ' || to_char(public.soccer_first_day(c), 'FMDay') || '.';
  end if;
  if no > c.duration_days then
    return 'That was the last day: the results come in tomorrow.';
  end if;
  if exists (select 1 from public.roulette_spins s where s.challenge_id = p_challenge_id and s.user_id = p_user and s.day = today) then
    return 'You''ve spun today. Back tomorrow.';
  end if;
  return null;
end;
$$;
revoke execute on function public.roulette_reason(uuid, uuid) from public, anon, authenticated;

-- ── What the app does ──

-- The phone's own step count for a day (daily_step_totals is kept by UTC
-- day), trusted as Daily Doors trusts it. Marks a steps spin done.
create or replace function public.roulette_claim_steps(p_challenge_id uuid, p_day date, p_steps int)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 2 or p_day > utc_today + 1 or p_steps is null or p_steps < 0 or p_steps > 150000 then
    raise exception 'Invalid steps.';
  end if;
  if exists (select 1 from public.roulette_spins s
             where s.challenge_id = p_challenge_id and s.user_id = me and s.day = p_day
               and s.task = 'steps' and s.status = 'open' and p_steps >= s.target) then
    perform public.roulette_credit(p_challenge_id, me, p_day);
    return true;
  end if;
  return false;
end;
$$;
revoke execute on function public.roulette_claim_steps(uuid, date, int) from public, anon;
grant execute on function public.roulette_claim_steps(uuid, date, int) to authenticated;

create or replace function public.roulette_bank(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := public.soccer_today(me);
  pl public.roulette_players;
  why text;
  worth int;
begin
  why := public.roulette_reason(p_challenge_id, me);
  if why is not null and why <> 'You''ve spun today. Back tomorrow.' then
    raise exception '%', why;
  end if;
  if why is not null then
    raise exception 'Bank before you spin: tomorrow morning.';
  end if;
  perform public.roulette_recheck(me);
  perform public.roulette_settle_member(p_challenge_id, me, today - 1);
  pl := public.roulette_player(p_challenge_id, me);
  if pl.ride <= 0 then
    raise exception 'Nothing riding to bank.';
  end if;
  worth := floor(pl.ride * public.roulette_mult(pl.ride_days))::int;
  update public.roulette_players set banked = banked + worth, ride = 0, ride_days = 0, updated_at = now()
    where challenge_id = p_challenge_id and user_id = me;
  perform public.roulette_log(p_challenge_id, me, null, 'bank', worth, null);
  return public.roulette_state(p_challenge_id);
end;
$$;

create or replace function public.roulette_spin(p_challenge_id uuid, p_stake text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := public.soccer_today(me);
  why text;
  seg text;
  t text;
begin
  if p_stake is null or p_stake not in ('safe', 'bold', 'allin') then
    raise exception 'Pick a stake: Safe, Bold or All in.';
  end if;
  why := public.roulette_reason(p_challenge_id, me);
  if why is not null then
    raise exception '%', why;
  end if;
  perform public.roulette_recheck(me);
  perform public.roulette_settle_member(p_challenge_id, me, today - 1);
  seg := public.roulette_segment(p_challenge_id, me, today);
  t := case seg when 'steps2' then 'steps' when 'double' then 'steps' when 'pick' then null else seg end;
  insert into public.roulette_spins (challenge_id, user_id, day, stake, segment, task, target, double)
  values (p_challenge_id, me, today, p_stake, seg, t,
          case when t is not null and t not in ('free', 'goals') then public.roulette_target(t, p_stake, me, today) end,
          seg = 'double');
  if p_stake = 'allin' then
    perform public.roulette_log(p_challenge_id, me, null, 'allin', 0, t);
  end if;
  if t = 'free' then
    perform public.roulette_credit(p_challenge_id, me, today);
  elsif t is not null then
    perform public.roulette_recheck(me);
  end if;
  return public.roulette_state(p_challenge_id);
end;
$$;

create or replace function public.roulette_pick(p_challenge_id uuid, p_task text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := public.soccer_today(me);
  s public.roulette_spins;
begin
  if p_task is null or p_task not in ('steps', 'workout', 'water', 'walk', 'cheer') then
    raise exception 'Pick steps, a workout, water, a hound walk or cheering.';
  end if;
  select * into s from public.roulette_spins x where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today for update;
  if not found or s.segment <> 'pick' or s.task is not null then
    raise exception 'Nothing to pick today.';
  end if;
  update public.roulette_spins set task = p_task, target = public.roulette_target(p_task, s.stake, me, today)
    where challenge_id = p_challenge_id and user_id = me and day = today;
  perform public.roulette_recheck(me);
  return public.roulette_state(p_challenge_id);
end;
$$;

create or replace function public.roulette_raid(p_challenge_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_day date := public.soccer_today(me);
  their_day date := public.soccer_today(p_target);
  cfg public.roulette_settings;
  pl public.roulette_players;
  them public.roulette_players;
  why text;
begin
  select * into cfg from public.roulette_settings;
  why := public.roulette_reason(p_challenge_id, me);
  if why is not null and why <> 'You''ve spun today. Back tomorrow.' then
    raise exception '%', why;
  end if;
  if p_target is null or p_target = me or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_target) then
    raise exception 'Raid someone in this game.';
  end if;
  if public.roulette_day_no(p_challenge_id, their_day) not between 1 and (select c.duration_days from public.challenges c where c.id = p_challenge_id) then
    raise exception 'Their wheel isn''t turning today.';
  end if;
  if exists (select 1 from public.roulette_raids r where r.challenge_id = p_challenge_id and r.raider = me and r.raider_day = my_day) then
    raise exception 'One Raid a day: you''ve sent today''s.';
  end if;
  if exists (select 1 from public.roulette_raids r where r.challenge_id = p_challenge_id and r.target = p_target and r.day = their_day) then
    raise exception 'Someone''s already raiding them today.';
  end if;
  perform public.roulette_recheck(p_target);
  perform public.roulette_settle_member(p_challenge_id, p_target, their_day - 1);
  them := public.roulette_player(p_challenge_id, p_target);
  if them.ride < 2 then
    raise exception 'They''ve nothing worth raiding: 2 or more riding.';
  end if;
  if exists (select 1 from public.roulette_spins s where s.challenge_id = p_challenge_id and s.user_id = p_target and s.day = their_day and s.status = 'done') then
    raise exception 'Too late: they''ve made today''s task.';
  end if;
  pl := public.roulette_player(p_challenge_id, me);
  if pl.banked < cfg.raid_cost then
    raise exception 'A Raid takes % banked points.', cfg.raid_cost;
  end if;
  update public.roulette_players set banked = banked - cfg.raid_cost, updated_at = now()
    where challenge_id = p_challenge_id and user_id = me;
  insert into public.roulette_raids (challenge_id, raider, target, raider_day, day, cost)
  values (p_challenge_id, me, p_target, my_day, their_day, cfg.raid_cost);
  perform public.roulette_log(p_challenge_id, me, p_target, 'raid', cfg.raid_cost, null);
  perform public.roulette_notify(p_challenge_id, p_target, 'You''re being raided!',
    public.roulette_name(me) || ' is raiding your ride. Make today''s task, or they take your ' || them.ride || ' points.');
  return public.roulette_state(p_challenge_id);
end;
$$;

create or replace function public.roulette_duel_call(p_challenge_id uuid, p_opponent uuid, p_stake int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.roulette_settings;
  pl public.roulette_players;
  them public.roulette_players;
  why text;
begin
  select * into cfg from public.roulette_settings;
  why := public.roulette_reason(p_challenge_id, me);
  if why is not null and why <> 'You''ve spun today. Back tomorrow.' then
    raise exception '%', why;
  end if;
  if p_opponent is null or p_opponent = me or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_opponent) then
    raise exception 'Call out someone in this game.';
  end if;
  if p_stake is null or p_stake < cfg.duel_min or p_stake > cfg.duel_max then
    raise exception 'A Duel is for % to % points.', cfg.duel_min, cfg.duel_max;
  end if;
  pl := public.roulette_player(p_challenge_id, me);
  them := public.roulette_player(p_challenge_id, p_opponent);
  if pl.banked < p_stake then
    raise exception 'You''ve only % banked.', pl.banked;
  end if;
  if them.banked < p_stake then
    raise exception 'They''ve only % banked: call them for that or less.', them.banked;
  end if;
  if exists (select 1 from public.roulette_duels d where d.challenge_id = p_challenge_id and d.status in ('open', 'on')
             and ((d.caller = me and d.opponent = p_opponent) or (d.caller = p_opponent and d.opponent = me))) then
    raise exception 'You two already have a Duel going.';
  end if;
  if (select count(*) from public.roulette_duels d where d.challenge_id = p_challenge_id and d.status in ('open', 'on') and me in (d.caller, d.opponent)) >= 2 then
    raise exception 'Two Duels at a time.';
  end if;
  if public.roulette_day_no(p_challenge_id, public.soccer_today(me) + 1) > (select c.duration_days from public.challenges c where c.id = p_challenge_id) then
    raise exception 'No days left for a Duel.';
  end if;
  insert into public.roulette_duels (challenge_id, caller, opponent, stake) values (p_challenge_id, me, p_opponent, p_stake);
  perform public.roulette_log(p_challenge_id, me, p_opponent, 'duel_call', p_stake, null);
  perform public.roulette_notify(p_challenge_id, p_opponent, 'You''ve been called out!',
    public.roulette_name(me) || ' wants a Duel for ' || p_stake || ' points: tomorrow''s steps, against your own average. Answer within a day.');
  return public.roulette_state(p_challenge_id);
end;
$$;

create or replace function public.roulette_duel_answer(p_duel_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  d public.roulette_duels;
  a public.roulette_players;
  b public.roulette_players;
  c public.challenges%rowtype;
  cd date;
  od date;
begin
  select * into d from public.roulette_duels where id = p_duel_id for update;
  if not found or d.opponent is distinct from me then
    raise exception 'That Duel isn''t yours to answer.';
  end if;
  if d.status <> 'open' or d.created_at < now() - interval '1 day' then
    raise exception 'That call has run out.';
  end if;
  select * into c from public.challenges where id = d.challenge_id;
  if not coalesce(p_accept, false) then
    update public.roulette_duels set status = 'declined', resolved_at = now() where id = d.id;
    perform public.roulette_log(d.challenge_id, me, d.caller, 'duel_declined', d.stake, null);
    perform public.roulette_notify(d.challenge_id, d.caller, 'Duel', public.roulette_name(me) || ' turned down your Duel.');
    return public.roulette_state(d.challenge_id);
  end if;
  cd := public.soccer_today(d.caller) + 1;
  od := public.soccer_today(me) + 1;
  if greatest(public.roulette_day_no(d.challenge_id, cd), public.roulette_day_no(d.challenge_id, od)) > c.duration_days then
    raise exception 'No days left for a Duel.';
  end if;
  a := public.roulette_player(d.challenge_id, d.caller);
  b := public.roulette_player(d.challenge_id, me);
  if a.banked < d.stake or b.banked < d.stake then
    raise exception 'One of you no longer has % banked.', d.stake;
  end if;
  update public.roulette_players set banked = banked - d.stake, updated_at = now()
    where challenge_id = d.challenge_id and user_id in (d.caller, me);
  update public.roulette_duels
    set status = 'on', accepted_at = now(), caller_day = cd, opponent_day = od,
        caller_avg = public.roulette_avg(d.caller, cd), opponent_avg = public.roulette_avg(me, od)
    where id = d.id;
  perform public.roulette_log(d.challenge_id, me, d.caller, 'duel_on', d.stake, null);
  perform public.roulette_notify(d.challenge_id, d.caller, 'Duel on!',
    public.roulette_name(me) || ' accepted: ' || d.stake || ' points each, on tomorrow''s steps against your own averages.');
  return public.roulette_state(d.challenge_id);
end;
$$;

-- A Duel whose days are over: who beat their own average by more.
create or replace function public.roulette_duel_resolve(p_duel_id bigint)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  d public.roulette_duels;
  cs int;
  os int;
  cr numeric;
  orr numeric;
  w uuid;
begin
  select * into d from public.roulette_duels where id = p_duel_id for update;
  if not found or d.status <> 'on' then
    return;
  end if;
  cs := public.roulette_progress(d.caller, 'steps', d.caller_day);
  os := public.roulette_progress(d.opponent, 'steps', d.opponent_day);
  cr := cs::numeric / greatest(1, d.caller_avg);
  orr := os::numeric / greatest(1, d.opponent_avg);
  if abs(cr - orr) >= 0.01 and greatest(cs, os) > 0 then
    w := case when cr > orr then d.caller else d.opponent end;
  end if;
  update public.roulette_duels set status = 'done', caller_steps = cs, opponent_steps = os, winner = w, resolved_at = now() where id = d.id;
  if w is null then
    update public.roulette_players set banked = banked + d.stake, updated_at = now()
      where challenge_id = d.challenge_id and user_id in (d.caller, d.opponent);
    perform public.roulette_log(d.challenge_id, d.caller, d.opponent, 'duel_push', d.stake, null);
    perform public.roulette_notify(d.challenge_id, d.caller, 'Duel', 'Dead level: your ' || d.stake || ' points come back.');
    perform public.roulette_notify(d.challenge_id, d.opponent, 'Duel', 'Dead level: your ' || d.stake || ' points come back.');
  else
    update public.roulette_players set banked = banked + 2 * d.stake, updated_at = now()
      where challenge_id = d.challenge_id and user_id = w;
    perform public.roulette_log(d.challenge_id, w, case when w = d.caller then d.opponent else d.caller end, 'duel_won', d.stake,
      round(100 * cr) || ':' || round(100 * orr));
    perform public.roulette_notify(d.challenge_id, w, 'Duel won!', 'You beat your average by more: +' || d.stake || ' points.');
    perform public.roulette_notify(d.challenge_id, case when w = d.caller then d.opponent else d.caller end, 'Duel',
      public.roulette_name(w) || ' beat their average by more and takes your ' || d.stake || ' points.');
  end if;
end;
$$;
revoke execute on function public.roulette_duel_resolve(bigint) from public, anon, authenticated;

-- ── What the app shows ──

create or replace function public.roulette_state(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges%rowtype;
  today date := public.soccer_today(me);
  cfg public.roulette_settings;
  pl public.roulette_players;
  s public.roulette_spins;
  board jsonb;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'roulette' then
    raise exception 'That isn''t a Hound Roulette.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge to spin.';
  end if;
  select * into cfg from public.roulette_settings;
  pl := public.roulette_player(p_challenge_id, me);
  select * into s from public.roulette_spins x where x.challenge_id = p_challenge_id and x.user_id = me and x.day = today;

  select coalesce(jsonb_agg(row order by (row ->> 'banked')::int desc, (row ->> 'ride')::int desc, row ->> 'name'), '[]'::jsonb) into board
  from (
    select jsonb_build_object(
      'userId', cp.user_id,
      'name', public.roulette_name(cp.user_id),
      'banked', coalesce(rp.banked, 0),
      'ride', coalesce(rp.ride, 0),
      'rideDays', coalesce(rp.ride_days, 0),
      'today', (select jsonb_build_object('stake', x.stake, 'segment', x.segment, 'task', x.task, 'target', x.target, 'double', x.double, 'status', x.status,
                                          'progress', case when x.task is not null and x.task <> 'free' then public.roulette_progress(cp.user_id, x.task, x.day) end)
                from public.roulette_spins x where x.challenge_id = p_challenge_id and x.user_id = cp.user_id and x.day = public.soccer_today(cp.user_id)),
      'raidedBy', (select public.roulette_name(r.raider) from public.roulette_raids r
                   where r.challenge_id = p_challenge_id and r.target = cp.user_id and r.day = public.soccer_today(cp.user_id) and r.status = 'pending')
    ) as row
    from public.challenge_participants cp
    left join public.roulette_players rp on rp.challenge_id = cp.challenge_id and rp.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
  ) b;

  return jsonb_build_object(
    'firstDay', public.soccer_first_day(c),
    'days', c.duration_days,
    'today', today,
    'dayNo', today - public.soccer_first_day(c) + 1,
    'settled', c.score_settled_at is not null,
    'reason', public.roulette_reason(p_challenge_id, me),
    'banked', pl.banked,
    'ride', pl.ride,
    'rideDays', pl.ride_days,
    'mult', public.roulette_mult(pl.ride_days),
    'bankValue', floor(pl.ride * public.roulette_mult(pl.ride_days))::int,
    'avg', public.roulette_avg(me, today),
    'spin', case when s.day is null then null else jsonb_build_object(
      'stake', s.stake, 'segment', s.segment, 'task', s.task, 'target', s.target, 'double', s.double, 'status', s.status, 'points', s.points,
      'progress', case when s.task is not null and s.task <> 'free' then public.roulette_progress(me, s.task, s.day) end) end,
    'picks', jsonb_build_object(
      'steps', public.roulette_target('steps', coalesce(s.stake, 'bold'), me, today),
      'workout', public.roulette_target('workout', coalesce(s.stake, 'bold'), me, today),
      'water', public.roulette_target('water', coalesce(s.stake, 'bold'), me, today),
      'walk', public.roulette_target('walk', coalesce(s.stake, 'bold'), me, today),
      'cheer', public.roulette_target('cheer', coalesce(s.stake, 'bold'), me, today)),
    'board', board,
    'raidOnMe', (select jsonb_build_object('by', public.roulette_name(r.raider), 'cost', r.cost) from public.roulette_raids r
                 where r.challenge_id = p_challenge_id and r.target = me and r.day = today and r.status = 'pending'),
    'myRaid', (select jsonb_build_object('target', r.target, 'name', public.roulette_name(r.target), 'status', r.status, 'points', r.points)
               from public.roulette_raids r where r.challenge_id = p_challenge_id and r.raider = me and r.raider_day = today),
    'duels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'status', case when d.status = 'open' and d.created_at < now() - interval '1 day' then 'expired' else d.status end,
        'stake', d.stake, 'mine', d.caller = me,
        'otherId', case when d.caller = me then d.opponent else d.caller end,
        'other', public.roulette_name(case when d.caller = me then d.opponent else d.caller end),
        'myDay', case when d.caller = me then d.caller_day else d.opponent_day end,
        'myAvg', case when d.caller = me then d.caller_avg else d.opponent_avg end,
        'mySteps', case when d.caller = me then d.caller_steps else d.opponent_steps end,
        'theirSteps', case when d.caller = me then d.opponent_steps else d.caller_steps end,
        'theirAvg', case when d.caller = me then d.opponent_avg else d.caller_avg end,
        'won', case when d.status = 'done' then d.winner = me end,
        'push', d.status = 'done' and d.winner is null,
        'createdAt', d.created_at) order by d.created_at desc)
      from public.roulette_duels d
      where d.challenge_id = p_challenge_id and me in (d.caller, d.opponent)
        and (d.status in ('open', 'on') or d.resolved_at > now() - interval '3 days')
    ), '[]'::jsonb),
    'feed', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'userId', e.user_id, 'name', public.roulette_name(e.user_id),
                                          'otherId', e.other_id, 'other', case when e.other_id is not null then public.roulette_name(e.other_id) end,
                                          'points', e.points, 'detail', e.detail, 'at', e.created_at) order by e.id desc)
      from (select * from public.roulette_events e where e.challenge_id = p_challenge_id and e.kind not in ('missed') order by e.id desc limit 12) e
    ), '[]'::jsonb),
    'settings', jsonb_build_object('safe', cfg.safe_points, 'bold', cfg.bold_points, 'raidCost', cfg.raid_cost, 'raidCap', cfg.raid_cap,
                                   'duelMin', cfg.duel_min, 'duelMax', cfg.duel_max, 'bonesPerPoint', cfg.bones_per_point, 'bonesCap', cfg.bones_cap,
                                   'finishBones', cfg.finish_bones)
  );
end;
$$;

revoke execute on function public.roulette_state(uuid) from public, anon;
grant execute on function public.roulette_state(uuid) to authenticated;
revoke execute on function public.roulette_bank(uuid) from public, anon;
grant execute on function public.roulette_bank(uuid) to authenticated;
revoke execute on function public.roulette_spin(uuid, text) from public, anon;
grant execute on function public.roulette_spin(uuid, text) to authenticated;
revoke execute on function public.roulette_pick(uuid, text) from public, anon;
grant execute on function public.roulette_pick(uuid, text) to authenticated;
revoke execute on function public.roulette_raid(uuid, uuid) from public, anon;
grant execute on function public.roulette_raid(uuid, uuid) to authenticated;
revoke execute on function public.roulette_duel_call(uuid, uuid, int) from public, anon;
grant execute on function public.roulette_duel_call(uuid, uuid, int) to authenticated;
revoke execute on function public.roulette_duel_answer(bigint, boolean) from public, anon;
grant execute on function public.roulette_duel_answer(bigint, boolean) to authenticated;

-- ── The morning sweep ──

create or replace function public.roulette_sweep()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  -- Calls nobody answered in a day.
  update public.roulette_duels set status = 'expired', resolved_at = now()
    where status = 'open' and created_at < now() - interval '1 day';
  -- Duels whose days are over everywhere.
  for r in
    select d.id from public.roulette_duels d
    where d.status = 'on' and greatest(d.caller_day, d.opponent_day) <= (now() at time zone 'utc')::date - 1
  loop
    perform public.roulette_duel_resolve(r.id);
    n := n + 1;
  end loop;
  -- Anyone two days behind, in a live game.
  for r in
    select cp.challenge_id, cp.user_id
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where c.kind::text = 'roulette' and c.score_settled_at is null
  loop
    perform public.roulette_recheck(r.user_id);
    perform public.roulette_settle_member(r.challenge_id, r.user_id,
      least(public.soccer_today(r.user_id) - 2,
            (select public.soccer_first_day(c) + c.duration_days - 1 from public.challenges c where c.id = r.challenge_id)));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.roulette_sweep() from public, anon, authenticated;
select cron.schedule('hound-roulette-sweep', '50 11 * * *', $$ select public.roulette_sweep(); $$);

-- "Spin today's wheel": the US morning, to anyone in a live one who hasn't.
create or replace function public.roulette_push()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select cp.challenge_id, cp.user_id, c.name
    from public.challenge_participants cp
    join public.challenges c on c.id = cp.challenge_id
    where c.kind::text = 'roulette' and c.score_settled_at is null
      and public.soccer_today(cp.user_id) - public.soccer_first_day(c) + 1 between 1 and c.duration_days
      and not exists (select 1 from public.roulette_spins s where s.challenge_id = cp.challenge_id and s.user_id = cp.user_id and s.day = public.soccer_today(cp.user_id))
  loop
    perform public.roulette_notify(r.challenge_id, r.user_id, r.name, 'Today''s wheel is waiting: bank your ride or let it ride, then spin.');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.roulette_push() from public, anon, authenticated;
select cron.schedule('hound-roulette-morning', '41 14 * * *', $$ select public.roulette_push(); $$);

-- Everything settled for the end: every day resolved, the rest of each
-- ride banked, and Duels finished or handed back.
create or replace function public.roulette_finish(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  last_day date;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id;
  last_day := public.soccer_first_day(c) + c.duration_days - 1;
  update public.roulette_duels set status = 'expired', resolved_at = now() where challenge_id = p_challenge_id and status = 'open';
  for r in select d.id from public.roulette_duels d where d.challenge_id = p_challenge_id and d.status = 'on' loop
    perform public.roulette_duel_resolve(r.id);
  end loop;
  for r in select cp.user_id from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
    perform public.roulette_recheck(r.user_id);
    perform public.roulette_settle_member(p_challenge_id, r.user_id, last_day);
    update public.roulette_players
      set banked = banked + floor(ride * public.roulette_mult(ride_days))::int, ride = 0, ride_days = 0, updated_at = now()
      where challenge_id = p_challenge_id and user_id = r.user_id and ride > 0;
  end loop;
end;
$$;
revoke execute on function public.roulette_finish(uuid) from public, anon, authenticated;

-- ── Scoring (0225's, with Roulette) ──

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
  xb public.bout_games%rowtype;
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

  -- 0225: a Hound Bout ends with a KO, or after its last round.
  if c.kind::text = 'bout' then
    perform public.bout_advance(p_challenge_id);
    select * into xb from public.bout_games where challenge_id = p_challenge_id;
    concluded := found and xb.status = 'final';
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

  elsif c.kind::text = 'bout' then
    -- Like H-O-R-S-E: the winner gets Hoops' win Bones, both the play Bones.
    select * into hcfg from public.hoops_config where id;
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select cp.user_id, p_challenge_id, 'bout_result',
      case
        when xb.winner is null then 15
        when cp.user_id = xb.winner then 35
        else 5
      end,
      25,
      bones_trickle + coalesce(hcfg.play_bones, 10)
        + case when cp.user_id = xb.winner then coalesce(hcfg.win_bones, 40) else 0 end
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

  elsif c.kind::text = 'roulette' then
    -- 0236: every day resolved and the rest of each ride banked; most
    -- banked wins, placed like a Step Race. Everyone gets the finishing
    -- Bones and one a banked point (Admin's cap); the winner's hound the
    -- Lucky Bandana.
    perform public.roulette_finish(p_challenge_id);
    with ranked as (
      select cp.user_id, coalesce(rp.banked, 0) as banked, rank() over (order by coalesce(rp.banked, 0) desc) as rnk
      from public.challenge_participants cp
      left join public.roulette_players rp on rp.challenge_id = cp.challenge_id and rp.user_id = cp.user_id
      where cp.challenge_id = p_challenge_id
    ),
    paid as (
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
      select r.user_id, p_challenge_id, 'roulette_result',
        case r.rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
        25,
        bones_trickle + s.finish_bones + least(s.bones_cap, r.banked * s.bones_per_point)
      from ranked r cross join public.roulette_settings s
      returning user_id
    )
    insert into public.kennel_purchases (user_id, item_id, bones)
    select r.user_id, 'bandana_lucky', 0 from ranked r where r.rnk = 1 and r.banked > 0
    on conflict do nothing;

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

-- Roulette can be played on your own, like a checklist.
create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  grace constant interval := interval '24 hours';
  min_players constant int := 2;
  players int;
  caller uuid := auth.uid();
  personal boolean;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  -- A signed-in caller must be in the challenge. The scheduled job runs as
  -- the database and has no signed-in user.
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select count(*) into players
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;

  -- Played for your own effort, so one player is enough.
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist', 'roulette');

  -- Game-event kinds (a Journey, which ends when someone reaches the end
  -- of the course, and a Rally, which ends on two games) can end before
  -- ends_at; the core decides if they have.
  -- A Rally's or a Soccer match's other players may all be bots: its own
  -- state says whether it's over, whatever the participant count.
  if c.kind::text in ('rally', 'soccer', 'cricket', 'baseball', 'hoops', 'golf') then
    perform public.settle_challenge_score_core(p_challenge_id);
    return;
  end if;

  -- H-O-R-S-E and the Hound Bout (0225) need their second player.
  if c.kind::text in ('horse', 'bout') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  if c.kind::text in ('hunt', 'tag', 'tictacgo', 'journey') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      -- Never had an opponent: close it without paying anyone.
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players and not personal then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;
revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;

-- ── Admin → Overview → Games → Hound Roulette ──

create or replace function public.admin_roulette_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with s7 as (select * from public.roulette_spins s where s.spun_at > now() - interval '7 days')
    select jsonb_build_object(
      'live', (select count(*) from public.challenges c where c.kind::text = 'roulette' and c.score_settled_at is null),
      'finished', (select count(*) from public.challenges c where c.kind::text = 'roulette' and c.score_settled_at is not null),
      'players', (select count(distinct cp.user_id) from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.kind::text = 'roulette'),
      'everSpun', (select count(distinct s.user_id) from public.roulette_spins s),
      'spinners7d', (select count(distinct s7.user_id) from s7),
      'spins7d', (select count(*) from s7),
      'spinsToday', (select count(*) from public.roulette_spins s where s.day = (now() at time zone 'America/New_York')::date),
      'stakes', (select jsonb_object_agg(k.stake, jsonb_build_object('spins', k.spins, 'done', k.done, 'missed', k.missed)) from (
        select s7.stake, count(*) as spins, count(*) filter (where s7.status = 'done') as done, count(*) filter (where s7.status = 'missed') as missed
        from s7 group by s7.stake) k),
      'tasks', (select jsonb_object_agg(k.t, jsonb_build_object('spins', k.spins, 'done', k.done)) from (
        select coalesce(s7.task, 'unpicked') as t, count(*) as spins, count(*) filter (where s7.status = 'done') as done
        from s7 group by coalesce(s7.task, 'unpicked')) k),
      'specials7d', (select jsonb_build_object('free', count(*) filter (where s7.segment = 'free'), 'double', count(*) filter (where s7.segment = 'double'),
                                               'pick', count(*) filter (where s7.segment = 'pick')) from s7),
      'banks7d', (select count(*) from public.roulette_events e where e.kind = 'bank' and e.created_at > now() - interval '7 days'),
      'banked7d', (select coalesce(sum(e.points), 0) from public.roulette_events e where e.kind = 'bank' and e.created_at > now() - interval '7 days'),
      'ridesLost7d', (select count(*) from public.roulette_events e where e.kind = 'lost' and e.created_at > now() - interval '7 days'),
      'pointsLost7d', (select coalesce(sum(e.points), 0) from public.roulette_events e where e.kind = 'lost' and e.created_at > now() - interval '7 days'),
      'raids7d', (select jsonb_build_object('sent', count(*), 'won', count(*) filter (where r.status = 'won'), 'held', count(*) filter (where r.status = 'lost'),
                                            'void', count(*) filter (where r.status = 'void'), 'pending', count(*) filter (where r.status = 'pending'),
                                            'taken', coalesce(sum(r.points) filter (where r.status = 'won'), 0))
                  from public.roulette_raids r where r.created_at > now() - interval '7 days'),
      'duels7d', (select jsonb_build_object('called', count(*), 'accepted', count(*) filter (where d.accepted_at is not null),
                                            'declined', count(*) filter (where d.status = 'declined'), 'expired', count(*) filter (where d.status = 'expired'),
                                            'decided', count(*) filter (where d.status = 'done' and d.winner is not null),
                                            'level', count(*) filter (where d.status = 'done' and d.winner is null),
                                            'staked', coalesce(sum(d.stake) filter (where d.accepted_at is not null), 0))
                  from public.roulette_duels d where d.created_at > now() - interval '7 days'),
      'bandanas', (select count(*) from public.kennel_purchases k where k.item_id = 'bandana_lucky'),
      'bonesPaid', (select coalesce(sum(a.bones_points), 0) from public.activity_events a where a.kind = 'roulette_result'),
      'settings', (select to_jsonb(x) - 'id' - 'updated_at' from public.roulette_settings x)
    )
  );
end;
$$;
revoke execute on function public.admin_roulette_overview() from public, anon;
grant execute on function public.admin_roulette_overview() to authenticated;
