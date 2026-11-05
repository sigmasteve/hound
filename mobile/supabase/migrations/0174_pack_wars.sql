-- Hound: Pack Wars. See 0173_packs_challenge_kind.sql for the enum value
-- this depends on (it must already be committed).
--
-- Four packs, one neighborhood map of 24 territories (6 across, 4 down,
-- numbered row by row from the top left). Everyone who joins is put in
-- the pack with the fewest members (ties broken by a seeded roll), so the
-- packs stay even, and each pack starts on its own corner:
--
--   wolves 0 (top left)   goldens 5 (top right)
--   collies 18 (bottom left)   beagles 23 (bottom right)
--
-- Each day a member votes, on their own date, where their pack marches:
-- a territory next to ground it holds (anywhere, for a pack with no ground
-- left), or Hold. Voting is the daily check-in: only members who voted
-- that day add their steps, and the pack's strength is those steps over
-- all its members, so a big pack doesn't win on numbers alone and a pack
-- whose members don't vote is weak.
--
-- Once the day is over everywhere (11:20 UTC the next morning), every
-- pack marches on its most-voted spot (ties: Hold first, then the lowest
-- number). A territory goes to the strongest pack marching on it when
-- that beats its owner's defence: the owner's full strength if it held,
-- half if it marched elsewhere; nobody's for open ground. A tie leaves it
-- where it was. All of it from the ground as it stood that morning.
--
-- Steps for a day are the synced day's total (daily_step_totals) or the
-- phone's own count for it (pack_claim_steps), whichever is more: the
-- server keeps steps by UTC day, which runs ahead of a US evening.
--
-- Most territory when it ends wins (a tie shares it). Everyone in the
-- winning pack gets the win Bones and everyone else the finishing Bones,
-- on top of the usual 5; both are Admin's (pack_settings).
--
--   pack_settings      the admin knobs (one row)
--   pack_members       who's in which pack
--   pack_territories   who holds each of the 24, and since when
--   pack_votes         one vote per member per day, with the phone's
--                      steps for it
--   pack_days          which days each game has played
--   pack_moves         what changed hands each night, for the morning
--
-- Pushes: the morning (14:47 UTC) with how the pack did overnight, and the
-- early evening (23:47 UTC) to anyone who hasn't voted today. They need
-- the send-packs-notification Edge Function deployed; without it the game
-- plays, quietly.
--
-- Global only: publish_global_challenge takes 'packs', 7 to 30 days.
--
-- Run this once, after 0173 (as its own, separately committed
-- transaction), in the SQL Editor.
--
-- Undo, if needed: unschedule hound-packs-advance, hound-packs-morning and
-- hound-packs-evening; drop the six tables, the pack_* functions and the
-- pack_after_join trigger; re-run settle_challenge_score_core and
-- publish_global_challenge from 0172. The enum value stays.

-- ── Settings ─────────────────────────────────────────────────────────

create table public.pack_settings (
  id boolean primary key default true,
  constraint pack_settings_singleton check (id),
  -- Everyone in the winning pack.
  win_bones int not null default 50 check (win_bones between 0 and 1000),
  -- Everyone else.
  finish_bones int not null default 20 check (finish_bones between 0 and 1000),
  updated_at timestamptz not null default now()
);

insert into public.pack_settings (id) values (true);

alter table public.pack_settings enable row level security;

create policy "Anyone signed in can read the Pack Wars settings"
  on public.pack_settings for select to authenticated
  using (true);

create policy "Only admins can change the Pack Wars settings"
  on public.pack_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

revoke all on public.pack_settings from anon;
revoke insert, delete on public.pack_settings from authenticated;

-- ── The game ─────────────────────────────────────────────────────────

create table public.pack_members (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack text not null check (pack in ('wolves', 'goldens', 'collies', 'beagles')),
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index pack_members_pack on public.pack_members (challenge_id, pack);

create table public.pack_territories (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  idx int not null check (idx between 0 and 23),
  owner text check (owner in ('wolves', 'goldens', 'collies', 'beagles')),
  since date,
  primary key (challenge_id, idx)
);

create table public.pack_votes (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  -- A territory, or -1 to hold.
  target int not null check (target between -1 and 23),
  -- The phone's own count for the day, the most it's reported.
  steps int check (steps between 0 and 150000),
  voted_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day)
);

create index pack_votes_day on public.pack_votes (challenge_id, day);

create table public.pack_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  played_at timestamptz not null default now(),
  primary key (challenge_id, day)
);

create table public.pack_moves (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day date not null,
  idx int not null,
  pack text not null,
  from_pack text,
  -- Steps a member, the winner's and what it beat (null: open ground
  -- nobody else marched on).
  strength int not null,
  beat int,
  primary key (challenge_id, day, idx)
);

alter table public.pack_members enable row level security;
alter table public.pack_territories enable row level security;
alter table public.pack_votes enable row level security;
alter table public.pack_days enable row level security;
alter table public.pack_moves enable row level security;

-- Everyone in it sees the packs and the map; a vote is your own until
-- it's counted (pack_state shows your pack's tally).
create policy "Players see who's in which pack" on public.pack_members for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));
create policy "Players see the map" on public.pack_territories for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));
create policy "Members see their own votes" on public.pack_votes for select to authenticated
  using (user_id = auth.uid());
create policy "Players see which days have played" on public.pack_days for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));
create policy "Players see what changed hands" on public.pack_moves for select to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));

revoke all on public.pack_members, public.pack_territories, public.pack_votes, public.pack_days, public.pack_moves from anon;
revoke insert, update, delete on public.pack_members, public.pack_territories, public.pack_votes, public.pack_days, public.pack_moves from authenticated;

-- ── Pieces ───────────────────────────────────────────────────────────

-- Day 1: the challenge's own start day, else its start in US Eastern time.
create or replace function public.pack_first_day(c public.challenges)
returns date
language sql
immutable
as $$
  select coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
$$;

revoke execute on function public.pack_first_day(public.challenges) from public, anon, authenticated;

create or replace function public.pack_home(p_pack text)
returns int
language sql
immutable
as $$
  select case p_pack when 'wolves' then 0 when 'goldens' then 5 when 'collies' then 18 else 23 end;
$$;

revoke execute on function public.pack_home(text) from public, anon, authenticated;

-- Up, down, left and right on the 6 x 4 map.
create or replace function public.pack_neighbors(p_idx int)
returns int[]
language sql
immutable
as $$
  select array_remove(array[
    case when p_idx >= 6 then p_idx - 6 end,
    case when p_idx < 18 then p_idx + 6 end,
    case when p_idx % 6 > 0 then p_idx - 1 end,
    case when p_idx % 6 < 5 then p_idx + 1 end
  ], null);
$$;

revoke execute on function public.pack_neighbors(int) from public, anon;
grant execute on function public.pack_neighbors(int) to authenticated;

-- Whether a pack may march on a territory now: one it doesn't hold, next
-- to one it does; anywhere it doesn't hold, once it holds nothing.
create or replace function public.pack_can_march(p_challenge_id uuid, p_pack text, p_idx int)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_idx between 0 and 23
    and not exists (select 1 from public.pack_territories t where t.challenge_id = p_challenge_id and t.idx = p_idx and t.owner = p_pack)
    and (
      not exists (select 1 from public.pack_territories t where t.challenge_id = p_challenge_id and t.owner = p_pack)
      or exists (
        select 1 from public.pack_territories t
        where t.challenge_id = p_challenge_id and t.owner = p_pack and t.idx = any (public.pack_neighbors(p_idx))));
$$;

revoke execute on function public.pack_can_march(uuid, text, int) from public, anon, authenticated;

-- The map, the first time anyone joins: each pack on its corner.
create or replace function public.pack_ensure_map(p_challenge_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.pack_territories (challenge_id, idx, owner)
  select p_challenge_id, g, case g when 0 then 'wolves' when 5 then 'goldens' when 18 then 'collies' when 23 then 'beagles' end
  from generate_series(0, 23) g
  on conflict do nothing;
$$;

revoke execute on function public.pack_ensure_map(uuid) from public, anon, authenticated;

-- Joining a Pack Wars challenge puts you in the smallest pack.
create or replace function public.pack_after_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  k public.challenge_kind;
  pick text;
begin
  select kind into k from public.challenges where id = new.challenge_id;
  if k <> 'packs' then
    return new;
  end if;
  perform public.pack_ensure_map(new.challenge_id);
  -- Serialise joins on one game so two at once can't both pick the same
  -- smallest pack.
  perform pg_advisory_xact_lock(hashtext('packs:' || new.challenge_id::text));
  select p into pick
  from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p
  order by (select count(*) from public.pack_members m where m.challenge_id = new.challenge_id and m.pack = p),
           md5(new.user_id::text || p)
  limit 1;
  insert into public.pack_members (challenge_id, user_id, pack) values (new.challenge_id, new.user_id, pick)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.pack_after_join() from public, anon, authenticated;

create trigger pack_after_join
  after insert on public.challenge_participants
  for each row execute procedure public.pack_after_join();

-- A pack's strength on a day: its voters' steps over all its members.
create or replace function public.pack_strength(p_challenge_id uuid, p_pack text, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select (sum(greatest(coalesce(v.steps, 0), coalesce(d.steps, 0))) / nullif(
      (select count(*) from public.pack_members m2 where m2.challenge_id = p_challenge_id and m2.pack = p_pack), 0))::int
    from public.pack_votes v
    join public.pack_members m on m.challenge_id = v.challenge_id and m.user_id = v.user_id and m.pack = p_pack
    left join public.daily_step_totals d on d.user_id = v.user_id and d.day = v.day
    where v.challenge_id = p_challenge_id and v.day = p_day
  ), 0);
$$;

revoke execute on function public.pack_strength(uuid, text, date) from public, anon, authenticated;

-- Where a pack marches on a day: its most-voted spot (Hold, -1, first on a
-- tie, then the lowest number); Hold with no votes.
create or replace function public.pack_target(p_challenge_id uuid, p_pack text, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select v.target
    from public.pack_votes v
    join public.pack_members m on m.challenge_id = v.challenge_id and m.user_id = v.user_id and m.pack = p_pack
    where v.challenge_id = p_challenge_id and v.day = p_day
    group by v.target
    order by count(*) desc, v.target
    limit 1
  ), -1);
$$;

revoke execute on function public.pack_target(uuid, text, date) from public, anon, authenticated;

-- Plays one day: every pack's march at once, from the map as it stood.
create or replace function public.pack_play_day(p_challenge_id uuid, p_day date)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  changed int := 0;
  def int;
  packs text[];
  strengths int[];
begin
  if exists (select 1 from public.pack_days d where d.challenge_id = p_challenge_id and d.day = p_day) then
    return 0;
  end if;

  create temp table if not exists pack_marches (pack text, target int, strength int) on commit drop;
  delete from pack_marches where true;
  insert into pack_marches
  select p, public.pack_target(p_challenge_id, p, p_day), public.pack_strength(p_challenge_id, p, p_day)
  from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p;

  for r in
    select t.idx, t.owner from public.pack_territories t
    where t.challenge_id = p_challenge_id and exists (select 1 from pack_marches m where m.target = t.idx)
    order by t.idx
  loop
    -- Who marched on it, strongest first.
    select array_agg(m.pack order by m.strength desc, m.pack), array_agg(m.strength order by m.strength desc, m.pack)
    into packs, strengths
    from pack_marches m
    where m.target = r.idx and m.strength > 0 and public.pack_can_march(p_challenge_id, m.pack, r.idx);
    continue when packs is null;
    -- Two level at the top: nobody takes it.
    continue when array_length(strengths, 1) > 1 and strengths[1] = strengths[2];
    -- The owner's defence: all of it on a Hold, half while marching.
    def := case
      when r.owner is null then 0
      when (select m.target from pack_marches m where m.pack = r.owner) = -1 then (select m.strength from pack_marches m where m.pack = r.owner)
      else (select m.strength from pack_marches m where m.pack = r.owner) / 2 end;
    continue when strengths[1] <= def;
    insert into public.pack_moves (challenge_id, day, idx, pack, from_pack, strength, beat)
    values (p_challenge_id, p_day, r.idx, packs[1], r.owner, strengths[1], nullif(greatest(def, coalesce(strengths[2], 0)), 0));
    changed := changed + 1;
  end loop;

  update public.pack_territories t
    set owner = mv.pack, since = p_day
    from public.pack_moves mv
    where mv.challenge_id = p_challenge_id and mv.day = p_day and t.challenge_id = p_challenge_id and t.idx = mv.idx;

  insert into public.pack_days (challenge_id, day) values (p_challenge_id, p_day);
  return changed;
end;
$$;

revoke execute on function public.pack_play_day(uuid, date) from public, anon, authenticated;

-- Plays every day that's over everywhere and not played yet.
create or replace function public.pack_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  d date;
  last_day date;
  cutoff date;
  n int := 0;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.kind <> 'packs' then
    return 0;
  end if;
  last_day := public.pack_first_day(c) + c.duration_days - 1;
  -- The latest day that's over everywhere: yesterday (UTC) from 11:00
  -- UTC, otherwise the day before.
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  for d in
    select g::date from generate_series(public.pack_first_day(c)::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') g
    where not exists (select 1 from public.pack_days pd where pd.challenge_id = p_challenge_id and pd.day = g::date)
    order by g
  loop
    perform public.pack_play_day(p_challenge_id, d);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.pack_advance(uuid) from public, anon, authenticated;

-- ── What the app does ────────────────────────────────────────────────

-- The game for the caller, as of p_day (the phone's date).
create or replace function public.pack_state(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  mine text;
  last_played date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind <> 'packs' then
    raise exception 'That isn''t a Pack Wars challenge.';
  end if;
  select m.pack into mine from public.pack_members m where m.challenge_id = p_challenge_id and m.user_id = me;
  if mine is null then
    raise exception 'Join the challenge to see the map.';
  end if;
  perform public.pack_advance(p_challenge_id);
  select max(d.day) into last_played from public.pack_days d where d.challenge_id = p_challenge_id;

  return jsonb_build_object(
    'firstDay', public.pack_first_day(c),
    'days', c.duration_days,
    'myPack', mine,
    'map', (select jsonb_agg(jsonb_build_object('idx', t.idx, 'owner', t.owner) order by t.idx)
            from public.pack_territories t where t.challenge_id = p_challenge_id),
    'members', (select jsonb_object_agg(p, (select count(*) from public.pack_members m where m.challenge_id = p_challenge_id and m.pack = p))
                from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p),
    'myVote', (select v.target from public.pack_votes v where v.challenge_id = p_challenge_id and v.user_id = me and v.day = p_day),
    'packVotes', coalesce((
      select jsonb_agg(jsonb_build_object('idx', x.target, 'votes', x.n) order by x.n desc, x.target)
      from (
        select v.target, count(*) as n
        from public.pack_votes v
        join public.pack_members m on m.challenge_id = v.challenge_id and m.user_id = v.user_id and m.pack = mine
        where v.challenge_id = p_challenge_id and v.day = p_day
        group by v.target
      ) x), '[]'::jsonb),
    'votedToday', (select count(*) from public.pack_votes v
                   join public.pack_members m on m.challenge_id = v.challenge_id and m.user_id = v.user_id and m.pack = mine
                   where v.challenge_id = p_challenge_id and v.day = p_day),
    'lastDay', last_played,
    'lastNight', coalesce((
      select jsonb_agg(jsonb_build_object('idx', mv.idx, 'to', mv.pack, 'from', mv.from_pack, 'avg', mv.strength, 'vsAvg', mv.beat) order by mv.idx)
      from public.pack_moves mv where mv.challenge_id = p_challenge_id and mv.day = last_played), '[]'::jsonb),
    'settled', c.score_settled_at is not null,
    'winBones', (select s.win_bones from public.pack_settings s),
    'finishBones', (select s.finish_bones from public.pack_settings s)
  );
end;
$$;

revoke execute on function public.pack_state(uuid, date) from public, anon;
grant execute on function public.pack_state(uuid, date) to authenticated;

-- Votes where the caller's pack marches today (p_day, the phone's date):
-- a territory it can march on, or -1 to hold. A new vote replaces the old.
create or replace function public.pack_vote(p_challenge_id uuid, p_day date, p_target int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  c public.challenges;
  mine text;
  first date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if exists (select 1 from public.profiles p where p.id = me and p.time_zone is not null)
     and p_day <> public.soccer_today(me) then
    raise exception 'You can only vote for today.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind <> 'packs' then
    raise exception 'That isn''t a Pack Wars challenge.';
  end if;
  if c.score_settled_at is not null then
    raise exception 'This one''s over.';
  end if;
  select m.pack into mine from public.pack_members m where m.challenge_id = p_challenge_id and m.user_id = me;
  if mine is null then
    raise exception 'Join the challenge to vote.';
  end if;
  first := public.pack_first_day(c);
  if p_day < first or p_day > first + c.duration_days - 1 then
    raise exception 'There''s no march today.';
  end if;
  perform public.pack_advance(p_challenge_id);
  if p_target is null or (p_target <> -1 and not public.pack_can_march(p_challenge_id, mine, p_target)) then
    raise exception 'Your pack can''t reach that one yet.';
  end if;
  insert into public.pack_votes (challenge_id, user_id, day, target)
  values (p_challenge_id, me, p_day, p_target)
  on conflict (challenge_id, user_id, day) do update set target = excluded.target, voted_at = now();
  return public.pack_state(p_challenge_id, p_day);
end;
$$;

revoke execute on function public.pack_vote(uuid, date, int) from public, anon;
grant execute on function public.pack_vote(uuid, date, int) to authenticated;

-- The phone's own count for today, on the caller's vote (no vote, no
-- effect: only voters' steps count). Trusted like a water day (0153).
create or replace function public.pack_claim_steps(p_challenge_id uuid, p_day date, p_steps int)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 or p_steps is null or p_steps < 0 or p_steps > 150000 then
    raise exception 'Invalid steps.';
  end if;
  update public.pack_votes v
    set steps = greatest(coalesce(v.steps, 0), p_steps)
    where v.challenge_id = p_challenge_id and v.user_id = auth.uid() and v.day = p_day
      and not exists (select 1 from public.pack_days d where d.challenge_id = p_challenge_id and d.day = p_day);
end;
$$;

revoke execute on function public.pack_claim_steps(uuid, date, int) from public, anon;
grant execute on function public.pack_claim_steps(uuid, date, int) to authenticated;

-- ── Jobs ─────────────────────────────────────────────────────────────

create or replace function public.pack_advance_all()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select c.id from public.challenges c where c.kind = 'packs' and c.score_settled_at is null and c.starts_at <= now() loop
    n := n + public.pack_advance(r.id);
  end loop;
  return n;
end;
$$;

revoke execute on function public.pack_advance_all() from public, anon, authenticated;

select cron.schedule('hound-packs-advance', '20 11 * * *', $$ select public.pack_advance_all(); $$);

create or replace function public.pack_notify(p_kind text, p_challenge_id uuid, p_pack text, p_extra jsonb, p_recipients uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(array_length(p_recipients, 1), 0) = 0 then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-packs-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', p_kind, 'challenge_id', p_challenge_id, 'pack', p_pack, 'recipient_ids', to_jsonb(p_recipients)) || p_extra
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.pack_notify(text, uuid, text, jsonb, uuid[]) from public, anon, authenticated;

-- 'morning': each pack hears what it took and lost overnight and how much
-- ground it holds. 'evening': anyone who hasn't voted today. Returns how
-- many people it was sent for.
create or replace function public.pack_push(p_kind text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  p text;
  n int := 0;
  today date := (now() at time zone 'America/New_York')::date;
  last_played date;
  who uuid[];
begin
  for c in
    select * from public.challenges ch where ch.kind = 'packs' and ch.score_settled_at is null and ch.starts_at <= now()
  loop
    continue when today < public.pack_first_day(c) or today > public.pack_first_day(c) + c.duration_days - 1;
    select max(d.day) into last_played from public.pack_days d where d.challenge_id = c.id;
    foreach p in array array['wolves', 'goldens', 'collies', 'beagles'] loop
      select array_agg(m.user_id) into who
      from public.pack_members m
      where m.challenge_id = c.id and m.pack = p
        and (p_kind = 'morning' or not exists (
          select 1 from public.pack_votes v where v.challenge_id = c.id and v.user_id = m.user_id and v.day = public.soccer_today(m.user_id)));
      perform public.pack_notify(p_kind, c.id, p, jsonb_build_object(
        'took', (select count(*) from public.pack_moves mv where mv.challenge_id = c.id and mv.day = last_played and mv.pack = p),
        'lost', (select count(*) from public.pack_moves mv where mv.challenge_id = c.id and mv.day = last_played and mv.from_pack = p),
        'held', (select count(*) from public.pack_territories t where t.challenge_id = c.id and t.owner = p)
      ), who);
      n := n + coalesce(array_length(who, 1), 0);
    end loop;
  end loop;
  return n;
end;
$$;

revoke execute on function public.pack_push(text) from public, anon, authenticated;

select cron.schedule('hound-packs-morning', '47 14 * * *', $$ select public.pack_push('morning'); $$);
select cron.schedule('hound-packs-evening', '47 23 * * *', $$ select public.pack_push('evening'); $$);

-- ── Admin ────────────────────────────────────────────────────────────

-- Admin → Overview → Pack Wars: who's joined, who votes each day, and how
-- each live game's map stands.
create or replace function public.admin_packs_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  return jsonb_build_object(
    'challenges', (select count(*) from public.challenges c where c.kind = 'packs'),
    'live', (select count(*) from public.challenges c where c.kind = 'packs' and c.score_settled_at is null and c.starts_at <= now()),
    'joined', (select count(*) from public.pack_members),
    'everVoted', (select count(distinct v.user_id) from public.pack_votes v),
    'votedToday', (select count(*) from public.pack_votes v where v.day = today),
    'votes', (select count(*) from public.pack_votes),
    'holds', (select count(*) from public.pack_votes v where v.target = -1),
    'settings', (select jsonb_build_object('winBones', s.win_bones, 'finishBones', s.finish_bones) from public.pack_settings s),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'voted', d.n) order by d.day desc)
      from (select v.day, count(*) as n from public.pack_votes v where v.day > today - 14 group by v.day) d
    ), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name,
          'day', today - public.pack_first_day(c) + 1,
          'days', c.duration_days,
          'packs', (select jsonb_object_agg(p, jsonb_build_object(
              'members', (select count(*) from public.pack_members m where m.challenge_id = c.id and m.pack = p),
              'votedToday', (select count(*) from public.pack_votes v join public.pack_members m on m.challenge_id = v.challenge_id and m.user_id = v.user_id
                             where v.challenge_id = c.id and m.pack = p and v.day = today),
              'held', (select count(*) from public.pack_territories t where t.challenge_id = c.id and t.owner = p)))
            from unnest(array['wolves', 'goldens', 'collies', 'beagles']) p)
        ) order by c.starts_at desc)
      from public.challenges c
      where c.kind = 'packs' and c.score_settled_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_packs_overview() from public, anon;
grant execute on function public.admin_packs_overview() to authenticated;

-- ── Scoring and publishing ───────────────────────────────────────────

-- Scoring: 0172's core with a Pack Wars branch. The wrapper (0167) needs
-- no change: Pack Wars is time-based, settled 24 hours after it ends.
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

  -- A Cricket match ends once the second innings is over: that can be
  -- well before ends_at, or the morning after it.
  if c.kind = 'cricket' then
    perform public.cricket_advance(p_challenge_id);
    select * into cg from public.cricket_games where challenge_id = p_challenge_id;
    concluded := found and cg.status = 'final';
  end if;

  -- A Baseball game ends after its last inning, which can be days past
  -- ends_at in extra innings, or before it on a skipped bottom half.
  if c.kind = 'baseball' then
    perform public.baseball_advance(p_challenge_id);
    select * into bg from public.baseball_games where challenge_id = p_challenge_id;
    concluded := found and bg.status = 'final';
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

-- Publishing: 0172's, with Pack Wars among the global kinds (7 to 30 days).
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
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors', 'packs') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly, Daily Doors or Pack Wars.';
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
