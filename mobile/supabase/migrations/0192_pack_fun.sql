-- Hound: Pack Fun, a live session for a group walking, running or
-- hiking together (Steve: "a group of 6 people doing a hike, and along
-- the hike, there are mini-games or puzzles... a real-time challenge
-- that is short-lived").
--
--   - Anyone starts one (friends, or open to a club), 30 min to 4 hours.
--   - Each phone reports its steps since the start (and, with the live
--     map, where it is) with pack_fun_ping, every few seconds while Hound
--     is open and in the background while the map is on. The same call
--     returns the board, so the app just polls.
--   - Scent trails: every so many pack steps a puzzle from the bank opens
--     for a few minutes. First right answer earns the most Bones.
--   - Flash challenges: anyone starts a Dash (most steps in N minutes)
--     or a Pack push (the pack hits a step target together).
--   - The live map (from 1.2.0): members' positions, shared only with
--     their pack and only until it ends; bones dropped near the pack to
--     walk to.
--   - At the end, everyone who walked gets the finish bonus.
--
-- Every Bones amount and the daily cap are Admin settings
-- (pack_fun_config), and every award goes through pack_fun_award, which
-- applies the cap. Bones only flow in a Pack Fun with two or more
-- people in it.
--
-- Run once, after 0191, in the SQL Editor; then deploy send-social-push
-- (it gains the 'pack_fun' push).

create table if not exists public.pack_fun_config (
  id boolean primary key default true,
  constraint pack_fun_config_singleton check (id),
  enabled boolean not null default true,
  trail_first_bones integer not null default 25 check (trail_first_bones between 0 and 500),
  trail_answer_bones integer not null default 5 check (trail_answer_bones between 0 and 500),
  flash_win_bones integer not null default 20 check (flash_win_bones between 0 and 500),
  push_bonus_bones integer not null default 10 check (push_bonus_bones between 0 and 500),
  finish_bonus_bones integer not null default 30 check (finish_bonus_bones between 0 and 500),
  bone_find_bones integer not null default 10 check (bone_find_bones between 0 and 500),
  daily_cap integer not null default 150 check (daily_cap between 0 and 5000),
  trail_every_steps integer not null default 2000 check (trail_every_steps between 200 and 50000),
  trail_minutes integer not null default 5 check (trail_minutes between 1 and 30),
  finish_min_steps integer not null default 1000 check (finish_min_steps between 0 and 50000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.pack_fun_config (id) values (true) on conflict (id) do nothing;
alter table public.pack_fun_config enable row level security;
drop policy if exists "Anyone signed in reads the Pack Fun settings" on public.pack_fun_config;
create policy "Anyone signed in reads the Pack Fun settings" on public.pack_fun_config for select to authenticated using (true);
revoke insert, update, delete on public.pack_fun_config from anon, authenticated;

create table if not exists public.pack_funs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  club_id uuid references public.clubs (id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  trails_on boolean not null default true,
  flash_on boolean not null default true,
  map_on boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index if not exists pack_funs_ends on public.pack_funs (ends_at) where settled_at is null;

create table if not exists public.pack_fun_members (
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  steps integer not null default 0 check (steps >= 0),
  steps_at timestamptz,
  live_at timestamptz,
  muted boolean not null default false,
  lat double precision,
  lng double precision,
  loc_at timestamptz,
  primary key (pack_id, user_id)
);
create index if not exists pack_fun_members_user on public.pack_fun_members (user_id);

create table if not exists public.pack_fun_puzzles (
  id serial primary key,
  kind text not null default 'riddle' check (kind in ('riddle', 'trivia', 'emoji')),
  question text not null,
  choices text[] not null check (array_length(choices, 1) between 2 and 4),
  answer integer not null check (answer >= 0 and answer < 4),
  active boolean not null default true
);

create table if not exists public.pack_fun_trails (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  seq integer not null,
  puzzle_id integer not null references public.pack_fun_puzzles (id),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  first_user uuid references public.profiles (id) on delete set null,
  unique (pack_id, seq)
);

create table if not exists public.pack_fun_answers (
  trail_id uuid not null references public.pack_fun_trails (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  choice integer not null,
  correct boolean not null,
  bones integer not null default 0,
  answered_at timestamptz not null default now(),
  primary key (trail_id, user_id)
);

create table if not exists public.pack_fun_flashes (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  kind text not null check (kind in ('dash', 'push')),
  started_by uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  target integer,
  start_steps jsonb not null default '{}'::jsonb,
  settled_at timestamptz,
  result jsonb
);
create unique index if not exists pack_fun_flashes_one_open on public.pack_fun_flashes (pack_id) where settled_at is null;

create table if not exists public.pack_fun_cheers (
  id bigint generated always as identity primary key,
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('go', 'wait', 'water', 'nice')),
  created_at timestamptz not null default now()
);

create table if not exists public.pack_fun_bones (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  dropped_at timestamptz not null default now(),
  expires_at timestamptz not null,
  found_by uuid references public.profiles (id) on delete set null,
  found_at timestamptz
);

-- Every Bone a Pack Fun gave, for the daily cap and Admin.
create table if not exists public.pack_fun_rewards (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid not null references public.pack_funs (id) on delete cascade,
  reason text not null,
  wanted integer not null,
  bones integer not null,
  created_at timestamptz not null default now()
);
create index if not exists pack_fun_rewards_user on public.pack_fun_rewards (user_id, created_at desc);

alter table public.pack_funs enable row level security;
alter table public.pack_fun_members enable row level security;
alter table public.pack_fun_puzzles enable row level security;
alter table public.pack_fun_trails enable row level security;
alter table public.pack_fun_answers enable row level security;
alter table public.pack_fun_flashes enable row level security;
alter table public.pack_fun_cheers enable row level security;
alter table public.pack_fun_bones enable row level security;
alter table public.pack_fun_rewards enable row level security;
revoke all on public.pack_funs, public.pack_fun_members, public.pack_fun_puzzles, public.pack_fun_trails,
  public.pack_fun_answers, public.pack_fun_flashes, public.pack_fun_cheers, public.pack_fun_bones,
  public.pack_fun_rewards from anon, authenticated;

-- ── Helpers (internal) ──

create or replace function public.pack_fun_cfg()
returns public.pack_fun_config
language sql
stable
security definer set search_path = public
as $$ select * from public.pack_fun_config where id $$;
revoke execute on function public.pack_fun_cfg() from public, anon, authenticated;

-- Metres between two points.
create or replace function public.pack_fun_metres(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;
revoke execute on function public.pack_fun_metres(double precision, double precision, double precision, double precision) from public, anon, authenticated;

create or replace function public.pack_fun_member_of(p_pack uuid, p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$ select exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = p_user and m.joined_at is not null) $$;
revoke execute on function public.pack_fun_member_of(uuid, uuid) from public, anon, authenticated;

-- Gives Bones, up to what's left of the person's daily cap (the last 24
-- hours), and only in a Pack Fun with two or more people. Returns what
-- was given.
create or replace function public.pack_fun_award(p_user uuid, p_pack uuid, p_reason text, p_bones integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  cfg public.pack_fun_config := public.pack_fun_cfg();
  got integer;
  give integer;
begin
  if coalesce(p_bones, 0) <= 0 then
    return 0;
  end if;
  if (select count(*) from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null) < 2 then
    give := 0;
  else
    select coalesce(sum(r.bones), 0) into got from public.pack_fun_rewards r
     where r.user_id = p_user and r.created_at > now() - interval '24 hours';
    give := greatest(0, least(p_bones, cfg.daily_cap - got));
  end if;
  insert into public.pack_fun_rewards (user_id, pack_id, reason, wanted, bones) values (p_user, p_pack, p_reason, p_bones, give);
  if give > 0 then
    update public.profiles p set bones_balance = p.bones_balance + give, bones_earned_total = p.bones_earned_total + give where p.id = p_user;
  end if;
  return give;
end;
$$;
revoke execute on function public.pack_fun_award(uuid, uuid, text, integer) from public, anon, authenticated;

-- A push to some of the pack (send-social-push 'pack_fun').
create or replace function public.pack_fun_notify(p_pack uuid, p_from uuid, p_to uuid[], p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  p_name text := (select f.name from public.pack_funs f where f.id = p_pack);
begin
  if p_to is null or array_length(p_to, 1) is null then
    return;
  end if;
  perform public.social_notify(jsonb_build_object(
    'kind', 'pack_fun', 'from_user', p_from, 'to_users', to_jsonb(p_to),
    'message', p_message, 'pack_id', p_pack, 'pack_name', p_name, 'challenge_id', null
  ));
end;
$$;
revoke execute on function public.pack_fun_notify(uuid, uuid, uuid[], text) from public, anon, authenticated;

-- Everyone joined and not muted, except p_except.
create or replace function public.pack_fun_listeners(p_pack uuid, p_except uuid)
returns uuid[]
language sql
stable
security definer set search_path = public
as $$
  select coalesce(array_agg(m.user_id), '{}') from public.pack_fun_members m
  where m.pack_id = p_pack and m.joined_at is not null and not m.muted and m.user_id is distinct from p_except
$$;
revoke execute on function public.pack_fun_listeners(uuid, uuid) from public, anon, authenticated;

-- ── Settling: flashes that ran out, and Pack Funs that ended ──

create or replace function public.pack_fun_settle_flash(p_flash uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  f public.pack_fun_flashes;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  winner uuid;
  best integer;
  total integer;
  r record;
begin
  select * into f from public.pack_fun_flashes x where x.id = p_flash and x.settled_at is null for update;
  if f.id is null or f.ends_at > now() then
    return;
  end if;
  if f.kind = 'dash' then
    select m.user_id, m.steps - coalesce((f.start_steps ->> m.user_id::text)::int, m.steps) as gained
      into winner, best
      from public.pack_fun_members m
     where m.pack_id = f.pack_id and m.joined_at is not null
     order by 2 desc, m.steps_at asc nulls last limit 1;
    if winner is not null and best > 0 then
      perform public.pack_fun_award(winner, f.pack_id, 'flash_dash', cfg.flash_win_bones);
    else
      winner := null;
    end if;
    update public.pack_fun_flashes x set settled_at = now(), result = jsonb_build_object('winner', winner, 'steps', best) where x.id = f.id;
  else
    select coalesce(sum(greatest(0, m.steps - coalesce((f.start_steps ->> m.user_id::text)::int, m.steps))), 0) into total
      from public.pack_fun_members m where m.pack_id = f.pack_id and m.joined_at is not null;
    if total >= coalesce(f.target, 0) then
      for r in select m.user_id from public.pack_fun_members m where m.pack_id = f.pack_id and m.joined_at is not null loop
        perform public.pack_fun_award(r.user_id, f.pack_id, 'flash_push', cfg.push_bonus_bones);
      end loop;
    end if;
    update public.pack_fun_flashes x set settled_at = now(), result = jsonb_build_object('total', total, 'made_it', total >= coalesce(f.target, 0)) where x.id = f.id;
  end if;
end;
$$;
revoke execute on function public.pack_fun_settle_flash(uuid) from public, anon, authenticated;

create or replace function public.pack_fun_settle(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  pf public.pack_funs;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  fl record;
  r record;
begin
  select * into pf from public.pack_funs x where x.id = p_pack and x.settled_at is null for update;
  if pf.id is null or pf.ends_at > now() then
    return;
  end if;
  for fl in select x.id from public.pack_fun_flashes x where x.pack_id = p_pack and x.settled_at is null loop
    update public.pack_fun_flashes y set ends_at = least(y.ends_at, now()) where y.id = fl.id;
    perform public.pack_fun_settle_flash(fl.id);
  end loop;
  for r in select m.user_id from public.pack_fun_members m
            where m.pack_id = p_pack and m.joined_at is not null and m.steps >= cfg.finish_min_steps loop
    perform public.pack_fun_award(r.user_id, p_pack, 'finish', cfg.finish_bonus_bones);
  end loop;
  -- Where people were is never kept after the end.
  update public.pack_fun_members m set lat = null, lng = null, loc_at = null where m.pack_id = p_pack;
  update public.pack_funs x set settled_at = now() where x.id = p_pack;
end;
$$;
revoke execute on function public.pack_fun_settle(uuid) from public, anon, authenticated;

-- Every few minutes: Pack Funs that have ended, flashes that ran out.
create or replace function public.pack_fun_settle_due()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in select x.id from public.pack_fun_flashes x where x.settled_at is null and x.ends_at <= now() loop
    perform public.pack_fun_settle_flash(r.id);
  end loop;
  for r in select x.id from public.pack_funs x where x.settled_at is null and x.ends_at <= now() loop
    perform public.pack_fun_settle(r.id);
  end loop;
end;
$$;
revoke execute on function public.pack_fun_settle_due() from public, anon, authenticated;

-- ── Starting and joining ──

-- Invitees must be friends; a club makes it open to its members too.
create or replace function public.start_pack_fun(
  p_name text, p_minutes integer, p_invite uuid[] default '{}', p_club uuid default null,
  p_trails boolean default true, p_flash boolean default true, p_map boolean default false,
  p_starts_at timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_start timestamptz := greatest(coalesce(p_starts_at, now()), now());
  invitees uuid[];
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  if not (public.pack_fun_cfg()).enabled then
    raise exception 'Pack Fun is paused right now.';
  end if;
  if v_name = '' then
    raise exception 'Give it a name.';
  end if;
  if p_minutes not in (30, 60, 120, 240) then
    raise exception 'Pick 30 minutes, 1, 2 or 4 hours.';
  end if;
  if v_start > now() + interval '14 days' then
    raise exception 'Start it within two weeks.';
  end if;
  if p_club is not null and not exists (select 1 from public.club_members c where c.club_id = p_club and c.user_id = me) then
    raise exception 'You''re not in that club.';
  end if;
  if (select count(*) from public.pack_funs f where f.created_by = me and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'That''s plenty of Pack Fun for one day.';
  end if;
  select coalesce(array_agg(distinct u), '{}') into invitees
    from unnest(coalesce(p_invite, '{}')) u
   where u <> me and public.dog_photo_are_friends(u, me);
  if array_length(invitees, 1) > 30 then
    raise exception 'Invite up to 30 friends.';
  end if;
  insert into public.pack_funs (created_by, name, club_id, starts_at, ends_at, trails_on, flash_on, map_on)
  values (me, left(v_name, 60), p_club, v_start, v_start + make_interval(mins => p_minutes), coalesce(p_trails, true), coalesce(p_flash, true), coalesce(p_map, false))
  returning id into v_id;
  insert into public.pack_fun_members (pack_id, user_id, joined_at) values (v_id, me, now());
  insert into public.pack_fun_members (pack_id, user_id) select v_id, u from unnest(invitees) u on conflict do nothing;
  perform public.pack_fun_notify(v_id, me, invitees,
    case when v_start > now() + interval '5 minutes' then '{name} invited you to a Pack Fun. Tap to see when.'
         else '{name} started a Pack Fun. Tap to join in.' end);
  return v_id;
end;
$$;
revoke execute on function public.start_pack_fun(text, integer, uuid[], uuid, boolean, boolean, boolean, timestamptz) from public, anon;
grant execute on function public.start_pack_fun(text, integer, uuid[], uuid, boolean, boolean, boolean, timestamptz) to authenticated;

create or replace function public.join_pack_fun(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null or pf.settled_at is not null or pf.ends_at <= now() then
    raise exception 'That Pack Fun is over.';
  end if;
  if not exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me)
     and not (pf.club_id is not null and exists (select 1 from public.club_members c where c.club_id = pf.club_id and c.user_id = me)) then
    raise exception 'You weren''t invited to that one.';
  end if;
  if (select count(*) from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null) >= 40 then
    raise exception 'That pack is full.';
  end if;
  insert into public.pack_fun_members (pack_id, user_id, joined_at) values (p_pack, me, now())
  on conflict (pack_id, user_id) do update set joined_at = coalesce(public.pack_fun_members.joined_at, now());
end;
$$;
revoke execute on function public.join_pack_fun(uuid) from public, anon;
grant execute on function public.join_pack_fun(uuid) to authenticated;

-- The creator ends it early (or anyone leaves).
create or replace function public.end_pack_fun(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.pack_funs f where f.id = p_pack and f.created_by = auth.uid()) then
    raise exception 'Only whoever started it can end it.';
  end if;
  -- A scheduled one that hasn't started is cancelled the same way.
  update public.pack_funs f set starts_at = least(f.starts_at, now()), ends_at = least(f.ends_at, now())
   where f.id = p_pack and f.settled_at is null;
  perform public.pack_fun_settle(p_pack);
end;
$$;
revoke execute on function public.end_pack_fun(uuid) from public, anon;
grant execute on function public.end_pack_fun(uuid) to authenticated;

create or replace function public.mute_pack_fun(p_pack uuid, p_muted boolean)
returns void
language sql
security definer set search_path = public
as $$
  update public.pack_fun_members m set muted = coalesce(p_muted, false) where m.pack_id = p_pack and m.user_id = auth.uid();
$$;
revoke execute on function public.mute_pack_fun(uuid, boolean) from public, anon;
grant execute on function public.mute_pack_fun(uuid, boolean) to authenticated;

-- ── The live loop ──

-- The board, for a member.
create or replace function public.pack_fun_state(p_pack uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  total integer;
  trails integer;
  t public.pack_fun_trails;
  pz public.pack_fun_puzzles;
  fl public.pack_fun_flashes;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null then
    raise exception 'That Pack Fun is gone.';
  end if;
  if not exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me)
     and not (pf.club_id is not null and exists (select 1 from public.club_members c where c.club_id = pf.club_id and c.user_id = me)) then
    raise exception 'not authorized';
  end if;
  select coalesce(sum(m.steps), 0) into total from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null;
  select count(*) into trails from public.pack_fun_trails x where x.pack_id = p_pack;
  select * into t from public.pack_fun_trails x where x.pack_id = p_pack order by x.seq desc limit 1;
  if t.id is not null then
    select * into pz from public.pack_fun_puzzles p where p.id = t.puzzle_id;
  end if;
  select * into fl from public.pack_fun_flashes x where x.pack_id = p_pack order by x.starts_at desc limit 1;
  return jsonb_build_object(
    'id', pf.id, 'name', pf.name, 'created_by', pf.created_by, 'club_id', pf.club_id,
    'starts_at', pf.starts_at, 'ends_at', pf.ends_at, 'settled', pf.settled_at is not null,
    'trails_on', pf.trails_on, 'flash_on', pf.flash_on, 'map_on', pf.map_on,
    'joined', public.pack_fun_member_of(p_pack, me),
    'muted', coalesce((select m.muted from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me), false),
    'pack_steps', total,
    'trail_every', cfg.trail_every_steps,
    'next_trail_at', (trails + 1) * cfg.trail_every_steps,
    'trails_solved', (select count(*) from public.pack_fun_trails x where x.pack_id = p_pack and x.first_user is not null),
    'bones', jsonb_build_object('trail_first', cfg.trail_first_bones, 'trail_answer', cfg.trail_answer_bones,
      'flash_win', cfg.flash_win_bones, 'push_bonus', cfg.push_bonus_bones, 'finish', cfg.finish_bonus_bones, 'bone_find', cfg.bone_find_bones),
    'my_bones', (select coalesce(sum(r.bones), 0) from public.pack_fun_rewards r where r.pack_id = p_pack and r.user_id = me),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', case when p.use_username and p.username is not null then p.username else p.name end,
        'initials', p.initials, 'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id,
        'joined', m.joined_at is not null, 'steps', m.steps, 'steps_at', m.steps_at, 'live', m.live_at > now() - interval '45 seconds',
        'lat', case when pf.map_on and pf.settled_at is null and m.loc_at > now() - interval '10 minutes' then m.lat end,
        'lng', case when pf.map_on and pf.settled_at is null and m.loc_at > now() - interval '10 minutes' then m.lng end,
        'loc_at', m.loc_at,
        'bones', (select coalesce(sum(r.bones), 0) from public.pack_fun_rewards r where r.pack_id = p_pack and r.user_id = m.user_id)
      ) order by m.joined_at is null, m.steps desc)
      from public.pack_fun_members m join public.profiles p on p.id = m.user_id
      where m.pack_id = p_pack
    ), '[]'::jsonb),
    'trail', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'seq', t.seq, 'opened_at', t.opened_at, 'closes_at', t.closes_at, 'open', t.closes_at > now() and t.first_user is null and pf.settled_at is null,
      'question', pz.question, 'choices', to_jsonb(pz.choices), 'kind', pz.kind,
      'first_user', t.first_user,
      'answer', case when t.first_user is not null or t.closes_at <= now() or exists (select 1 from public.pack_fun_answers a where a.trail_id = t.id and a.user_id = me) then pz.answer end,
      'my_choice', (select a.choice from public.pack_fun_answers a where a.trail_id = t.id and a.user_id = me),
      'answered', (select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) from public.pack_fun_answers a where a.trail_id = t.id)
    ) end,
    'flash', case when fl.id is null then null else jsonb_build_object(
      'id', fl.id, 'kind', fl.kind, 'started_by', fl.started_by, 'starts_at', fl.starts_at, 'ends_at', fl.ends_at, 'target', fl.target,
      'start_steps', fl.start_steps, 'settled', fl.settled_at is not null, 'result', fl.result
    ) end,
    'cheers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'kind', c.kind, 'at', c.created_at) order by c.created_at desc)
      from (select * from public.pack_fun_cheers c where c.pack_id = p_pack and c.created_at > now() - interval '10 minutes' order by c.created_at desc limit 10) c
    ), '[]'::jsonb),
    'map_bones', case when pf.map_on and pf.settled_at is null then coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'lat', b.lat, 'lng', b.lng))
      from public.pack_fun_bones b where b.pack_id = p_pack and b.found_by is null and b.expires_at > now()
    ), '[]'::jsonb) else '[]'::jsonb end,
    'bones_found', (select count(*) from public.pack_fun_bones b where b.pack_id = p_pack and b.found_by is not null)
  );
end;
$$;
revoke execute on function public.pack_fun_state(uuid) from public, anon;
grant execute on function public.pack_fun_state(uuid) to authenticated;

-- A phone reports in: steps since the start (only ever up), whether
-- Hound is open, and where it is when the map is on. Opens the next
-- scent trail when the pack gets there, drops bones near the pack,
-- settles what's due, and returns the board.
create or replace function public.pack_fun_ping(
  p_pack uuid, p_steps integer, p_live boolean default true,
  p_lat double precision default null, p_lng double precision default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  total integer;
  next_seq integer;
  pz integer;
  clat double precision;
  clng double precision;
  bearing double precision;
  dist double precision;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null or not public.pack_fun_member_of(p_pack, me) then
    raise exception 'not authorized';
  end if;
  if pf.settled_at is null and pf.ends_at <= now() then
    perform public.pack_fun_settle(p_pack);
    return public.pack_fun_state(p_pack);
  end if;
  if pf.settled_at is null and pf.starts_at <= now() then
    update public.pack_fun_members m
       set steps = greatest(m.steps, least(coalesce(p_steps, 0), 60000)),
           steps_at = case when coalesce(p_steps, 0) > m.steps then now() else m.steps_at end,
           live_at = case when coalesce(p_live, false) then now() else m.live_at end,
           lat = case when pf.map_on and p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat else m.lat end,
           lng = case when pf.map_on and p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng else m.lng end,
           loc_at = case when pf.map_on and p_lat between -90 and 90 and p_lng between -180 and 180 then now() else m.loc_at end
     where m.pack_id = p_pack and m.user_id = me;

    -- Flashes that ran out.
    perform public.pack_fun_settle_flash(x.id) from public.pack_fun_flashes x
     where x.pack_id = p_pack and x.settled_at is null and x.ends_at <= now();

    -- The next scent trail, when the pack reaches it (one at a time).
    if pf.trails_on then
      select coalesce(sum(m.steps), 0) into total from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null;
      select coalesce(max(x.seq), 0) + 1 into next_seq from public.pack_fun_trails x where x.pack_id = p_pack;
      if total >= next_seq * cfg.trail_every_steps and next_seq <= 12
         and not exists (select 1 from public.pack_fun_trails x where x.pack_id = p_pack and x.closes_at > now() and x.first_user is null) then
        select p.id into pz from public.pack_fun_puzzles p
         where p.active and p.id not in (select x.puzzle_id from public.pack_fun_trails x where x.pack_id = p_pack)
         order by random() limit 1;
        if pz is not null then
          insert into public.pack_fun_trails (pack_id, seq, puzzle_id, closes_at)
          values (p_pack, next_seq, pz, now() + make_interval(mins => cfg.trail_minutes))
          on conflict (pack_id, seq) do nothing;
          if found then
            perform public.pack_fun_notify(p_pack, pf.created_by, public.pack_fun_listeners(p_pack, null),
              format('Scent trail %s at %s pack steps! First right answer wins %s Bones.', next_seq, to_char(next_seq * cfg.trail_every_steps, 'FM999,999'), cfg.trail_first_bones));
          end if;
        end if;
      end if;
    end if;

    -- Bones on the map: up to two at a time, near the pack, 150-300 m
    -- out, for 20 minutes.
    if pf.map_on and p_lat is not null
       and (select count(*) from public.pack_fun_bones b where b.pack_id = p_pack and b.found_by is null and b.expires_at > now()) < 2
       and not exists (select 1 from public.pack_fun_bones b where b.pack_id = p_pack and b.dropped_at > now() - interval '3 minutes') then
      select avg(m.lat), avg(m.lng) into clat, clng from public.pack_fun_members m
       where m.pack_id = p_pack and m.loc_at > now() - interval '2 minutes' and m.lat is not null;
      if clat is not null then
        bearing := random() * 2 * pi();
        dist := 150 + random() * 150;
        insert into public.pack_fun_bones (pack_id, lat, lng, expires_at)
        values (p_pack, clat + (dist * cos(bearing)) / 111320.0, clng + (dist * sin(bearing)) / (111320.0 * cos(radians(clat))), now() + interval '20 minutes');
      end if;
    end if;
  end if;
  return public.pack_fun_state(p_pack);
end;
$$;
revoke execute on function public.pack_fun_ping(uuid, integer, boolean, double precision, double precision) from public, anon;
grant execute on function public.pack_fun_ping(uuid, integer, boolean, double precision, double precision) to authenticated;

-- An answer to the open scent trail.
create or replace function public.answer_pack_fun_trail(p_trail uuid, p_choice integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t public.pack_fun_trails;
  pz public.pack_fun_puzzles;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  ok boolean;
  first boolean := false;
  got integer := 0;
begin
  select * into t from public.pack_fun_trails x where x.id = p_trail for update;
  if t.id is null or not public.pack_fun_member_of(t.pack_id, me) then
    raise exception 'not authorized';
  end if;
  if t.closes_at <= now() then
    raise exception 'That scent trail has gone cold.';
  end if;
  if exists (select 1 from public.pack_fun_answers a where a.trail_id = p_trail and a.user_id = me) then
    raise exception 'You''ve answered this one.';
  end if;
  select * into pz from public.pack_fun_puzzles p where p.id = t.puzzle_id;
  ok := p_choice = pz.answer;
  if ok then
    if t.first_user is null then
      first := true;
      update public.pack_fun_trails x set first_user = me where x.id = p_trail;
      got := public.pack_fun_award(me, t.pack_id, 'trail_first', cfg.trail_first_bones);
    else
      got := public.pack_fun_award(me, t.pack_id, 'trail_answer', cfg.trail_answer_bones);
    end if;
  end if;
  insert into public.pack_fun_answers (trail_id, user_id, choice, correct, bones) values (p_trail, me, p_choice, ok, got);
  return jsonb_build_object('correct', ok, 'first', first, 'bones', got, 'answer', pz.answer);
end;
$$;
revoke execute on function public.answer_pack_fun_trail(uuid, integer) from public, anon;
grant execute on function public.answer_pack_fun_trail(uuid, integer) to authenticated;

-- A flash challenge: a Dash (most steps in p_minutes) or a Pack push
-- (the pack's steps together reach p_target in p_minutes).
create or replace function public.start_pack_fun_flash(p_pack uuid, p_kind text, p_minutes integer, p_target integer default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
  v_id uuid;
  snap jsonb;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null or not public.pack_fun_member_of(p_pack, me) then
    raise exception 'not authorized';
  end if;
  if not pf.flash_on then
    raise exception 'Flash challenges are off in this one.';
  end if;
  if pf.settled_at is not null or pf.ends_at <= now() + make_interval(mins => coalesce(p_minutes, 0)) or pf.starts_at > now() then
    raise exception 'Not enough time left for that.';
  end if;
  if p_kind not in ('dash', 'push') or p_minutes not in (5, 10, 15) then
    raise exception 'Pick a Dash or a Pack push, 5, 10 or 15 minutes.';
  end if;
  if p_kind = 'push' and (p_target is null or p_target < 100 or p_target > 50000) then
    raise exception 'Pick a target for the pack.';
  end if;
  perform public.pack_fun_settle_flash(x.id) from public.pack_fun_flashes x where x.pack_id = p_pack and x.settled_at is null and x.ends_at <= now();
  if exists (select 1 from public.pack_fun_flashes x where x.pack_id = p_pack and x.settled_at is null) then
    raise exception 'One flash challenge at a time.';
  end if;
  if (select count(*) from public.pack_fun_flashes x where x.pack_id = p_pack and x.started_by = me) >= 6 then
    raise exception 'That''s six from you in this one. Let someone else start the next.';
  end if;
  select coalesce(jsonb_object_agg(m.user_id::text, m.steps), '{}'::jsonb) into snap
    from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null;
  insert into public.pack_fun_flashes (pack_id, kind, started_by, ends_at, target, start_steps)
  values (p_pack, p_kind, me, now() + make_interval(mins => p_minutes), case when p_kind = 'push' then p_target end, snap)
  returning id into v_id;
  perform public.pack_fun_notify(p_pack, me, public.pack_fun_listeners(p_pack, me),
    case when p_kind = 'dash' then format('{name} started a %s-minute Dash. Go!', p_minutes)
         else format('{name} started a Pack push: %s steps together in %s minutes.', to_char(p_target, 'FM999,999'), p_minutes) end);
  return v_id;
end;
$$;
revoke execute on function public.start_pack_fun_flash(uuid, text, integer, integer) from public, anon;
grant execute on function public.start_pack_fun_flash(uuid, text, integer, integer) to authenticated;

-- A cheer for the pack (Let's go!, Wait up, Water break, Nice!). Wait up
-- reaches everyone; the others show on the board. One a minute.
create or replace function public.pack_fun_cheer(p_pack uuid, p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not public.pack_fun_member_of(p_pack, me) then
    raise exception 'not authorized';
  end if;
  if p_kind not in ('go', 'wait', 'water', 'nice') then
    raise exception 'Unknown cheer.';
  end if;
  if exists (select 1 from public.pack_fun_cheers c where c.pack_id = p_pack and c.user_id = me and c.created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.pack_fun_cheers (pack_id, user_id, kind) values (p_pack, me, p_kind);
  if p_kind = 'wait' then
    perform public.pack_fun_notify(p_pack, me, public.pack_fun_listeners(p_pack, me), '{name} says: wait up!');
  end if;
end;
$$;
revoke execute on function public.pack_fun_cheer(uuid, text) from public, anon;
grant execute on function public.pack_fun_cheer(uuid, text) to authenticated;

-- Picking up a bone on the map: within 40 m of it.
create or replace function public.find_pack_fun_bone(p_bone uuid, p_lat double precision, p_lng double precision)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  b public.pack_fun_bones;
begin
  select * into b from public.pack_fun_bones x where x.id = p_bone for update;
  if b.id is null or not public.pack_fun_member_of(b.pack_id, me) then
    raise exception 'not authorized';
  end if;
  if b.found_by is not null or b.expires_at <= now() then
    raise exception 'Someone got there first.';
  end if;
  if p_lat is null or public.pack_fun_metres(b.lat, b.lng, p_lat, p_lng) > 40 then
    raise exception 'Get a little closer.';
  end if;
  update public.pack_fun_bones x set found_by = me, found_at = now() where x.id = p_bone;
  return public.pack_fun_award(me, b.pack_id, 'bone', (public.pack_fun_cfg()).bone_find_bones);
end;
$$;
revoke execute on function public.find_pack_fun_bone(uuid, double precision, double precision) from public, anon;
grant execute on function public.find_pack_fun_bone(uuid, double precision, double precision) to authenticated;

-- Pack Funs for me: invited, live, coming up, and the last week's.
create or replace function public.my_pack_funs()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'starts_at', f.starts_at, 'ends_at', f.ends_at, 'settled', f.settled_at is not null,
    'joined', m.joined_at is not null, 'created_by', f.created_by, 'map_on', f.map_on,
    'people', (select count(*) from public.pack_fun_members x where x.pack_id = f.id and x.joined_at is not null)
  ) order by f.settled_at is not null, f.starts_at desc), '[]'::jsonb)
  from public.pack_funs f
  left join public.pack_fun_members m on m.pack_id = f.id and m.user_id = auth.uid()
  where (m.user_id is not null
         or (f.club_id is not null and f.settled_at is null and exists (select 1 from public.club_members c where c.club_id = f.club_id and c.user_id = auth.uid())))
    and f.ends_at > now() - interval '7 days'
$$;
revoke execute on function public.my_pack_funs() from public, anon;
grant execute on function public.my_pack_funs() to authenticated;

-- ── Admin ──

create or replace function public.admin_set_pack_fun_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.pack_fun_config c set
    enabled = coalesce((p ->> 'enabled')::boolean, c.enabled),
    trail_first_bones = coalesce((p ->> 'trail_first_bones')::int, c.trail_first_bones),
    trail_answer_bones = coalesce((p ->> 'trail_answer_bones')::int, c.trail_answer_bones),
    flash_win_bones = coalesce((p ->> 'flash_win_bones')::int, c.flash_win_bones),
    push_bonus_bones = coalesce((p ->> 'push_bonus_bones')::int, c.push_bonus_bones),
    finish_bonus_bones = coalesce((p ->> 'finish_bonus_bones')::int, c.finish_bonus_bones),
    bone_find_bones = coalesce((p ->> 'bone_find_bones')::int, c.bone_find_bones),
    daily_cap = coalesce((p ->> 'daily_cap')::int, c.daily_cap),
    trail_every_steps = coalesce((p ->> 'trail_every_steps')::int, c.trail_every_steps),
    trail_minutes = coalesce((p ->> 'trail_minutes')::int, c.trail_minutes),
    finish_min_steps = coalesce((p ->> 'finish_min_steps')::int, c.finish_min_steps),
    updated_at = now(), updated_by = auth.uid()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_pack_fun_config(jsonb) from public, anon;
grant execute on function public.admin_set_pack_fun_config(jsonb) to authenticated;

create or replace function public.admin_pack_fun_overview()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'config', to_jsonb(public.pack_fun_cfg()),
    'live_now', (select count(*) from public.pack_funs f where f.settled_at is null and f.starts_at <= now() and f.ends_at > now()),
    'started_7d', (select count(*) from public.pack_funs f where f.created_at > now() - interval '7 days'),
    'started_all', (select count(*) from public.pack_funs),
    'people_7d', (select count(distinct m.user_id) from public.pack_fun_members m join public.pack_funs f on f.id = m.pack_id
                   where m.joined_at is not null and f.created_at > now() - interval '7 days'),
    'people_all', (select count(distinct m.user_id) from public.pack_fun_members m where m.joined_at is not null),
    'avg_pack', (select round(avg(c), 1) from (select count(*) c from public.pack_fun_members m join public.pack_funs f on f.id = m.pack_id
                   where m.joined_at is not null and f.created_at > now() - interval '30 days' group by m.pack_id) x),
    'with_map_7d', (select count(*) from public.pack_funs f where f.map_on and f.created_at > now() - interval '7 days'),
    'trails_7d', (select count(*) from public.pack_fun_trails t where t.opened_at > now() - interval '7 days'),
    'trails_solved_7d', (select count(*) from public.pack_fun_trails t where t.first_user is not null and t.opened_at > now() - interval '7 days'),
    'flashes_7d', (select count(*) from public.pack_fun_flashes x where x.starts_at > now() - interval '7 days'),
    'bones_found_7d', (select count(*) from public.pack_fun_bones b where b.found_at > now() - interval '7 days'),
    'bones_given_7d', (select coalesce(sum(r.bones), 0) from public.pack_fun_rewards r where r.created_at > now() - interval '7 days'),
    'bones_capped_7d', (select coalesce(sum(r.wanted - r.bones), 0) from public.pack_fun_rewards r where r.created_at > now() - interval '7 days'),
    'people_at_cap_7d', (select count(distinct r.user_id) from public.pack_fun_rewards r where r.bones < r.wanted and r.created_at > now() - interval '7 days')
  );
end;
$$;
revoke execute on function public.admin_pack_fun_overview() from public, anon;
grant execute on function public.admin_pack_fun_overview() to authenticated;

-- ── The puzzle bank ──
insert into public.pack_fun_puzzles (kind, question, choices, answer)
select * from (values
  ('riddle', 'I have a bark but no bite, and rings but no phone. What am I?', array['A puppy', 'A tree', 'A bell', 'A canoe'], 1),
  ('riddle', 'The more of me you take, the more you leave behind. What am I?', array['Footsteps', 'Breaths', 'Photos', 'Bones'], 0),
  ('riddle', 'What has a tail and a head but no body?', array['A comet', 'A coin', 'A kite', 'A snake'], 1),
  ('riddle', 'What runs but never walks, has a bed but never sleeps?', array['A river', 'A clock', 'A road', 'A dog'], 0),
  ('riddle', 'I go up and down but never move. What am I?', array['A hill', 'Stairs', 'An elevator', 'A tide'], 1),
  ('riddle', 'What gets wetter the more it dries?', array['A sponge', 'A towel', 'Rain', 'A puddle'], 1),
  ('riddle', 'What has many keys but can''t open a single door?', array['A janitor', 'A piano', 'A map', 'A safe'], 1),
  ('riddle', 'What has hands but can''t clap?', array['A clock', 'A glove', 'A statue', 'A crab'], 0),
  ('riddle', 'What can you catch but not throw?', array['A ball', 'A cold', 'A frisbee', 'A fish'], 1),
  ('riddle', 'What goes through towns and over hills but never moves?', array['A road', 'Wind', 'A train', 'A cloud'], 0),
  ('riddle', 'What has one eye but can''t see?', array['A storm', 'A needle', 'A potato', 'Both A and B'], 3),
  ('riddle', 'Which dog keeps the best time?', array['A watch dog', 'A hot dog', 'A sheep dog', 'A sundial'], 0),
  ('trivia', 'About how many steps make a mile for most adults?', array['500', '2,000', '5,000', '10,000'], 1),
  ('trivia', 'Which of these dogs was bred to hunt by scent?', array['Greyhound', 'Bloodhound', 'Whippet', 'Saluki'], 1),
  ('trivia', 'A dog''s sense of smell is roughly how much stronger than ours?', array['2 times', '10 times', '1,000 times', 'Up to 100,000 times'], 3),
  ('trivia', 'How many minutes of moderate exercise a week do health guidelines suggest for adults?', array['30', '75', '150', '600'], 2),
  ('trivia', 'Which is the smallest dog breed?', array['Pug', 'Chihuahua', 'Corgi', 'Beagle'], 1),
  ('trivia', 'What do you call a group of puppies born together?', array['A pack', 'A litter', 'A herd', 'A flock'], 1),
  ('trivia', 'Which muscle is the largest in your body?', array['Biceps', 'Calf', 'Gluteus maximus', 'Heart'], 2),
  ('trivia', 'How many legs does a spider have?', array['6', '8', '10', '12'], 1),
  ('trivia', 'Which of these trees keeps its leaves all year?', array['Oak', 'Maple', 'Pine', 'Birch'], 2),
  ('trivia', 'Which way does moss most often grow on trees in the northern hemisphere?', array['North side', 'South side', 'Top only', 'Any side'], 0),
  ('trivia', 'What is a dog''s normal number of teeth as an adult?', array['28', '32', '42', '50'], 2),
  ('trivia', 'Which breed is the fastest runner?', array['Greyhound', 'Labrador', 'Husky', 'Dachshund'], 0),
  ('trivia', 'About how much of your body is water?', array['10%', '30%', '60%', '90%'], 2),
  ('trivia', 'Which bird can fly backwards?', array['Hummingbird', 'Eagle', 'Robin', 'Crow'], 0),
  ('trivia', 'What should you drink before you feel thirsty on a long hike?', array['Nothing', 'Water', 'Only soda', 'Coffee'], 1),
  ('trivia', 'Which planet is closest to the sun?', array['Venus', 'Earth', 'Mercury', 'Mars'], 2),
  ('trivia', 'How many bones does an adult human have?', array['106', '206', '306', '406'], 1),
  ('emoji', 'Which saying is this? 🐶 🦴 🏠', array['Dog days of summer', 'Bring home the bone', 'Fetch!', 'Doghouse'], 1),
  ('emoji', 'Which movie? 🦁 👑', array['Madagascar', 'The Lion King', 'Zootopia', 'Bambi'], 1),
  ('emoji', 'Which activity? 🥾 ⛰️ 🎒', array['Swimming', 'Hiking', 'Cycling', 'Skating'], 1),
  ('emoji', 'Which saying? 🐦 🐦 🪨', array['Bird brain', 'Two birds, one stone', 'Early bird', 'Rock on'], 1),
  ('emoji', 'Which treat? 🌭', array['A hot dog', 'A pretzel', 'A taco', 'A bagel'], 0),
  ('emoji', 'Which weather? ⛈️ 🐱 🐶', array['Sunny', 'Raining cats and dogs', 'Foggy', 'Windy'], 1),
  ('emoji', 'Which time? 🌅 🐦', array['Night owl', 'Early bird', 'Midday', 'Happy hour'], 1),
  ('emoji', 'Which job? 🐕 🦮 💼', array['Dog walker', 'Mail carrier', 'Chef', 'Pilot'], 0),
  ('emoji', 'Which phrase? 🏃 💨', array['Slow and steady', 'Run like the wind', 'Take a nap', 'Stop and go'], 1),
  ('emoji', 'Which sport? ⚾ 🧤', array['Tennis', 'Baseball', 'Golf', 'Soccer'], 1),
  ('emoji', 'Which season? 🍂 🎃', array['Spring', 'Summer', 'Fall', 'Winter'], 2)
) v(kind, question, choices, answer)
where not exists (select 1 from public.pack_fun_puzzles);

-- Every 5 minutes: end Pack Funs that are over and settle flashes.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('hound-pack-fun') where exists (select 1 from cron.job where jobname = 'hound-pack-fun');
    perform cron.schedule('hound-pack-fun', '*/5 * * * *', $$ select public.pack_fun_settle_due(); $$);
  end if;
end;
$cron$;

-- Undo, if needed:
--   select cron.unschedule('hound-pack-fun');
--   drop table public.pack_fun_rewards, public.pack_fun_bones, public.pack_fun_cheers, public.pack_fun_flashes,
--     public.pack_fun_answers, public.pack_fun_trails, public.pack_fun_puzzles, public.pack_fun_members,
--     public.pack_funs, public.pack_fun_config;
