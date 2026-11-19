-- Hound: Title Bout — a Global Hound Bout for the belt (0226 adds the
-- kind). Approved mockup: claude.ai/artifact/1V36kFvgdExKjh1CXwbFeD.
--
--   the week    a Global Hound Challenge of 7 days; join in the first 3.
--   days 1-5    a new opponent every day, paired by the ladder: everyone
--               who's in, best first, two by two (not yesterday's opponent
--               if it can be helped); the odd one out, or anyone who joins
--               after the day's pairing, gets a sparring hound. Each fight
--               is one Hound Bout round (0225's rules: actions from steps,
--               jab / hook / uppercut on the meter, the guard, slips,
--               knockdowns), scored the morning after.
--   the ladder  a KO win 3, a win on points 2, a draw 1, a loss 0; then
--               knockdowns scored, then points landed. A fighter who
--               threw nothing that day forfeits (the other wins on points
--               if they threw anything).
--   days 6-7    once day 5 is scored, the top two fight for the belt: two
--               rounds, days 6 and 7, a KO ending it. Level on the cards:
--               the higher seed keeps it. Everyone else keeps fighting the
--               ladder.
--   picks       free: from the moment the title fight's set until round 1
--               is scored, anyone in the challenge but the two fighters
--               picks a champion (tb_pick), after the tale of the tape
--               (tb_tape). A right pick earns pick_bones (25); right on
--               the underdog (fewer picks), double.
--   the belt    the champion's hound gets the Title Bout Belt (kennel item
--               title_belt, never sold) and wears it.
--   prizes      (titlebout_setup_global; defaults) champion 500, runner-up
--               250, 3rd-10th 100, most KOs 150 (ties split), everyone who
--               fought 5+ days 25. Paid by pay_global_places with the picks.
--   pushes      the day's result to each fighter, the title fight to all,
--               and the end, through send-golf-notification's 'bout' kind.
--
-- Run this once, after 0226 (committed on its own), in the SQL Editor.

-- ── The belt ──

insert into public.kennel_items (id, slot, name, cost_bones, available_until)
  values ('title_belt', 'body', 'Title Bout Belt', 0, '2000-01-01')
  on conflict (id) do nothing;

-- ── Tables ──

create table public.tb_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  prizes jsonb not null default '{"champion":500,"runner_up":250,"top10":100,"most_kos":150,"five_days":25}'::jsonb,
  pick_bones integer not null default 25 check (pick_bones between 0 and 500),
  days_scored integer not null default 0,
  title_a uuid references public.profiles (id) on delete set null,
  title_b uuid references public.profiles (id) on delete set null,
  title_set_at timestamptz,
  winner uuid references public.profiles (id) on delete set null,
  method text check (method in ('ko', 'decision', 'draw')),
  ko_round int,
  status text not null default 'active' check (status in ('active', 'final')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tb_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_day date not null,
  pts integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  kos integer not null default 0,
  downs_for integer not null default 0,
  downs_against integer not null default 0,
  landed integer not null default 0,
  days_fought integer not null default 0,
  place integer,
  place_bones integer not null default 0,
  kos_bones integer not null default 0,
  five_bones integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.tb_fights (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  title boolean not null default false,
  round int not null default 1,
  a uuid not null references public.profiles (id) on delete cascade,
  -- null: a sparring hound.
  b uuid references public.profiles (id) on delete cascade,
  a_points int,
  b_points int,
  a_down int,
  b_down int,
  a_score int,
  b_score int,
  result text check (result in ('a', 'b', 'draw', 'none')),
  ko boolean not null default false,
  scored_at timestamptz,
  created_at timestamptz not null default now()
);
create index tb_fights_day on public.tb_fights (challenge_id, day);
create index tb_fights_a on public.tb_fights (challenge_id, a, day);
create index tb_fights_b on public.tb_fights (challenge_id, b, day);

create table public.tb_punches (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  fight_id bigint not null references public.tb_fights (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target uuid references public.profiles (id) on delete cascade,
  day date not null,
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
  landed boolean,
  knockdown boolean not null default false,
  created_at timestamptz not null default now()
);
create index tb_punches_fight on public.tb_punches (fight_id, id);
create index tb_punches_user_day on public.tb_punches (challenge_id, user_id, day);
create index tb_punches_target on public.tb_punches (challenge_id, target, slip_day);
create index tb_punches_at on public.tb_punches (created_at desc);

create table public.tb_guards (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  guard text not null check (guard in ('high', 'body', 'counter')),
  set_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

create table public.tb_picks (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pick uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  correct boolean,
  bones int not null default 0,
  primary key (challenge_id, user_id)
);

alter table public.tb_games enable row level security;
alter table public.tb_players enable row level security;
alter table public.tb_fights enable row level security;
alter table public.tb_punches enable row level security;
alter table public.tb_guards enable row level security;
alter table public.tb_picks enable row level security;
revoke all on public.tb_games, public.tb_players, public.tb_fights, public.tb_punches, public.tb_guards, public.tb_picks from anon;
revoke insert, update, delete on public.tb_games, public.tb_players, public.tb_fights, public.tb_punches, public.tb_guards, public.tb_picks from authenticated;
create policy "Fighters see their own Title Bout" on public.tb_players for select to authenticated using (user_id = auth.uid());
create policy "Fighters see their own picks" on public.tb_picks for select to authenticated using (user_id = auth.uid());
create policy "Fighters see their own guard" on public.tb_guards for select to authenticated using (user_id = auth.uid());


-- ── Helpers ──

create or replace function public.tb_rand(p_seed text)
returns double precision language sql immutable as $$ select public.rally_js_rand(public.rally_js_hash(p_seed)); $$;
revoke execute on function public.tb_rand(text) from public, anon, authenticated;

-- The ladder: points, then knockdowns scored, then points landed. pos ties
-- on all three; idx is unique.
create or replace function public.tb_ladder(p_challenge_id uuid)
returns table (user_id uuid, pos int, idx int, pts int)
language sql
stable
security definer set search_path = public
as $$
  select p.user_id,
    (rank() over (order by p.pts desc, p.downs_for desc, p.landed desc))::int,
    (row_number() over (order by p.pts desc, p.downs_for desc, p.landed desc, p.joined_day, p.user_id))::int,
    p.pts
  from public.tb_players p where p.challenge_id = p_challenge_id;
$$;
revoke execute on function public.tb_ladder(uuid) from public, anon, authenticated;

-- Someone's day: steps, workouts, actions (0225's bout_day, on tb_punches).
create or replace function public.tb_day(p_challenge_id uuid, p_user uuid, p_day date)
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
  select (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.day = p_day)
       + (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.target = p_user
            and x.slip in ('slipped', 'missed') and x.slip_day = p_day)
    into used;
  return jsonb_build_object('steps', steps, 'earned', earned, 'used', used, 'left', greatest(0, earned - used),
    'next_at', case when steps >= 20000 then null else (steps / 1000 + 1) * 1000 end,
    'cardio', cardio >= 20, 'cardio_min', cardio,
    'strength', coalesce(b.strength, 0) > 0, 'camp', coalesce(b.game_day, false), 'camp_workout', b.workout,
    'kd_needs', case when coalesce(b.strength, 0) > 0 then 2 else 3 end);
end;
$$;
revoke execute on function public.tb_day(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.tb_guard_on(p_challenge_id uuid, p_user uuid, p_day date)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select g.guard from public.tb_guards g
                   where g.challenge_id = p_challenge_id and g.user_id = p_user and g.day <= p_day
                   order by g.day desc limit 1), 'high');
$$;
revoke execute on function public.tb_guard_on(uuid, uuid, date) from public, anon, authenticated;

-- A sparring hound's guard for a fight, and its points in it.
create or replace function public.tb_bot_guard(p_fight bigint)
returns text language sql immutable as $$
  select (array['high', 'body', 'counter'])[1 + floor(public.tb_rand('tb-guard:' || p_fight) * 3)::int];
$$;
create or replace function public.tb_bot_points(p_fight bigint)
returns int language sql immutable as $$ select 2 + floor(public.tb_rand('tb-bot:' || p_fight) * 5)::int; $$;
revoke execute on function public.tb_bot_guard(bigint) from public, anon, authenticated;
revoke execute on function public.tb_bot_points(bigint) from public, anon, authenticated;

create or replace function public.tb_day_no(c public.challenges, p_day date)
returns int language sql immutable as $$ select p_day - public.soccer_first_day(c) + 1; $$;
revoke execute on function public.tb_day_no(public.challenges, date) from public, anon, authenticated;

-- Pairs day d, once: everyone in, ladder order, two by two; title
-- fighters fight each other on days 6 and 7.
create or replace function public.tb_ensure_day(p_challenge_id uuid, p_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  ids uuid[];
  i int;
  x uuid;
  y uuid;
  dn int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id for update;
  dn := public.tb_day_no(c, p_day);
  if g.challenge_id is null or dn < 1 or dn > 7 or g.status <> 'active' then
    return;
  end if;
  if exists (select 1 from public.tb_fights f where f.challenge_id = p_challenge_id and f.day = p_day and not f.title) then
    return;
  end if;
  select array_agg(l.user_id order by l.idx) into ids
    from public.tb_ladder(p_challenge_id) l
    join public.tb_players p on p.challenge_id = p_challenge_id and p.user_id = l.user_id
    where p.joined_day <= p_day
      and not (dn >= 6 and g.title_a is not null and l.user_id in (g.title_a, g.title_b));
  if ids is null then
    return;
  end if;
  i := 1;
  while i <= array_length(ids, 1) loop
    x := ids[i];
    y := case when i + 1 <= array_length(ids, 1) then ids[i + 1] end;
    -- Not yesterday's opponent if the next one along can take their place.
    if y is not null and i + 2 <= array_length(ids, 1) and exists (
      select 1 from public.tb_fights f where f.challenge_id = p_challenge_id and f.day = p_day - 1
        and ((f.a = x and f.b = y) or (f.a = y and f.b = x))) then
      ids[i + 1] := ids[i + 2];
      ids[i + 2] := y;
      y := ids[i + 1];
    end if;
    insert into public.tb_fights (challenge_id, day, a, b) values (p_challenge_id, p_day, x, y);
    i := i + 2;
  end loop;
end;
$$;
revoke execute on function public.tb_ensure_day(uuid, date) from public, anon, authenticated;

-- Someone's fight on a day (pairing the day first; a sparring hound if
-- they came after it).
create or replace function public.tb_fight_for(p_challenge_id uuid, p_user uuid, p_day date)
returns public.tb_fights
language plpgsql
security definer set search_path = public
as $$
declare
  f public.tb_fights%rowtype;
  c public.challenges%rowtype;
  dn int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  dn := public.tb_day_no(c, p_day);
  if dn < 1 or dn > 7 or not exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = p_user and p.joined_day <= p_day) then
    return null;
  end if;
  perform public.tb_ensure_day(p_challenge_id, p_day);
  select * into f from public.tb_fights x where x.challenge_id = p_challenge_id and x.day = p_day and (x.a = p_user or x.b = p_user)
    order by x.title desc limit 1;
  if f.id is null then
    insert into public.tb_fights (challenge_id, day, a, b) values (p_challenge_id, p_day, p_user, null) returning * into f;
  end if;
  return f;
end;
$$;
revoke execute on function public.tb_fight_for(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.tb_run(p_fight bigint, p_user uuid, p_needs int)
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
  for x in select * from public.tb_punches p where p.fight_id = p_fight and p.user_id = p_user order by p.id loop
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
revoke execute on function public.tb_run(bigint, uuid, int) from public, anon, authenticated;


-- ── Publishing: 0221's, with the Title Bout ──

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
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby', 'shootout', 'titlebout') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf, the Home Run Derby, the Hound Shootout or the Title Bout.';
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
  if p_kind::text = 'derby' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'The Home Run Derby runs 3 to 30 days.';
  end if;
  if p_kind::text = 'shootout' and (p_duration_days < 3 or p_duration_days > 30) then
    raise exception 'The Hound Shootout runs 3 to 30 days.';
  end if;
  if p_kind::text = 'titlebout' and p_duration_days <> 7 then
    raise exception 'The Title Bout runs 7 days: 5 on the ladder, then the title fight.';
  end if;
  -- Joining closes after day 3 of the Title Bout at the latest.
  if p_kind::text = 'titlebout' and p_join_closes_at > p_starts_at + interval '3 days' then
    raise exception 'Joining the Title Bout closes by the end of day 3.';
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

create or replace function public.titlebout_setup_global(p_challenge_id uuid, p_prizes jsonb default null, p_pick_bones int default 25)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  pz jsonb := coalesce(p_prizes, '{"champion":500,"runner_up":250,"top10":100,"most_kos":150,"five_days":25}'::jsonb);
  k text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can set up the Title Bout.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'titlebout' or not c.is_global then
    raise exception 'That isn''t a Title Bout.';
  end if;
  if exists (select 1 from public.tb_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This Title Bout is already set up.';
  end if;
  foreach k in array array['champion', 'runner_up', 'top10', 'most_kos', 'five_days'] loop
    if jsonb_typeof(pz -> k) is distinct from 'number' or (pz ->> k)::numeric not between 0 and 5000 then
      raise exception 'Each prize is 0 to 5,000 Bones.';
    end if;
  end loop;
  if p_pick_bones is null or p_pick_bones not between 0 and 500 then
    raise exception 'A right pick is worth 0 to 500 Bones.';
  end if;
  insert into public.tb_games (challenge_id, prizes, pick_bones) values (p_challenge_id, pz, p_pick_bones);
end;
$$;
revoke execute on function public.titlebout_setup_global(uuid, jsonb, int) from public, anon;
grant execute on function public.titlebout_setup_global(uuid, jsonb, int) to authenticated;

create or replace function public.tb_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'titlebout')
     and not exists (select 1 from public.tb_games g where g.challenge_id = new.challenge_id) then
    raise exception 'This Title Bout isn''t set up yet.';
  end if;
  return new;
end;
$$;
revoke execute on function public.tb_before_join() from public, anon, authenticated;
create trigger tb_before_join before insert on public.challenge_participants
  for each row execute procedure public.tb_before_join();

create or replace function public.tb_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if c.kind::text = 'titlebout' then
    insert into public.tb_players (challenge_id, user_id, joined_day)
      values (new.challenge_id, new.user_id, greatest(public.soccer_first_day(c), public.soccer_today(new.user_id)))
      on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.tb_after_join() from public, anon, authenticated;
create trigger tb_after_join after insert on public.challenge_participants
  for each row execute procedure public.tb_after_join();


-- ── In the ring ──

create or replace function public.tb_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  today date;
  dn int;
  f public.tb_fights%rowtype;
  dy jsonb;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or not exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = p_user) then
    return 'Join the Title Bout to fight.';
  end if;
  if g.status <> 'active' then
    return 'The Title Bout is over.';
  end if;
  today := public.soccer_today(p_user);
  dn := public.tb_day_no(c, today);
  if dn < 1 then
    return 'The first bell rings ' || to_char(public.soccer_first_day(c), 'FMDay') || '.';
  end if;
  if dn > 7 then
    return 'The Title Bout is over.';
  end if;
  f := public.tb_fight_for(p_challenge_id, p_user, today);
  if f.id is null then
    return 'Your first fight is tomorrow.';
  end if;
  if f.scored_at is not null then
    return 'Today''s fight has been scored.';
  end if;
  dy := public.tb_day(p_challenge_id, p_user, today);
  if (dy ->> 'left')::int <= 0 then
    if (dy ->> 'earned')::int >= 20 then
      return 'That''s every action today. Back tomorrow.';
    end if;
    return 'No actions ready: your next comes at ' || to_char((dy ->> 'next_at')::int, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.tb_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.tb_set_guard(p_challenge_id uuid, p_guard text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = caller) then
    raise exception 'Join the Title Bout to fight.';
  end if;
  if p_guard is null or p_guard not in ('high', 'body', 'counter') then
    raise exception 'Pick a high guard, a body guard or counter.';
  end if;
  insert into public.tb_guards (challenge_id, user_id, day, guard) values (p_challenge_id, caller, public.soccer_today(caller), p_guard)
    on conflict (challenge_id, user_id, day) do update set guard = excluded.guard, set_at = now();
  return p_guard;
end;
$$;
revoke execute on function public.tb_set_guard(uuid, text) from public, anon;
grant execute on function public.tb_set_guard(uuid, text) to authenticated;

create or replace function public.tb_throw(p_challenge_id uuid, p_punch text, p_pos numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_reason text;
  today date := public.soccer_today(caller);
  f public.tb_fights%rowtype;
  other uuid;
  dy jsonb;
  w numeric;
  q text;
  gd text;
  blk boolean;
  ctr boolean;
  pts int;
  pr record;
  pid bigint;
  nm text;
  msg text;
  pos numeric := greatest(0, least(100, coalesce(p_pos, 0)));
begin
  if p_punch is null or p_punch not in ('jab', 'hook', 'up') then
    raise exception 'Throw a jab, a hook or an uppercut.';
  end if;
  v_reason := public.tb_reason(p_challenge_id, caller);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;
  f := public.tb_fight_for(p_challenge_id, caller, today);
  perform 1 from public.tb_fights x where x.id = f.id for update;
  other := case when f.a = caller then f.b else f.a end;
  dy := public.tb_day(p_challenge_id, caller, today);
  w := public.bout_width(p_punch, (dy ->> 'camp')::boolean);
  q := public.bout_quality(pos, w);
  gd := case when other is null then public.tb_bot_guard(f.id) else public.tb_guard_on(p_challenge_id, other, public.soccer_today(other)) end;
  blk := q <> 'miss' and public.bout_blocks(gd, p_punch, q);
  ctr := blk and gd = 'counter';
  pts := case when q = 'miss' or blk then 0 else public.bout_points(p_punch) + case when gd = 'counter' then 1 else 0 end end;
  insert into public.tb_punches (challenge_id, fight_id, user_id, target, day, punch, pos, quality, guard, blocked, countered, points)
    values (p_challenge_id, f.id, caller, other, today, p_punch, pos, q, gd, blk, ctr, pts)
    returning id into pid;
  select * into pr from public.tb_run(f.id, caller, (dy ->> 'kd_needs')::int);
  nm := case when other is null then 'The sparring hound' else split_part(public.bout_name(other), ' ', 1) end;
  msg := case
    when q = 'miss' then 'Swung at air: ' || case when pos < 50 then 'too early.' else 'too late.' end
    when ctr then nm || '’s counter guard caught your jab and hit back: 1 to ' || nm || '.'
    when blk then 'Blocked: ' || nm || '’s got a ' || gd || ' guard up. ' || case when p_punch = 'hook' then 'Try an uppercut.' else 'Try a hook.' end
    when pr.downs > 0 and pr.run = 0 and p_punch <> 'jab' then nm || ' goes down! Unless it’s slipped, that’s a knockdown tonight.'
    when p_punch = 'jab' then 'Snapped it in: ' || pts || '. Jabs score, but they don’t build to a knockdown.'
    else initcap(case p_punch when 'up' then 'uppercut' else p_punch end) || ' lands: ' || pts
         || case when q = 'perfect' then ', perfect' else '' end || '. ' || pr.run || ' of ' || (dy ->> 'kd_needs') || ' to a knockdown.' end;
  return jsonb_build_object('id', pid, 'punch', p_punch, 'quality', q, 'blocked', blk, 'countered', ctr, 'points', pts,
    'guard', case when blk then gd end, 'run', pr.run, 'downs', pr.downs, 'kd_needs', (dy ->> 'kd_needs')::int,
    'left', greatest(0, (dy ->> 'left')::int - 1), 'message', msg);
end;
$$;
revoke execute on function public.tb_throw(uuid, text, numeric) from public, anon;
grant execute on function public.tb_throw(uuid, text, numeric) to authenticated;

create or replace function public.tb_slip(p_challenge_id uuid, p_punch_id bigint, p_pos numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  x public.tb_punches%rowtype;
  f public.tb_fights%rowtype;
  today date := public.soccer_today(caller);
  dy jsonb;
  ok boolean;
begin
  select * into x from public.tb_punches p where p.id = p_punch_id and p.challenge_id = p_challenge_id for update;
  if x.id is null or x.target is distinct from caller then
    raise exception 'That punch isn''t coming at you.';
  end if;
  if x.slip is not null or x.quality = 'miss' or x.blocked then
    raise exception 'That one''s already dealt with.';
  end if;
  select * into f from public.tb_fights where id = x.fight_id;
  if f.scored_at is not null then
    raise exception 'That fight''s been scored.';
  end if;
  if p_pos is null then
    update public.tb_punches set slip = 'taken', slipped_at = now() where id = x.id;
    return jsonb_build_object('slip', 'taken', 'message', 'You took it: it lands tonight.');
  end if;
  dy := public.tb_day(p_challenge_id, caller, today);
  if (dy ->> 'left')::int <= 0 then
    raise exception 'No actions left to slip with today.';
  end if;
  ok := abs(greatest(0, least(100, p_pos)) - 50) <= public.bout_slip_width(x.punch, (dy ->> 'camp')::boolean);
  update public.tb_punches set slip = case when ok then 'slipped' else 'missed' end, slip_day = today,
      slip_pos = greatest(0, least(100, p_pos)), slipped_at = now()
    where id = x.id;
  return jsonb_build_object('slip', case when ok then 'slipped' else 'missed' end, 'left', greatest(0, (dy ->> 'left')::int - 1),
    'message', case when ok then 'Slipped it: that ' || case x.punch when 'up' then 'uppercut' else x.punch end || ' won’t score.'
               else 'Too ' || case when p_pos < 50 then 'early' else 'late' end || ': it lands tonight.' end);
end;
$$;
revoke execute on function public.tb_slip(uuid, bigint, numeric) from public, anon;
grant execute on function public.tb_slip(uuid, bigint, numeric) to authenticated;


-- ── Scoring, the morning after ──

-- Scores one fight: landed punches, knockdowns, the 10-point card, the
-- result; returns it.
create or replace function public.tb_score_fight(p_fight bigint)
returns public.tb_fights
language plpgsql
security definer set search_path = public
as $$
declare
  f public.tb_fights%rowtype;
  who uuid;
  needs int;
  run int;
  x record;
  a_pts int;
  b_pts int;
  a_dn int;
  b_dn int;
  a_threw int;
  b_threw int;
  res text;
begin
  select * into f from public.tb_fights where id = p_fight for update;
  if f.scored_at is not null then
    return f;
  end if;
  update public.tb_punches set landed = (quality <> 'miss' and not blocked and slip is distinct from 'slipped') where fight_id = f.id;
  update public.tb_punches set slip = 'taken' where fight_id = f.id and slip is null and landed;
  for who in select unnest(array[f.a, f.b]) loop
    continue when who is null;
    needs := (public.tb_day(f.challenge_id, who, f.day) ->> 'kd_needs')::int;
    run := 0;
    for x in select * from public.tb_punches p where p.fight_id = f.id and p.user_id = who order by p.id loop
      if x.landed and x.punch <> 'jab' then
        run := run + 1;
        if run >= needs then
          update public.tb_punches set knockdown = true where id = x.id;
          run := 0;
        end if;
      else
        run := 0;
      end if;
    end loop;
  end loop;
  a_threw := (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a)
           + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.a and p.slip in ('slipped', 'missed'));
  b_threw := case when f.b is null then 1 else
             (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b)
           + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.b and p.slip in ('slipped', 'missed')) end;
  a_pts := coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a and p.landed), 0)
         + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.a and p.countered);
  b_pts := case when f.b is null then case when a_threw > 0 then public.tb_bot_points(f.id) else 0 end else
           coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b and p.landed), 0)
         + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = f.b and p.countered) end;
  b_dn := (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.a and p.knockdown);
  a_dn := case when f.b is null then 0 else (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = f.b and p.knockdown) end;
  res := case
    when a_threw = 0 and b_threw = 0 then 'none'
    when a_threw = 0 then 'b'
    when b_threw = 0 then 'a'
    when a_dn >= 3 and b_dn < 3 then 'b'
    when b_dn >= 3 and a_dn < 3 then 'a'
    when (case when a_pts < b_pts then 9 else 10 end) - a_dn > (case when b_pts < a_pts then 9 else 10 end) - b_dn then 'a'
    when (case when a_pts < b_pts then 9 else 10 end) - a_dn < (case when b_pts < a_pts then 9 else 10 end) - b_dn then 'b'
    else 'draw' end;
  update public.tb_fights set a_points = a_pts, b_points = b_pts, a_down = a_dn, b_down = b_dn,
      a_score = (case when a_pts < b_pts then 9 else 10 end) - a_dn,
      b_score = (case when b_pts < a_pts then 9 else 10 end) - b_dn,
      result = res, ko = (a_dn >= 3 or b_dn >= 3), scored_at = now()
    where id = f.id returning * into f;
  return f;
end;
$$;
revoke execute on function public.tb_score_fight(bigint) from public, anon, authenticated;

-- A ladder fight's result onto the ladder.
create or replace function public.tb_book(f public.tb_fights)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  side text;
  u uuid;
  won boolean;
  lost boolean;
  threw boolean;
begin
  for side in select unnest(array['a', 'b']) loop
    u := case when side = 'a' then f.a else f.b end;
    continue when u is null;
    threw := exists (select 1 from public.tb_punches p where p.fight_id = f.id and (p.user_id = u or (p.target = u and p.slip in ('slipped', 'missed'))));
    won := f.result = side;
    lost := f.result in ('a', 'b') and f.result <> side;
    update public.tb_players set
        pts = pts + case when won and f.ko then 3 when won then 2 when f.result = 'draw' then 1 else 0 end,
        wins = wins + case when won then 1 else 0 end,
        losses = losses + case when lost then 1 else 0 end,
        draws = draws + case when f.result = 'draw' then 1 else 0 end,
        kos = kos + case when won and f.ko then 1 else 0 end,
        downs_for = downs_for + coalesce(case when side = 'a' then f.b_down else f.a_down end, 0),
        downs_against = downs_against + coalesce(case when side = 'a' then f.a_down else f.b_down end, 0),
        landed = landed + coalesce(case when side = 'a' then f.a_points else f.b_points end, 0),
        days_fought = days_fought + case when threw then 1 else 0 end
      where challenge_id = f.challenge_id and user_id = u;
  end loop;
end;
$$;
revoke execute on function public.tb_book(public.tb_fights) from public, anon, authenticated;

create or replace function public.tb_notify(p_challenge_id uuid, p_user uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('bout', p_challenge_id, p_user, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.tb_notify(uuid, uuid, text, text) from public, anon, authenticated;

-- Scores every day that's over everywhere: the ladder fights, the title
-- fight's rounds, the title fight's pairing after day 5, and the end.
create or replace function public.tb_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  cutoff date;
  d date;
  dn int;
  n int := 0;
  f public.tb_fights%rowtype;
  r record;
  r2 record;
  ta int;
  tb int;
  da int;
  db int;
  v_winner uuid;
  v_ko boolean;
  opp text;
  line text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id for update;
  if c.id is null or g.challenge_id is null or g.status <> 'active' then
    return 0;
  end if;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  loop
    dn := g.days_scored + 1;
    d := public.soccer_first_day(c) + dn - 1;
    exit when dn > 7 or d > cutoff;

    -- The ladder fights.
    for r in select x.id from public.tb_fights x where x.challenge_id = p_challenge_id and x.day = d and not x.title and x.scored_at is null loop
      f := public.tb_score_fight(r.id);
      perform public.tb_book(f);
      for r2 in select unnest(array[f.a, f.b]) as u loop
        continue when r2.u is null;
        opp := case when f.b is null then 'the sparring hound' else split_part(public.bout_name(case when r2.u = f.a then f.b else f.a end), ' ', 1) end;
        line := case
          when f.result = 'none' then null
          when (f.result = 'a' and r2.u = f.a) or (f.result = 'b' and r2.u = f.b) then
            'You beat ' || opp || case when f.ko then ' by KO: +3.' else ' on points: +2.' end
          when f.result = 'draw' then 'A draw with ' || opp || ': +1.'
          else opp || ' beat you' || case when f.ko then ' by KO.' else ' on points.' end || ' New opponent today.' end;
        if line is not null then
          perform public.tb_notify(p_challenge_id, r2.u, c.name, line);
        end if;
      end loop;
    end loop;

    -- The title fight's round.
    select * into f from public.tb_fights x where x.challenge_id = p_challenge_id and x.day = d and x.title;
    if f.id is not null and f.scored_at is null then
      f := public.tb_score_fight(f.id);
      ta := (select sum(x.a_score) from public.tb_fights x where x.challenge_id = p_challenge_id and x.title);
      tb := (select sum(x.b_score) from public.tb_fights x where x.challenge_id = p_challenge_id and x.title);
      da := (select sum(x.a_down) from public.tb_fights x where x.challenge_id = p_challenge_id and x.title);
      db := (select sum(x.b_down) from public.tb_fights x where x.challenge_id = p_challenge_id and x.title);
      v_ko := f.a_down >= 3 or f.b_down >= 3 or da >= 4 or db >= 4;
      if v_ko or f.round >= 2 then
        v_winner := case
          when v_ko and (f.b_down >= 3 or db >= 4) and not (f.a_down >= 3 or da >= 4) then f.a
          when v_ko and (f.a_down >= 3 or da >= 4) and not (f.b_down >= 3 or db >= 4) then f.b
          when tb > ta then f.b
          -- Level on the cards (or both down for the count): the higher seed.
          else f.a end;
        update public.tb_games set winner = v_winner,
            method = case when v_ko then 'ko' when ta = tb then 'draw' else 'decision' end,
            ko_round = case when v_ko then f.round end
          where challenge_id = p_challenge_id;
        -- A KO in round 1: there's no round 2.
        delete from public.tb_fights x where x.challenge_id = p_challenge_id and x.title and x.round > f.round;
        -- The belt.
        insert into public.kennel_purchases (user_id, item_id, bones) values (v_winner, 'title_belt', 0) on conflict do nothing;
        update public.kennels set body_id = 'title_belt', updated_at = now() where user_id = v_winner;
        for r in select cp.user_id as u from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
          perform public.tb_notify(p_challenge_id, r.u, c.name,
            case when r.u = v_winner then 'You’re the champion! The belt is yours.'
                 else split_part(public.bout_name(v_winner), ' ', 1) || ' takes the belt'
                   || case when v_ko then ' by KO in round ' || f.round || '.' else ' on the cards.' end end);
        end loop;
      end if;
    end if;

    update public.tb_games set days_scored = dn where challenge_id = p_challenge_id;
    n := n + 1;

    -- After day 5: the top two fight for the belt.
    select * into g from public.tb_games where challenge_id = p_challenge_id;
    if dn = 5 and g.title_a is null then
      update public.tb_games set
          title_a = (select l.user_id from public.tb_ladder(p_challenge_id) l where l.idx = 1
                     and exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = l.user_id and p.days_fought > 0)),
          title_b = (select l.user_id from public.tb_ladder(p_challenge_id) l where l.idx = 2
                     and exists (select 1 from public.tb_players p where p.challenge_id = p_challenge_id and p.user_id = l.user_id and p.days_fought > 0)),
          title_set_at = now()
        where challenge_id = p_challenge_id
        returning * into g;
      if g.title_a is not null and g.title_b is not null then
        insert into public.tb_fights (challenge_id, day, title, round, a, b) values
          (p_challenge_id, d + 1, true, 1, g.title_a, g.title_b),
          (p_challenge_id, d + 2, true, 2, g.title_a, g.title_b);
        -- Today's ladder pairing (if made already) mustn't hold them.
        delete from public.tb_fights x where x.challenge_id = p_challenge_id and x.day = d + 1 and not x.title
          and (x.a in (g.title_a, g.title_b) or x.b in (g.title_a, g.title_b))
          and not exists (select 1 from public.tb_punches p where p.fight_id = x.id);
        for r in select cp.user_id as u from public.challenge_participants cp where cp.challenge_id = p_challenge_id loop
          perform public.tb_notify(p_challenge_id, r.u, c.name,
            case when r.u in (g.title_a, g.title_b) then 'You’re in the title fight! Two rounds for the belt, starting today.'
                 else 'Title fight: ' || split_part(public.bout_name(g.title_a), ' ', 1) || ' vs ' || split_part(public.bout_name(g.title_b), ' ', 1)
                   || '. Check the tale of the tape and pick your champion.' end);
        end loop;
      end if;
    end if;
    if dn >= 7 then
      update public.tb_games set status = 'final' where challenge_id = p_challenge_id returning * into g;
      exit;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.tb_advance(uuid) from public, anon, authenticated;

create or replace function public.tb_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select g.challenge_id from public.tb_games g join public.challenges c on c.id = g.challenge_id
           where g.status = 'active' and c.starts_at < now() loop
    begin
      n := n + public.tb_advance(r.challenge_id);
    exception when others then
      raise warning 'tb_advance_all: % failed: %', r.challenge_id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.tb_advance_all() from public, anon, authenticated;
select cron.schedule('hound-titlebout-advance', '35 11 * * *', $$ select public.tb_advance_all(); $$);


-- ── Picks ──

create or replace function public.tb_picks_open(g public.tb_games)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select g.title_a is not null and g.title_b is not null and g.status = 'active'
    and not exists (select 1 from public.tb_fights x where x.challenge_id = g.challenge_id and x.title and x.round = 1 and x.scored_at is not null);
$$;
revoke execute on function public.tb_picks_open(public.tb_games) from public, anon, authenticated;

create or replace function public.tb_pick(p_challenge_id uuid, p_pick uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.tb_games%rowtype;
begin
  select * into g from public.tb_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'Join the Title Bout to pick a champion.';
  end if;
  if not public.tb_picks_open(g) then
    raise exception 'Picks are closed.';
  end if;
  if caller in (g.title_a, g.title_b) then
    raise exception 'You’re in the title fight: no picking yourself.';
  end if;
  if p_pick is null or p_pick not in (g.title_a, g.title_b) then
    raise exception 'Pick one of the two in the title fight.';
  end if;
  insert into public.tb_picks (challenge_id, user_id, pick) values (p_challenge_id, caller, p_pick)
    on conflict (challenge_id, user_id) do update set pick = excluded.pick, updated_at = now();
  return jsonb_build_object('pick', p_pick,
    'a', (select count(*) from public.tb_picks k where k.challenge_id = p_challenge_id and k.pick = g.title_a),
    'b', (select count(*) from public.tb_picks k where k.challenge_id = p_challenge_id and k.pick = g.title_b));
end;
$$;
revoke execute on function public.tb_pick(uuid, uuid) from public, anon;
grant execute on function public.tb_pick(uuid, uuid) to authenticated;

-- One fighter's tale of the tape.
create or replace function public.tb_tape_side(p_challenge_id uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  p public.tb_players%rowtype;
  first_day date;
  strength_days int := 0;
  d date;
  b record;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into p from public.tb_players x where x.challenge_id = p_challenge_id and x.user_id = p_user;
  first_day := public.soccer_first_day(c);
  for d in select generate_series(first_day, first_day + 4, interval '1 day')::date loop
    select * into b from public.sport_day_bonus(p_user, d, 'bout');
    if coalesce(b.strength, 0) > 0 then
      strength_days := strength_days + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'id', p_user, 'name', public.bout_name(p_user),
    'initials', (select pr.initials from public.profiles pr where pr.id = p_user),
    'icon_id', (select pr.equipped_icon_id from public.profiles pr where pr.id = p_user),
    'pos', (select l.pos from public.tb_ladder(p_challenge_id) l where l.user_id = p_user),
    'pts', p.pts, 'wins', p.wins, 'losses', p.losses, 'draws', p.draws, 'kos', p.kos,
    'downs_against', p.downs_against,
    'thrown', (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and not exists (
                 select 1 from public.tb_fights f where f.id = x.fight_id and f.title)),
    'landed', (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.landed
                 and not exists (select 1 from public.tb_fights f where f.id = x.fight_id and f.title)),
    'slips_tried', (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.target = p_user and x.slip in ('slipped', 'missed')),
    'slipped', (select count(*) from public.tb_punches x where x.challenge_id = p_challenge_id and x.target = p_user and x.slip = 'slipped'),
    'best_punch', (select x.punch from public.tb_punches x where x.challenge_id = p_challenge_id and x.user_id = p_user and x.landed
                   group by x.punch order by sum(x.points) desc limit 1),
    'guard', (select g.guard from public.tb_guards g where g.challenge_id = p_challenge_id and g.user_id = p_user
              group by g.guard order by count(*) desc limit 1),
    'steps_a_day', (select round(avg(ps.steps))::int from public.progress_snapshots ps where ps.challenge_id = p_challenge_id and ps.user_id = p_user
                      and ps.day between first_day and first_day + 4),
    'strength_days', strength_days);
end;
$$;
revoke execute on function public.tb_tape_side(uuid, uuid) from public, anon, authenticated;


-- ── The state of it, for the caller ──

create or replace function public.tb_punch_json(p public.tb_punches)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('id', p.id, 'by', p.user_id, 'round', 1, 'punch', p.punch, 'quality', p.quality,
    'blocked', p.blocked, 'countered', p.countered, 'points', p.points, 'slip', p.slip, 'landed', p.landed,
    'knockdown', p.knockdown, 'at', p.created_at, 'slipped_at', p.slipped_at);
$$;
revoke execute on function public.tb_punch_json(public.tb_punches) from public, anon, authenticated;

create or replace function public.tb_live(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  me public.tb_players%rowtype;
  today date;
  dn int;
  f public.tb_fights%rowtype;
  other uuid;
  dy jsonb;
  v_run int := 0;
  v_downs int := 0;
  v_reason text;
  last_f public.tb_fights%rowtype;
  mine_pos int;
  phase text;
  in_title boolean;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'titlebout' or g.challenge_id is null then
    raise exception 'That isn''t a Title Bout.';
  end if;
  perform public.tb_advance(p_challenge_id);
  select * into g from public.tb_games where challenge_id = p_challenge_id;
  select * into me from public.tb_players x where x.challenge_id = p_challenge_id and x.user_id = caller;
  today := public.soccer_today(caller);
  dn := public.tb_day_no(c, today);
  if me.user_id is not null and dn between 1 and 7 and g.status = 'active' then
    f := public.tb_fight_for(p_challenge_id, caller, today);
  end if;
  other := case when f.id is null then null when f.a = caller then f.b else f.a end;
  dy := public.tb_day(p_challenge_id, caller, today);
  if f.id is not null then
    select x.run, x.downs into v_run, v_downs from public.tb_run(f.id, caller, (dy ->> 'kd_needs')::int) x;
  end if;
  v_reason := public.tb_reason(p_challenge_id, caller);
  select * into last_f from public.tb_fights x
    where x.challenge_id = p_challenge_id and (x.a = caller or x.b = caller) and x.scored_at is not null and x.result <> 'none'
    order by x.day desc, x.title desc limit 1;
  select l.pos into mine_pos from public.tb_ladder(p_challenge_id) l where l.user_id = caller;
  in_title := caller in (g.title_a, g.title_b);
  phase := case when g.status = 'final' then 'final' when dn < 1 then 'upcoming' when g.title_a is not null then 'title' else 'ladder' end;

  return jsonb_build_object(
    -- What the ring (BoutRingScreen) reads, as 0225's bout_live.
    'status', case when g.status = 'final' then 'final' else 'active' end,
    'rounds', case when f.title then 2 else 1 end,
    'rounds_played', 0,
    'round', case when f.title then f.round else 1 end,
    'winner', g.winner, 'method', g.method, 'ko_round', g.ko_round, 'me', caller,
    'opponent', case
      when f.id is null then null
      when other is null then jsonb_build_object('id', null, 'name', 'Sparring hound', 'initials', 'SP', 'icon_id', null)
      else jsonb_build_object('id', other, 'name', public.bout_name(other),
        'initials', (select p.initials from public.profiles p where p.id = other),
        'icon_id', (select p.equipped_icon_id from public.profiles p where p.id = other)) end,
    'day', dy,
    'widths', jsonb_build_object('jab', public.bout_width('jab', (dy ->> 'camp')::boolean), 'hook', public.bout_width('hook', (dy ->> 'camp')::boolean),
      'up', public.bout_width('up', (dy ->> 'camp')::boolean), 'perfect_share', 0.35),
    'slip_widths', jsonb_build_object('jab', public.bout_slip_width('jab', (dy ->> 'camp')::boolean),
      'hook', public.bout_slip_width('hook', (dy ->> 'camp')::boolean), 'up', public.bout_slip_width('up', (dy ->> 'camp')::boolean)),
    'guard', public.tb_guard_on(p_challenge_id, caller, today),
    'run', v_run, 'downs', v_downs, 'today', today, 'first_day', public.soccer_first_day(c),
    'tally', jsonb_build_object(
      'mine', coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.user_id = caller
                          and p.quality <> 'miss' and not p.blocked and p.slip is distinct from 'slipped'), 0)
              + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.target = caller and p.countered),
      'theirs', coalesce((select sum(p.points) from public.tb_punches p where p.fight_id = f.id and p.target = caller
                          and p.quality <> 'miss' and not p.blocked and p.slip is distinct from 'slipped'), 0)
              + (select count(*) from public.tb_punches p where p.fight_id = f.id and p.user_id = caller and p.countered)),
    'incoming', (select coalesce(jsonb_agg(public.tb_punch_json(p) order by p.id), '[]'::jsonb) from public.tb_punches p
                 join public.tb_fights x on x.id = p.fight_id and x.scored_at is null
                 where p.challenge_id = p_challenge_id and p.target = caller and p.quality <> 'miss' and not p.blocked and p.slip is null),
    'thrown', (select coalesce(jsonb_agg(public.tb_punch_json(p) order by p.id desc), '[]'::jsonb) from (
                 select * from public.tb_punches p where p.fight_id = f.id and p.user_id = caller order by p.id desc limit 12) p),
    'card', '[]'::jsonb,
    'last', null,
    'can_act', v_reason is null,
    'reason', v_reason,
    -- The Title Bout's own.
    'tb', jsonb_build_object(
      'day_no', greatest(0, least(7, dn)), 'days', 7, 'phase', phase, 'joined', me.user_id is not null,
      'field', (select count(*) from public.tb_players x where x.challenge_id = p_challenge_id),
      'fight', case when f.id is null then null else jsonb_build_object('id', f.id, 'title', f.title, 'round', f.round,
        'opp_pos', case when other is null then null else (select l.pos from public.tb_ladder(p_challenge_id) l where l.user_id = other) end,
        'opp_pts', case when other is null then null else (select x.pts from public.tb_players x where x.challenge_id = p_challenge_id and x.user_id = other) end) end,
      'me', case when me.user_id is null then null else jsonb_build_object('pos', mine_pos, 'pts', me.pts, 'wins', me.wins, 'losses', me.losses,
        'draws', me.draws, 'kos', me.kos, 'days_fought', me.days_fought) end,
      'last_fight', case when last_f.id is null then null else jsonb_build_object('id', last_f.id, 'day', last_f.day, 'title', last_f.title,
        'opp', case when (case when last_f.a = caller then last_f.b else last_f.a end) is null then 'the sparring hound'
                    else public.bout_name(case when last_f.a = caller then last_f.b else last_f.a end) end,
        'won', (last_f.result = 'a' and last_f.a = caller) or (last_f.result = 'b' and last_f.b = caller),
        'draw', last_f.result = 'draw', 'ko', last_f.ko,
        'mine', case when last_f.a = caller then last_f.a_score else last_f.b_score end,
        'theirs', case when last_f.a = caller then last_f.b_score else last_f.a_score end) end,
      'ladder', (select coalesce(jsonb_agg(jsonb_build_object('pos', l.pos, 'user_id', l.user_id, 'name', public.bout_name(l.user_id),
            'initials', pr2.initials, 'icon_id', pr2.equipped_icon_id, 'wins', p.wins, 'losses', p.losses, 'draws', p.draws,
            'kos', p.kos, 'pts', p.pts, 'is_me', l.user_id = caller, 'title', l.user_id in (g.title_a, g.title_b)) order by l.idx), '[]'::jsonb)
         from public.tb_ladder(p_challenge_id) l
         join public.tb_players p on p.challenge_id = p_challenge_id and p.user_id = l.user_id
         join public.profiles pr2 on pr2.id = l.user_id
         where l.idx <= 25 or l.user_id = caller),
      'title', case when g.title_a is null then null else jsonb_build_object(
        'a', public.tb_tape_side(p_challenge_id, g.title_a), 'b', public.tb_tape_side(p_challenge_id, g.title_b),
        'rounds', (select coalesce(jsonb_agg(jsonb_build_object('round', x.round, 'a', x.a_score, 'b', x.b_score, 'a_down', x.a_down, 'b_down', x.b_down,
              'scored', x.scored_at is not null, 'fight_id', x.id) order by x.round), '[]'::jsonb)
           from public.tb_fights x where x.challenge_id = p_challenge_id and x.title),
        'winner', g.winner, 'method', g.method, 'ko_round', g.ko_round, 'mine', in_title) end,
      'picks', case when g.title_a is null then null else jsonb_build_object(
        'open', public.tb_picks_open(g) and not in_title,
        'mine', (select k.pick from public.tb_picks k where k.challenge_id = p_challenge_id and k.user_id = caller),
        'correct', (select k.correct from public.tb_picks k where k.challenge_id = p_challenge_id and k.user_id = caller),
        'won_bones', (select k.bones from public.tb_picks k where k.challenge_id = p_challenge_id and k.user_id = caller),
        'a', (select count(*) from public.tb_picks k where k.challenge_id = p_challenge_id and k.pick = g.title_a),
        'b', (select count(*) from public.tb_picks k where k.challenge_id = p_challenge_id and k.pick = g.title_b),
        'reward', g.pick_bones) end,
      'prizes', g.prizes, 'pick_bones', g.pick_bones,
      'sponsor', case when c.sponsor_name is null then null else jsonb_build_object('name', c.sponsor_name, 'color', c.sponsor_color) end));
end;
$$;
revoke execute on function public.tb_live(uuid) from public, anon;
grant execute on function public.tb_live(uuid) to authenticated;

-- A scored fight, punch by punch, for the replay.
create or replace function public.tb_replay(p_challenge_id uuid, p_fight bigint)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  f public.tb_fights%rowtype;
begin
  select * into f from public.tb_fights where id = p_fight and challenge_id = p_challenge_id;
  if f.id is null or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller) then
    raise exception 'That fight isn''t in this Title Bout.';
  end if;
  if f.scored_at is null then
    raise exception 'That fight hasn''t been scored yet.';
  end if;
  -- Anyone can watch the title fight; a ladder fight is its fighters'.
  if not f.title and caller is distinct from f.a and caller is distinct from f.b then
    raise exception 'That fight isn''t yours.';
  end if;
  return jsonb_build_object('round', f.round,
    -- Seen from the first fighter's corner unless it's yours.
    'me', case when caller in (f.a, f.b) then caller else f.a end,
    'punches', (select coalesce(jsonb_agg(public.tb_punch_json(p) order by p.created_at, p.id), '[]'::jsonb) from public.tb_punches p where p.fight_id = f.id));
end;
$$;
revoke execute on function public.tb_replay(uuid, bigint) from public, anon;
grant execute on function public.tb_replay(uuid, bigint) to authenticated;


-- ── Paying it ──

create or replace function public.tb_pay(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.tb_games%rowtype;
  v_max int;
  v_n int;
  r record;
  v_total int;
  a_n int;
  b_n int;
  under uuid;
begin
  perform public.tb_advance(p_challenge_id);
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.tb_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or g.paid_at is not null then
    return;
  end if;
  -- Paid a day after it ends, by when day 7 is scored: it's over.
  update public.tb_games set paid_at = now(), status = 'final' where challenge_id = p_challenge_id;

  -- Places: the champion 1, the runner-up 2, then the ladder.
  with ord as (
    select l.user_id,
      row_number() over (order by case when l.user_id = g.winner then 0 when l.user_id in (g.title_a, g.title_b) then 1 else 2 end, l.idx) as place
    from public.tb_ladder(p_challenge_id) l
    join public.tb_players p on p.challenge_id = p_challenge_id and p.user_id = l.user_id
    where p.days_fought > 0
  )
  update public.tb_players p set place = o.place,
      place_bones = case
        when o.place = 1 and g.winner is not null then coalesce((g.prizes ->> 'champion')::int, 0)
        when o.place = 2 and g.winner is not null then coalesce((g.prizes ->> 'runner_up')::int, 0)
        when o.place <= 10 then coalesce((g.prizes ->> 'top10')::int, 0)
        else 0 end
    from ord o where p.challenge_id = p_challenge_id and p.user_id = o.user_id;

  select max(p.kos) into v_max from public.tb_players p where p.challenge_id = p_challenge_id;
  if coalesce(v_max, 0) > 0 then
    select count(*) into v_n from public.tb_players p where p.challenge_id = p_challenge_id and p.kos = v_max;
    update public.tb_players p set kos_bones = coalesce((g.prizes ->> 'most_kos')::int, 0) / v_n
      where p.challenge_id = p_challenge_id and p.kos = v_max;
  end if;
  update public.tb_players p set five_bones = coalesce((g.prizes ->> 'five_days')::int, 0)
    where p.challenge_id = p_challenge_id and p.days_fought >= 5;

  -- Picks: right ones earn pick_bones, double on the underdog.
  if g.winner is not null then
    select count(*) filter (where k.pick = g.title_a), count(*) filter (where k.pick = g.title_b) into a_n, b_n
      from public.tb_picks k where k.challenge_id = p_challenge_id;
    under := case when a_n < b_n then g.title_a when b_n < a_n then g.title_b end;
    update public.tb_picks k set correct = (k.pick = g.winner),
        bones = case when k.pick = g.winner then g.pick_bones * case when k.pick = under then 2 else 1 end else 0 end
      where k.challenge_id = p_challenge_id;
  end if;

  for r in
    select u.user_id,
      coalesce(p.place_bones, 0) + coalesce(p.kos_bones, 0) + coalesce(p.five_bones, 0) as prize,
      coalesce(k.bones, 0) as pick, p.place, k.correct
    from (select x.user_id from public.tb_players x where x.challenge_id = p_challenge_id
          union select k2.user_id from public.tb_picks k2 where k2.challenge_id = p_challenge_id) u
    left join public.tb_players p on p.challenge_id = p_challenge_id and p.user_id = u.user_id
    left join public.tb_picks k on k.challenge_id = p_challenge_id and k.user_id = u.user_id
  loop
    v_total := r.prize + r.pick;
    if v_total > 0 then
      update public.profiles x set bones_balance = x.bones_balance + v_total, bones_earned_total = x.bones_earned_total + v_total
        where x.id = r.user_id;
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
        values (r.user_id, p_challenge_id, 'global_place', 0, 0, v_total);
    end if;
    perform public.tb_notify(p_challenge_id, r.user_id, c.name,
      'The Title Bout''s over' || case when r.place is not null then ': you finished #' || r.place else '' end
      || case when r.correct then ', and you picked the champion' when r.correct = false then '; your pick didn’t win' else '' end
      || case when v_total > 0 then '. You won ' || v_total || ' Bones.' else '.' end);
  end loop;
end;
$$;
revoke execute on function public.tb_pay(uuid) from public, anon, authenticated;

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
  -- 0211: the Derby pays its own prizes.
  if c.kind::text = 'derby' then
    perform public.derby_pay(p_challenge_id);
    return;
  end if;
  -- 0221: so does the Shootout.
  if c.kind::text = 'shootout' then
    perform public.shootout_pay(p_challenge_id);
    return;
  end if;
  -- 0227: and the Title Bout (places, KOs, five days, and the picks).
  if c.kind::text = 'titlebout' then
    perform public.tb_pay(p_challenge_id);
    return;
  end if;
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


-- ── Admin → Overview → Games → Title Bout ──

create or replace function public.admin_titlebout_overview()
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
    'live', (select count(*) from public.tb_games g where g.status = 'active'),
    'all', (select count(*) from public.tb_games),
    'joined', (select count(*) from public.tb_players),
    'fought_ever', (select count(*) from public.tb_players p where p.days_fought > 0),
    'fought_7d', (select count(distinct p.user_id) from public.tb_punches p where p.created_at > now() - interval '7 days'),
    'fights_7d', (select count(*) from public.tb_fights f where f.scored_at > now() - interval '7 days' and f.result <> 'none'),
    'kos_7d', (select count(*) from public.tb_fights f where f.scored_at > now() - interval '7 days' and f.ko),
    'sparring_7d', (select count(*) from public.tb_fights f where f.scored_at > now() - interval '7 days' and f.b is null),
    'punches_7d', (select count(*) from public.tb_punches p where p.created_at > now() - interval '7 days'),
    'came_back', (select round(100.0 * count(*) filter (where p.days_fought >= 3) / nullif(count(*) filter (where p.days_fought >= 1), 0))
                  from public.tb_players p),
    'five_days', (select count(*) from public.tb_players p where p.days_fought >= 5),
    'picks', (select count(*) from public.tb_picks),
    'picks_right', (select count(*) from public.tb_picks k where k.correct),
    'champions', (select coalesce(jsonb_agg(jsonb_build_object('name', public.bout_name(g.winner), 'method', g.method, 'challenge', c.name)
                    order by g.created_at desc), '[]'::jsonb)
                  from public.tb_games g join public.challenges c on c.id = g.challenge_id where g.winner is not null));
end;
$$;
revoke execute on function public.admin_titlebout_overview() from public, anon;
grant execute on function public.admin_titlebout_overview() to authenticated;
