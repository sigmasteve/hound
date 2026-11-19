-- Hound: the Hound Shootout — a Global Hound Challenge of penalty kicks
-- (0220 adds the kind). Approved mockup: claude.ai/artifact/GuF4uuosLuKM4Li8dTjL1x.
--
-- Everyone in one shootout for a week (3 to 30 days), joining until the
-- challenge's join_closes_at (3 days in), built like the Home Run Derby
-- (0211): publish_global_challenge takes 'shootout', shootout_setup_global
-- (admins) sets the prizes, shootout_board reads the leaderboard (top 25,
-- friends, your club), and pay_global_places pays it at the end.
--
--   kicks       least(20, steps today / 1,000) a day, less kicks taken
--               today; nothing carries over (the Derby's swings).
--   a kick      shootout_kick(zone, power). zone 0-5: top left, top
--               middle, top right, low left, low middle, low right (the
--               kicker's left and right). power 0-100 off the meter.
--   the green   centred on 62, half as wide as: top corners 7, top middle
--               9, low corners 10, low middle 13, times the stage's factor:
--               the first third of the days 1.0, the middle 0.85, the last
--               0.70 (derby_stage). Under it: too soft, the keeper holds
--               it. Over it: over the bar (top, and low middle) or wide
--               (low corners). Within 35% of the centre: perfect.
--   the keeper  dives left, stays home or dives right. Out of 1: left 0.4,
--               middle 0.2, right 0.4, plus 0.9 x the share of your last
--               10 kicks aimed that way (once you've taken 3), normalised:
--               the same spot again and again and he goes there. Seeded per
--               kick, and never from where you aimed this time.
--   the save    wrong way: a goal. Right way: he saves it with a chance by
--               the spot, perfect or not: top corners 0.55 / 0.15, top
--               middle 0.70 / 0.35, low corners 0.85 / 0.50, low middle
--               0.95 / 0.65; less 0.10 for one strength workout today, 0.20
--               for two or more (pace: sport_day_bonus 'soccer'); never
--               under 0.05. Steps never change the green.
--   score       a goal 1, top bins (a top corner) 2; the golden ball (one
--               kick a day, seeded 1st-5th) doubles it.
--   board       most goals (points), then the best conversion (goals
--               scored / kicks), then whoever got there first.
--   prizes      (shootout_setup_global; defaults) 1st 500, 2nd 300, 3rd
--               200, 4th-10th 100 (a tie shares the places it covers, split
--               evenly), the longest scoring streak 150 (ties split), 15+
--               goals 25 each. Paid by pay_global_places after settlement.
--   sponsor     the challenge's sponsor on the boards behind the goal and
--               the keeper's shirt (drawn by the app; no sign Bones).
--   pushes      a one-time "you're into the top 10" once 20+ have kicked,
--               and at the end your place and Bones, through
--               send-golf-notification's new 'shootout' kind.
--
-- Run this once, after 0220 (committed on its own), in the SQL Editor.
-- Then redeploy send-golf-notification for the pushes.

-- ── Tables ──

create table public.shootout_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  prizes jsonb not null default '{"places":[500,300,200],"top10":100,"streak":150,"fifteen":25}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.shootout_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_day date not null,
  points integer not null default 0,
  goals integer not null default 0,
  kicks integer not null default 0,
  top_bins integer not null default 0,
  saved integer not null default 0,
  missed integer not null default 0,
  goldens_scored integer not null default 0,
  cur_streak integer not null default 0,
  best_streak integer not null default 0,
  best_streak_at timestamptz,
  last_goal_at timestamptz,
  pos_mark integer,
  pos_mark_day date,
  top10_at timestamptz,
  -- What the end paid, for the results screen.
  place integer,
  place_bones integer not null default 0,
  streak_bones integer not null default 0,
  fifteen_bones integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);
create index shootout_players_rank on public.shootout_players (challenge_id, points desc);

create table public.shootout_kicks (
  id bigserial primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  n integer not null,
  zone integer not null check (zone between 0 and 5),
  power integer not null check (power between 0 and 100),
  stage integer not null,
  width numeric(5, 2) not null,
  golden boolean not null default false,
  dive integer not null check (dive between 0 and 2),
  perfect boolean not null default false,
  pace integer not null default 0,
  result text not null check (result in ('goal', 'saved', 'held', 'over', 'wide')),
  points integer not null default 0,
  kicked_at timestamptz not null default now(),
  unique (challenge_id, user_id, day, n)
);
create index shootout_kicks_user on public.shootout_kicks (challenge_id, user_id, id desc);
create index shootout_kicks_at on public.shootout_kicks (kicked_at desc);

alter table public.shootout_games enable row level security;
alter table public.shootout_players enable row level security;
alter table public.shootout_kicks enable row level security;
revoke all on public.shootout_games, public.shootout_players, public.shootout_kicks from anon;
revoke insert, update, delete on public.shootout_games, public.shootout_players, public.shootout_kicks from authenticated;
create policy "Players see their own Shootout" on public.shootout_players for select to authenticated using (user_id = auth.uid());
create policy "Players see their own kicks" on public.shootout_kicks for select to authenticated using (user_id = auth.uid());
create policy "Players see their Shootout's settings" on public.shootout_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = shootout_games.challenge_id and cp.user_id = auth.uid()));


-- ── The numbers ──

create or replace function public.shootout_center()
returns integer language sql immutable as $$ select 62; $$;

-- Half the green's width for a spot at a stage's factor.
create or replace function public.shootout_width(p_zone int, f numeric)
returns numeric
language sql
immutable
as $$
  select round((case p_zone when 0 then 7 when 2 then 7 when 1 then 9 when 3 then 10 when 5 then 10 else 13 end) * f, 2);
$$;

-- The keeper's chance to save it when he's gone the right way.
create or replace function public.shootout_save_chance(p_zone int, p_perfect boolean, p_strength int)
returns numeric
language sql
immutable
as $$
  select greatest(0.05,
    (case
      when p_zone in (0, 2) then case when p_perfect then 0.15 else 0.55 end
      when p_zone = 1 then case when p_perfect then 0.35 else 0.70 end
      when p_zone in (3, 5) then case when p_perfect then 0.50 else 0.85 end
      else case when p_perfect then 0.65 else 0.95 end
    end)
    - case when coalesce(p_strength, 0) >= 2 then 0.20 when p_strength = 1 then 0.10 else 0 end)::numeric;
$$;

-- Too soft, on target, or over / wide: what the power does at a spot.
create or replace function public.shootout_strike(p_zone int, p_power int, f numeric)
returns text
language sql
immutable
as $$
  select case
    when p_power < public.shootout_center() - public.shootout_width(p_zone, f) then 'held'
    when p_power > public.shootout_center() + public.shootout_width(p_zone, f) then
      case when p_zone in (3, 5) then 'wide' else 'over' end
    else 'on' end;
$$;

-- How the keeper leans: left, middle, right (sums to 1), from the base
-- and the share of your last 10 kicks aimed each way.
create or replace function public.shootout_keeper_lean(p_challenge_id uuid, p_user uuid)
returns numeric[]
language plpgsql
stable
security definer set search_path = public
as $$
declare
  n int;
  l int;
  m int;
  r int;
  w numeric[] := array[0.4, 0.2, 0.4];
  total numeric;
begin
  select count(*), count(*) filter (where k.zone % 3 = 0), count(*) filter (where k.zone % 3 = 1), count(*) filter (where k.zone % 3 = 2)
    into n, l, m, r
    from (select x.zone from public.shootout_kicks x
          where x.challenge_id = p_challenge_id and x.user_id = p_user
          order by x.id desc limit 10) k;
  if n >= 3 then
    w := array[w[1] + 0.9 * l / n, w[2] + 0.9 * m / n, w[3] + 0.9 * r / n];
  end if;
  total := w[1] + w[2] + w[3];
  return array[round(w[1] / total, 4), round(w[2] / total, 4), round(w[3] / total, 4)];
end;
$$;

-- The golden ball's kick of the day, 1st to 5th.
create or replace function public.shootout_golden_n(p_challenge_id uuid, p_user uuid, p_day date)
returns integer
language sql
immutable
as $$
  select 1 + floor(public.derby_rand(p_challenge_id::text || ':' || p_user::text || ':' || p_day::text || ':shootout-golden') * 5)::int;
$$;

revoke execute on function public.shootout_center() from public, anon, authenticated;
revoke execute on function public.shootout_width(int, numeric) from public, anon, authenticated;
revoke execute on function public.shootout_save_chance(int, boolean, int) from public, anon, authenticated;
revoke execute on function public.shootout_strike(int, int, numeric) from public, anon, authenticated;
revoke execute on function public.shootout_keeper_lean(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.shootout_golden_n(uuid, uuid, date) from public, anon, authenticated;

-- Where everyone who's kicked stands: points, then conversion, then
-- whoever got there first. pos ties on points and conversion; idx is unique.
create or replace function public.shootout_positions(p_challenge_id uuid)
returns table (user_id uuid, pos integer, idx integer, tied boolean, points integer, goals integer, kicks integer)
language sql
stable
security definer set search_path = public
as $$
  select z.user_id, z.pos, z.idx, count(*) over (partition by z.pos) > 1, z.points, z.goals, z.kicks
  from (
    select p.user_id,
      (rank() over (order by p.points desc, p.goals::numeric / greatest(p.kicks, 1) desc))::int as pos,
      (row_number() over (order by p.points desc, p.goals::numeric / greatest(p.kicks, 1) desc, p.last_goal_at asc nulls last, p.user_id))::int as idx,
      p.points, p.goals, p.kicks
    from public.shootout_players p
    where p.challenge_id = p_challenge_id and p.kicks > 0
  ) z;
$$;
revoke execute on function public.shootout_positions(uuid) from public, anon, authenticated;

create or replace function public.shootout_notify(p_challenge_id uuid, p_recipient uuid, p_title text, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.golf_notify('shootout', p_challenge_id, p_recipient, jsonb_build_object('title', p_title, 'message', p_message));
end;
$$;
revoke execute on function public.shootout_notify(uuid, uuid, text, text) from public, anon, authenticated;


-- ── Publishing: 0211's, with the Shootout ──

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
  if p_kind::text not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs', 'golf', 'derby', 'shootout') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors, Pack Wars, Golf, the Home Run Derby or the Hound Shootout.';
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

-- Right after publishing, an admin sets the prizes.
-- p_prizes: {"places":[1st,2nd,3rd],"top10":n,"streak":n,"fifteen":n};
-- null = the defaults.
create or replace function public.shootout_setup_global(p_challenge_id uuid, p_prizes jsonb default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  pz jsonb := coalesce(p_prizes, '{"places":[500,300,200],"top10":100,"streak":150,"fifteen":25}'::jsonb);
  v jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can set up the Hound Shootout.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'shootout' or not c.is_global then
    raise exception 'That isn''t a Hound Shootout.';
  end if;
  if exists (select 1 from public.shootout_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This Shootout is already set up.';
  end if;
  if jsonb_typeof(pz -> 'places') is distinct from 'array' or jsonb_array_length(pz -> 'places') <> 3 then
    raise exception 'Prizes need Bones for 1st, 2nd and 3rd.';
  end if;
  for v in select x from jsonb_array_elements(pz -> 'places') x
    union all select pz -> 'top10' union all select pz -> 'streak' union all select pz -> 'fifteen' loop
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 5000 then
      raise exception 'Each prize is 0 to 5,000 Bones.';
    end if;
  end loop;
  insert into public.shootout_games (challenge_id, prizes) values (p_challenge_id, pz);
end;
$$;
revoke execute on function public.shootout_setup_global(uuid, jsonb) from public, anon;
grant execute on function public.shootout_setup_global(uuid, jsonb) to authenticated;


-- ── Joining: set up first; your kicks count from the day you join ──

create or replace function public.shootout_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'shootout')
     and not exists (select 1 from public.shootout_games g where g.challenge_id = new.challenge_id) then
    raise exception 'This Shootout isn''t set up yet.';
  end if;
  return new;
end;
$$;
revoke execute on function public.shootout_before_join() from public, anon, authenticated;

create trigger shootout_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.shootout_before_join();

create or replace function public.shootout_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if c.kind::text = 'shootout' then
    insert into public.shootout_players (challenge_id, user_id, joined_day)
      values (new.challenge_id, new.user_id, greatest(public.soccer_first_day(c), public.soccer_today(new.user_id)))
      on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.shootout_after_join() from public, anon, authenticated;

create trigger shootout_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.shootout_after_join();


-- ── The state of play for the caller ──

-- Why you can't kick now (null = you can).
create or replace function public.shootout_reason(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  today date;
  first_day date;
  earned int;
  taken int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not exists (select 1 from public.shootout_players p where p.challenge_id = p_challenge_id and p.user_id = p_user) then
    return 'Join the Shootout to kick.';
  end if;
  today := public.soccer_today(p_user);
  first_day := public.soccer_first_day(c);
  if now() < c.starts_at or today < first_day then
    return 'The Shootout hasn''t started yet.';
  end if;
  if now() >= c.ends_at or today > first_day + c.duration_days - 1 then
    return 'The Shootout is over.';
  end if;
  earned := least(20, public.derby_steps_today(p_challenge_id, p_user, today) / 1000);
  select count(*) into taken from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = p_user and k.day = today;
  if taken >= 20 then
    return 'That''s 20 kicks today. Back tomorrow.';
  end if;
  if taken >= earned then
    return 'No kicks ready: your next comes at ' || to_char((taken + 1) * 1000, 'FM999,999') || ' steps.';
  end if;
  return null;
end;
$$;
revoke execute on function public.shootout_reason(uuid, uuid) from public, anon, authenticated;

create or replace function public.shootout_kick_json(k public.shootout_kicks)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('n', k.n, 'day', k.day, 'zone', k.zone, 'power', k.power, 'golden', k.golden, 'dive', k.dive,
    'perfect', k.perfect, 'result', k.result, 'points', k.points);
$$;
revoke execute on function public.shootout_kick_json(public.shootout_kicks) from public, anon, authenticated;

create or replace function public.shootout_live(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.shootout_games%rowtype;
  p public.shootout_players%rowtype;
  today date;
  day_no int;
  stage int;
  f numeric;
  steps int;
  earned int;
  taken int;
  strength int;
  lean numeric[];
  v_rank int;
  v_reason text;
  v_golden_n int;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.shootout_games where challenge_id = p_challenge_id;
  if c.id is null or c.kind::text <> 'shootout' or g.challenge_id is null then
    raise exception 'That isn''t a Hound Shootout.';
  end if;
  select * into p from public.shootout_players x where x.challenge_id = p_challenge_id and x.user_id = caller;
  today := public.soccer_today(caller);
  day_no := greatest(1, least(c.duration_days, today - public.soccer_first_day(c) + 1));
  stage := public.derby_stage(c.duration_days, day_no);
  f := public.derby_factor(stage);
  steps := public.derby_steps_today(p_challenge_id, caller, today);
  earned := least(20, steps / 1000);
  select count(*) into taken from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller and k.day = today;
  select b.strength into strength from public.sport_day_bonus(caller, today, 'soccer') b;
  lean := public.shootout_keeper_lean(p_challenge_id, caller);
  v_golden_n := public.shootout_golden_n(p_challenge_id, caller, today);
  select x.pos into v_rank from public.shootout_positions(p_challenge_id) x where x.user_id = caller;
  v_reason := public.shootout_reason(p_challenge_id, caller);

  return jsonb_build_object(
    'day', today, 'day_no', day_no, 'days', c.duration_days, 'stage', stage, 'factor', f,
    'center', public.shootout_center(),
    'widths', (select jsonb_agg(public.shootout_width(z, f) order by z) from generate_series(0, 5) z),
    'perfect_share', 0.35,
    'steps', steps, 'kicks_earned', earned, 'kicks_taken', taken,
    'kicks_left', greatest(0, least(earned, 20) - taken),
    'next_kick_at', case when earned >= 20 then null else (earned + 1) * 1000 end,
    'cap', 20,
    'golden_next', taken + 1 = v_golden_n,
    'golden_done', taken >= v_golden_n,
    'golden_n', v_golden_n,
    'pace', jsonb_build_object('strength', coalesce(strength, 0),
      'cut', case when coalesce(strength, 0) >= 2 then 20 when strength = 1 then 10 else 0 end),
    'keeper', jsonb_build_object('lean', to_jsonb(lean),
      'reads', (select count(*) from (select 1 from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller limit 10) z)),
    'joined', p.user_id is not null,
    'me', case when p.user_id is null then null else jsonb_build_object(
      'points', p.points, 'goals', p.goals, 'kicks', p.kicks, 'top_bins', p.top_bins, 'saved', p.saved, 'missed', p.missed,
      'cur_streak', p.cur_streak, 'best_streak', p.best_streak, 'rank', v_rank) end,
    'zones', (select jsonb_agg(jsonb_build_object(
        'kicks', (select count(*) from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller and k.zone = z),
        'goals', (select count(*) from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller and k.zone = z and k.result = 'goal'))
      order by z) from generate_series(0, 5) z),
    'field', (select count(*) from public.shootout_players x where x.challenge_id = p_challenge_id),
    'recent', (select coalesce(jsonb_agg(public.shootout_kick_json(k) order by k.id desc), '[]'::jsonb) from (
      select * from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller
      order by k.id desc limit 8) k),
    'sponsor', case when c.sponsor_name is null then null else jsonb_build_object(
      'name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color) end,
    'can_kick', v_reason is null,
    'reason', v_reason);
end;
$$;
revoke execute on function public.shootout_live(uuid) from public, anon;
grant execute on function public.shootout_live(uuid) to authenticated;


-- ── A kick ──

create or replace function public.shootout_kick(p_challenge_id uuid, p_zone integer, p_power integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  p public.shootout_players%rowtype;
  today date;
  stage int;
  f numeric;
  w numeric;
  pw int;
  n int;
  seed text;
  v_reason text;
  v_pos int;
  is_golden boolean;
  lean numeric[];
  r numeric;
  v_dive int;
  v_strike text;
  v_perfect boolean := false;
  v_strength int;
  v_result text;
  v_points int := 0;
  v_msg text;
  v_rank int;
  v_kicked int;
  v_left int;
  col int;
  v_top boolean;
  side text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.kind::text <> 'shootout' then
    raise exception 'That isn''t a Hound Shootout.';
  end if;
  if p_zone is null or p_zone not between 0 and 5 then
    raise exception 'Aim at one of the six spots.';
  end if;
  select * into p from public.shootout_players x where x.challenge_id = p_challenge_id and x.user_id = caller for update;
  v_reason := public.shootout_reason(p_challenge_id, caller);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  today := public.soccer_today(caller);
  stage := public.derby_stage(c.duration_days, today - public.soccer_first_day(c) + 1);
  f := public.derby_factor(stage);
  w := public.shootout_width(p_zone, f);
  pw := greatest(0, least(100, coalesce(p_power, 0)));
  select count(*) + 1 into n from public.shootout_kicks k where k.challenge_id = p_challenge_id and k.user_id = caller and k.day = today;
  seed := p_challenge_id::text || ':' || caller::text || ':' || today::text || ':' || n;
  is_golden := n = public.shootout_golden_n(p_challenge_id, caller, today);
  col := p_zone % 3;
  v_top := p_zone in (0, 2);
  side := case col when 0 then 'left' when 1 then 'down the middle' else 'right' end;

  if n = 1 then
    -- Where you stood when today's first kick came, for "moved today".
    select x.pos into v_pos from public.shootout_positions(p_challenge_id) x where x.user_id = caller;
    update public.shootout_players set pos_mark = v_pos, pos_mark_day = today
      where challenge_id = p_challenge_id and user_id = caller;
  end if;

  -- The keeper commits from your habits, before he sees this one.
  lean := public.shootout_keeper_lean(p_challenge_id, caller);
  r := public.derby_rand(seed || ':dive');
  v_dive := case when r < lean[1] then 0 when r < lean[1] + lean[2] then 1 else 2 end;
  select b.strength into v_strength from public.sport_day_bonus(caller, today, 'soccer') b;
  v_strength := coalesce(v_strength, 0);

  v_strike := public.shootout_strike(p_zone, pw, f);
  if v_strike = 'held' then
    v_result := 'held';
    v_msg := 'Too soft: the keeper holds it.';
  elsif v_strike = 'over' then
    v_result := 'over';
    v_msg := case when p_zone = 4 then 'Skied it over the bar.' else 'Too much on it: over the bar.' end;
  elsif v_strike = 'wide' then
    v_result := 'wide';
    v_msg := 'Too much on it: wide of the post.';
  else
    v_perfect := abs(pw - public.shootout_center()) <= w * 0.35;
    if v_dive <> col then
      v_result := 'goal';
    elsif public.derby_rand(seed || ':save') < public.shootout_save_chance(p_zone, v_perfect, v_strength) then
      v_result := 'saved';
    else
      v_result := 'goal';
    end if;
    if v_result = 'goal' then
      v_points := (case when v_top then 2 else 1 end) * (case when is_golden then 2 else 1 end);
      v_msg := case
        when is_golden and v_top then 'Golden ball, top bins: that''s 4 goals!'
        when is_golden then 'Golden ball: that goal counts double.'
        when v_top and v_dive = col then 'Top bins! He guessed right and still couldn''t reach it. 2 goals.'
        when v_top then 'Top bins! 2 goals.'
        when v_dive = col and v_strength > 0 then 'Goal! He went the right way, but your pace beat him.'
        when v_dive = col then 'Goal! He went the right way and couldn''t keep it out.'
        when v_dive = 1 then 'Goal! He stayed home and watched it go in.'
        else 'Goal! You sent him the wrong way.' end;
    else
      v_msg := case
        when lean[col + 1] >= 0.5 then 'Saved! He''s reading you: you keep going ' || side || '.'
        when v_perfect then 'Saved! A great stop from a perfect strike.'
        else 'Saved! He guessed right.' end;
    end if;
  end if;

  insert into public.shootout_kicks (challenge_id, user_id, day, n, zone, power, stage, width, golden, dive, perfect, pace, result, points)
    values (p_challenge_id, caller, today, n, p_zone, pw, stage, w, is_golden, v_dive, v_perfect, v_strength, v_result, v_points);

  update public.shootout_players set
      kicks = kicks + 1,
      points = points + v_points,
      goals = goals + case when v_result = 'goal' then 1 else 0 end,
      top_bins = top_bins + case when v_result = 'goal' and v_top then 1 else 0 end,
      saved = saved + case when v_result = 'saved' then 1 else 0 end,
      missed = missed + case when v_result in ('held', 'over', 'wide') then 1 else 0 end,
      goldens_scored = goldens_scored + case when v_result = 'goal' and is_golden then 1 else 0 end,
      cur_streak = case when v_result = 'goal' then cur_streak + 1 else 0 end,
      best_streak = case when v_result = 'goal' and cur_streak + 1 > best_streak then cur_streak + 1 else best_streak end,
      best_streak_at = case when v_result = 'goal' and cur_streak + 1 > best_streak then now() else best_streak_at end,
      last_goal_at = case when v_result = 'goal' then now() else last_goal_at end
    where challenge_id = p_challenge_id and user_id = caller
    returning * into p;

  select x.pos into v_rank from public.shootout_positions(p_challenge_id) x where x.user_id = caller;
  select count(*) into v_kicked from public.shootout_positions(p_challenge_id);
  -- The top 10, once the field's big enough to mean something.
  if v_kicked >= 20 and v_rank <= 10 and p.top10_at is null then
    update public.shootout_players set top10_at = now() where challenge_id = p_challenge_id and user_id = caller;
    perform public.shootout_notify(p_challenge_id, caller, c.name,
      'You''re into the top 10: #' || v_rank || ' with ' || p.points || ' goals. Keep shooting.');
  end if;
  v_left := greatest(0, least(20, public.derby_steps_today(p_challenge_id, caller, today) / 1000) - n);

  return jsonb_build_object(
    'n', n, 'zone', p_zone, 'power', pw, 'golden', is_golden, 'dive', v_dive, 'perfect', v_perfect,
    'result', v_result, 'points', v_points, 'pace', v_strength,
    'total', p.points, 'goals', p.goals, 'kicks', p.kicks, 'streak', p.cur_streak, 'best_streak', p.best_streak,
    'rank', v_rank, 'kicks_left', v_left,
    'golden_next', n + 1 = public.shootout_golden_n(p_challenge_id, caller, today),
    'lean', to_jsonb(public.shootout_keeper_lean(p_challenge_id, caller)),
    'message', v_msg);
end;
$$;
revoke execute on function public.shootout_kick(uuid, integer, integer) from public, anon;
grant execute on function public.shootout_kick(uuid, integer, integer) to authenticated;


-- ── The leaderboard ──

create or replace function public.shootout_fav_zone(p_challenge_id uuid, p_user uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select k.zone from public.shootout_kicks k
  where k.challenge_id = p_challenge_id and k.user_id = p_user and k.result = 'goal'
  group by k.zone order by sum(k.points) desc, count(*) desc, k.zone limit 1;
$$;
revoke execute on function public.shootout_fav_zone(uuid, uuid) from public, anon, authenticated;

create or replace function public.shootout_board(p_challenge_id uuid, p_tab text default 'top')
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.shootout_games%rowtype;
  me_row public.shootout_players%rowtype;
  mine record;
  today date;
  v_status text;
  v_field int;
  v_kicked int;
  v_club uuid;
  v_club_json jsonb;
  v_rows jsonb;
  v_more int;
  v_me jsonb;
  v_streak jsonb;
  v_podium jsonb;
  v_streak_won jsonb;
  v_mine_paid jsonb;
begin
  if caller is null then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.shootout_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null or c.kind::text <> 'shootout' then
    raise exception 'not authorized';
  end if;
  if p_tab is null or p_tab not in ('top', 'friends', 'club') then
    raise exception 'Pick Top, Friends or My club.';
  end if;
  today := public.soccer_today(caller);
  v_status := case when now() >= c.ends_at or today > public.soccer_first_day(c) + c.duration_days - 1 then 'final'
                   when now() < c.starts_at or today < public.soccer_first_day(c) then 'upcoming' else 'live' end;
  select count(*) into v_field from public.shootout_players p where p.challenge_id = p_challenge_id;
  select count(*) into v_kicked from public.shootout_positions(p_challenge_id);

  select * into me_row from public.shootout_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if me_row.user_id is not null then
    select x.* into mine from public.shootout_positions(p_challenge_id) x where x.user_id = caller;
    v_me := jsonb_build_object(
      'pos', mine.pos, 'tied', coalesce(mine.tied, false), 'points', me_row.points, 'goals', me_row.goals, 'kicks', me_row.kicks,
      'top_bins', me_row.top_bins, 'best_streak', me_row.best_streak, 'cur_streak', me_row.cur_streak,
      'moved', case when mine.pos is not null and me_row.pos_mark is not null and me_row.pos_mark_day = today
                    then me_row.pos_mark - mine.pos end);
  end if;

  -- My club: the one with the most members in this shootout, then the oldest.
  select cl.id into v_club
  from public.club_members cm
  join public.clubs cl on cl.id = cm.club_id and cl.removed_at is null
  where cm.user_id = caller
  order by (select count(*) from public.club_members m2
            join public.shootout_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id
            where m2.club_id = cl.id) desc, cl.created_at, cl.id
  limit 1;
  if v_club is not null then
    select jsonb_build_object('id', cl.id, 'name', cl.name, 'playing', (
        select count(*) from public.club_members m2
        join public.shootout_players p on p.challenge_id = p_challenge_id and p.user_id = m2.user_id
        where m2.club_id = cl.id))
      into v_club_json from public.clubs cl where cl.id = v_club;
  end if;

  with ord as (select * from public.shootout_positions(p_challenge_id)),
  base as (
    select p.user_id, p.points, p.goals, p.kicks, p.top_bins, p.best_streak, o.pos, o.idx, o.tied
    from public.shootout_players p
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
      'pos', b.pos, 'tied', coalesce(b.tied, false), 'user_id', b.user_id, 'name', public.golf_name(b.user_id), 'initials', pr.initials,
      'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
      'points', b.points, 'goals', b.goals, 'kicks', b.kicks, 'top_bins', b.top_bins, 'best_streak', b.best_streak,
      'fav_zone', public.shootout_fav_zone(p_challenge_id, b.user_id),
      'is_me', b.user_id = caller,
      'is_friend', b.user_id <> caller and public.golf_are_friends(b.user_id, caller),
      'in_club', v_club is not null and exists (select 1 from public.club_members m where m.club_id = v_club and m.user_id = b.user_id))
    order by b.idx nulls last, public.golf_name(b.user_id)), '[]'::jsonb)
    into v_rows
  from base b join public.profiles pr on pr.id = b.user_id;

  if p_tab = 'top' and v_kicked > 25 and (mine.idx is null or mine.idx > 26) then
    select count(*) into v_more from public.shootout_positions(p_challenge_id) o
      where o.idx > 25 and (mine.idx is null or o.idx < mine.idx);
  end if;

  select jsonb_build_object('user_id', p.user_id, 'name', public.golf_name(p.user_id), 'streak', p.best_streak) into v_streak
  from public.shootout_players p
  where p.challenge_id = p_challenge_id and p.best_streak > 0
  order by p.best_streak desc, p.best_streak_at limit 1;

  if v_status = 'final' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'place', x.pos, 'tied', x.tied, 'user_id', x.user_id, 'name', public.golf_name(x.user_id), 'initials', pr.initials,
        'icon_id', pr.equipped_icon_id, 'points', x.points, 'goals', x.goals, 'kicks', x.kicks,
        'bones', coalesce(p.place_bones, 0))
      order by x.idx), '[]'::jsonb)
      into v_podium
    from public.shootout_positions(p_challenge_id) x
    join public.profiles pr on pr.id = x.user_id
    join public.shootout_players p on p.challenge_id = p_challenge_id and p.user_id = x.user_id
    where x.pos <= 3 and x.points > 0;
    select coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'name', public.golf_name(p.user_id),
        'streak', p.best_streak, 'bones', p.streak_bones) order by p.best_streak_at), '[]'::jsonb)
      into v_streak_won
    from public.shootout_players p
    where p.challenge_id = p_challenge_id and p.best_streak > 0
      and p.best_streak = (select max(q.best_streak) from public.shootout_players q where q.challenge_id = p_challenge_id);
    if me_row.user_id is not null then
      v_mine_paid := jsonb_build_object('paid', g.paid_at is not null, 'place', me_row.place,
        'place_bones', me_row.place_bones, 'streak_bones', me_row.streak_bones, 'fifteen_bones', me_row.fifteen_bones,
        'total', me_row.place_bones + me_row.streak_bones + me_row.fifteen_bones);
    end if;
  end if;

  return jsonb_build_object(
    'field', v_field, 'kicked', v_kicked, 'status', v_status,
    'ends_at', c.ends_at, 'join_closes_at', c.join_closes_at, 'days', c.duration_days,
    'day_no', greatest(1, least(c.duration_days, today - public.soccer_first_day(c) + 1)),
    'joined', me_row.user_id is not null,
    'me', v_me, 'rows', v_rows, 'more', v_more, 'club', v_club_json,
    'prizes', g.prizes,
    'sponsor', case when c.sponsor_name is null then null else jsonb_build_object(
      'name', c.sponsor_name, 'logo_url', c.sponsor_logo_url, 'color', c.sponsor_color) end,
    'best_streak', v_streak,
    'goals_total', (select coalesce(sum(p.points), 0) from public.shootout_players p where p.challenge_id = p_challenge_id),
    'top_bins_total', (select coalesce(sum(p.top_bins), 0) from public.shootout_players p where p.challenge_id = p_challenge_id),
    'podium', v_podium, 'streak_winner', v_streak_won, 'my_bones', v_mine_paid);
end;
$$;
revoke execute on function public.shootout_board(uuid, text) from public, anon;
grant execute on function public.shootout_board(uuid, text) to authenticated;


-- ── Paying it ──

-- The Shootout's prizes for whoever kicked: places 1-3 and 4-10 (a tie
-- shares the places it covers, split evenly), the longest scoring streak
-- (ties split), and 15+ goals.
create or replace function public.shootout_pay(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.shootout_games%rowtype;
  v_best int;
  v_best_n int;
  r record;
  v_total int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.shootout_games where challenge_id = p_challenge_id for update;
  if g.challenge_id is null or g.paid_at is not null then
    return;
  end if;
  update public.shootout_games set paid_at = now() where challenge_id = p_challenge_id;

  with placed as (
    select x.user_id, x.pos, count(*) over (partition by x.pos) as n
    from public.shootout_positions(p_challenge_id) x where x.points > 0
  ),
  prize as (
    select z.user_id, z.pos,
      (select coalesce(sum(case when q <= 3 then coalesce((g.prizes -> 'places' ->> (q - 1))::int, 0)
                               when q <= 10 then coalesce((g.prizes ->> 'top10')::int, 0) else 0 end), 0)
       from generate_series(z.pos, z.pos + z.n::int - 1) q)::int / z.n as bones
    from placed z
  )
  update public.shootout_players p set place = z.pos, place_bones = z.bones
    from prize z where p.challenge_id = p_challenge_id and p.user_id = z.user_id;

  select max(p.best_streak) into v_best from public.shootout_players p where p.challenge_id = p_challenge_id;
  if coalesce(v_best, 0) > 0 then
    select count(*) into v_best_n from public.shootout_players p where p.challenge_id = p_challenge_id and p.best_streak = v_best;
    update public.shootout_players p set streak_bones = coalesce((g.prizes ->> 'streak')::int, 0) / v_best_n
      where p.challenge_id = p_challenge_id and p.best_streak = v_best;
  end if;
  update public.shootout_players p set fifteen_bones = coalesce((g.prizes ->> 'fifteen')::int, 0)
    where p.challenge_id = p_challenge_id and p.points >= 15;

  for r in
    select p.* from public.shootout_players p where p.challenge_id = p_challenge_id and p.kicks > 0
  loop
    v_total := r.place_bones + r.streak_bones + r.fifteen_bones;
    if v_total > 0 then
      update public.profiles x set bones_balance = x.bones_balance + v_total, bones_earned_total = x.bones_earned_total + v_total
        where x.id = r.user_id;
      insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
        values (r.user_id, p_challenge_id, 'global_place', 0, 0, v_total);
    end if;
    perform public.shootout_notify(p_challenge_id, r.user_id, c.name,
      'The Shootout''s over: ' || case when r.place is null then r.points || ' goals' else '#' || r.place || ' with ' || r.points || ' goals' end
      || case when v_total > 0 then '. You won ' || v_total || ' Bones.' else '.' end);
  end loop;
end;
$$;
revoke execute on function public.shootout_pay(uuid) from public, anon, authenticated;

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


-- ── Admin → Overview → Games → Hound Shootout ──

create or replace function public.admin_shootout_overview()
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
    'shootouts_live', (select count(*) from public.shootout_games g join public.challenges c on c.id = g.challenge_id
                       where now() >= c.starts_at and now() < c.ends_at),
    'shootouts_all', (select count(*) from public.shootout_games),
    'players', (select count(*) from public.shootout_players),
    'kicked_ever', (select count(*) from public.shootout_players p where p.kicks > 0),
    'kicked_7d', (select count(distinct k.user_id) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days'),
    'kicks_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days'),
    'scored_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.result = 'goal'),
    'goals_7d', (select coalesce(sum(k.points), 0) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days'),
    'top_bins_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.result = 'goal' and k.zone in (0, 2)),
    'saved_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.result = 'saved'),
    'held_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.result = 'held'),
    'off_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.result in ('over', 'wide')),
    'perfect_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.perfect),
    'golden_scored_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.golden and k.result = 'goal'),
    'paced_7d', (select count(*) from public.shootout_kicks k where k.kicked_at > now() - interval '7 days' and k.pace > 0),
    -- Where people aim, the six spots in order (top left .. low right).
    'zones_7d', (select jsonb_agg((select count(*) from public.shootout_kicks k
                   where k.kicked_at > now() - interval '7 days' and k.zone = z) order by z) from generate_series(0, 5) z),
    'prize_bones_all', (select coalesce(sum(p.place_bones + p.streak_bones + p.fifteen_bones), 0) from public.shootout_players p),
    'avg_goals', (select round(avg(p.points)::numeric, 1) from public.shootout_players p where p.kicks > 0),
    'best_streak_ever', (select jsonb_build_object('streak', p.best_streak, 'name', public.golf_name(p.user_id))
                         from public.shootout_players p where p.best_streak > 0
                         order by p.best_streak desc, p.best_streak_at limit 1));
end;
$$;
revoke execute on function public.admin_shootout_overview() from public, anon;
grant execute on function public.admin_shootout_overview() to authenticated;
