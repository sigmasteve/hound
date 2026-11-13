-- Hound: Hoops — basketball on everyone's steps, a quarter a day.
-- See 0194_hoops_horse_kinds.sql for the enum value this depends on (must
-- already be committed).
--
-- Two sides, the Hounds (home, the creator's) and the Strays (away), of
-- one to nine people each; bots can fill a side to five. Four quarters,
-- a quarter a day (or two days a quarter). Each day is played once it's
-- over everywhere, at 11:00 UTC the next morning, like Soccer (0142):
--
--   shots       one per shot_steps walked that day (2,000 by default), up
--               to five, by everyone on the side
--   the pick    each player's shot: drive (2 points, 55%), mid-range (2,
--               44%) or three (3, 35%). Sticky until changed.
--   matchups    everyone guards someone on the other side, paired by
--               their usual steps. Out-walk the one guarding you and your
--               shots fall more often: 0.12 × ln((mine + 500) / (theirs +
--               500)), at most ±0.15.
--   defense     each side votes every day: pack the paint (their drives
--               −0.10, threes +0.04) or guard the arc (threes −0.08,
--               drives +0.03). No votes: yesterday's, or the paint.
--   dunks       a drive by someone over 15,000 steps that day: +0.08
--   fouls       twice the steps of whoever's guarding you (and 4,000 or
--               more): your first shot is two free throws (78% each)
--   on fire     three makes in a row: +0.08 for the rest of the day
--   rebounds    a miss goes back to the shooter's side 0.6 × their side's
--               share of the day's steps, for one putback (50%)
--
-- Every roll is seeded (rally_js_rand, 0140), so a day plays the same way
-- wherever it's computed and a replay never changes. Tied after the last
-- quarter: an overtime day, up to three. The winners get Admin's win
-- Bones, everyone who played the play Bones (hoops_config), paid by
-- settle_challenge_score_core (0196, which also has H-O-R-S-E).
--
-- The app creates the challenge (duration_days = 4 × days_per_quarter),
-- adds the creator as a participant, then calls hoops_setup. Anyone
-- invited later joins onto the side with fewer people, taking a bot's
-- place if there is one. Like the other games, the tables have no write
-- policies; every write goes through the functions below.
--
-- Run this once, after 0194 (as its own, separately committed
-- transaction), in the SQL Editor. Pushes need send-hoops-notification
-- deployed; without it the game still plays, quietly.

-- ── Admin's settings ──

create table if not exists public.hoops_config (
  id boolean primary key default true,
  constraint hoops_config_singleton check (id),
  enabled boolean not null default true,
  win_bones integer not null default 40 check (win_bones between 0 and 500),
  play_bones integer not null default 10 check (play_bones between 0 and 500),
  bot_steps integer not null default 7000 check (bot_steps between 1000 and 30000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.hoops_config (id) values (true) on conflict (id) do nothing;
alter table public.hoops_config enable row level security;
drop policy if exists "Anyone signed in reads the Hoops settings" on public.hoops_config;
create policy "Anyone signed in reads the Hoops settings" on public.hoops_config for select to authenticated using (true);
revoke insert, update, delete on public.hoops_config from anon, authenticated;

create or replace function public.hoops_cfg()
returns public.hoops_config
language sql
stable
security definer set search_path = public
as $$
  select * from public.hoops_config where id;
$$;
revoke execute on function public.hoops_cfg() from public, anon, authenticated;

create or replace function public.admin_set_hoops_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.hoops_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    win_bones = coalesce((p ->> 'win_bones')::int, c.win_bones),
    play_bones = coalesce((p ->> 'play_bones')::int, c.play_bones),
    bot_steps = coalesce((p ->> 'bot_steps')::int, c.bot_steps),
    updated_at = now(), updated_by = auth.uid()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_hoops_config(jsonb) from public, anon;
grant execute on function public.admin_set_hoops_config(jsonb) to authenticated;

-- ── The game ──

create table public.hoops_games (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  shot_steps int not null default 2000 check (shot_steps in (1500, 2000, 2500, 3000)),
  days_per_quarter int not null default 1 check (days_per_quarter in (1, 2)),
  home_name text not null default 'Hounds',
  away_name text not null default 'Strays',
  score_home int not null default 0,
  score_away int not null default 0,
  days_played int not null default 0,
  status text not null default 'active' check (status in ('active', 'final')),
  winner_team text check (winner_team in ('home', 'away')),
  updated_at timestamptz not null default now()
);

alter table public.hoops_games enable row level security;
revoke all on public.hoops_games from anon;
revoke insert, update, delete on public.hoops_games from authenticated;
create policy "Participants can view their Hoops game"
  on public.hoops_games for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = hoops_games.challenge_id and cp.user_id = auth.uid()));

-- A seat holds a person or one of the challenge's bots; player_id is
-- whichever it is. guarding is the other side's seat this one defends.
create table public.hoops_players (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid references public.profiles (id),
  bot_id uuid references public.challenge_bots (id) on delete cascade,
  player_id uuid generated always as (coalesce(user_id, bot_id)) stored,
  team text not null check (team in ('home', 'away')),
  shot text not null default 'drive' check (shot in ('drive', 'mid', 'three')),
  shot_day date,
  guarding uuid,
  baseline int not null default 0,
  joined boolean not null default false,
  seated_at timestamptz not null default now(),
  constraint hoops_players_one_kind check ((user_id is null) <> (bot_id is null))
);

create unique index hoops_players_player_idx on public.hoops_players (challenge_id, player_id);
create index hoops_players_user_idx on public.hoops_players (user_id);

alter table public.hoops_players enable row level security;
revoke all on public.hoops_players from anon;
revoke insert, update, delete on public.hoops_players from authenticated;
create policy "Participants can view their Hoops line-ups"
  on public.hoops_players for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = hoops_players.challenge_id and cp.user_id = auth.uid()));

-- A side's defense vote, for one game day.
create table public.hoops_votes (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team text not null check (team in ('home', 'away')),
  choice text not null check (choice in ('paint', 'arc')),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, day, user_id)
);
alter table public.hoops_votes enable row level security;
revoke all on public.hoops_votes from anon;
revoke insert, update, delete on public.hoops_votes from authenticated;
create policy "Your side's votes"
  on public.hoops_votes for select to authenticated
  using (exists (
    select 1 from public.hoops_players me
    where me.challenge_id = hoops_votes.challenge_id and me.user_id = auth.uid() and me.team = hoops_votes.team
  ));

-- One row per played day.
create table public.hoops_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  period int not null,
  label text not null,
  home int not null default 0,
  away int not null default 0,
  defense_home text not null default 'none',
  defense_away text not null default 'none',
  resolved_at timestamptz not null default now(),
  primary key (challenge_id, day)
);
alter table public.hoops_days enable row level security;
revoke all on public.hoops_days from anon;
revoke insert, update, delete on public.hoops_days from authenticated;
create policy "Participants can view their Hoops days"
  on public.hoops_days for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = hoops_days.challenge_id and cp.user_id = auth.uid()));

-- One row per shot. shooter and defender are hoops_players ids.
create table public.hoops_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  day_no int not null,
  period int not null,
  seq int not null,
  team text not null check (team in ('home', 'away')),
  shooter uuid not null,
  defender uuid,
  kind text not null check (kind in ('drive', 'mid', 'three', 'ft', 'putback')),
  dunk boolean not null default false,
  made boolean not null,
  pts int not null default 0,
  on_fire boolean not null default false,
  rebound text check (rebound in ('home', 'away')),
  shooter_steps int not null default 0,
  defender_steps int not null default 0,
  defense text not null default 'none',
  created_at timestamptz not null default now()
);
create index hoops_events_challenge_idx on public.hoops_events (challenge_id, day, seq);
alter table public.hoops_events enable row level security;
revoke all on public.hoops_events from anon;
revoke insert, update, delete on public.hoops_events from authenticated;
create policy "Participants can view their Hoops shots"
  on public.hoops_events for select to authenticated
  using (exists (select 1 from public.challenge_participants cp where cp.challenge_id = hoops_events.challenge_id and cp.user_id = auth.uid()));

-- ── Helpers ──

-- Regulation days: four quarters.
create or replace function public.hoops_reg_days(p_days_per_quarter int)
returns int
language sql
immutable
as $$
  select 4 * p_days_per_quarter;
$$;
revoke execute on function public.hoops_reg_days(int) from public, anon, authenticated;

-- A game day's period (1 to 4, then 5, 6, 7 for overtime) and label.
create or replace function public.hoops_period_of(p_day_no int, p_days_per_quarter int)
returns int
language sql
immutable
as $$
  select case when p_day_no <= 4 * p_days_per_quarter then ceil(p_day_no::numeric / p_days_per_quarter)::int
              else 4 + (p_day_no - 4 * p_days_per_quarter) end;
$$;
revoke execute on function public.hoops_period_of(int, int) from public, anon, authenticated;

create or replace function public.hoops_label(p_period int)
returns text
language sql
immutable
as $$
  select case when p_period <= 4 then 'Q' || p_period when p_period = 5 then 'OT' else 'OT' || (p_period - 4) end;
$$;
revoke execute on function public.hoops_label(int) from public, anon, authenticated;

-- A seat's steps on a day: a person's synced row, or a bot's day (Admin's
-- bot steps, ± a seeded 1,500).
create or replace function public.hoops_steps(p_challenge_id uuid, p_player uuid, p_day date)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.challenge_bots b where b.id = p_player and b.challenge_id = p_challenge_id) then
    return greatest(0, round((public.hoops_cfg()).bot_steps
      + (public.rally_js_rand(public.rally_js_hash(p_player::text || ':' || p_day || ':hoops')) - 0.5) * 3000))::int;
  end if;
  return coalesce((select ps.steps from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id and ps.user_id = p_player and ps.day = p_day), 0);
end;
$$;
revoke execute on function public.hoops_steps(uuid, uuid, date) from public, anon, authenticated;

-- Someone's usual day, for pairing matchups: their last two weeks'
-- average, or 5,000 if Hound hasn't seen any.
create or replace function public.hoops_baseline(p_user uuid)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(round(avg(d.steps))::int, 5000)
  from public.daily_step_totals d
  where d.user_id = p_user and d.day >= current_date - 14 and d.day < current_date and d.steps > 0;
$$;
revoke execute on function public.hoops_baseline(uuid) from public, anon, authenticated;

-- Pairs matchups by rank of usual steps: each side's n-th guards the
-- other side's n-th, extras guarding the other side's last.
create or replace function public.hoops_pair(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  home uuid[];
  away uuid[];
  i int;
begin
  select coalesce(array_agg(id order by baseline desc, seated_at, id), '{}') into home from public.hoops_players where challenge_id = p_challenge_id and team = 'home';
  select coalesce(array_agg(id order by baseline desc, seated_at, id), '{}') into away from public.hoops_players where challenge_id = p_challenge_id and team = 'away';
  if coalesce(array_length(home, 1), 0) = 0 or coalesce(array_length(away, 1), 0) = 0 then
    update public.hoops_players set guarding = null where challenge_id = p_challenge_id;
    return;
  end if;
  for i in 1..array_length(home, 1) loop
    update public.hoops_players set guarding = away[least(i, array_length(away, 1))] where id = home[i];
  end loop;
  for i in 1..array_length(away, 1) loop
    update public.hoops_players set guarding = home[least(i, array_length(home, 1))] where id = away[i];
  end loop;
end;
$$;
revoke execute on function public.hoops_pair(uuid) from public, anon, authenticated;

-- The seat guarding p_seat: whoever on the other side guards it (the
-- strongest, if several), else the one it guards.
create or replace function public.hoops_defender_of(p_seat uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select d.id from public.hoops_players d where d.guarding = p_seat order by d.baseline desc, d.seated_at limit 1),
    (select s.guarding from public.hoops_players s where s.id = p_seat)
  );
$$;
revoke execute on function public.hoops_defender_of(uuid) from public, anon, authenticated;

-- The make chance for a shot.
create or replace function public.hoops_chance(p_kind text, p_mine numeric, p_theirs numeric, p_defense text, p_dunk boolean, p_on_fire boolean)
returns double precision
language sql
immutable
as $$
  select least(0.95, greatest(0.05,
    case p_kind when 'drive' then 0.55 when 'mid' then 0.44 when 'three' then 0.35 when 'ft' then 0.78 else 0.50 end
    + case when p_kind = 'ft' then 0
           else least(0.15, greatest(-0.15, 0.12 * ln((greatest(p_mine, 0) + 500) / (greatest(p_theirs, 0) + 500)))) end
    + case when p_kind = 'drive' and p_defense = 'paint' then -0.10
           when p_kind = 'drive' and p_defense = 'arc' then 0.03
           when p_kind = 'three' and p_defense = 'paint' then 0.04
           when p_kind = 'three' and p_defense = 'arc' then -0.08
           else 0 end
    + case when p_dunk then 0.08 else 0 end
    + case when p_on_fire then 0.08 else 0 end
  ))::double precision;
$$;
revoke execute on function public.hoops_chance(text, numeric, numeric, text, boolean, boolean) from public, anon, authenticated;

-- A side's defense on a day: most votes, else what it played last, else
-- 'none' (no lean either way, so not voting doesn't hand the other side
-- easier threes).
create or replace function public.hoops_defense(p_challenge_id uuid, p_team text, p_day date)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select v.choice from public.hoops_votes v
      where v.challenge_id = p_challenge_id and v.team = p_team and v.day = p_day
      group by v.choice
      having count(*) > coalesce((select count(*) from public.hoops_votes w
        where w.challenge_id = p_challenge_id and w.team = p_team and w.day = p_day and w.choice <> v.choice), 0)
      limit 1),
    (select case when p_team = 'home' then d.defense_home else d.defense_away end
      from public.hoops_days d where d.challenge_id = p_challenge_id and d.day < p_day order by d.day desc limit 1),
    'none');
$$;
revoke execute on function public.hoops_defense(uuid, text, date) from public, anon, authenticated;

-- A seat's name, as the app shows it.
create or replace function public.hoops_name(p_seat uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select case when p.use_username and p.username is not null then p.username else p.name end
       from public.hoops_players s join public.profiles p on p.id = s.user_id where s.id = p_seat),
    (select b.name from public.hoops_players s join public.challenge_bots b on b.id = s.bot_id where s.id = p_seat),
    'Someone');
$$;
revoke execute on function public.hoops_name(uuid) from public, anon, authenticated;

create or replace function public.hoops_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null or not exists (select 1 from public.profiles p where p.id = p_recipient) then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-hoops-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', p_kind, 'challenge_id', p_challenge_id, 'recipient_id', p_recipient) || p_extra
  );
exception when others then
  null;
end;
$$;
revoke execute on function public.hoops_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ── Setting up and joining ──

-- The creator names who plays where, right after creating the challenge:
-- [{"user_id": uuid, "team": "home"|"away"}], the creator at home. A
-- friend named here still has to accept their invite. p_fill_bots adds
-- bots to bring each side to five.
create or replace function public.hoops_setup(
  p_challenge_id uuid, p_shot_steps int, p_days_per_quarter int, p_fill_bots boolean, p_players jsonb,
  p_home_name text default 'Hounds', p_away_name text default 'Strays'
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  r record;
  n_home int;
  n_away int;
  bot_names text[] := array['Rex', 'Biscuit', 'Scout', 'Maple', 'Duke', 'Pepper', 'Ziggy', 'Bruno', 'Luna', 'Rocket'];
  side text;
  k int := 0;
  b uuid;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind::text <> 'hoops' or c.created_by is distinct from caller then
    raise exception 'Only whoever made this game can set it up.';
  end if;
  if not (public.hoops_cfg()).enabled then
    raise exception 'Hoops is paused right now.';
  end if;
  if exists (select 1 from public.hoops_games g where g.challenge_id = p_challenge_id) then
    raise exception 'This game is already set up.';
  end if;
  if p_shot_steps not in (1500, 2000, 2500, 3000) then
    raise exception 'A shot is 1,500, 2,000, 2,500 or 3,000 steps.';
  end if;
  if p_days_per_quarter not in (1, 2) then
    raise exception 'A quarter is one day or two.';
  end if;
  if c.duration_days <> 4 * p_days_per_quarter then
    raise exception 'A game is four quarters: % days.', 4 * p_days_per_quarter;
  end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) < 1 then
    raise exception 'Who''s playing?';
  end if;
  if (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_players) e) <> jsonb_array_length(p_players) then
    raise exception 'Everyone in the game has to be a different person.';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_players) e where (e ->> 'user_id')::uuid = caller and e ->> 'team' = 'home') then
    raise exception 'You play for the home side.';
  end if;
  for r in select (e ->> 'user_id')::uuid as id, e ->> 'team' as team from jsonb_array_elements(p_players) e loop
    if r.team not in ('home', 'away') then
      raise exception 'Each player is home or away.';
    end if;
    if not exists (select 1 from public.profiles p where p.id = r.id) then
      raise exception 'One of the players isn''t on Hound.';
    end if;
  end loop;
  select count(*) filter (where e ->> 'team' = 'home'), count(*) filter (where e ->> 'team' = 'away')
    into n_home, n_away from jsonb_array_elements(p_players) e;
  if n_home > 9 or n_away > 9 then
    raise exception 'A side has one to nine people.';
  end if;
  if n_away = 0 and not coalesce(p_fill_bots, false) then
    raise exception 'The other side needs someone: invite a friend or fill it with bots.';
  end if;

  insert into public.hoops_games (challenge_id, shot_steps, days_per_quarter, home_name, away_name)
  values (p_challenge_id, p_shot_steps, p_days_per_quarter,
          coalesce(nullif(left(trim(p_home_name), 24), ''), 'Hounds'), coalesce(nullif(left(trim(p_away_name), 24), ''), 'Strays'));

  insert into public.hoops_players (challenge_id, user_id, team, baseline, joined)
  select p_challenge_id, (e ->> 'user_id')::uuid, e ->> 'team', public.hoops_baseline((e ->> 'user_id')::uuid),
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = (e ->> 'user_id')::uuid)
  from jsonb_array_elements(p_players) e;

  if coalesce(p_fill_bots, false) then
    foreach side in array array['home', 'away'] loop
      while (select count(*) from public.hoops_players p where p.challenge_id = p_challenge_id and p.team = side) < 5 loop
        k := k + 1;
        insert into public.challenge_bots (challenge_id, name, fitness_level)
          values (p_challenge_id, bot_names[1 + (k - 1) % array_length(bot_names, 1)], 'active')
          returning id into b;
        insert into public.hoops_players (challenge_id, bot_id, team, baseline, joined, shot)
          values (p_challenge_id, b, side, (public.hoops_cfg()).bot_steps, true,
                  (array['drive', 'mid', 'three'])[1 + floor(public.rally_js_rand(public.rally_js_hash(b::text || ':shot')) * 3)::int]);
      end loop;
    end loop;
  end if;

  perform public.hoops_pair(p_challenge_id);
end;
$$;
revoke execute on function public.hoops_setup(uuid, int, int, boolean, jsonb, text, text) from public, anon;
grant execute on function public.hoops_setup(uuid, int, int, boolean, jsonb, text, text) to authenticated;

-- Before the game's set up, only the creator's own row gets in. After,
-- anyone invited can join while it's on, if there's room.
create or replace function public.hoops_before_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  g public.hoops_games%rowtype;
begin
  if not exists (select 1 from public.challenges c where c.id = new.challenge_id and c.kind::text = 'hoops') then
    return new;
  end if;
  select * into g from public.hoops_games where challenge_id = new.challenge_id;
  if not found then
    if exists (select 1 from public.challenge_participants cp where cp.challenge_id = new.challenge_id) then
      raise exception 'This game isn''t set up yet.';
    end if;
    return new;
  end if;
  if g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  if not exists (select 1 from public.hoops_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id)
     and (select count(*) from public.hoops_players p where p.challenge_id = new.challenge_id and p.user_id is not null) >= 18 then
    raise exception 'Both sides are full.';
  end if;
  return new;
end;
$$;
revoke execute on function public.hoops_before_join() from public, anon, authenticated;
create trigger hoops_before_join
  before insert on public.challenge_participants
  for each row execute procedure public.hoops_before_join();

-- A named player's seat is now taken. Someone joining late goes to the
-- side with fewer people, in a bot's seat if that side has one, and the
-- matchups are paired again.
create or replace function public.hoops_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  side text;
  bot_seat uuid;
begin
  if not exists (select 1 from public.hoops_games g where g.challenge_id = new.challenge_id) then
    return new;
  end if;
  update public.hoops_players set joined = true
    where challenge_id = new.challenge_id and user_id = new.user_id and not joined;
  if found then
    return new;
  end if;
  if exists (select 1 from public.hoops_players p where p.challenge_id = new.challenge_id and p.user_id = new.user_id) then
    return new;
  end if;
  select t into side from (values ('home'), ('away')) v(t)
    where (select count(*) from public.hoops_players p where p.challenge_id = new.challenge_id and p.team = t and p.user_id is not null) < 9
    order by (select count(*) from public.hoops_players p where p.challenge_id = new.challenge_id and p.team = t and p.user_id is not null),
             (select count(*) from public.hoops_players p where p.challenge_id = new.challenge_id and p.team = t),
             case t when 'away' then 0 else 1 end
    limit 1;
  if side is null then
    return new;
  end if;
  select p.id into bot_seat from public.hoops_players p
    where p.challenge_id = new.challenge_id and p.team = side and p.bot_id is not null
    order by p.seated_at desc limit 1;
  if bot_seat is not null then
    delete from public.hoops_players where id = bot_seat;
  end if;
  insert into public.hoops_players (challenge_id, user_id, team, baseline, joined)
    values (new.challenge_id, new.user_id, side, public.hoops_baseline(new.user_id), true);
  perform public.hoops_pair(new.challenge_id);
  return new;
end;
$$;
revoke execute on function public.hoops_after_join() from public, anon, authenticated;
create trigger hoops_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.hoops_after_join();

-- ── Picks ──

create or replace function public.hoops_set_shot(p_challenge_id uuid, p_shot text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_shot not in ('drive', 'mid', 'three') then
    raise exception 'Pick a drive, a mid-range or a three.';
  end if;
  if not exists (select 1 from public.hoops_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'This game is over.';
  end if;
  update public.hoops_players set shot = p_shot, shot_day = public.soccer_today(auth.uid())
    where challenge_id = p_challenge_id and user_id = auth.uid() and joined;
  if not found then
    raise exception 'You''re not playing in this game.';
  end if;
end;
$$;
revoke execute on function public.hoops_set_shot(uuid, text) from public, anon;
grant execute on function public.hoops_set_shot(uuid, text) to authenticated;

-- A defense vote for the caller's today.
create or replace function public.hoops_vote(p_challenge_id uuid, p_choice text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me public.hoops_players%rowtype;
  c public.challenges%rowtype;
  g public.hoops_games%rowtype;
  d date;
  first_day date;
begin
  if p_choice not in ('paint', 'arc') then
    raise exception 'Pack the paint or guard the arc.';
  end if;
  select * into me from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = auth.uid();
  if not found or not me.joined then
    raise exception 'You''re not playing in this game.';
  end if;
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  if g.status <> 'active' then
    raise exception 'This game is over.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  first_day := public.soccer_first_day(c);
  d := public.soccer_today(auth.uid());
  if d < first_day then
    raise exception 'The game hasn''t started yet.';
  end if;
  if exists (select 1 from public.hoops_days hd where hd.challenge_id = p_challenge_id and hd.day = d) then
    raise exception 'Today''s quarter is already played.';
  end if;
  insert into public.hoops_votes (challenge_id, day, user_id, team, choice) values (p_challenge_id, d, auth.uid(), me.team, p_choice)
    on conflict (challenge_id, day, user_id) do update set choice = excluded.choice, team = excluded.team, updated_at = now();
end;
$$;
revoke execute on function public.hoops_vote(uuid, text) from public, anon;
grant execute on function public.hoops_vote(uuid, text) to authenticated;

-- ── Playing a day ──

-- Plays one day: every seat's shots, both sides taking turns a shot at a
-- time, every roll seeded. Internal; hoops_advance holds the row lock.
create or replace function public.hoops_play_day(p_challenge_id uuid, p_day date, p_day_no int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  g public.hoops_games%rowtype;
  per int;
  def_home text;
  def_away text;
  team_steps jsonb;
  seats jsonb := '[]'::jsonb;
  s record;
  rnd int;
  t text;
  o text;
  seq int := 0;
  pts_home int := 0;
  pts_away int := 0;
  st jsonb;
  i int;
  mine int;
  theirs int;
  their_def text;
  kind text;
  dunk boolean;
  fire boolean;
  ch double precision;
  made boolean;
  p int;
  streaks jsonb := '{}'::jsonb;
  streak int;
  share double precision;
  reb text;
  seed text;
  steps_home numeric;
  steps_away numeric;
begin
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  per := public.hoops_period_of(p_day_no, g.days_per_quarter);
  def_home := public.hoops_defense(p_challenge_id, 'home', p_day);
  def_away := public.hoops_defense(p_challenge_id, 'away', p_day);

  -- Every joined seat's steps, its defender's, and its shots.
  for s in
    select hp.id, hp.team, hp.shot, public.hoops_steps(p_challenge_id, hp.player_id, p_day) as steps,
           public.hoops_defender_of(hp.id) as def_id
    from public.hoops_players hp
    where hp.challenge_id = p_challenge_id and hp.joined
    order by hp.team, hp.baseline desc, hp.seated_at, hp.id
  loop
    seats := seats || jsonb_build_object('id', s.id, 'team', s.team, 'shot', s.shot, 'steps', s.steps, 'def', s.def_id,
      'shots', least(5, floor(s.steps::numeric / g.shot_steps))::int);
  end loop;
  -- Defenders' steps (a defender who hasn't joined walks nothing).
  select coalesce(jsonb_agg(x || jsonb_build_object('def_steps',
      coalesce((select (y ->> 'steps')::int from jsonb_array_elements(seats) y where y ->> 'id' = x ->> 'def'), 0))), '[]'::jsonb)
    into seats from jsonb_array_elements(seats) x;
  select coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'home'), 0),
         coalesce(sum((x ->> 'steps')::numeric) filter (where x ->> 'team' = 'away'), 0)
    into steps_home, steps_away from jsonb_array_elements(seats) x;

  for rnd in 1..5 loop
    foreach t in array array['home', 'away'] loop
      o := case when t = 'home' then 'away' else 'home' end;
      their_def := case when t = 'home' then def_away else def_home end;
      share := case when steps_home + steps_away = 0 then 0.5
                    when t = 'home' then steps_home / (steps_home + steps_away) else steps_away / (steps_home + steps_away) end;
      for st in select x from jsonb_array_elements(seats) x where x ->> 'team' = t and (x ->> 'shots')::int >= rnd loop
        mine := (st ->> 'steps')::int;
        theirs := (st ->> 'def_steps')::int;
        streak := coalesce((streaks ->> (st ->> 'id'))::int, 0);
        seed := p_challenge_id::text || ':' || p_day || ':' || (st ->> 'id') || ':' || rnd;

        if rnd = 1 and mine >= 4000 and mine >= 2 * theirs then
          -- Fouled: two free throws.
          for i in 1..2 loop
            seq := seq + 1;
            made := public.rally_js_rand(public.rally_js_hash(seed || ':ft' || i)) < public.hoops_chance('ft', mine, theirs, their_def, false, false);
            p := case when made then 1 else 0 end;
            insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, shooter_steps, defender_steps, defense)
              values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'ft', made, p, mine, theirs, their_def);
            if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          end loop;
          continue;
        end if;

        kind := st ->> 'shot';
        dunk := kind = 'drive' and mine >= 15000;
        fire := streak >= 3;
        ch := public.hoops_chance(kind, mine, theirs, their_def, dunk, fire);
        made := public.rally_js_rand(public.rally_js_hash(seed || ':shot')) < ch;
        p := case when not made then 0 when kind = 'three' then 3 else 2 end;
        reb := null;
        if not made then
          reb := case when public.rally_js_rand(public.rally_js_hash(seed || ':reb')) < 0.6 * share then t else o end;
        end if;
        seq := seq + 1;
        insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, dunk, made, pts, on_fire, rebound, shooter_steps, defender_steps, defense)
          values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, kind, dunk and made, made, p, fire, reb, mine, theirs, their_def);
        if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
        streak := case when made then streak + 1 else 0 end;

        if reb = t then
          -- The putback.
          ch := public.hoops_chance('putback', mine, theirs, their_def, false, false);
          made := public.rally_js_rand(public.rally_js_hash(seed || ':putback')) < ch;
          p := case when made then 2 else 0 end;
          seq := seq + 1;
          insert into public.hoops_events (challenge_id, day, day_no, period, seq, team, shooter, defender, kind, made, pts, rebound, shooter_steps, defender_steps, defense)
            values (p_challenge_id, p_day, p_day_no, per, seq, t, (st ->> 'id')::uuid, (st ->> 'def')::uuid, 'putback', made, p,
                    case when made then null else o end, mine, theirs, their_def);
          if t = 'home' then pts_home := pts_home + p; else pts_away := pts_away + p; end if;
          streak := case when made then streak + 1 else 0 end;
        end if;
        streaks := streaks || jsonb_build_object(st ->> 'id', streak);
      end loop;
    end loop;
  end loop;

  insert into public.hoops_days (challenge_id, day, day_no, period, label, home, away, defense_home, defense_away)
    values (p_challenge_id, p_day, p_day_no, per, public.hoops_label(per), pts_home, pts_away, def_home, def_away);
  update public.hoops_games
    set score_home = score_home + pts_home, score_away = score_away + pts_away, days_played = p_day_no, updated_at = now()
    where challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.hoops_play_day(uuid, date, int) from public, anon, authenticated;

-- The day's best moment, for the morning push: a dunk, a three, then any
-- make, biggest step gap first.
create or replace function public.hoops_highlight(p_challenge_id uuid, p_day date)
returns text
language sql
stable
security definer set search_path = public
as $$
  select public.hoops_name(e.shooter) || case
      when e.dunk then ' dunked on the drive.'
      when e.kind = 'three' then ' hit from three.'
      when e.kind = 'putback' then ' scored on the putback.'
      when e.kind = 'mid' then ' hit from mid-range.'
      else ' scored on the drive.' end
  from public.hoops_events e
  where e.challenge_id = p_challenge_id and e.day = p_day and e.made and e.kind <> 'ft'
  order by e.dunk desc, (e.kind = 'three') desc, (e.shooter_steps - e.defender_steps) desc, e.seq
  limit 1;
$$;
revoke execute on function public.hoops_highlight(uuid, date) from public, anon, authenticated;

-- Plays every day that's over everywhere and not yet played (yesterday,
-- UTC, once 11:00 UTC has passed), then an overtime day while it's tied
-- (up to three), then ends the game. Any participant can call it (the
-- app does on load); the morning job calls it for every running game.
create or replace function public.hoops_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  g public.hoops_games%rowtype;
  caller uuid := auth.uid();
  first_day date;
  reg int;
  cutoff date;
  d date;
  n int := 0;
  r record;
  extra jsonb;
  hd public.hoops_days%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind::text <> 'hoops' then
    return 0;
  end if;
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return 0;
  end if;
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  if not found or g.status <> 'active' then
    return 0;
  end if;
  first_day := public.soccer_first_day(c);
  reg := public.hoops_reg_days(g.days_per_quarter);
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;

  loop
    d := first_day + g.days_played;
    exit when d > cutoff;
    -- Past regulation, play on only while it's tied, three overtimes at most.
    exit when g.days_played >= reg and (g.score_home <> g.score_away or g.days_played >= reg + 3);
    perform public.hoops_play_day(p_challenge_id, d, g.days_played + 1);
    n := n + 1;
    select * into g from public.hoops_games where challenge_id = p_challenge_id;
    if g.days_played >= reg and (g.score_home <> g.score_away or g.days_played >= reg + 3) then
      update public.hoops_games
        set status = 'final',
            winner_team = case when g.score_home > g.score_away then 'home' when g.score_away > g.score_home then 'away' end,
            updated_at = now()
        where challenge_id = p_challenge_id;
      select * into g from public.hoops_games where challenge_id = p_challenge_id;
    end if;
    select * into hd from public.hoops_days where challenge_id = p_challenge_id and day = d;
    extra := jsonb_build_object('label', hd.label, 'period', hd.period, 'home_name', g.home_name, 'away_name', g.away_name,
      'score_home', g.score_home, 'score_away', g.score_away, 'today_home', hd.home, 'today_away', hd.away,
      'winner_team', g.winner_team, 'highlight', public.hoops_highlight(p_challenge_id, d));
    for r in select user_id from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id is not null and p.joined loop
      perform public.hoops_notify(case when g.status = 'final' then 'final' else 'quarter' end, p_challenge_id, r.user_id, extra);
    end loop;
    exit when g.status = 'final';
  end loop;
  return n;
end;
$$;
revoke execute on function public.hoops_advance(uuid) from public, anon;
grant execute on function public.hoops_advance(uuid) to authenticated;

create or replace function public.hoops_advance_all()
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
    join public.hoops_games g on g.challenge_id = c.id
    where c.kind::text = 'hoops' and g.status = 'active' and c.starts_at < now()
    order by c.starts_at
  loop
    begin
      n := n + public.hoops_advance(r.id);
    exception when others then
      raise warning 'hoops_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.hoops_advance_all() from public, anon, authenticated;

select cron.schedule('hound-hoops-advance', '29 11 * * *', $$ select public.hoops_advance_all(); $$);

-- Afternoon nudge, once a day, to anyone in a game on a game day who
-- hasn't touched their shot or voted today.
create or replace function public.hoops_pick_reminders()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.challenge_id, p.user_id, p.shot, p.shot_day, public.soccer_today(p.user_id) as d,
           public.soccer_first_day(c) as first_day, g.days_played, g.days_per_quarter
    from public.hoops_players p
    join public.hoops_games g on g.challenge_id = p.challenge_id and g.status = 'active'
    join public.challenges c on c.id = p.challenge_id
    where p.user_id is not null and p.joined
  loop
    continue when r.d < r.first_day or r.d > r.first_day + public.hoops_reg_days(r.days_per_quarter) + 2;
    continue when exists (select 1 from public.hoops_days hd where hd.challenge_id = r.challenge_id and hd.day = r.d);
    continue when r.shot_day = r.d;
    continue when exists (select 1 from public.hoops_votes v where v.challenge_id = r.challenge_id and v.day = r.d and v.user_id = r.user_id);
    perform public.hoops_notify('pick', r.challenge_id, r.user_id, jsonb_build_object('shot', r.shot,
      'label', public.hoops_label(public.hoops_period_of((r.d - r.first_day) + 1, r.days_per_quarter))));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.hoops_pick_reminders() from public, anon, authenticated;

select cron.schedule('hound-hoops-pick-reminders', '13 18 * * *', $$ select public.hoops_pick_reminders(); $$);

-- ── Reading a game ──

-- One played day's (or period's) shots, as the app shows them.
create or replace function public.hoops_events_json(p_challenge_id uuid, p_period int, p_day date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'seq', e.seq, 'team', e.team, 'shooter', e.shooter, 'defender', e.defender, 'kind', e.kind, 'dunk', e.dunk,
      'made', e.made, 'pts', e.pts, 'on_fire', e.on_fire, 'rebound', e.rebound,
      'shooter_steps', e.shooter_steps, 'defender_steps', e.defender_steps, 'defense', e.defense)
    order by e.day, e.seq), '[]'::jsonb)
  from public.hoops_events e
  where e.challenge_id = p_challenge_id
    and (p_period is null or e.period = p_period)
    and (p_day is null or e.day = p_day);
$$;
revoke execute on function public.hoops_events_json(uuid, int, date) from public, anon, authenticated;

create or replace function public.hoops_view(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.challenges%rowtype;
  g public.hoops_games%rowtype;
  first_day date;
  today date;
  reg int;
  me public.hoops_players%rowtype;
  my_steps int;
  def_steps int;
  their_def text;
  last_day public.hoops_days%rowtype;
  status text;
  periods int;
begin
  select * into c from public.challenges where id = p_challenge_id;
  select * into g from public.hoops_games where challenge_id = p_challenge_id;
  if c.id is null or g.challenge_id is null then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = caller)
     and not exists (select 1 from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = caller) then
    raise exception 'not authorized';
  end if;
  first_day := public.soccer_first_day(c);
  today := public.soccer_today(caller);
  reg := public.hoops_reg_days(g.days_per_quarter);
  status := case when g.status = 'final' then 'final' when today < first_day and g.days_played = 0 then 'upcoming' else 'live' end;
  periods := greatest(4, public.hoops_period_of(greatest(g.days_played, 1), g.days_per_quarter));

  select * into me from public.hoops_players p where p.challenge_id = p_challenge_id and p.user_id = caller;
  if me.id is not null and status = 'live' then
    my_steps := public.hoops_steps(p_challenge_id, caller, today);
    def_steps := coalesce((select public.hoops_steps(p_challenge_id, d.player_id, today) from public.hoops_players d where d.id = public.hoops_defender_of(me.id) and d.joined), 0);
    their_def := public.hoops_defense(p_challenge_id, case when me.team = 'home' then 'away' else 'home' end, today);
  end if;
  select * into last_day from public.hoops_days d where d.challenge_id = p_challenge_id order by d.day desc limit 1;

  return jsonb_build_object(
    'status', status,
    'first_day', first_day,
    'day_no', greatest(0, today - first_day + 1),
    'days', greatest(reg, g.days_played),
    'days_per_quarter', g.days_per_quarter,
    'shot_steps', g.shot_steps,
    'teams', jsonb_build_object(
      'home', jsonb_build_object('name', g.home_name, 'score', g.score_home),
      'away', jsonb_build_object('name', g.away_name, 'score', g.score_away)),
    'line', (select jsonb_agg(jsonb_build_object(
        'period', pr, 'label', public.hoops_label(pr),
        'home', (select sum(d.home) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr),
        'away', (select sum(d.away) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr),
        'played', (select count(*) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = pr)
                    >= case when pr <= 4 then g.days_per_quarter else 1 end)
      order by pr) from generate_series(1, periods) pr),
    'winner', g.winner_team,
    'me', me.id,
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'user_id', p.user_id,
        'name', public.hoops_name(p.id),
        'initials', coalesce(pr.initials, upper(left(b.name, 1))),
        'icon_id', pr.equipped_icon_id, 'frame_id', pr.equipped_frame_id, 'background_id', pr.equipped_background_id,
        'bot', p.bot_id is not null, 'team', p.team, 'guarding', p.guarding, 'shot', p.shot, 'joined', p.joined,
        'steps_today', case when p.joined then public.hoops_steps(p_challenge_id, p.player_id, today) else 0 end,
        'shots_today', case when p.joined then least(5, floor(public.hoops_steps(p_challenge_id, p.player_id, today)::numeric / g.shot_steps))::int else 0 end,
        'pts', coalesce(t.pts, 0), 'fg_made', coalesce(t.fg_made, 0), 'fg_att', coalesce(t.fg_att, 0),
        'three_made', coalesce(t.three_made, 0), 'three_att', coalesce(t.three_att, 0),
        'ft_made', coalesce(t.ft_made, 0), 'ft_att', coalesce(t.ft_att, 0))
      order by p.team, p.baseline desc, p.seated_at), '[]'::jsonb)
      from public.hoops_players p
      left join public.profiles pr on pr.id = p.user_id
      left join public.challenge_bots b on b.id = p.bot_id
      left join lateral (
        select sum(e.pts) as pts,
          count(*) filter (where e.kind <> 'ft' and e.made) as fg_made, count(*) filter (where e.kind <> 'ft') as fg_att,
          count(*) filter (where e.kind = 'three' and e.made) as three_made, count(*) filter (where e.kind = 'three') as three_att,
          count(*) filter (where e.kind = 'ft' and e.made) as ft_made, count(*) filter (where e.kind = 'ft') as ft_att
        from public.hoops_events e where e.challenge_id = p_challenge_id and e.shooter = p.id
      ) t on true
      where p.challenge_id = p_challenge_id),
    'my_odds', case when me.id is null or status <> 'live' then null else jsonb_build_object(
        'drive', round(public.hoops_chance('drive', my_steps, def_steps, their_def, my_steps >= 15000, false)::numeric, 2),
        'mid', round(public.hoops_chance('mid', my_steps, def_steps, their_def, false, false)::numeric, 2),
        'three', round(public.hoops_chance('three', my_steps, def_steps, their_def, false, false)::numeric, 2)) end,
    'my_vote', (select v.choice from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.user_id = caller),
    'team_votes', jsonb_build_object(
      'paint', (select count(*) from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.team = me.team and v.choice = 'paint'),
      'arc', (select count(*) from public.hoops_votes v where v.challenge_id = p_challenge_id and v.day = today and v.team = me.team and v.choice = 'arc')),
    'last', case when last_day.day is null then null else jsonb_build_object(
        'period', last_day.period, 'label', last_day.label, 'home', last_day.home, 'away', last_day.away,
        'events', public.hoops_events_json(p_challenge_id, null, last_day.day)) end
  );
end;
$$;
revoke execute on function public.hoops_view(uuid) from public, anon;
grant execute on function public.hoops_view(uuid) to authenticated;

-- One period's shots, for the replay: every day of it.
create or replace function public.hoops_period(p_challenge_id uuid, p_period int)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'period', p_period, 'label', public.hoops_label(p_period),
    'home', coalesce((select sum(d.home) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = p_period), 0),
    'away', coalesce((select sum(d.away) from public.hoops_days d where d.challenge_id = p_challenge_id and d.period = p_period), 0),
    'events', public.hoops_events_json(p_challenge_id, p_period, null));
end;
$$;
revoke execute on function public.hoops_period(uuid, int) from public, anon;
grant execute on function public.hoops_period(uuid, int) to authenticated;
