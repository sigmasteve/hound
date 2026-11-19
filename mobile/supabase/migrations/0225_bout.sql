-- Hound: Hound Bout — boxing, one on one, a round a day (0224 adds the
-- kind). Approved mockup: claude.ai/artifact/6QfNPYvzE47ga9hGdxH6eK.
--
--   the fight   two hounds, 3, 5 or 7 rounds (duration_days), one a day.
--               The creator sets it up (bout_setup) and invites one friend.
--   actions     each 1,000 steps today is an action, up to 20 a day, plus 2
--               after 20+ minutes of cardio (running, cycling, swimming,
--               rowing, HIIT...). An action is a punch or a slip. Unused
--               actions don't carry over.
--   a punch     bout_throw(punch, pos): jab 1, hook 2, uppercut 3. pos is
--               where the meter stopped, 0-100; the green is 50 ± 14 (jab),
--               9 (hook) or 5 (uppercut), x1.3 on a fight camp day (a real
--               boxing or kickboxing workout: sport_day_bonus 'bout'). The
--               middle 35% of the green is perfect. Outside it: a miss.
--   the guard   each fighter's guard for their day (bout_set_guard; high
--               until changed, sticky): high blocks hooks, body blocks
--               uppercuts, counter blocks jabs and scores 1 for each, but
--               every punch that gets through a counter guard scores 1
--               more. A perfect punch beats any guard. Decided when it's
--               thrown, against the guard then.
--   incoming    a punch that got through waits for the other fighter until
--               the round is scored: bout_slip(id, pos) spends one of their
--               actions; within 50 ± 7 (jab), 10 (hook) or 12 (uppercut),
--               x1.3 on their fight camp day, it's slipped and scores
--               nothing. bout_slip(id, null) takes it (no action).
--   the round   played the morning after (11:00 UTC, Soccer's rule), from
--               the punches each threw on that local day. Points landed
--               (counters included): more wins it 10-9, level 10-10.
--   knockdowns  three landed power punches (hooks, uppercuts) in a row,
--               two after a strength workout that day; a jab, a miss, a
--               block or a slip breaks the run. Each costs the one down a
--               point (10-8). Three in a round, or four in the fight: KO.
--   the end     a KO, or the last round: the most on the cards wins; level
--               is a draw. The winner gets Hoops' win Bones and both the
--               play Bones (hoops_config), like H-O-R-S-E.
--   pushes      each round's result, and the end, through
--               send-golf-notification's 'bout' kind (worded here).
--
-- Every write goes through the functions below. Run this once, after 0224
-- (committed on its own), in the SQL Editor. Then redeploy
-- send-golf-notification.

-- ── Tables ──

create table public.bout_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  rounds int not null check (rounds in (3, 5, 7)),
  rounds_played int not null default 0,
  status text not null default 'active' check (status in ('active', 'final')),
  winner uuid references public.profiles (id) on delete set null,
  method text check (method in ('ko', 'decision', 'draw')),
  ko_round int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bout_guards (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  guard text not null check (guard in ('high', 'body', 'counter')),
  set_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

create table public.bout_punches (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  round int not null,
  punch text not null check (punch in ('jab', 'hook', 'up')),
  pos numeric not null,
  quality text not null check (quality in ('perfect', 'clean', 'miss')),
  guard text not null,
  blocked boolean not null default false,
  countered boolean not null default false,
  points int not null default 0,
  slip text check (slip in ('slipped', 'missed', 'taken')),
  slip_day date,
  slip_pos numeric,
  slipped_at timestamptz,
  -- At the round's scoring: whether it scored, and whether it put them down.
  landed boolean,
  knockdown boolean not null default false,
  created_at timestamptz not null default now()
);
create index bout_punches_round on public.bout_punches (challenge_id, round, id);
create index bout_punches_user_day on public.bout_punches (challenge_id, user_id, day);
create index bout_punches_slip_day on public.bout_punches (challenge_id, target, slip_day);
create index bout_punches_at on public.bout_punches (created_at desc);

create table public.bout_rounds (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  round int not null,
  day date not null,
  a_user uuid,
  b_user uuid,
  a_points int not null default 0,
  b_points int not null default 0,
  a_down int not null default 0,
  b_down int not null default 0,
  a_score int not null default 10,
  b_score int not null default 10,
  ko boolean not null default false,
  scored_at timestamptz not null default now(),
  primary key (challenge_id, round)
);

alter table public.bout_games enable row level security;
alter table public.bout_guards enable row level security;
alter table public.bout_punches enable row level security;
alter table public.bout_rounds enable row level security;
revoke all on public.bout_games, public.bout_guards, public.bout_punches, public.bout_rounds from anon;
revoke insert, update, delete on public.bout_games, public.bout_guards, public.bout_punches, public.bout_rounds from authenticated;
create policy "Fighters see their bout" on public.bout_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = bout_games.challenge_id and cp.user_id = auth.uid()));
create policy "Fighters see their rounds" on public.bout_rounds for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = bout_rounds.challenge_id and cp.user_id = auth.uid()));
create policy "Fighters see their own guard" on public.bout_guards for select to authenticated using (user_id = auth.uid());


-- ── Sports bonuses: boxing counts for the Bout ──

create or replace function public.sport_bonus_sport(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'hoops' then 'basketball' when 'horse' then 'basketball'
    when 'soccer' then 'soccer' when 'baseball' then 'baseball'
    when 'cricket' then 'cricket' when 'rally' then 'racquet'
    when 'bout' then 'boxing' end;
$$;
revoke execute on function public.sport_bonus_sport(text) from public, anon, authenticated;

create or replace function public.sport_bonus_pattern(p_kind text)
returns text
language sql
immutable
as $$
  select case public.sport_bonus_sport(p_kind)
    when 'basketball' then 'basketball'
    -- Not American or Australian football.
    when 'soccer' then 'soccer'
    when 'baseball' then 'baseball|softball'
    when 'cricket' then 'cricket'
    when 'racquet' then 'badminton|tennis|squash|pickleball|racquetball|padel'
    when 'boxing' then 'boxing|kickboxing|martial arts|mixed martial' end;
$$;
revoke execute on function public.sport_bonus_pattern(text) from public, anon, authenticated;


-- ── The numbers ──

create or replace function public.bout_points(p_punch text)
returns int language sql immutable as $$ select case p_punch when 'jab' then 1 when 'hook' then 2 else 3 end; $$;

create or replace function public.bout_width(p_punch text, p_camp boolean)
returns numeric
language sql
immutable
as $$
  select round((case p_punch when 'jab' then 14 when 'hook' then 9 else 5 end) * case when p_camp then 1.3 else 1 end, 2);
$$;

create or replace function public.bout_slip_width(p_punch text, p_camp boolean)
returns numeric
language sql
immutable
as $$
  select round((case p_punch when 'jab' then 7 when 'hook' then 10 else 12 end) * case when p_camp then 1.3 else 1 end, 2);
$$;

create or replace function public.bout_quality(p_pos numeric, p_width numeric)
returns text
language sql
immutable
as $$
  select case when abs(p_pos - 50) <= p_width * 0.35 then 'perfect' when abs(p_pos - 50) <= p_width then 'clean' else 'miss' end;
$$;

-- Whether a guard stops a punch (a perfect one gets through anything).
create or replace function public.bout_blocks(p_guard text, p_punch text, p_quality text)
returns boolean
language sql
immutable
as $$
  select p_quality = 'clean' and (
    (p_guard = 'high' and p_punch = 'hook') or (p_guard = 'body' and p_punch = 'up') or (p_guard = 'counter' and p_punch = 'jab'));
$$;

revoke execute on function public.bout_points(text) from public, anon, authenticated;
revoke execute on function public.bout_width(text, boolean) from public, anon, authenticated;
revoke execute on function public.bout_slip_width(text, boolean) from public, anon, authenticated;
revoke execute on function public.bout_quality(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.bout_blocks(text, text, text) from public, anon, authenticated;

-- Minutes of cardio on someone's day (their time zone).
create or replace function public.bout_cardio_min(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(coalesce(w.duration_min, 0)), 0)::int
  from public.workout_history w
  where w.user_id = p_user
    and w.occurred_at >= (p_day - 1)::timestamp at time zone 'utc'
    and w.occurred_at < (p_day + 2)::timestamp at time zone 'utc'
    and (w.occurred_at at time zone coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York'))::date = p_day
    and w.name ~* 'run|walk|hik|cycl|bik|swim|row|elliptical|stair|hiit|interval|cardio|dance|jump|rope|ski';
$$;
revoke execute on function public.bout_cardio_min(uuid, date) from public, anon, authenticated;

-- Someone's day in a bout: steps, workouts, and actions earned and used.
create or replace function public.bout_day(p_challenge_id uuid, p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  steps int := public.derby_steps_today(p_challenge_id, p_user, p_day);
  b record;
  cardio int := public.bout_cardio_min(p_user, p_day);
  earned int;
  used int;
begin
  select * into b from public.sport_day_bonus(p_user, p_day, 'bout');
  earned := least(20, steps / 1000) + case when cardio >= 20 then 2 else 0 end;
  select (select count(*) from public.bout_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.day = p_day)
       + (select count(*) from public.bout_punches x where x.challenge_id = p_challenge_id and x.target = p_user
            and x.slip in ('slipped', 'missed') and x.slip_day = p_day)
    into used;
  return jsonb_build_object('steps', steps, 'earned', earned, 'used', used, 'left', greatest(0, earned - used),
    'next_at', case when steps >= 20000 then null else (steps / 1000 + 1) * 1000 end,
    'cardio', cardio >= 20, 'cardio_min', cardio,
    'strength', coalesce(b.strength, 0) > 0, 'camp', coalesce(b.game_day, false), 'camp_workout', b.workout,
    'kd_needs', case when coalesce(b.strength, 0) > 0 then 2 else 3 end);
end;
$$;
revoke execute on function public.bout_day(uuid, uuid, date) from public, anon, authenticated;

-- Someone's guard on a day: the last they set on or before it, else high.
create or replace function public.bout_guard_on(p_challenge_id uuid, p_user uuid, p_day date)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select g.guard from public.bout_guards g
                   where g.challenge_id = p_challenge_id and g.user_id = p_user and g.day <= p_day
                   order by g.day desc limit 1), 'high');
$$;
revoke execute on function public.bout_guard_on(uuid, uuid, date) from public, anon, authenticated;

-- The two in the fight, the creator first.
create or replace function public.bout_pair(p_challenge_id uuid)
returns table (a uuid, b uuid)
language sql
stable
security definer set search_path = public
as $$
  select
    (select cp.user_id from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
      where cp.challenge_id = p_challenge_id order by (cp.user_id = c.created_by) desc, cp.user_id limit 1),
    (select cp.user_id from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
      where cp.challenge_id = p_challenge_id order by (cp.user_id = c.created_by) desc, cp.user_id offset 1 limit 1);
$$;
revoke execute on function public.bout_pair(uuid) from public, anon, authenticated;

-- An attacker's run of landed power punches in a round so far, and the
-- knockdowns it has made (as the round would be scored now).
create or replace function public.bout_run(p_challenge_id uuid, p_user uuid, p_round int, p_needs int)
returns table (run int, downs int)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  x record;
  r int := 0;
  d int := 0;
begin
  for x in select * from public.bout_punches p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.round = p_round order by p.id loop
    if x.punch <> 'jab' and x.quality <> 'miss' and not x.blocked and x.slip is distinct from 'slipped' then
      r := r + 1;
      if r >= p_needs then
        d := d + 1;
        r := 0;
      end if;
    else
      r := 0;
    end if;
  end loop;
  return query select r, d;
end;
$$;
revoke execute on function public.bout_run(uuid, uuid, int, int) from public, anon, authenticated;

create or replace function public.bout_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$ select public.horse_name(p_user); $$;
revoke execute on function public.bout_name(uuid) from public, anon, authenticated;


-- ── Setting up and joining ──

create or replace function public.bout_setup(p_challenge_id uuid, p_rounds int default 5)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'bout' or c.created_by is distinct from auth.uid() then
    raise exception 'Only whoever made this fight can set it up.';
  end if;
  if p_rounds is null or p_rounds not in (3, 5, 7) then
    raise exception 'A Hound Bout is 3, 5 or 7 rounds.';
  end if;
  if c.duration_days <> p_rounds then
    raise exception 'A round a day: the fight runs as many days as it has rounds.';
  end if;
  if exists (select 1 from public.bout_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This fight is already set up.';
  end if;
  insert into public.bout_games (challenge_id, rounds) values (p_challenge_id, p_rounds);
end;
$$;
revoke execute on function public.bout_setup(uuid, int) from public, anon;
grant execute on function public.bout_setup(uuid, int) to authenticated;

-- One on one: a third can't join, nor anyone once it's over.
create or replace function public.bout_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'bout') then
    return new;
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = new.challenge_id and cp.user_id <> new.user_id) >= 2 then
    raise exception 'A Hound Bout is one on one.';
  end if;
  if exists (select 1 from public.bout_games g where g.challenge_id = new.challenge_id and g.status <> 'active') then
    raise exception 'This fight is over.';
  end if;
  return new;
end;
$$;
revoke execute on function public.bout_before_join() from public, anon, authenticated;
create trigger bout_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.bout_before_join();


-- ── In the ring ──

-- Why you can't throw or slip now (null = you can).
create or replace function public.bout_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.bout_games%rowtype;
  today date;
  rnd int;
  dy jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.bout_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user) then
    return 'You''re not in this fight.';
  end if;
  if g.status <> 'active' then
    return 'The fight is over.';
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = p_challenge_id) < 2 then
    return 'Waiting for your opponent to join.';
  end if;
  today := public.soccer_today(p_user);
  rnd := today - public.soccer_first_day(c) + 1;
  if rnd < 1 then
    return 'The fight starts ' || to_char(public.soccer_first_day(c), 'FMDay') || '.';
  end if;
  if rnd > g.rounds or rnd <= g.rounds_played then
    return 'That round''s over: the scores come in tonight.';
  end if;
  dy := public.bout_day(p_challenge_id, p_user, today);
  if (dy ->> 'left')::int <= 0 then
    if (dy ->> 'earned')::int >= 20 then
      return 'That''s every action today. Back tomorrow.';
    end if;
    return 'No actions ready: your next comes at ' || to_char((dy ->> 'next_at')::int, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.bout_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.bout_set_guard(p_challenge_id uuid, p_guard text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
     or not exists (select 1 from public.bout_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'You''re not in this fight.';
  end if;
  if p_guard is null or p_guard not in ('high', 'body', 'counter') then
    raise exception 'Pick a high guard, a body guard or counter.';
  end if;
  insert into public.bout_guards (challenge_id, user_id, day, guard) values (p_challenge_id, caller, public.soccer_today(caller), p_guard)
    on conflict (challenge_id, user_id, day) do update set guard = excluded.guard, set_at = now();
  return p_guard;
end;
$$;
revoke execute on function public.bout_set_guard(uuid, text) from public, anon;
grant execute on function public.bout_set_guard(uuid, text) to authenticated;

create or replace function public.bout_throw(p_challenge_id uuid, p_punch text, p_pos numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  other uuid;
  v_reason text;
  today date;
  dy jsonb;
  w numeric;
  q text;
  gd text;
  blk boolean;
  ctr boolean;
  pts int;
  rnd int;
  pr record;
  pid bigint;
  msg text;
  nm text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> 'bout' then
    raise exception 'That isn''t a Hound Bout.';
  end if;
  if p_punch is null or p_punch not in ('jab', 'hook', 'up') then
    raise exception 'Throw a jab, a hook or an uppercut.';
  end if;
  perform 1 from public.bout_games g where g.challenge_id = p_challenge_id for update;
  v_reason := public.bout_reason(p_challenge_id, caller);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;
  select cp.user_id into other from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id <> caller limit 1;
  today := public.soccer_today(caller);
  rnd := today - public.soccer_first_day(c) + 1;
  dy := public.bout_day(p_challenge_id, caller, today);
  w := public.bout_width(p_punch, (dy ->> 'camp')::boolean);
  q := public.bout_quality(greatest(0, least(100, coalesce(p_pos, 0))), w);
  gd := public.bout_guard_on(p_challenge_id, other, public.soccer_today(other));
  blk := q <> 'miss' and public.bout_blocks(gd, p_punch, q);
  ctr := blk and gd = 'counter';
  pts := case when q = 'miss' or blk then 0 else public.bout_points(p_punch) + case when gd = 'counter' then 1 else 0 end end;
  insert into public.bout_punches (challenge_id, user_id, target, day, round, punch, pos, quality, guard, blocked, countered, points)
    values (p_challenge_id, caller, other, today, rnd, p_punch, greatest(0, least(100, coalesce(p_pos, 0))), q, gd, blk, ctr, pts)
    returning id into pid;
  select * into pr from public.bout_run(p_challenge_id, caller, rnd, (dy ->> 'kd_needs')::int);
  nm := split_part(public.bout_name(other), ' ', 1);
  msg := case
    when q = 'miss' then 'Swung at air: ' || case when p_pos < 50 then 'too early.' else 'too late.' end
    when ctr then nm || '’s counter guard caught your jab and hit back: 1 to ' || nm || '.'
    when blk then 'Blocked: ' || nm || '’s got a ' || gd || ' guard up. ' || case when p_punch = 'hook' then 'Try an uppercut.' else 'Try a hook.' end
    when pr.downs > 0 and pr.run = 0 and p_punch <> 'jab' then nm || ' goes down! Unless they slip it, that’s a knockdown tonight.'
    when p_punch = 'jab' then 'Snapped it in: ' || pts || '. Jabs score, but they don’t build to a knockdown.'
    else initcap(case p_punch when 'up' then 'uppercut' else p_punch end) || ' lands: ' || pts
         || case when q = 'perfect' then ', perfect' else '' end || '. '
         || pr.run || ' of ' || (dy ->> 'kd_needs') || ' to a knockdown, unless ' || nm || ' slips it.' end;
  return jsonb_build_object('id', pid, 'punch', p_punch, 'quality', q, 'blocked', blk, 'countered', ctr, 'points', pts,
    'guard', case when blk then gd end, 'run', pr.run, 'downs', pr.downs, 'kd_needs', (dy ->> 'kd_needs')::int,
    'left', greatest(0, (dy ->> 'left')::int - 1), 'message', msg);
end;
$$;
revoke execute on function public.bout_throw(uuid, text, numeric) from public, anon;
grant execute on function public.bout_throw(uuid, text, numeric) to authenticated;

-- Slip an incoming punch (pos where the meter stopped), or take it (null).
create or replace function public.bout_slip(p_challenge_id uuid, p_punch_id bigint, p_pos numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  x public.bout_punches%rowtype;
  g public.bout_games%rowtype;
  v_reason text;
  today date := public.soccer_today(caller);
  dy jsonb;
  ok boolean;
begin
  select * into g from public.bout_games where challenge_id = p_challenge_id for update;
  select * into x from public.bout_punches p where p.id = p_punch_id and p.challenge_id = p_challenge_id for update;
  if x.id is null or x.target is distinct from caller then
    raise exception 'That punch isn''t coming at you.';
  end if;
  if x.slip is not null or x.quality = 'miss' or x.blocked then
    raise exception 'That one''s already dealt with.';
  end if;
  if g.status <> 'active' or x.round <= g.rounds_played then
    raise exception 'That round''s been scored.';
  end if;
  if p_pos is null then
    update public.bout_punches set slip = 'taken', slipped_at = now() where id = x.id;
    return jsonb_build_object('slip', 'taken', 'message', 'You took it: it lands tonight.');
  end if;
  v_reason := public.bout_reason(p_challenge_id, caller);
  -- Slipping needs an action today (a later round's punches can't be).
  if v_reason is not null and v_reason not like 'That round%' then
    raise exception '%', v_reason;
  end if;
  dy := public.bout_day(p_challenge_id, caller, today);
  if (dy ->> 'left')::int <= 0 then
    raise exception 'No actions left to slip with today.';
  end if;
  ok := abs(greatest(0, least(100, p_pos)) - 50) <= public.bout_slip_width(x.punch, (dy ->> 'camp')::boolean);
  update public.bout_punches set slip = case when ok then 'slipped' else 'missed' end, slip_day = today,
      slip_pos = greatest(0, least(100, p_pos)), slipped_at = now()
    where id = x.id;
  return jsonb_build_object('slip', case when ok then 'slipped' else 'missed' end,
    'left', greatest(0, (dy ->> 'left')::int - 1),
    'message', case when ok then 'Slipped it: that ' || case x.punch when 'up' then 'uppercut' else x.punch end || ' won’t score.'
               else 'Too ' || case when p_pos < 50 then 'early' else 'late' end || ': it lands tonight.' end);
end;
$$;
revoke execute on function public.bout_slip(uuid, bigint, numeric) from public, anon;
grant execute on function public.bout_slip(uuid, bigint, numeric) to authenticated;


-- ── The rounds, the morning after ──

create or replace function public.bout_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('bout', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.bout_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- Scores every round whose day is over everywhere, until a KO or the last.
create or replace function public.bout_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.bout_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  cutoff date;
  d date;
  rnd int;
  a uuid;
  b uuid;
  a_pts int;
  b_pts int;
  a_down int;
  b_down int;
  a_sc int;
  b_sc int;
  needs_a int;
  needs_b int;
  v_ko boolean;
  v_winner uuid;
  ta int;
  tb int;
  da int;
  db int;
  n int := 0;
  x record;
  run int;
  who uuid;
  r record;
  line text;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind::text <> 'bout' then
    return 0;
  end if;
  if caller is not null and not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    return 0;
  end if;
  select * into g from public.bout_games where challenge_id = p_challenge_id for update;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  select p.a, p.b into a, b from public.bout_pair(p_challenge_id) p;

  loop
    rnd := g.rounds_played + 1;
    d := first_day + rnd - 1;
    exit when rnd > g.rounds or d > cutoff;
    -- Whatever wasn't slipped lands; whatever's waiting is taken.
    update public.bout_punches set landed = (quality <> 'miss' and not blocked and slip is distinct from 'slipped')
      where challenge_id = p_challenge_id and round = rnd;
    update public.bout_punches set slip = 'taken' where challenge_id = p_challenge_id and round = rnd and slip is null and landed;
    -- Knockdowns: each attacker's runs of landed power punches.
    needs_a := (public.bout_day(p_challenge_id, a, d) ->> 'kd_needs')::int;
    needs_b := case when b is null then 3 else (public.bout_day(p_challenge_id, b, d) ->> 'kd_needs')::int end;
    for who in select unnest(array[a, b]) loop
      continue when who is null;
      run := 0;
      for x in select * from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = who order by p.id loop
        if x.landed and x.punch <> 'jab' then
          run := run + 1;
          if run >= (case when who = a then needs_a else needs_b end) then
            update public.bout_punches set knockdown = true where id = x.id;
            run := 0;
          end if;
        else
          run := 0;
        end if;
      end loop;
    end loop;
    -- Points: landed punches, and counters (an opponent's jab caught by a counter guard).
    a_pts := coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = a and p.landed), 0)
           + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = a and p.countered);
    b_pts := coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = b and p.landed), 0)
           + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = b and p.countered);
    b_down := (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = a and p.knockdown);
    a_down := (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = b and p.knockdown);
    a_sc := case when a_pts < b_pts then 9 else 10 end - a_down;
    b_sc := case when b_pts < a_pts then 9 else 10 end - b_down;
    -- A KO: three down in the round, or four in the fight.
    da := a_down + coalesce((select sum(r2.a_down) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id), 0);
    db := b_down + coalesce((select sum(r2.b_down) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id), 0);
    v_ko := a_down >= 3 or b_down >= 3 or da >= 4 or db >= 4;
    insert into public.bout_rounds (challenge_id, round, day, a_user, b_user, a_points, b_points, a_down, b_down, a_score, b_score, ko)
      values (p_challenge_id, rnd, d, a, b, a_pts, b_pts, a_down, b_down, a_sc, b_sc, v_ko);
    update public.bout_games set rounds_played = rnd, updated_at = now() where challenge_id = p_challenge_id;
    n := n + 1;

    if v_ko or rnd >= g.rounds then
      ta := (select sum(r2.a_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
      tb := (select sum(r2.b_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
      if v_ko then
        v_winner := case when (a_down >= 3 or da >= 4) and not (b_down >= 3 or db >= 4) then b
                       when (b_down >= 3 or db >= 4) and not (a_down >= 3 or da >= 4) then a
                       when da > db then b when db > da then a
                       when ta > tb then a when tb > ta then b end;
      else
        v_winner := case when ta > tb then a when tb > ta then b end;
      end if;
      update public.bout_games set status = 'final', winner = v_winner,
          method = case when v_winner is null then 'draw' when v_ko then 'ko' else 'decision' end,
          ko_round = case when v_ko and v_winner is not null then rnd end, updated_at = now()
        where challenge_id = p_challenge_id;
    end if;
    select * into g from public.bout_games where challenge_id = p_challenge_id;

    -- Tell them both.
    ta := (select sum(r2.a_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
    tb := (select sum(r2.b_score) from public.bout_rounds r2 where r2.challenge_id = p_challenge_id);
    for r in select unnest(array[a, b]) as u loop
      continue when r.u is null;
      if g.status = 'final' then
        line := case
          when g.winner is null then 'A draw after ' || g.rounds_played || ' rounds, ' || ta || '–' || tb || '.'
          when g.winner = r.u and g.method = 'ko' then 'You won by KO in round ' || g.ko_round || '!'
          when g.winner = r.u then 'You won on the cards, ' || greatest(ta, tb) || '–' || least(ta, tb) || '!'
          when g.method = 'ko' then split_part(public.bout_name(g.winner), ' ', 1) || ' won by KO in round ' || g.ko_round || '. Rematch?'
          else split_part(public.bout_name(g.winner), ' ', 1) || ' won on the cards, ' || greatest(ta, tb) || '–' || least(ta, tb) || '. Rematch?' end;
      else
        line := 'Round ' || rnd || ': ' || case
          when (r.u = a and a_sc > b_sc) or (r.u = b and b_sc > a_sc) then 'yours, '
          when a_sc = b_sc then 'even, '
          else 'theirs, ' end
          || case when r.u = a then a_sc || '–' || b_sc else b_sc || '–' || a_sc end
          || case when (r.u = a and b_down > 0) or (r.u = b and a_down > 0) then ', with a knockdown' else '' end
          || '. ' || case when r.u = a then ta || '–' || tb else tb || '–' || ta end || ' after ' || rnd || '.';
      end if;
      perform public.bout_notify(p_challenge_id, r.u, c.name, line);
    end loop;
    exit when g.status = 'final';
  end loop;
  return n;
end;
$$;
revoke execute on function public.bout_advance(uuid) from public, anon;
grant execute on function public.bout_advance(uuid) to authenticated;

create or replace function public.bout_advance_all()
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
    join public.bout_games g on g.challenge_id = c.id
    where c.kind::text = 'bout' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.bout_advance(r.id);
    exception when others then
      raise warning 'bout_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.bout_advance_all() from public, anon, authenticated;

select cron.schedule('hound-bout-advance', '33 11 * * *', $$ select public.bout_advance_all(); $$);


-- ── The state of the fight, for the caller ──

create or replace function public.bout_punch_json(p public.bout_punches)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p.id, 'by', p.user_id, 'round', p.round, 'punch', p.punch, 'quality', p.quality,
    'blocked', p.blocked, 'countered', p.countered, 'points', p.points, 'slip', p.slip, 'landed', p.landed,
    'knockdown', p.knockdown, 'at', p.created_at, 'slipped_at', p.slipped_at);
$$;
revoke execute on function public.bout_punch_json(public.bout_punches) from public, anon, authenticated;

create or replace function public.bout_live(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.bout_games%rowtype;
  other uuid;
  me_a boolean;
  today date;
  rnd int;
  dy jsonb;
  pr record;
  v_reason text;
  last_r public.bout_rounds%rowtype;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> 'bout'
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'You''re not in this fight.';
  end if;
  -- Score anything that's due first.
  perform public.bout_advance(p_challenge_id);
  select * into g from public.bout_games where challenge_id = p_challenge_id;
  if g.challenge_id is null then
    raise exception 'This fight isn''t set up yet.';
  end if;
  select cp.user_id into other from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id <> caller limit 1;
  me_a := (select p.a from public.bout_pair(p_challenge_id) p) = caller;
  today := public.soccer_today(caller);
  rnd := today - public.soccer_first_day(c) + 1;
  dy := public.bout_day(p_challenge_id, caller, today);
  select * into pr from public.bout_run(p_challenge_id, caller, rnd, (dy ->> 'kd_needs')::int);
  v_reason := public.bout_reason(p_challenge_id, caller);
  select * into last_r from public.bout_rounds r where r.challenge_id = p_challenge_id order by r.round desc limit 1;

  return jsonb_build_object(
    'status', g.status, 'rounds', g.rounds, 'rounds_played', g.rounds_played, 'round', rnd, 'today', today,
    'first_day', public.soccer_first_day(c),
    'winner', g.winner, 'method', g.method, 'ko_round', g.ko_round, 'me', caller,
    'opponent', case when other is null then null else jsonb_build_object('id', other, 'name', public.bout_name(other),
      'initials', (select p.initials from public.profiles p where p.id = other),
      'icon_id', (select p.equipped_icon_id from public.profiles p where p.id = other)) end,
    'day', dy,
    'widths', jsonb_build_object('jab', public.bout_width('jab', (dy ->> 'camp')::boolean), 'hook', public.bout_width('hook', (dy ->> 'camp')::boolean),
      'up', public.bout_width('up', (dy ->> 'camp')::boolean), 'perfect_share', 0.35),
    'slip_widths', jsonb_build_object('jab', public.bout_slip_width('jab', (dy ->> 'camp')::boolean),
      'hook', public.bout_slip_width('hook', (dy ->> 'camp')::boolean), 'up', public.bout_slip_width('up', (dy ->> 'camp')::boolean)),
    'guard', public.bout_guard_on(p_challenge_id, caller, today),
    'run', pr.run, 'downs', pr.downs,
    -- Today's tally so far, as it stands: landed points, counters included.
    'tally', jsonb_build_object(
      'mine', coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = caller
                          and p.quality <> 'miss' and not p.blocked and p.slip is distinct from 'slipped'), 0)
              + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = caller and p.countered),
      'theirs', coalesce((select sum(p.points) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.target = caller
                          and p.quality <> 'miss' and not p.blocked and p.slip is distinct from 'slipped'), 0)
              + (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = rnd and p.user_id = caller and p.countered)),
    'incoming', (select coalesce(jsonb_agg(public.bout_punch_json(p) order by p.id), '[]'::jsonb) from public.bout_punches p
                 where p.challenge_id = p_challenge_id and p.target = caller and p.round > g.rounds_played
                   and p.quality <> 'miss' and not p.blocked and p.slip is null),
    'thrown', (select coalesce(jsonb_agg(public.bout_punch_json(p) order by p.id desc), '[]'::jsonb) from (
                 select * from public.bout_punches p where p.challenge_id = p_challenge_id and p.user_id = caller and p.round = rnd
                 order by p.id desc limit 12) p),
    'card', (select coalesce(jsonb_agg(jsonb_build_object('round', r.round, 'day', r.day,
                'mine', case when me_a then r.a_score else r.b_score end, 'theirs', case when me_a then r.b_score else r.a_score end,
                'my_points', case when me_a then r.a_points else r.b_points end, 'their_points', case when me_a then r.b_points else r.a_points end,
                'my_down', case when me_a then r.a_down else r.b_down end, 'their_down', case when me_a then r.b_down else r.a_down end,
                'ko', r.ko) order by r.round), '[]'::jsonb)
             from public.bout_rounds r where r.challenge_id = p_challenge_id),
    'last', case when last_r.round is null then null else jsonb_build_object(
      'round', last_r.round,
      'mine', case when me_a then last_r.a_score else last_r.b_score end, 'theirs', case when me_a then last_r.b_score else last_r.a_score end,
      'my_points', case when me_a then last_r.a_points else last_r.b_points end, 'their_points', case when me_a then last_r.b_points else last_r.a_points end,
      'my_down', case when me_a then last_r.a_down else last_r.b_down end, 'their_down', case when me_a then last_r.b_down else last_r.a_down end,
      'my_landed', (select jsonb_object_agg(z.punch, z.n) from (select p.punch, count(*) as n from public.bout_punches p
                     where p.challenge_id = p_challenge_id and p.round = last_r.round and p.user_id = caller and p.landed group by p.punch) z),
      'slipped', (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = last_r.round and p.target = caller and p.slip = 'slipped'),
      'their_through', (select count(*) from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = last_r.round and p.target = caller
                          and p.quality <> 'miss' and not p.blocked),
      'their_guard', case when other is null then null else public.bout_guard_on(p_challenge_id, other, last_r.day) end) end,
    'can_act', v_reason is null,
    'reason', v_reason);
end;
$$;
revoke execute on function public.bout_live(uuid) from public, anon;
grant execute on function public.bout_live(uuid) to authenticated;

-- A scored round, punch by punch, for the replay: both fighters' punches
-- in the order thrown, each with how it ended (a miss, blocked, slipped,
-- landed, and whether it put them down).
create or replace function public.bout_replay(p_challenge_id uuid, p_round int)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.bout_games%rowtype;
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'You''re not in this fight.';
  end if;
  select * into g from public.bout_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or p_round is null or p_round < 1 or p_round > g.rounds_played then
    raise exception 'That round hasn''t been scored yet.';
  end if;
  return jsonb_build_object(
    'round', p_round, 'me', caller,
    'punches', (select coalesce(jsonb_agg(public.bout_punch_json(p) order by p.created_at, p.id), '[]'::jsonb)
                from public.bout_punches p where p.challenge_id = p_challenge_id and p.round = p_round),
    'result', (select to_jsonb(r) from public.bout_rounds r where r.challenge_id = p_challenge_id and r.round = p_round));
end;
$$;
revoke execute on function public.bout_replay(uuid, int) from public, anon;
grant execute on function public.bout_replay(uuid, int) to authenticated;


-- ── Settling it: 0202's settle_challenge_score_core, with the Bout ──

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


-- 0200's settle_challenge_score: a Bout settles like H-O-R-S-E.
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
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist');

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


-- ── Admin → Overview → Games → Hound Bout ──

create or replace function public.admin_bout_overview()
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
    'fights_live', (select count(*) from public.bout_games g where g.status = 'active'),
    'fights_all', (select count(*) from public.bout_games),
    'fighters_all', (select count(distinct cp.user_id) from public.challenge_participants cp join public.bout_games g on g.challenge_id = cp.challenge_id),
    'threw_ever', (select count(distinct p.user_id) from public.bout_punches p),
    'threw_7d', (select count(distinct p.user_id) from public.bout_punches p where p.created_at > now() - interval '7 days'),
    'punches_7d', (select count(*) from public.bout_punches p where p.created_at > now() - interval '7 days'),
    'by_punch_7d', (select coalesce(jsonb_object_agg(z.punch, z.n), '{}'::jsonb) from (select p.punch, count(*) as n from public.bout_punches p
                     where p.created_at > now() - interval '7 days' group by p.punch) z),
    'missed_7d', (select count(*) from public.bout_punches p where p.created_at > now() - interval '7 days' and p.quality = 'miss'),
    'blocked_7d', (select count(*) from public.bout_punches p where p.created_at > now() - interval '7 days' and p.blocked),
    'perfect_7d', (select count(*) from public.bout_punches p where p.created_at > now() - interval '7 days' and p.quality = 'perfect'),
    'slips_tried_7d', (select count(*) from public.bout_punches p where p.slipped_at > now() - interval '7 days' and p.slip in ('slipped', 'missed')),
    'slipped_7d', (select count(*) from public.bout_punches p where p.slipped_at > now() - interval '7 days' and p.slip = 'slipped'),
    'knockdowns_all', (select count(*) from public.bout_punches p where p.knockdown),
    'by_method', (select coalesce(jsonb_object_agg(z.method, z.n), '{}'::jsonb) from (select g.method, count(*) as n from public.bout_games g
                   where g.status = 'final' group by g.method) z),
    'guards_7d', (select coalesce(jsonb_object_agg(z.guard, z.n), '{}'::jsonb) from (select g.guard, count(*) as n from public.bout_guards g
                   where g.set_at > now() - interval '7 days' group by g.guard) z));
end;
$$;
revoke execute on function public.admin_bout_overview() from public, anon;
grant execute on function public.admin_bout_overview() to authenticated;
