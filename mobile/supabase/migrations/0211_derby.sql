-- Hound: the Home Run Derby — a Global Hound Challenge (0210 adds the
-- kind). Approved mockup: claude.ai/artifact/NxbY81Wiu37VUnVDWri8b5.
--
-- Everyone in one derby for a week (3 to 30 days), joining until the
-- challenge's join_closes_at (3 days in, like the Hound Open). Built like
-- the Open (0202, 0203): publish_global_challenge takes 'derby',
-- derby_setup_global (admins) sets the prizes and the sponsor's sign,
-- derby_board reads the leaderboard (top 25, friends, your club), and
-- pay_global_places pays it at the end.
--
--   swings      least(20, steps today / 1,000) a day, less pitches thrown
--               today; nothing carries over. Steps today are the caller's
--               synced row for their local day (soccer_today).
--   the pitch   every pitch a meatball in the zone. Speed by the stage of
--               the derby: the first third of its days 70 mph (820 ms to
--               the plate), the middle third 75 (760 ms), the last third
--               80 (700 ms); 7 days = days 1-2 / 3-5 / 6-7. The timing
--               bands below shrink by f = 1.0 / 0.85 / 0.70.
--   the swing   a = |timing| (ms from the ball reaching the zone). No
--               swing is an out. a <= 70f is contact; 70f < a <= 120f a
--               long fly ball caught at the wall (the mockup's "slightly
--               early or late"); past 120f a whiff. Base feet: a <= 10f
--               435, <= 20f 425, <= 30f 410, <= 45f 390, <= 70f 360;
--               + 10 ft per 5,000 steps today (up to + 40); + a strength
--               workout today (sport_day_bonus 'baseball' strength 1:
--               + 15, 2 or more: + 25); - round(a / f x 0.2). At most 500.
--               Direction: timing < -15f pulled (left), > 15f to right,
--               else center. Fence: a <= 20f 410 (center), <= 45f 375
--               (the gaps), else 330 (down the lines). Clear it: a home
--               run; else caught at the wall.
--   moonshot    475 ft or more counts as 2 home runs.
--   golden      one of your first 10 pitches a day (seeded, uniformly
--               1..10) is golden; a second is due once you've passed
--               15,000 steps today: seeded within the 10 pitches from the
--               first one thrown past 15K, never the first's pitch. Two a
--               day at most. A home run off one counts double (+2; a
--               golden Moonshot +4).
--   the sign    when the challenge has a sponsor and sign_bones: a center
--               home run (a <= 20f) of 410-445 ft hits the sign 35% of the
--               time (seeded); each hit pays sign_bones (25) at the end,
--               at most sign_cap (5) hits a person.
--   score       home runs (Moonshots and golden balls as above); ties by
--               the longest home run, then whoever hit it first.
--   prizes      (derby_setup_global; defaults) 1st 500, 2nd 300, 3rd 200,
--               4th-10th 100 (a tie shares the places it covers, split
--               evenly), the longest home run 150 (ties split), 10+ home
--               runs 25 each, plus sign Bones. Paid by pay_global_places
--               after settlement (the settlement's participation event
--               stands; places are the prize, so no win Bones).
--   pushes      a one-time "you're into the top 10" once 20+ have swung
--               (as the Open), and at the end your place and Bones.
--               Through send-golf-notification's new 'derby' kind.
--
-- Run this once, after 0210 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification for the pushes.

-- ── Tables ──

create table public.derby_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  prizes jsonb not null default '{"places":[500,300,200],"top10":100,"longest":150,"ten_hr":25}'::jsonb,
  sign_bones integer not null default 25 check (sign_bones between 0 and 100),
  sign_cap integer not null default 5 check (sign_cap between 0 and 50),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.derby_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_day date not null,
  hrs integer not null default 0,
  longest_ft integer,
  longest_at timestamptz,
  moonshots integer not null default 0,
  goldens_hit integer not null default 0,
  sign_hits integer not null default 0,
  swings integer not null default 0,
  pos_mark integer,
  pos_mark_day date,
  top10_at timestamptz,
  -- What the end paid, for the results screen.
  place integer,
  place_bones integer not null default 0,
  longest_bones integer not null default 0,
  ten_bones integer not null default 0,
  sign_bones_paid integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index derby_players_rank on public.derby_players (challenge_id, hrs desc, longest_ft desc);

create table public.derby_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  golden1 integer not null,
  golden2 integer,
  primary key (challenge_id, user_id, day)
);

-- Every pitch; a pending one has no result yet.
create table public.derby_swings (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  n integer not null,
  golden boolean not null default false,
  stage integer not null,
  mph integer not null,
  factor numeric(4, 2) not null,
  ms integer not null,
  thrown_at timestamptz not null default now(),
  timing integer,
  result text check (result in ('hr', 'fly_out', 'whiff', 'take')),
  ft integer,
  dir text check (dir in ('left', 'center', 'right')),
  moonshot boolean not null default false,
  sign boolean not null default false,
  sign_paid boolean not null default false,
  counts integer not null default 0,
  swung_at timestamptz,
  unique (challenge_id, user_id, day, n)
);
create index derby_swings_day on public.derby_swings (challenge_id, day);
create index derby_swings_user on public.derby_swings (user_id, swung_at desc);

alter table public.derby_games enable row level security;
alter table public.derby_players enable row level security;
alter table public.derby_days enable row level security;
alter table public.derby_swings enable row level security;
revoke all on public.derby_games, public.derby_players, public.derby_days, public.derby_swings from anon;
revoke insert, update, delete on public.derby_games, public.derby_players, public.derby_days, public.derby_swings from authenticated;
create policy "Players see their own Derby" on public.derby_players for select to authenticated using (user_id = auth.uid());
create policy "Players see their own Derby days" on public.derby_days for select to authenticated using (user_id = auth.uid());
create policy "Players see their own swings" on public.derby_swings for select to authenticated using (user_id = auth.uid());
create policy "Players see their Derby's settings" on public.derby_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = derby_games.challenge_id and cp.user_id = auth.uid()));

-- ── Small helpers ──

create or replace function public.derby_rand(p_seed text)
returns double precision
language sql
immutable
as $$
  select public.rally_js_rand(public.rally_js_hash(p_seed));
$$;
revoke execute on function public.derby_rand(text) from public, anon, authenticated;

-- The stage of a derby day: 1, 2 or 3 (thirds of its days).
create or replace function public.derby_stage(p_days int, p_day_no int)
returns integer
language sql
immutable
as $$
  select case
    when p_day_no <= floor(p_days / 3.0) then 1
    when p_day_no > p_days - floor(p_days / 3.0) then 3
    else 2 end;
$$;

create or replace function public.derby_mph(p_stage int)
returns integer language sql immutable as $$ select case p_stage when 1 then 70 when 2 then 75 else 80 end; $$;
create or replace function public.derby_factor(p_stage int)
returns numeric language sql immutable as $$ select case p_stage when 1 then 1.0 when 2 then 0.85 else 0.70 end::numeric; $$;
create or replace function public.derby_ms(p_stage int)
returns integer language sql immutable as $$ select case p_stage when 1 then 820 when 2 then 760 else 700 end; $$;

-- The swing itself, as numbers (also for the tests): base feet, fence,
-- direction. a and timing in ms, f the stage's factor.
create or replace function public.derby_base_ft(a numeric, f numeric)
returns integer
language sql
immutable
as $$
  select case
    when a > 70 * f then null
    when a <= 10 * f then 435
    when a <= 20 * f then 425
    when a <= 30 * f then 410
    when a <= 45 * f then 390
    else 360 end;
$$;

create or replace function public.derby_fence(a numeric, f numeric)
returns integer
language sql
immutable
as $$
  select case when a <= 20 * f then 410 when a <= 45 * f then 375 else 330 end;
$$;

create or replace function public.derby_dir(t numeric, f numeric)
returns text
language sql
immutable
as $$
  select case when t < -15 * f then 'left' when t > 15 * f then 'right' else 'center' end;
$$;

create or replace function public.derby_steps_ft(p_steps int)
returns integer language sql immutable as $$ select least(40, (greatest(coalesce(p_steps, 0), 0) / 5000) * 10); $$;

create or replace function public.derby_workout_ft(p_strength int)
returns integer language sql immutable as $$ select case when coalesce(p_strength, 0) >= 2 then 25 when p_strength = 1 then 15 else 0 end; $$;

revoke execute on function public.derby_stage(int, int) from public, anon, authenticated;
revoke execute on function public.derby_mph(int) from public, anon, authenticated;
revoke execute on function public.derby_factor(int) from public, anon, authenticated;
revoke execute on function public.derby_ms(int) from public, anon, authenticated;
revoke execute on function public.derby_base_ft(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.derby_fence(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.derby_dir(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.derby_steps_ft(int) from public, anon, authenticated;
revoke execute on function public.derby_workout_ft(int) from public, anon, authenticated;

-- Your steps today in a derby (your synced row for your local day).
create or replace function public.derby_steps_today(p_challenge_id uuid, p_user uuid, p_day date)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select ps.steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_user and ps.day = p_day), 0)::int;
$$;
revoke execute on function public.derby_steps_today(uuid, uuid, date) from public, anon, authenticated;

-- Where everyone who's swung stands: home runs, then the longest, then
-- whoever hit it first. pos ties only on all three; idx is unique.
create or replace function public.derby_positions(p_challenge_id uuid)
returns table (user_id uuid, pos integer, idx integer, hrs integer, longest_ft integer)
language sql
stable
security definer set search_path = public
as $$
  select p.user_id,
    (rank() over (order by p.hrs desc, p.longest_ft desc nulls last, p.longest_at asc nulls last))::int,
    (row_number() over (order by p.hrs desc, p.longest_ft desc nulls last, p.longest_at asc nulls last, p.user_id))::int,
    p.hrs, p.longest_ft
  from public.derby_players p
  where p.challenge_id = p_challenge_id and p.swings > 0;
$$;
revoke execute on function public.derby_positions(uuid) from public, anon, authenticated;

create or replace function public.derby_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('derby', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.derby_notify(uuid, uuid, text, text) from public, anon, authenticated;


-- ── Publishing: 0202's, with the Derby ──

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
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf or the Home Run Derby.';
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

-- Right after publishing, an admin sets the prizes and the sponsor's sign.
-- p_prizes: {"places":[1st,2nd,3rd],"top10":n,"longest":n,"ten_hr":n};
-- null = the defaults.
create or replace function public.derby_setup_global(
  p_challenge_id uuid, p_prizes jsonb default null, p_sign_bones int default 25, p_sign_cap int default 5
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  pz jsonb := coalesce(p_prizes, '{"places":[500,300,200],"top10":100,"longest":150,"ten_hr":25}'::jsonb);
  v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can set up the Home Run Derby.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'derby' or not c.is_global then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  if exists (select 1 from public.derby_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This Derby is already set up.';
  end if;
  if jsonb_typeof(pz -> 'places') is distinct from 'array' or jsonb_array_length(pz -> 'places') <> 3 then
    raise exception 'Prizes need Bones for 1st, 2nd and 3rd.';
  end if;
  for v in select x from jsonb_array_elements(pz -> 'places') x
    union all select pz -> 'top10' union all select pz -> 'longest' union all select pz -> 'ten_hr' loop
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 5000 then
      raise exception 'Each prize is 0 to 5,000 Bones.';
    end if;
  end loop;
  if p_sign_bones is null or p_sign_bones not between 0 and 100 then
    raise exception 'The sign''s Bones are 0 to 100.';
  end if;
  if p_sign_cap is null or p_sign_cap not between 0 and 50 then
    raise exception 'Sign hits paid are 0 to 50 a person.';
  end if;
  insert into public.derby_games (challenge_id, prizes, sign_bones, sign_cap)
    values (p_challenge_id, pz, p_sign_bones, p_sign_cap);
end;
$$;
revoke execute on function public.derby_setup_global(uuid, jsonb, int, int) from public, anon;
grant execute on function public.derby_setup_global(uuid, jsonb, int, int) to authenticated;


-- ── Joining: set up first; your swings count from the day you join ──

create or replace function public.derby_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'derby')
     and not exists (select 1 from public.derby_games g where g.challenge_id = new.challenge_id) then
    raise exception 'This Derby isn''t set up yet.';
  end if;
  return new;
end;
$$;
revoke execute on function public.derby_before_join() from public, anon, authenticated;

create trigger derby_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.derby_before_join();

create or replace function public.derby_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if c.kind::text = 'derby' then
    insert into public.derby_players (challenge_id, user_id, joined_day)
      values (new.challenge_id, new.user_id, greatest(public.soccer_first_day(c), public.soccer_today(new.user_id)))
      on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.derby_after_join() from public, anon, authenticated;

create trigger derby_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.derby_after_join();


-- ── The state of play for the caller ──

-- Why you can't pitch now (null = you can), with the numbers it needs.
create or replace function public.derby_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  today date;
  first_day date;
  steps int;
  earned int;
  thrown int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not exists (select 1 from public.derby_players p where p.challenge_id = p_challenge_id and p.user_id = p_user) then
    return 'Join the Derby to swing.';
  end if;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  if now() < c.starts_at or today < first_day then
    return 'The Derby hasn''t started yet.';
  end if;
  if now() >= c.ends_at or today > first_day + c.duration_days - 1 then
    return 'The Derby is over.';
  end if;
  steps := public.derby_steps_today(p_challenge_id, p_user, today);
  earned := least(20, steps / 1000);
  select count(*) into thrown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = p_user and s.day = today;
  if thrown >= 20 then
    return 'That''s 20 swings today. Back tomorrow.';
  end if;
  if thrown >= earned then
    return 'No swings ready: your next comes at ' || to_char((thrown + 1) * 1000, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.derby_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.derby_swing_json(s public.derby_swings)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('n', s.n, 'day', s.day, 'golden', s.golden, 'mph', s.mph, 'result', s.result, 'ft', s.ft,
    'dir', s.dir, 'moonshot', s.moonshot, 'sign', s.sign, 'counts', s.counts, 'timing', s.timing);
$$;

create or replace function public.derby_bands(f numeric)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('dead_on', round(10 * f), 'center', round(20 * f), 'gaps', round(45 * f), 'contact', round(70 * f),
    'warning_track', round(120 * f));
$$;

revoke execute on function public.derby_swing_json(public.derby_swings) from public, anon, authenticated;
revoke execute on function public.derby_bands(numeric) from public, anon, authenticated;

create or replace function public.derby_live(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  p public.derby_players%rowtype;
  d public.derby_days%rowtype;
  pend public.derby_swings%rowtype;
  today date;
  first_day date;
  day_no int;
  stage int;
  steps int;
  earned int;
  thrown int;
  strength int;
  v_rank int;
  v_shown int;
  v_reason text;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' or g.challenge_id is null then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller;
  today := public.soccer_today(caller);
  first_day := public.soccer_first_day(c);
  day_no := greatest(1, least(c.duration_days, today - first_day + 1));
  stage := public.derby_stage(c.duration_days, day_no);
  steps := public.derby_steps_today(p_challenge_id, caller, today);
  earned := least(20, steps / 1000);
  select count(*) into thrown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today;
  select * into pend from public.derby_swings s
    where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is null
    order by s.id desc limit 1;
  select b.strength into strength from public.sport_day_bonus(caller, today, 'baseball') b;
  select * into d from public.derby_days x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = today;
  select count(*) into v_shown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today and s.golden;
  select x.pos into v_rank from public.derby_positions(p_challenge_id) x where x.user_id = caller;
  v_reason := case when pend.id is not null then null else public.derby_reason(p_challenge_id, caller) end;

  return jsonb_build_object(
    'day', today, 'day_no', day_no, 'days', c.duration_days, 'stage', stage,
    'mph', public.derby_mph(stage), 'factor', public.derby_factor(stage), 'ms', public.derby_ms(stage),
    'bands', public.derby_bands(public.derby_factor(stage)),
    'steps', steps, 'swings_earned', earned, 'swings_taken', thrown,
    'swings_left', greatest(0, least(earned, 20) - thrown),
    'next_swing_at', case when earned >= 20 then null else (earned + 1) * 1000 end,
    'cap', 20,
    'goldens', jsonb_build_object(
      'shown', v_shown,
      -- A golden ball still to come today (not which pitch).
      'due_next', d.day is null or (d.golden1 > thrown) or (d.golden2 is not null and d.golden2 > thrown),
      'second_unlocks_at', 15000,
      'second_unlocked', steps >= 15000),
    'power', jsonb_build_object('steps_ft', public.derby_steps_ft(steps), 'workout_ft', public.derby_workout_ft(strength)),
    'pending', case when pend.id is null then null else jsonb_build_object(
      'n', pend.n, 'golden', pend.golden, 'mph', pend.mph, 'ms', pend.ms, 'bands', public.derby_bands(pend.factor)) end,
    'joined', p.user_id is not null,
    'me', case when p.user_id is null then null else jsonb_build_object(
      'hrs', p.hrs, 'longest_ft', p.longest_ft, 'rank', v_rank, 'moonshots', p.moonshots,
      'goldens_hit', p.goldens_hit, 'sign_hits', p.sign_hits, 'swings', p.swings) end,
    'field', (select count(*) from public.derby_players x where x.challenge_id = p_challenge_id),
    'recent', (select coalesce(jsonb_agg(public.derby_swing_json(s) order by s.id desc), '[]'::jsonb) from (
      select * from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is not null
      order by s.id desc limit 8) s),
    'sponsor', case when c.sponsor_name is null then null else jsonb_build_object(
      'name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color,
      'sign_bones', g.sign_bones, 'sign_cap', g.sign_cap, 'sign_hits', coalesce(p.sign_hits, 0)) end,
    'can_swing', pend.id is not null or v_reason is null,
    'reason', v_reason);
end;
$$;
revoke execute on function public.derby_live(uuid) from public, anon;
grant execute on function public.derby_live(uuid) to authenticated;


-- ── A pitch ──

create or replace function public.derby_pitch(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  p public.derby_players%rowtype;
  d public.derby_days%rowtype;
  pend public.derby_swings%rowtype;
  today date;
  day_no int;
  stage int;
  steps int;
  thrown int;
  n int;
  v_reason text;
  v_pos int;
  is_golden boolean;
  seed text;
  g2 int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller for update;
  -- A pitch thrown and not swung at comes back as it was.
  select * into pend from public.derby_swings s
    where s.challenge_id = p_challenge_id and s.user_id = caller and s.result is null
    order by s.id desc limit 1;
  if pend.id is not null then
    return jsonb_build_object('n', pend.n, 'golden', pend.golden, 'mph', pend.mph, 'ms', pend.ms,
      'bands', public.derby_bands(pend.factor), 'swings_left',
      greatest(0, least(20, public.derby_steps_today(p_challenge_id, caller, pend.day) / 1000)
        - (select count(*) from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = pend.day)));
  end if;
  v_reason := public.derby_reason(p_challenge_id, caller);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  today := public.soccer_today(caller);
  day_no := today - public.soccer_first_day(c) + 1;
  stage := public.derby_stage(c.duration_days, day_no);
  steps := public.derby_steps_today(p_challenge_id, caller, today);
  seed := p_challenge_id::text || ':' || caller::text || ':' || today::text;

  select * into d from public.derby_days x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = today for update;
  if d.day is null then
    insert into public.derby_days (challenge_id, user_id, day, golden1)
      values (p_challenge_id, caller, today, 1 + floor(public.derby_rand(seed || ':golden1') * 10)::int)
      returning * into d;
    -- Where you stood when today's first pitch came, for "moved today".
    select x.pos into v_pos from public.derby_positions(p_challenge_id) x where x.user_id = caller;
    update public.derby_players set pos_mark = v_pos, pos_mark_day = today
      where challenge_id = p_challenge_id and user_id = caller;
  end if;
  select count(*) into thrown from public.derby_swings s where s.challenge_id = p_challenge_id and s.user_id = caller and s.day = today;
  n := thrown + 1;

  -- The second golden ball: due once you've passed 15,000 steps, within
  -- the 10 pitches from the first one thrown past 15K.
  if d.golden2 is null and steps >= 15000 then
    g2 := n + floor(public.derby_rand(seed || ':golden2') * 10)::int;
    if g2 = d.golden1 then
      g2 := g2 + 1;
    end if;
    update public.derby_days set golden2 = g2 where challenge_id = p_challenge_id and user_id = caller and day = today;
    d.golden2 := g2;
  end if;
  is_golden := n = d.golden1 or n = coalesce(d.golden2, 0);

  insert into public.derby_swings (challenge_id, user_id, day, n, golden, stage, mph, factor, ms)
    values (p_challenge_id, caller, today, n, is_golden, stage, public.derby_mph(stage), public.derby_factor(stage), public.derby_ms(stage))
    returning * into pend;

  return jsonb_build_object('n', n, 'golden', is_golden, 'mph', pend.mph, 'ms', pend.ms,
    'bands', public.derby_bands(pend.factor),
    'swings_left', greatest(0, least(20, steps / 1000) - n));
end;
$$;
revoke execute on function public.derby_pitch(uuid) from public, anon;
grant execute on function public.derby_pitch(uuid) to authenticated;


-- ── A swing ──

create or replace function public.derby_swing(p_challenge_id uuid, p_timing_ms integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  p public.derby_players%rowtype;
  s public.derby_swings%rowtype;
  f numeric;
  a numeric;
  t integer;
  base int;
  steps int;
  strength int;
  v_steps_ft int;
  v_workout_ft int;
  v_ft int;
  v_dir text;
  v_result text;
  v_moon boolean := false;
  v_sign boolean := false;
  v_sign_paid boolean := false;
  v_counts int := 0;
  v_msg text;
  v_rank int;
  v_swung int;
  v_left int;
  v_hrs int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'derby' or g.challenge_id is null then
    raise exception 'That isn''t a Home Run Derby.';
  end if;
  select * into p from public.derby_players x where x.challenge_id = p_challenge_id and x.user_id = caller for update;
  if p.user_id is null then
    raise exception 'Join the Derby to swing.';
  end if;
  select * into s from public.derby_swings x
    where x.challenge_id = p_challenge_id and x.user_id = caller and x.result is null
    order by x.id desc limit 1 for update;
  if s.id is null then
    raise exception 'Pitch first.';
  end if;

  f := s.factor;
  t := case when p_timing_ms is null then null else greatest(-2000, least(2000, p_timing_ms)) end;
  steps := public.derby_steps_today(p_challenge_id, caller, s.day);
  select b.strength into strength from public.sport_day_bonus(caller, s.day, 'baseball') b;
  v_steps_ft := public.derby_steps_ft(steps);
  v_workout_ft := public.derby_workout_ft(strength);

  if t is null then
    v_result := 'take';
    v_msg := 'You have to swing in a derby. That one''s an out.';
  else
    a := abs(t);
    base := public.derby_base_ft(a, f);
    if base is null and a > 120 * f then
      v_result := 'whiff';
      v_msg := 'Swing and a miss: way ' || case when t < 0 then 'early' else 'late' end || '.';
    elsif base is null then
      -- A long fly ball off the end of the bat: caught at the wall.
      v_result := 'fly_out';
      v_ft := round(340 - (a / f - 70))::int;
      v_dir := public.derby_dir(t, f);
      v_msg := 'Caught at the wall: a little ' || case when t < 0 then 'early' else 'late' end || '.';
    else
      v_ft := least(500, base + v_steps_ft + v_workout_ft - round(a / f * 0.2)::int);
      v_dir := public.derby_dir(t, f);
      if v_ft >= public.derby_fence(a, f) then
        v_result := 'hr';
        v_moon := v_ft >= 475;
        v_counts := (case when v_moon then 2 else 1 end) * (case when s.golden then 2 else 1 end);
        if c.sponsor_name is not null and g.sign_bones > 0 and a <= 20 * f and v_ft between 410 and 445
           and public.derby_rand(p_challenge_id::text || ':' || caller::text || ':' || s.day::text || ':' || s.n || ':sign') < 0.35 then
          v_sign := true;
          v_sign_paid := p.sign_hits < g.sign_cap;
        end if;
        v_msg := case
          when s.golden then 'Golden ball, out of the park: it counts as ' || v_counts || ' home runs.'
          when v_moon then 'Moonshot! ' || v_ft || ' ft: that counts as two.'
          when v_sign and v_sign_paid then 'Off the sign! +' || g.sign_bones || ' Bones from ' || c.sponsor_name || '.'
          when v_sign then 'Off the sign! ' || v_ft || ' ft.'
          when a <= 10 * f and v_workout_ft > 0 then 'Gone! ' || v_ft || ' ft. Barreled: your workout added ' || v_workout_ft || ' feet.'
          else 'Gone! ' || v_ft || ' ft.' end;
      else
        v_result := 'fly_out';
        v_msg := 'Caught at the wall: a little ' || case when t < 0 then 'early' else 'late' end || '.';
      end if;
    end if;
  end if;

  update public.derby_swings set timing = t, result = v_result, ft = v_ft, dir = v_dir, moonshot = v_moon,
      sign = v_sign, sign_paid = v_sign_paid, counts = v_counts, swung_at = now()
    where id = s.id;
  update public.derby_players set
      swings = swings + 1,
      hrs = hrs + v_counts,
      moonshots = moonshots + case when v_moon then 1 else 0 end,
      goldens_hit = goldens_hit + case when s.golden and v_result = 'hr' then 1 else 0 end,
      sign_hits = sign_hits + case when v_sign then 1 else 0 end,
      longest_ft = case when v_result = 'hr' and (longest_ft is null or v_ft > longest_ft) then v_ft else longest_ft end,
      longest_at = case when v_result = 'hr' and (longest_ft is null or v_ft > longest_ft) then now() else longest_at end
    where challenge_id = p_challenge_id and user_id = caller
    returning * into p;

  select x.pos into v_rank from public.derby_positions(p_challenge_id) x where x.user_id = caller;
  select count(*) into v_swung from public.derby_positions(p_challenge_id);
  -- The top 10, once the field's big enough to mean something.
  if v_swung >= 20 and v_rank <= 10 and p.top10_at is null then
    update public.derby_players set top10_at = now() where challenge_id = p_challenge_id and user_id = caller;
    perform public.derby_notify(p_challenge_id, caller, c.name,
      'You''re into the top 10: #' || v_rank || ' with ' || p.hrs || ' home runs. Keep swinging.');
  end if;
  select greatest(0, least(20, steps / 1000) - count(*))::int into v_left
    from public.derby_swings x where x.challenge_id = p_challenge_id and x.user_id = caller and x.day = s.day;

  return jsonb_build_object(
    'result', v_result, 'ft', v_ft, 'dir', v_dir, 'moonshot', v_moon, 'golden', s.golden,
    'sign', v_sign, 'sign_paid', v_sign_paid, 'counts', v_counts,
    'hrs', p.hrs, 'longest_ft', p.longest_ft, 'rank', v_rank, 'swings_left', v_left,
    'power', jsonb_build_object('steps_ft', v_steps_ft, 'workout_ft', v_workout_ft),
    'message', v_msg);
end;
$$;
revoke execute on function public.derby_swing(uuid, integer) from public, anon;
grant execute on function public.derby_swing(uuid, integer) to authenticated;


-- ── The leaderboard ──

create or replace function public.derby_board(p_challenge_id uuid, p_tab text default 'top')
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  me_row public.derby_players%rowtype;
  mine record;
  today date;
  v_status text;
  v_field int;
  v_swung int;
  v_club uuid;
  v_club_json jsonb;
  v_rows jsonb;
  v_more int;
  v_me jsonb;
  v_today jsonb;
  v_week jsonb;
  v_podium jsonb;
  v_longest jsonb;
  v_mine_paid jsonb;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null or c.kind::text <> 'derby' then
    raise exception 'not authorized';
  end if;
  if p_tab is null or p_tab not in ('top', 'friends', 'club') then
    raise exception 'Pick Top, Friends or My club.';
  end if;
  today := public.soccer_today(caller);
  v_status := case when now() >= c.ends_at or today > public.soccer_first_day(c) + c.duration_days - 1 then 'final'
                   when now() < c.starts_at or today < public.soccer_first_day(c) then 'upcoming' else 'live' end;
  select count(*) into v_field from public.derby_players p where p.challenge_id = p_challenge_id;
  select count(*) into v_swung from public.derby_positions(p_challenge_id);

  select * into me_row from public.derby_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if me_row.user_id is not null then
    select x.* into mine from public.derby_positions(p_challenge_id) x where x.user_id = caller;
    v_me := jsonb_build_object(
      'pos', mine.pos, 'hrs', me_row.hrs, 'longest_ft', me_row.longest_ft, 'moonshots', me_row.moonshots,
      'goldens_hit', me_row.goldens_hit, 'sign_hits', me_row.sign_hits, 'swings', me_row.swings,
      'moved', case when mine.pos is not null and me_row.pos_mark is not null and me_row.pos_mark_day = today
                    then me_row.pos_mark - mine.pos end);
  end if;

  -- My club: the one with the most members in this derby, then the oldest.
  select cl.id into v_club
  from public.club_members cm
  join public.clubs cl on cl.id = cm.club_id and cl.removed_at is null
  where cm.user_id = caller
  order by (select count(*) from public.club_members m2
            join public.derby_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id
            where m2.club_id = cl.id) desc, cl.created_at, cl.id
  limit 1;
  if v_club is not null then
    select jsonb_build_object('id', cl.id, 'name', cl.name, 'playing', (
        select count(*) from public.club_members m2
        join public.derby_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id
        where m2.club_id = cl.id))
      into v_club_json from public.clubs cl where cl.id = v_club;
  end if;

  with ord as (select * from public.derby_positions(p_challenge_id)),
  base as (
    select p.user_id, p.hrs, p.longest_ft, p.moonshots, o.pos, o.idx
    from public.derby_players p
    left join ord o on o.user_id = p.user_id
    where p.challenge_id = p_challenge_id
      and case p_tab
        when 'top' then o.idx <= 25 or p.user_id = caller
        when 'friends' then p.user_id = caller or public.golf_are_friends(p.user_id, caller)
        else p.user_id = caller or (v_club is not null and exists (
          select 1 from public.club_members m where m.club_id = v_club and m.user_id = p.user_id))
      end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'pos', b.pos, 'user_id', b.user_id, 'name', public.golf_name(b.user_id), 'initials', pr.initials,
      'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
      'hrs', b.hrs, 'longest_ft', b.longest_ft, 'moonshots', b.moonshots,
      'is_me', b.user_id = caller,
      'is_friend', b.user_id <> caller and public.golf_are_friends(b.user_id, caller),
      'in_club', v_club is not null and exists (select 1 from public.club_members m where m.club_id = v_club and m.user_id = b.user_id))
    order by b.idx nulls last, public.golf_name(b.user_id)), '[]'::jsonb)
    into v_rows
  from base b join public.profiles pr on pr.id = b.user_id;

  if p_tab = 'top' and v_swung > 25 and (mine.idx is null or mine.idx > 26) then
    select count(*) into v_more from public.derby_positions(p_challenge_id) o
      where o.idx > 25 and (mine.idx is null or o.idx < mine.idx);
  end if;

  select jsonb_build_object('user_id', s.user_id, 'name', public.golf_name(s.user_id), 'ft', s.ft) into v_today
  from public.derby_swings s
  where s.challenge_id = p_challenge_id and s.result = 'hr' and s.day = today
  order by s.ft desc, s.swung_at limit 1;
  select jsonb_build_object('user_id', p.user_id, 'name', public.golf_name(p.user_id), 'ft', p.longest_ft) into v_week
  from public.derby_players p
  where p.challenge_id = p_challenge_id and p.longest_ft is not null
  order by p.longest_ft desc, p.longest_at limit 1;

  if v_status = 'final' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'place', x.pos, 'user_id', x.user_id, 'name', public.golf_name(x.user_id), 'initials', pr.initials,
        'icon_id', pr.equipped_icon_id, 'hrs', x.hrs, 'longest_ft', x.longest_ft,
        'bones', coalesce(p.place_bones, 0))
      order by x.idx), '[]'::jsonb)
      into v_podium
    from public.derby_positions(p_challenge_id) x
    join public.profiles pr on pr.id = x.user_id
    join public.derby_players p on p.challenge_id = p_challenge_id and p.user_id = x.user_id
    where x.pos <= 3 and x.hrs > 0;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.golf_name(p.user_id),
        'ft', p.longest_ft, 'bones', p.longest_bones) order by p.longest_at), '[]'::jsonb)
      into v_longest
    from public.derby_players p
    where p.challenge_id = p_challenge_id and p.longest_ft is not null
      and p.longest_ft = (select max(q.longest_ft) from public.derby_players q where q.challenge_id = p_challenge_id);
    if me_row.user_id is not null then
      v_mine_paid := jsonb_build_object('paid', g.paid_at is not null, 'place', me_row.place,
        'place_bones', me_row.place_bones, 'longest_bones', me_row.longest_bones, 'ten_bones', me_row.ten_bones,
        'sign_bones', me_row.sign_bones_paid,
        'total', me_row.place_bones + me_row.longest_bones + me_row.ten_bones + me_row.sign_bones_paid);
    end if;
  end if;

  return jsonb_build_object(
    'field', v_field, 'swung', v_swung, 'status', v_status,
    'ends_at', c.ends_at, 'join_closes_at', c.join_closes_at, 'days', c.duration_days,
    'day_no', greatest(1, least(c.duration_days, today - public.soccer_first_day(c) + 1)),
    'joined', me_row.user_id is not null,
    'me', v_me, 'rows', v_rows, 'more', v_more, 'club', v_club_json,
    'prizes', g.prizes, 'sign_bones', g.sign_bones, 'sign_cap', g.sign_cap,
    'sponsor', case when c.sponsor_name is null then null else jsonb_build_object(
      'name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color) end,
    'today_longest', v_today, 'week_longest', v_week,
    'sign_hits', (select count(*) from public.derby_swings s where s.challenge_id = p_challenge_id and s.sign),
    'home_runs', (select coalesce(sum(p.hrs), 0) from public.derby_players p where p.challenge_id = p_challenge_id),
    'podium', v_podium, 'longest_winner', v_longest, 'my_bones', v_mine_paid);
end;
$$;
revoke execute on function public.derby_board(uuid, text) from public, anon;
grant execute on function public.derby_board(uuid, text) to authenticated;


-- ── Paying it: 0202's pay_global_places, with the Derby ──

-- The Derby's prizes for whoever swung: places 1-3 and 4-10 (a tie
-- shares the places it covers, split evenly), the longest home run (ties
-- split), 10+ home runs, and the sign hits up to the cap.
create or replace function public.derby_pay(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.derby_games%rowtype;
  v_long int;
  v_long_n int;
  r record;
  v_total int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.derby_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or g.paid_at is not null then
    return;
  end if;
  update public.derby_games set paid_at = now() where challenge_id = p_challenge_id;

  -- Places: rank by the score; tied rows share the places they cover.
  with placed as (
    select x.user_id, x.pos, count(*) over (partition by x.pos) as n
    from public.derby_positions(p_challenge_id) x where x.hrs > 0
  ),
  prize as (
    select z.user_id, z.pos,
      (select coalesce(sum(case when q <= 3 then coalesce((g.prizes -> 'places' ->> (q - 1))::int, 0)
                               when q <= 10 then coalesce((g.prizes ->> 'top10')::int, 0) else 0 end), 0)
       from generate_series(z.pos, z.pos + z.n::int - 1) q)::int / z.n as bones
    from placed z
  )
  update public.derby_players p set place = z.pos, place_bones = z.bones
    from prize z where p.challenge_id = p_challenge_id and p.user_id = z.user_id;

  select max(p.longest_ft) into v_long from public.derby_players p where p.challenge_id = p_challenge_id;
  if v_long is not null then
    select count(*) into v_long_n from public.derby_players p where p.challenge_id = p_challenge_id and p.longest_ft = v_long;
    update public.derby_players p set longest_bones = coalesce((g.prizes ->> 'longest')::int, 0) / v_long_n
      where p.challenge_id = p_challenge_id and p.longest_ft = v_long;
  end if;
  update public.derby_players p set ten_bones = coalesce((g.prizes ->> 'ten_hr')::int, 0)
    where p.challenge_id = p_challenge_id and p.hrs >= 10;
  if c.sponsor_name is not null then
    update public.derby_players p set sign_bones_paid = least(p.sign_hits, g.sign_cap) * g.sign_bones
      where p.challenge_id = p_challenge_id and p.sign_hits > 0;
  end if;

  for r in
    select p.* from public.derby_players p where p.challenge_id = p_challenge_id and p.swings > 0
  loop
    v_total := r.place_bones + r.longest_bones + r.ten_bones + r.sign_bones_paid;
    if v_total > 0 then
      update public.profiles x set bones_balance = x.bones_balance + v_total, bones_earned_total = x.bones_earned_total + v_total
        where x.id = r.user_id;
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
        values (r.user_id, p_challenge_id, 'global_place', 0, 0, v_total);
    end if;
    perform public.derby_notify(p_challenge_id, r.user_id, c.name,
      'The Derby''s over: ' || case when r.place is null then r.hrs || ' home runs' else '#' || r.place || ' with ' || r.hrs || ' home runs' end
      || case when v_total > 0 then '. You won ' || v_total || ' Bones.' else '.' end);
  end loop;
end;
$$;
revoke execute on function public.derby_pay(uuid) from public, anon, authenticated;

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


-- ── Admin → Overview → Games → Home Run Derby ──

create or replace function public.admin_derby_overview()
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
    'derbies_live', (select count(*) from public.derby_games g join public.challenges c on c.id = g.challenge_id
                     where now() >= c.starts_at and now() < c.ends_at),
    'derbies_all', (select count(*) from public.derby_games),
    'players', (select count(*) from public.derby_players),
    'swung_7d', (select count(distinct s.user_id) from public.derby_swings s where s.swung_at > now() - interval '7 days'),
    'swings_7d', (select count(*) from public.derby_swings s where s.swung_at > now() - interval '7 days'),
    'hrs_7d', (select coalesce(sum(s.counts), 0) from public.derby_swings s where s.swung_at > now() - interval '7 days'),
    'moonshots_7d', (select count(*) from public.derby_swings s where s.swung_at > now() - interval '7 days' and s.moonshot),
    'golden_thrown_7d', (select count(*) from public.derby_swings s where s.thrown_at > now() - interval '7 days' and s.golden),
    'golden_hit_7d', (select count(*) from public.derby_swings s where s.swung_at > now() - interval '7 days' and s.golden and s.result = 'hr'),
    'sign_hits_7d', (select count(*) from public.derby_swings s where s.swung_at > now() - interval '7 days' and s.sign),
    'sponsor_bones_all', (select coalesce(sum(p.sign_bones_paid), 0) from public.derby_players p),
    'prize_bones_all', (select coalesce(sum(p.place_bones + p.longest_bones + p.ten_bones), 0) from public.derby_players p),
    'avg_hrs', (select round(avg(p.hrs)::numeric, 1) from public.derby_players p where p.swings > 0),
    'longest_ever', (select jsonb_build_object('ft', p.longest_ft, 'name', public.golf_name(p.user_id))
                     from public.derby_players p where p.longest_ft is not null
                     order by p.longest_ft desc, p.longest_at limit 1));
end;
$$;
revoke execute on function public.admin_derby_overview() from public, anon;
grant execute on function public.admin_derby_overview() to authenticated;
