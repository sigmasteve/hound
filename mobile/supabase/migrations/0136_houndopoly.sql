-- Hound: Hound'opoly — a property board game played with your steps.
--
-- A loop of 24 squares (houndopoly_squares): parks and trails in colour
-- groups, Start, the Dog House, the Dog Park, the Vet, a Water Bowl and
-- three Fetch! card squares. Everyone in the challenge starts on Start
-- with the same cash. Each day's steps pick your dice, and the server
-- rolls once the day is over everywhere (11:00 UTC the next day):
--
--   under dog_house_steps   no roll: you stayed in
--   under two_dice_steps    one die
--   under three_dice_steps  two dice
--   from three_dice_steps   three dice
--
-- Land on a square nobody owns and it's held for you until the next
-- roll: buy it (houndopoly_decide) or let it go. Land on someone else's
-- and you pay rent, a tenth of its price, doubled when they own the
-- whole colour group. Pass Start and collect. The Vet costs; the Dog
-- Park and the Water Bowl are free. Fetch! draws a card tied to the day:
--
--   workout_bonus     logged a workout that day: collect 100
--   streak_advance    goal streak alive: move on to the next square for sale
--   fewest_steps      fewest steps in the game that day: pay 50 to the most
--   big_day_again     12,000+ steps: roll one more die
--   go_to_dog_house   straight to the Dog House, no Start payout
--
-- Run out of cash paying rent and you're bankrupt: you keep walking and
-- collecting rent on what you own, but can't buy. Highest net worth
-- (cash plus the price of your squares) on the last day wins; a global
-- one pays the top three places. Real Bones never enter the game.
--
--   houndopoly_settings   the admin knobs above (one row)
--   houndopoly_squares    the board, one row a square
--   houndopoly_players    one row per person per game: where they are,
--                         their cash, the square held for them
--   houndopoly_deeds      who owns which square
--   houndopoly_events     what happened, in order, for the overnight feed
--   houndopoly_days       which days each game has rolled
--
-- Run this once, after 0135 (which must already have committed on its
-- own — see that file's own comment), in the SQL Editor.
--
-- Undo, if needed: unschedule hound-houndopoly-advance, drop the six
-- tables and the houndopoly_* functions, re-run the settlement and
-- publish functions from 0126/0131. The enum value stays.

-- ── Settings ─────────────────────────────────────────────────────────

create table public.houndopoly_settings (
  id boolean primary key default true,
  constraint houndopoly_settings_singleton check (id),
  start_cash integer not null default 1500 check (start_cash > 0),
  pass_start_cash integer not null default 200 check (pass_start_cash >= 0),
  vet_cost integer not null default 100 check (vet_cost >= 0),
  dog_house_steps integer not null default 2000 check (dog_house_steps >= 0),
  two_dice_steps integer not null default 6000 check (two_dice_steps > dog_house_steps),
  three_dice_steps integer not null default 12000 check (three_dice_steps > two_dice_steps),
  -- The hour (UTC) after which a day counts as over everywhere.
  roll_hour_utc integer not null default 11 check (roll_hour_utc between 0 and 23),
  updated_at timestamptz not null default now()
);
insert into public.houndopoly_settings (id) values (true);

alter table public.houndopoly_settings enable row level security;
create policy "Anyone signed in can read houndopoly settings"
  on public.houndopoly_settings for select to authenticated using (true);
create policy "Only admins can update houndopoly settings"
  on public.houndopoly_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
revoke all on public.houndopoly_settings from anon;
revoke insert, delete on public.houndopoly_settings from authenticated;

-- ── The board ────────────────────────────────────────────────────────

create table public.houndopoly_squares (
  idx integer primary key check (idx between 0 and 23),
  name text not null,
  kind text not null check (kind in ('start', 'property', 'fetch', 'dog_house', 'dog_park', 'vet', 'water_bowl')),
  -- Properties only: the colour group and the price. Rent is a tenth.
  group_key text check (group_key ~ '^[a-g]$'),
  price integer check (price > 0),
  constraint houndopoly_squares_property check ((kind = 'property') = (group_key is not null and price is not null))
);

insert into public.houndopoly_squares (idx, name, kind, group_key, price) values
  (0, 'Start', 'start', null, null),
  (1, 'Elm Street Walk', 'property', 'a', 60),
  (2, 'Birch Lane', 'property', 'a', 60),
  (3, 'Fetch!', 'fetch', null, null),
  (4, 'Riverside Trail', 'property', 'b', 100),
  (5, 'Creekside Loop', 'property', 'b', 120),
  (6, 'Dog House', 'dog_house', null, null),
  (7, 'Oak Hollow', 'property', 'c', 140),
  (8, 'Lakeshore Path', 'property', 'c', 160),
  (9, 'Harbor Walk', 'property', 'c', 180),
  (10, 'Fetch!', 'fetch', null, null),
  (11, 'Meadow Run', 'property', 'd', 200),
  (12, 'Dog Park', 'dog_park', null, null),
  (13, 'Orchard Way', 'property', 'd', 220),
  (14, 'Summit Ridge', 'property', 'e', 240),
  (15, 'Canyon Trail', 'property', 'e', 260),
  (16, 'Fetch!', 'fetch', null, null),
  (17, 'Skyline Drive', 'property', 'e', 280),
  (18, 'Vet Visit', 'vet', null, null),
  (19, 'Boardwalk Pier', 'property', 'f', 300),
  (20, 'Water Bowl', 'water_bowl', null, null),
  (21, 'Lighthouse Point', 'property', 'f', 320),
  (22, 'Sunset Bluff', 'property', 'f', 350),
  (23, 'Grand Avenue', 'property', 'f', 400);

alter table public.houndopoly_squares enable row level security;
create policy "Anyone signed in can read the board"
  on public.houndopoly_squares for select to authenticated using (true);
revoke all on public.houndopoly_squares from anon;
revoke insert, update, delete on public.houndopoly_squares from authenticated;

-- ── Players, deeds, events, days ─────────────────────────────────────

create table public.houndopoly_players (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null default 0 check (position between 0 and 23),
  cash integer not null check (cash >= 0),
  -- A square landed on and not yet bought or passed on.
  pending_idx integer references public.houndopoly_squares (idx),
  bankrupt boolean not null default false,
  -- Days roll from the day after joining (joined mid-day).
  joined_day date not null,
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.houndopoly_deeds (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  idx integer not null references public.houndopoly_squares (idx),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  bought_on date not null,
  primary key (challenge_id, idx)
);

create table public.houndopoly_events (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  seq integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- moved, stayed_in, passed_start, landed_for_sale, landed_own, rent,
  -- bought, passed, vet, dog_park, water_bowl, visiting, card,
  -- bankrupt
  kind text not null,
  idx integer references public.houndopoly_squares (idx),
  amount integer,
  other_user_id uuid references public.profiles (id) on delete set null,
  -- A card's name, dice rolled, steps that day.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (challenge_id, day, seq)
);
create index houndopoly_events_challenge_day on public.houndopoly_events (challenge_id, day desc, seq desc);

create table public.houndopoly_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  rolled_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

alter table public.houndopoly_players enable row level security;
alter table public.houndopoly_deeds enable row level security;
alter table public.houndopoly_events enable row level security;
alter table public.houndopoly_days enable row level security;

-- Everyone in the game sees the whole game; nobody writes directly.
create policy "Participants can view houndopoly players"
  on public.houndopoly_players for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));
create policy "Participants can view houndopoly deeds"
  on public.houndopoly_deeds for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));
create policy "Participants can view houndopoly events"
  on public.houndopoly_events for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));
create policy "Participants can view houndopoly days"
  on public.houndopoly_days for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));
revoke all on public.houndopoly_players, public.houndopoly_deeds, public.houndopoly_events, public.houndopoly_days from anon;
revoke insert, update, delete on public.houndopoly_players, public.houndopoly_deeds, public.houndopoly_events, public.houndopoly_days from authenticated;

-- ── Seating ──────────────────────────────────────────────────────────

-- Joining a Hound'opoly challenge puts you on Start with the starting
-- cash. Your first roll is for the day after you join.
create or replace function public.houndopoly_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  k public.challenge_kind;
  s public.houndopoly_settings;
begin
  select kind into k from public.challenges where id = new.challenge_id;
  if k <> 'houndopoly' then
    return new;
  end if;
  select * into s from public.houndopoly_settings;
  insert into public.houndopoly_players (challenge_id, user_id, cash, joined_day)
  values (new.challenge_id, new.user_id, s.start_cash, (now() at time zone 'utc')::date)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.houndopoly_after_join() from public, anon, authenticated;

create trigger houndopoly_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.houndopoly_after_join();

-- ── The game's pieces ────────────────────────────────────────────────

create or replace function public.houndopoly_first_day(c public.challenges)
returns date
language sql
immutable
as $$
  select coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
$$;

-- Rent on a square: a tenth of its price, doubled when its owner has
-- the whole colour group.
create or replace function public.houndopoly_rent(p_challenge_id uuid, p_idx integer)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select case
    when (select count(*) from public.houndopoly_squares g where g.group_key = s.group_key)
       = (select count(*) from public.houndopoly_deeds d
          join public.houndopoly_squares g on g.idx = d.idx
          where d.challenge_id = p_challenge_id and g.group_key = s.group_key and d.owner_id = o.owner_id)
      then s.price / 5
    else s.price / 10
  end
  from public.houndopoly_squares s
  join public.houndopoly_deeds o on o.challenge_id = p_challenge_id and o.idx = s.idx
  where s.idx = p_idx;
$$;

revoke execute on function public.houndopoly_rent(uuid, integer) from public, anon;
grant execute on function public.houndopoly_rent(uuid, integer) to authenticated;

-- Cash plus the price of everything owned.
create or replace function public.houndopoly_net_worth(p_challenge_id uuid, p_user uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select cash from public.houndopoly_players where challenge_id = p_challenge_id and user_id = p_user), 0)
    + coalesce((select sum(s.price) from public.houndopoly_deeds d join public.houndopoly_squares s on s.idx = d.idx
                where d.challenge_id = p_challenge_id and d.owner_id = p_user), 0);
$$;

revoke execute on function public.houndopoly_net_worth(uuid, uuid) from public, anon;
grant execute on function public.houndopoly_net_worth(uuid, uuid) to authenticated;

-- One feed row. Sequence numbers run per game and day.
create or replace function public.houndopoly_log(
  p_challenge_id uuid, p_day date, p_user uuid, p_kind text,
  p_idx integer default null, p_amount integer default null, p_other uuid default null, p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.houndopoly_events (challenge_id, day, seq, user_id, kind, idx, amount, other_user_id, detail)
  values (
    p_challenge_id, p_day,
    coalesce((select max(seq) from public.houndopoly_events e where e.challenge_id = p_challenge_id and e.day = p_day), 0) + 1,
    p_user, p_kind, p_idx, p_amount, p_other, p_detail
  );
end;
$$;

revoke execute on function public.houndopoly_log(uuid, date, uuid, text, integer, integer, uuid, jsonb) from public, anon, authenticated;

-- Pays from one player to another (or to the bank, p_to null), as much
-- as they have; running dry makes them bankrupt.
create or replace function public.houndopoly_pay(p_challenge_id uuid, p_day date, p_from uuid, p_to uuid, p_amount integer, p_kind text, p_idx integer default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  have integer;
  paid integer;
begin
  select cash into have from public.houndopoly_players where challenge_id = p_challenge_id and user_id = p_from for update;
  paid := least(have, p_amount);
  update public.houndopoly_players set cash = cash - paid, updated_at = now()
    where challenge_id = p_challenge_id and user_id = p_from;
  if p_to is not null then
    update public.houndopoly_players set cash = cash + paid, updated_at = now()
      where challenge_id = p_challenge_id and user_id = p_to;
  end if;
  perform public.houndopoly_log(p_challenge_id, p_day, p_from, p_kind, p_idx, paid, p_to, jsonb_build_object('owed', p_amount));
  if paid < p_amount then
    update public.houndopoly_players set bankrupt = true, pending_idx = null, updated_at = now()
      where challenge_id = p_challenge_id and user_id = p_from and not bankrupt;
    perform public.houndopoly_log(p_challenge_id, p_day, p_from, 'bankrupt', p_idx, p_amount - paid, p_to);
  end if;
end;
$$;

revoke execute on function public.houndopoly_pay(uuid, date, uuid, uuid, integer, text, integer) from public, anon, authenticated;

-- Moves a player p_steps squares forward (collecting for passing Start)
-- and settles what they land on. p_steps 0 with p_to set jumps straight
-- there (a card), with no Start payout.
create or replace function public.houndopoly_land(p_challenge_id uuid, p_day date, p_user uuid, p_steps integer, p_to integer default null, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  s public.houndopoly_settings;
  pl public.houndopoly_players;
  sq public.houndopoly_squares;
  owner uuid;
  rent integer;
  card text;
  steps_today integer;
  low_user uuid;
  high_user uuid;
  next_idx integer;
begin
  select * into s from public.houndopoly_settings;
  select * into pl from public.houndopoly_players where challenge_id = p_challenge_id and user_id = p_user for update;
  if not found then
    return;
  end if;

  if p_to is not null then
    update public.houndopoly_players set position = p_to, updated_at = now()
      where challenge_id = p_challenge_id and user_id = p_user;
  else
    if pl.position + p_steps >= 24 then
      update public.houndopoly_players set cash = cash + s.pass_start_cash, updated_at = now()
        where challenge_id = p_challenge_id and user_id = p_user;
      perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'passed_start', 0, s.pass_start_cash);
    end if;
    update public.houndopoly_players set position = (position + p_steps) % 24, updated_at = now()
      where challenge_id = p_challenge_id and user_id = p_user;
  end if;
  select * into pl from public.houndopoly_players where challenge_id = p_challenge_id and user_id = p_user;
  select * into sq from public.houndopoly_squares where idx = pl.position;
  perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'moved', pl.position, p_steps, null, p_detail);

  if sq.kind = 'property' then
    select owner_id into owner from public.houndopoly_deeds where challenge_id = p_challenge_id and idx = sq.idx;
    if owner is null then
      if not pl.bankrupt then
        update public.houndopoly_players set pending_idx = sq.idx, updated_at = now()
          where challenge_id = p_challenge_id and user_id = p_user;
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'landed_for_sale', sq.idx, sq.price);
      end if;
    elsif owner = p_user then
      perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'landed_own', sq.idx);
    else
      rent := public.houndopoly_rent(p_challenge_id, sq.idx);
      perform public.houndopoly_pay(p_challenge_id, p_day, p_user, owner, rent, 'rent', sq.idx);
    end if;

  elsif sq.kind = 'vet' then
    perform public.houndopoly_pay(p_challenge_id, p_day, p_user, null, s.vet_cost, 'vet', sq.idx);

  elsif sq.kind in ('dog_park', 'water_bowl', 'start') then
    perform public.houndopoly_log(p_challenge_id, p_day, p_user, sq.kind, sq.idx);

  elsif sq.kind = 'dog_house' then
    perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'visiting', sq.idx);

  elsif sq.kind = 'fetch' then
    steps_today := coalesce((select steps from public.daily_step_totals t where t.user_id = p_user and t.day = p_day), 0);
    card := (array['workout_bonus', 'streak_advance', 'fewest_steps', 'big_day_again', 'go_to_dog_house'])[1 + floor(random() * 5)::int];

    if card = 'workout_bonus' then
      if exists (select 1 from public.workout_history w where w.user_id = p_user and (w.occurred_at at time zone 'utc')::date = p_day) then
        update public.houndopoly_players set cash = cash + 100, updated_at = now() where challenge_id = p_challenge_id and user_id = p_user;
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, 100, null, jsonb_build_object('card', card, 'hit', true));
      else
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, 0, null, jsonb_build_object('card', card, 'hit', false));
      end if;

    elsif card = 'streak_advance' then
      if exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day) then
        -- The next square for sale, going round; none left means nothing.
        select q.idx into next_idx
        from public.houndopoly_squares q
        where q.kind = 'property'
          and not exists (select 1 from public.houndopoly_deeds d where d.challenge_id = p_challenge_id and d.idx = q.idx)
        order by (q.idx - pl.position + 24) % 24
        limit 1;
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', next_idx is not null, 'to', next_idx));
        if next_idx is not null then
          perform public.houndopoly_land(p_challenge_id, p_day, p_user, (next_idx - pl.position + 24) % 24, null, jsonb_build_object('card', card));
        end if;
      else
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', false));
      end if;

    elsif card = 'fewest_steps' then
      select t.user_id into low_user
      from public.houndopoly_players hp
      left join public.daily_step_totals t on t.user_id = hp.user_id and t.day = p_day
      where hp.challenge_id = p_challenge_id and not hp.bankrupt
      order by coalesce(t.steps, 0) asc, hp.user_id limit 1;
      select hp.user_id into high_user
      from public.houndopoly_players hp
      left join public.daily_step_totals t on t.user_id = hp.user_id and t.day = p_day
      where hp.challenge_id = p_challenge_id
      order by coalesce(t.steps, 0) desc, hp.user_id limit 1;
      if low_user = p_user and high_user <> p_user then
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, high_user, jsonb_build_object('card', card, 'hit', true));
        perform public.houndopoly_pay(p_challenge_id, p_day, p_user, high_user, 50, 'card_pay', sq.idx);
      else
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', false));
      end if;

    elsif card = 'big_day_again' then
      if steps_today >= s.three_dice_steps then
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', true));
        perform public.houndopoly_land(p_challenge_id, p_day, p_user, 1 + floor(random() * 6)::int, null, jsonb_build_object('card', card, 'dice', 1));
      else
        perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', false));
      end if;

    else
      perform public.houndopoly_log(p_challenge_id, p_day, p_user, 'card', sq.idx, null, null, jsonb_build_object('card', card, 'hit', true));
      update public.houndopoly_players set pending_idx = null, updated_at = now() where challenge_id = p_challenge_id and user_id = p_user;
      perform public.houndopoly_land(p_challenge_id, p_day, p_user, 0, 6, jsonb_build_object('card', card));
    end if;
  end if;
end;
$$;

revoke execute on function public.houndopoly_land(uuid, date, uuid, integer, integer, jsonb) from public, anon, authenticated;

-- How many dice a day's steps earn.
create or replace function public.houndopoly_dice(p_steps integer, s public.houndopoly_settings)
returns integer
language sql
immutable
as $$
  select case
    when p_steps < s.dog_house_steps then 0
    when p_steps < s.two_dice_steps then 1
    when p_steps < s.three_dice_steps then 2
    else 3
  end;
$$;

-- Rolls one day for one game: every player who had joined by then and
-- hasn't rolled it. A square still held from the day before goes back
-- on the market first.
create or replace function public.houndopoly_roll_day(p_challenge_id uuid, p_day date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  s public.houndopoly_settings;
  pl record;
  steps integer;
  dice integer;
  total integer;
  i integer;
begin
  select * into s from public.houndopoly_settings;
  insert into public.houndopoly_days (challenge_id, day) values (p_challenge_id, p_day);

  for pl in
    select * from public.houndopoly_players hp
    where hp.challenge_id = p_challenge_id and hp.joined_day < p_day
    order by hp.user_id
  loop
    if pl.pending_idx is not null then
      perform public.houndopoly_log(p_challenge_id, p_day, pl.user_id, 'passed', pl.pending_idx);
      update public.houndopoly_players set pending_idx = null, updated_at = now()
        where challenge_id = p_challenge_id and user_id = pl.user_id;
    end if;
    steps := coalesce((select t.steps from public.daily_step_totals t where t.user_id = pl.user_id and t.day = p_day), 0);
    dice := public.houndopoly_dice(steps, s);
    if dice = 0 then
      perform public.houndopoly_log(p_challenge_id, p_day, pl.user_id, 'stayed_in', pl.position, null, null, jsonb_build_object('steps', steps));
      continue;
    end if;
    total := 0;
    for i in 1..dice loop
      total := total + 1 + floor(random() * 6)::int;
    end loop;
    perform public.houndopoly_land(p_challenge_id, p_day, pl.user_id, total, null, jsonb_build_object('steps', steps, 'dice', dice));
  end loop;
end;
$$;

revoke execute on function public.houndopoly_roll_day(uuid, date) from public, anon, authenticated;

-- Rolls every day of a game that's over everywhere and not yet rolled,
-- from its first day through its last. The app calls it when a game is
-- opened; the nightly job calls it for every game. Safe to call often.
create or replace function public.houndopoly_advance(p_challenge_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  s public.houndopoly_settings;
  caller uuid := auth.uid();
  d date;
  last_day date;
  cutoff date;
  n integer := 0;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'houndopoly' then
    return 0;
  end if;
  if caller is not null and not public.is_challenge_participant(p_challenge_id, caller) and c.created_by <> caller then
    raise exception 'Only players can do that.';
  end if;
  select * into s from public.houndopoly_settings;
  last_day := public.houndopoly_first_day(c) + c.duration_days - 1;
  -- The latest day that's over everywhere: yesterday (UTC) once the roll
  -- hour has passed, otherwise the day before.
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= s.roll_hour_utc then 1 else 2 end;
  for d in
    select g::date from generate_series(public.houndopoly_first_day(c)::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') g
    where not exists (select 1 from public.houndopoly_days hd where hd.challenge_id = p_challenge_id and hd.day = g::date)
    order by g
  loop
    perform public.houndopoly_roll_day(p_challenge_id, d);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.houndopoly_advance(uuid) from public, anon;
grant execute on function public.houndopoly_advance(uuid) to authenticated;

-- Buy the square held for you, or let it go.
create or replace function public.houndopoly_decide(p_challenge_id uuid, p_buy boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pl public.houndopoly_players;
  sq public.houndopoly_squares;
  today date := (now() at time zone 'utc')::date;
begin
  select * into pl from public.houndopoly_players where challenge_id = p_challenge_id and user_id = auth.uid() for update;
  if not found or pl.pending_idx is null then
    raise exception 'Nothing is waiting for you to decide.';
  end if;
  select * into sq from public.houndopoly_squares where idx = pl.pending_idx;
  if p_buy then
    if pl.bankrupt then
      raise exception 'You''re bankrupt; you can''t buy.';
    end if;
    if exists (select 1 from public.houndopoly_deeds d where d.challenge_id = p_challenge_id and d.idx = sq.idx) then
      raise exception 'Someone got there first.';
    end if;
    if pl.cash < sq.price then
      raise exception 'Not enough cash: % costs % and you have %.', sq.name, sq.price, pl.cash;
    end if;
    insert into public.houndopoly_deeds (challenge_id, idx, owner_id, bought_on) values (p_challenge_id, sq.idx, auth.uid(), today);
    update public.houndopoly_players set cash = cash - sq.price, pending_idx = null, updated_at = now()
      where challenge_id = p_challenge_id and user_id = auth.uid();
    perform public.houndopoly_log(p_challenge_id, today, auth.uid(), 'bought', sq.idx, sq.price);
  else
    update public.houndopoly_players set pending_idx = null, updated_at = now()
      where challenge_id = p_challenge_id and user_id = auth.uid();
    perform public.houndopoly_log(p_challenge_id, today, auth.uid(), 'passed', sq.idx);
  end if;
end;
$$;

revoke execute on function public.houndopoly_decide(uuid, boolean) from public, anon;
grant execute on function public.houndopoly_decide(uuid, boolean) to authenticated;

-- ── Nightly ──────────────────────────────────────────────────────────

create or replace function public.houndopoly_advance_all()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.challenges
    where kind = 'houndopoly' and score_settled_at is null and starts_at < now()
    order by starts_at
  loop
    begin
      n := n + public.houndopoly_advance(r.id);
    exception when others then
      raise warning 'houndopoly_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public.houndopoly_advance_all() from public, anon, authenticated;

-- 11:15 UTC daily, just after the roll hour.
select cron.schedule('hound-houndopoly-advance', '15 11 * * *', $$ select public.houndopoly_advance_all(); $$);

-- ── Settlement ───────────────────────────────────────────────────────
--
-- 0126's settlement core and global places, and 0131's publish, each
-- with one more branch: a Hound'opoly game rolls any day still owed,
-- then places by net worth; a global one pays the top three by net
-- worth; and it can be published as a Global Hound Challenge.
-- settle_challenge_score needs no change: it's competitive and
-- time-based, like a Step Race.

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
  bones_trickle constant int := 5;
  bones_per_level constant int := 25;
  first_day date;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  concluded := now() >= c.ends_at;

  if not concluded and c.kind = 'tag' then
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
  if c.kind::text in ('seventyfive', 'checklist') or c.prize_bones is null then
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
  p_distance_source text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  ends timestamptz;
  new_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can publish a global challenge.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability or Hound''opoly.';
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
    distance_source, is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;


revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text, text) to authenticated;
