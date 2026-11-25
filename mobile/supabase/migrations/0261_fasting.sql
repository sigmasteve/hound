-- 0261: Fasting (Steve, 24 Nov 2026). Intermittent fasting as a habit
-- kept with friends: press Start when you finish eating, End when you
-- eat. Mockups: claude.ai/artifact/3abHwCtUmzhQ9hzkfexR1s.
--
--   Who        16 and older: a one-time "I'm 16 or older" (Hound keeps no
--              ages), like the community age check (0152). "I'm under 16"
--              hides Fasting on the account.
--   A fast     fasting_start / fasting_end. A plan is 12 to 24 hours (13:11,
--              16:8, 18:6, 20:4, one meal a day = 23). "I stopped eating
--              at…" can start it up to 12 h back, "I ate at…" can end it
--              earlier than now. A fast ended within 15 minutes can be
--              cancelled (a mis-tap).
--   On plan    a fast that reached its goal. A day on plan is the local day
--              (the caller's own date) a fast on plan ended.
--   Streak     days on plan in a row, skipping the rest days you picked
--              (up to 3 weekdays) and one free miss each Monday-to-Sunday
--              week (fasting_freezes).
--   Bones      once a day, for the first fast that ends that day: by the
--              hours it reached (12/14/16/18/20 h), nothing more past 20 h
--              so long fasts don't pay extra. Streak bonuses at 3, 7, 14,
--              30 and 100 days on plan. A pack fast where everyone who
--              joined (2 or more) ends on plan pays each a bonus. All in
--              fasting_config, set from Admin → Bones. Like goal days
--              (0099), these credit bones_balance only, never
--              bones_earned_total.
--   Friends    who's fasting now (if they share, on by default), Cheer
--              (one per friend per fast, a push), compare side by side,
--              and the board: days on plan this week, then streak, then
--              longest (the app shows anything from 24 h as "24 h+" until
--              tapped, so it isn't what the board's about).
--   Pack fast  start together: invite up to 10 friends, who can join for
--              12 hours; quick notes (water break, you got this, coffee
--              time) ping the others.
--   Clubs      a club's page shows its members who fast (and share): who's
--              fasting now and the week's board. A new club sport,
--              'fasting', for an Intermittent Fasting club.
--   Admin      admin_fasting_overview (Overview → Fitness).
--
-- Pushes go through send-social-push, kind 'fasting' (redeploy it). The
-- "your fast is done" and the 36 h check-in are the phone's own local
-- notifications.
--
-- Run this once, after 0001-0260, in the SQL Editor.

-- ── Settings ──

create table public.fasting_config (
  id boolean primary key default true,
  constraint fasting_config_singleton check (id),
  bones_12 int not null default 5 check (bones_12 >= 0),
  bones_14 int not null default 10 check (bones_14 >= 0),
  bones_16 int not null default 15 check (bones_16 >= 0),
  bones_18 int not null default 20 check (bones_18 >= 0),
  bones_20 int not null default 25 check (bones_20 >= 0),
  streak_3 int not null default 25 check (streak_3 >= 0),
  streak_7 int not null default 100 check (streak_7 >= 0),
  streak_14 int not null default 200 check (streak_14 >= 0),
  streak_30 int not null default 500 check (streak_30 >= 0),
  streak_100 int not null default 2500 check (streak_100 >= 0),
  pack_bonus int not null default 10 check (pack_bonus >= 0),
  updated_at timestamptz not null default now()
);
insert into public.fasting_config (id) values (true);
alter table public.fasting_config enable row level security;
create policy "Anyone signed in can read the fasting Bones"
  on public.fasting_config for select to authenticated using (true);
revoke all on public.fasting_config from anon;
revoke insert, update, delete on public.fasting_config from authenticated;

-- ── Tables ──

create table public.fasting_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 'ok' (16 or older) or 'under' (hides Fasting).
  age text check (age in ('ok', 'under')),
  age_at timestamptz,
  plan_hours int not null default 16 check (plan_hours between 12 and 24),
  -- ISO weekdays (1 = Monday) that don't count against the streak.
  rest_days int[] not null default '{}',
  -- Friends (and clubmates) see when you're fasting and your numbers.
  share boolean not null default true,
  streak int not null default 0,
  best_streak int not null default 0,
  -- The last local day counted on plan.
  last_on date,
  updated_at timestamptz not null default now()
);
alter table public.fasting_profiles enable row level security;
create policy "Owners can view their fasting profile"
  on public.fasting_profiles for select to authenticated using (user_id = auth.uid());
revoke all on public.fasting_profiles from anon;
revoke insert, update, delete on public.fasting_profiles from authenticated;

create table public.fasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  goal_hours int not null check (goal_hours between 12 and 24),
  started_at timestamptz not null,
  ended_at timestamptz,
  -- Set when it ends.
  hours numeric(6, 2),
  on_plan boolean,
  local_day date,
  bones int not null default 0,
  feel text check (feel in ('easy', 'ok', 'tough', 'unwell')),
  pack_id uuid,
  created_at timestamptz not null default now()
);
create unique index fasts_one_open on public.fasts (user_id) where ended_at is null;
create index fasts_user_day on public.fasts (user_id, local_day);
create index fasts_ended on public.fasts (ended_at);
alter table public.fasts enable row level security;
create policy "Owners can view their fasts"
  on public.fasts for select to authenticated using (user_id = auth.uid());
revoke all on public.fasts from anon;
revoke insert, update, delete on public.fasts from authenticated;

-- The week's free miss, once used: which day it covered.
create table public.fasting_freezes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  week date not null,
  day date not null,
  primary key (user_id, week)
);
alter table public.fasting_freezes enable row level security;
revoke all on public.fasting_freezes from anon, authenticated;

create table public.fast_packs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  bonus_paid_at timestamptz
);
alter table public.fast_packs enable row level security;
revoke all on public.fast_packs from anon, authenticated;

alter table public.fasts
  add constraint fasts_pack_fk foreign key (pack_id) references public.fast_packs (id) on delete set null;

create table public.fast_pack_members (
  pack_id uuid not null references public.fast_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'joined', 'declined')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (pack_id, user_id)
);
create index fast_pack_members_user on public.fast_pack_members (user_id);
alter table public.fast_pack_members enable row level security;
revoke all on public.fast_pack_members from anon, authenticated;

create table public.fast_pack_notes (
  id bigint generated always as identity primary key,
  pack_id uuid not null references public.fast_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  note text not null check (note in ('water', 'gotthis', 'coffee', 'hungry', 'done')),
  created_at timestamptz not null default now()
);
create index fast_pack_notes_pack on public.fast_pack_notes (pack_id, created_at);
alter table public.fast_pack_notes enable row level security;
revoke all on public.fast_pack_notes from anon, authenticated;

create table public.fast_cheers (
  fast_id uuid not null references public.fasts (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (fast_id, from_user)
);
alter table public.fast_cheers enable row level security;
revoke all on public.fast_cheers from anon, authenticated;

-- A club for fasting.
alter table public.clubs drop constraint if exists clubs_sport_check;
alter table public.clubs add constraint clubs_sport_check
  check (sport in ('running', 'cycling', 'walking', 'hiking', 'swimming', 'mixed', 'fasting'));

-- ── Helpers ──

create or replace function public.fasting_person(p_user uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', coalesce(case when p.use_username and p.username is not null then p.username end, nullif(split_part(p.name, ' ', 1), ''), 'Someone'),
    'initials', p.initials,
    'icon_id', p.equipped_icon_id,
    'frame_id', p.equipped_frame_id,
    'background_id', p.equipped_background_id)
  from public.profiles p where p.id = p_user;
$$;
revoke execute on function public.fasting_person(uuid) from public, anon, authenticated;

create or replace function public.fasting_are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = a and f.recipient_id = b) or (f.requester_id = b and f.recipient_id = a)));
$$;
revoke execute on function public.fasting_are_friends(uuid, uuid) from public, anon, authenticated;

-- Friends who fast and share (not counting me).
create or replace function public.fasting_friend_ids(p_user uuid)
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  select case when f.requester_id = p_user then f.recipient_id else f.requester_id end
  from public.friendships f
  join public.fasting_profiles fp on fp.user_id = case when f.requester_id = p_user then f.recipient_id else f.requester_id end
  where f.status = 'accepted' and (f.requester_id = p_user or f.recipient_id = p_user)
    and fp.share and fp.age = 'ok';
$$;
revoke execute on function public.fasting_friend_ids(uuid) from public, anon, authenticated;

create or replace function public.fasting_monday(d date)
returns date
language sql
immutable
as $$ select d - (extract(isodow from d)::int - 1); $$;
revoke execute on function public.fasting_monday(date) from public, anon, authenticated;

-- What a fast of this many hours pays.
create or replace function public.fasting_hours_bones(h numeric, c public.fasting_config)
returns int
language sql
immutable
as $$
  select case when h >= 20 then c.bones_20 when h >= 18 then c.bones_18 when h >= 16 then c.bones_16
              when h >= 14 then c.bones_14 when h >= 12 then c.bones_12 else 0 end;
$$;
revoke execute on function public.fasting_hours_bones(numeric, public.fasting_config) from public, anon, authenticated;

create or replace function public.fasting_streak_bones(s int, c public.fasting_config)
returns int
language sql
immutable
as $$
  select case s when 3 then c.streak_3 when 7 then c.streak_7 when 14 then c.streak_14
                when 30 then c.streak_30 when 100 then c.streak_100 else 0 end;
$$;
revoke execute on function public.fasting_streak_bones(int, public.fasting_config) from public, anon, authenticated;

-- Whether a streak whose last day on plan was p_last still stands on
-- p_to: every day in between is a rest day or the week's one free miss.
-- p_commit records the free misses it uses (when a fast ends); without
-- it this only looks (for showing the streak).
create or replace function public.fasting_streak_holds(p_user uuid, p_last date, p_to date, p_rest int[], p_commit boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  d date;
  wk date;
  used date[] := '{}';
  fz public.fasting_freezes;
begin
  if p_last is null or p_to <= p_last then
    return p_last is not null;
  end if;
  if p_to - p_last > 60 then
    return false;
  end if;
  d := p_last + 1;
  while d < p_to loop
    if not (extract(isodow from d)::int = any (coalesce(p_rest, '{}'))) then
      wk := public.fasting_monday(d);
      select * into fz from public.fasting_freezes f where f.user_id = p_user and f.week = wk;
      if fz.user_id is not null then
        if fz.day <> d then
          return false;
        end if;
      elsif wk = any (used) then
        return false;
      else
        used := used || wk;
        if p_commit then
          insert into public.fasting_freezes (user_id, week, day) values (p_user, wk, d) on conflict do nothing;
        end if;
      end if;
    end if;
    d := d + 1;
  end loop;
  return true;
end;
$$;
revoke execute on function public.fasting_streak_holds(uuid, date, date, int[], boolean) from public, anon, authenticated;

create or replace function public.fasting_check_date(p_local_date date)
returns void
language plpgsql
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
end;
$$;
revoke execute on function public.fasting_check_date(date) from public, anon, authenticated;

create or replace function public.fasting_require_ok(p_user uuid)
returns public.fasting_profiles
language plpgsql
security definer set search_path = public
as $$
declare
  fp public.fasting_profiles;
begin
  if p_user is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into fp from public.fasting_profiles f where f.user_id = p_user;
  if fp.user_id is null or fp.age is distinct from 'ok' then
    raise exception 'Fasting is for people 16 and older.';
  end if;
  return fp;
end;
$$;
revoke execute on function public.fasting_require_ok(uuid) from public, anon, authenticated;

create or replace function public.fasting_notify(p_from uuid, p_to uuid[], p_message text, p_pack uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  reach uuid[];
begin
  select array_agg(distinct u) into reach from unnest(p_to) u where u is distinct from p_from and public.social_push_reachable(u);
  if reach is null or cardinality(reach) = 0 then
    return;
  end if;
  perform public.social_notify(jsonb_build_object(
    'kind', 'fasting', 'from_user', p_from, 'to_users', to_jsonb(reach), 'message', p_message,
    'pack_id', p_pack, 'challenge_id', null));
exception when others then
  null;
end;
$$;
revoke execute on function public.fasting_notify(uuid, uuid[], text, uuid) from public, anon, authenticated;

-- A fast for the board and lists: started, goal, hours so far.
create or replace function public.fasting_open_json(f public.fasts)
returns jsonb
language sql
stable
as $$
  select case when f.id is null then null else jsonb_build_object(
    'id', f.id, 'goal_hours', f.goal_hours, 'started_at', f.started_at, 'pack_id', f.pack_id,
    'hours', round(extract(epoch from (now() - f.started_at)) / 3600.0, 2)) end;
$$;
revoke execute on function public.fasting_open_json(public.fasts) from public, anon, authenticated;

-- A person's numbers: streak as of p_day, best, longest, days on plan in
-- the week of p_day, and over the last 30 days.
create or replace function public.fasting_numbers(p_user uuid, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  fp public.fasting_profiles;
  live int;
  wk date := public.fasting_monday(p_day);
begin
  select * into fp from public.fasting_profiles f where f.user_id = p_user;
  live := case
    when fp.last_on is null then 0
    when fp.last_on >= p_day then fp.streak
    when public.fasting_streak_holds(p_user, fp.last_on, p_day, fp.rest_days, false) then fp.streak
    else 0 end;
  return jsonb_build_object(
    'streak', coalesce(live, 0),
    'best_streak', coalesce(fp.best_streak, 0),
    'longest', coalesce((select max(hours) from public.fasts where user_id = p_user and ended_at is not null), 0),
    'week_days', (select count(distinct local_day) from public.fasts
                  where user_id = p_user and on_plan and local_day between wk and wk + 6),
    'days_30', (select count(distinct local_day) from public.fasts
                where user_id = p_user and on_plan and local_day > p_day - 30),
    'fasts_30', (select count(*) from public.fasts where user_id = p_user and ended_at is not null and local_day > p_day - 30),
    'avg_30', coalesce((select round(avg(hours), 2) from public.fasts
                        where user_id = p_user and ended_at is not null and local_day > p_day - 30 and hours >= 1), 0),
    'plan_hours', coalesce(fp.plan_hours, 16));
end;
$$;
revoke execute on function public.fasting_numbers(uuid, date) from public, anon, authenticated;

-- ── Yours ──

-- "I'm 16 or older" (true) or "I'm under 16" (false).
create or replace function public.fasting_set_age(p_ok boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  insert into public.fasting_profiles (user_id, age, age_at)
    values (me, case when p_ok then 'ok' else 'under' end, now())
  on conflict (user_id) do update set age = excluded.age, age_at = now(), updated_at = now()
    -- Once under, the answer stays: a kid can't just tap again.
    where public.fasting_profiles.age is distinct from 'under';
end;
$$;
revoke execute on function public.fasting_set_age(boolean) from public, anon;
grant execute on function public.fasting_set_age(boolean) to authenticated;

create or replace function public.fasting_settings(p_plan_hours int default null, p_rest_days int[] default null, p_share boolean default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  rest int[];
begin
  perform public.fasting_require_ok(me);
  if p_plan_hours is not null and (p_plan_hours < 12 or p_plan_hours > 24) then
    raise exception 'A plan is 12 to 24 hours.';
  end if;
  if p_rest_days is not null then
    select coalesce(array_agg(distinct d order by d), '{}') into rest from unnest(p_rest_days) d where d between 1 and 7;
    if cardinality(rest) > 3 then
      raise exception 'Pick up to 3 rest days.';
    end if;
  end if;
  update public.fasting_profiles f set
    plan_hours = coalesce(p_plan_hours, f.plan_hours),
    rest_days = coalesce(rest, f.rest_days),
    share = coalesce(p_share, f.share),
    updated_at = now()
  where f.user_id = me;
end;
$$;
revoke execute on function public.fasting_settings(int, int[], boolean) from public, anon;
grant execute on function public.fasting_settings(int, int[], boolean) to authenticated;

create or replace function public.fasting_begin(p_user uuid, p_plan_hours int, p_started_at timestamptz, p_pack uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  st timestamptz := coalesce(p_started_at, now());
  id uuid;
begin
  if p_plan_hours is null or p_plan_hours < 12 or p_plan_hours > 24 then
    raise exception 'A plan is 12 to 24 hours.';
  end if;
  if st > now() + interval '1 minute' or st < now() - interval '12 hours' then
    raise exception 'You can start a fast up to 12 hours back.';
  end if;
  if exists (select 1 from public.fasts f where f.user_id = p_user and f.ended_at is null) then
    raise exception 'You''re already fasting.';
  end if;
  -- Not over a fast you've already ended.
  if exists (select 1 from public.fasts f where f.user_id = p_user and f.ended_at > st) then
    raise exception 'That''s before your last fast ended.';
  end if;
  insert into public.fasts (user_id, goal_hours, started_at, pack_id)
    values (p_user, p_plan_hours, least(st, now()), p_pack) returning fasts.id into id;
  update public.fasting_profiles set plan_hours = p_plan_hours, updated_at = now() where user_id = p_user;
  return id;
end;
$$;
revoke execute on function public.fasting_begin(uuid, int, timestamptz, uuid) from public, anon, authenticated;

-- Start a fast; with friends named, also a pack fast they're invited to.
create or replace function public.fasting_start(p_plan_hours int, p_started_at timestamptz default null, p_invite uuid[] default '{}')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pack uuid;
  fid uuid;
  invitees uuid[];
begin
  perform public.fasting_require_ok(me);
  select coalesce(array_agg(distinct u), '{}') into invitees
    from unnest(coalesce(p_invite, '{}')) u where u <> me and public.fasting_are_friends(me, u);
  if cardinality(invitees) > 10 then
    raise exception 'Invite up to 10 friends.';
  end if;
  if cardinality(invitees) > 0 then
    insert into public.fast_packs (created_by) values (me) returning id into pack;
    insert into public.fast_pack_members (pack_id, user_id, status, joined_at) values (pack, me, 'joined', now());
    insert into public.fast_pack_members (pack_id, user_id) select pack, u from unnest(invitees) u;
  end if;
  fid := public.fasting_begin(me, p_plan_hours, p_started_at, pack);
  if pack is not null then
    perform public.fasting_notify(me, invitees, '{name} started a fast. Fast together tonight?', pack);
  end if;
  return jsonb_build_object('fast_id', fid, 'pack_id', pack);
end;
$$;
revoke execute on function public.fasting_start(int, timestamptz, uuid[]) from public, anon;
grant execute on function public.fasting_start(int, timestamptz, uuid[]) to authenticated;

-- Pay a pack's bonus once everyone who joined has ended on plan.
create or replace function public.fasting_pack_settle(p_pack uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.fasting_config;
  members uuid[];
  pk public.fast_packs;
begin
  select * into pk from public.fast_packs where id = p_pack for update;
  if pk.id is null or pk.bonus_paid_at is not null then
    return 0;
  end if;
  select array_agg(m.user_id) into members from public.fast_pack_members m where m.pack_id = p_pack and m.status = 'joined';
  if members is null or cardinality(members) < 2 then
    return 0;
  end if;
  -- Still joinable while someone's invited and the 12 hours aren't up.
  if pk.created_at > now() - interval '12 hours'
     and exists (select 1 from public.fast_pack_members m where m.pack_id = p_pack and m.status = 'invited') then
    return 0;
  end if;
  if exists (
    select 1 from unnest(members) u
    where not exists (select 1 from public.fasts f where f.pack_id = p_pack and f.user_id = u and f.ended_at is not null and f.on_plan)
  ) then
    return 0;
  end if;
  select * into c from public.fasting_config where id;
  update public.fast_packs set bonus_paid_at = now() where id = p_pack;
  if c.pack_bonus > 0 then
    update public.profiles set bones_balance = bones_balance + c.pack_bonus where id = any (members);
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      select u, 'fasting_pack', 0, 0, c.pack_bonus from unnest(members) u;
  end if;
  perform public.fasting_notify(null, members,
    format('Everyone in your pack fast made it. +%s Bones 🦴', c.pack_bonus), p_pack);
  return c.pack_bonus;
end;
$$;
revoke execute on function public.fasting_pack_settle(uuid) from public, anon, authenticated;

-- End your fast: p_local_date is your own date, p_ended_at "I ate at…".
create or replace function public.fasting_end(p_local_date date, p_ended_at timestamptz default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  fp public.fasting_profiles;
  c public.fasting_config;
  f public.fasts;
  en timestamptz := coalesce(p_ended_at, now());
  h numeric;
  plan_ok boolean;
  pay int := 0;
  milestone int := 0;
  new_streak int;
  prev_longest numeric;
  pack_paid int := 0;
begin
  fp := public.fasting_require_ok(me);
  perform public.fasting_check_date(p_local_date);
  select * into f from public.fasts where user_id = me and ended_at is null for update;
  if f.id is null then
    raise exception 'You''re not fasting.';
  end if;
  if en > now() + interval '1 minute' or en <= f.started_at then
    raise exception 'That time is outside your fast.';
  end if;
  en := least(en, now());
  select * into c from public.fasting_config where id;
  select coalesce(max(hours), 0) into prev_longest from public.fasts where user_id = me and ended_at is not null;

  h := round(extract(epoch from (en - f.started_at)) / 3600.0, 2);
  plan_ok := h >= f.goal_hours;
  if not exists (select 1 from public.fasts x where x.user_id = me and x.local_day = p_local_date and x.bones > 0) then
    pay := public.fasting_hours_bones(h, c);
  end if;

  select * into fp from public.fasting_profiles where user_id = me for update;
  new_streak := fp.streak;
  if plan_ok and (fp.last_on is null or p_local_date > fp.last_on) then
    new_streak := case when public.fasting_streak_holds(me, fp.last_on, p_local_date, fp.rest_days, true) then fp.streak + 1 else 1 end;
    milestone := public.fasting_streak_bones(new_streak, c);
    update public.fasting_profiles set streak = new_streak, best_streak = greatest(best_streak, new_streak),
      last_on = p_local_date, updated_at = now() where user_id = me;
  end if;

  update public.fasts set ended_at = en, hours = h, on_plan = plan_ok, local_day = p_local_date, bones = pay + milestone
    where id = f.id;
  if pay + milestone > 0 then
    update public.profiles set bones_balance = bones_balance + pay + milestone where id = me;
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      values (me, 'fasting', 0, 0, pay + milestone);
  end if;
  if f.pack_id is not null then
    pack_paid := public.fasting_pack_settle(f.pack_id);
  end if;

  return jsonb_build_object(
    'fast_id', f.id, 'hours', h, 'goal_hours', f.goal_hours, 'on_plan', plan_ok,
    'bones', pay, 'milestone_bones', milestone, 'pack_bones', pack_paid,
    'streak', case when plan_ok then new_streak else (public.fasting_numbers(me, p_local_date) ->> 'streak')::int end,
    'best_streak', greatest(fp.best_streak, new_streak),
    'longest', greatest(prev_longest, h), 'new_longest', h > prev_longest and prev_longest > 0);
end;
$$;
revoke execute on function public.fasting_end(date, timestamptz) from public, anon;
grant execute on function public.fasting_end(date, timestamptz) to authenticated;

-- A mis-tap: within 15 minutes of starting, the fast goes away.
create or replace function public.fasting_cancel()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  f public.fasts;
begin
  select * into f from public.fasts where user_id = me and ended_at is null for update;
  if f.id is null then
    raise exception 'You''re not fasting.';
  end if;
  if f.created_at < now() - interval '15 minutes' then
    raise exception 'Only in the first 15 minutes. End it instead.';
  end if;
  delete from public.fasts where id = f.id;
  update public.fast_pack_members set status = 'declined' where pack_id = f.pack_id and user_id = me;
end;
$$;
revoke execute on function public.fasting_cancel() from public, anon;
grant execute on function public.fasting_cancel() to authenticated;

create or replace function public.fasting_feel(p_fast_id uuid, p_feel text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.fasts set feel = p_feel where id = p_fast_id and user_id = auth.uid() and ended_at is not null;
  if not found then
    raise exception 'That fast isn''t yours.';
  end if;
end;
$$;
revoke execute on function public.fasting_feel(uuid, text) from public, anon;
grant execute on function public.fasting_feel(uuid, text) to authenticated;

-- Everything the Fasting screen and the Today tile show.
create or replace function public.my_fasting(p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  fp public.fasting_profiles;
  f public.fasts;
  c public.fasting_config;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  perform public.fasting_check_date(p_local_date);
  select * into fp from public.fasting_profiles where user_id = me;
  select * into c from public.fasting_config where id;
  if fp.user_id is null or fp.age is distinct from 'ok' then
    return jsonb_build_object('age', fp.age, 'config', to_jsonb(c) - 'id' - 'updated_at');
  end if;
  select * into f from public.fasts where user_id = me and ended_at is null;
  return jsonb_build_object(
    'age', fp.age,
    'plan_hours', fp.plan_hours,
    'rest_days', to_jsonb(fp.rest_days),
    'share', fp.share,
    'started_any', exists (select 1 from public.fasts x where x.user_id = me),
    'open', public.fasting_open_json(f),
    'cheers', coalesce((select jsonb_agg(public.fasting_person(ch.from_user) order by ch.created_at)
                        from public.fast_cheers ch where ch.fast_id = f.id), '[]'),
    'numbers', public.fasting_numbers(me, p_local_date),
    'paid_today', exists (select 1 from public.fasts x where x.user_id = me and x.local_day = p_local_date and x.bones > 0),
    -- The last 35 days: each day's longest fast ended that day.
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.local_day, 'hours', d.h, 'on_plan', d.p) order by d.local_day)
                      from (select local_day, max(hours) h, bool_or(on_plan) p from public.fasts
                            where user_id = me and ended_at is not null and local_day > p_local_date - 35
                            group by local_day) d), '[]'),
    -- The phone works out your usual start time in its own time zone.
    'recent_starts', coalesce((select jsonb_agg(s.started_at order by s.started_at desc)
                               from (select started_at from public.fasts where user_id = me order by started_at desc limit 7) s), '[]'),
    'config', to_jsonb(c) - 'id' - 'updated_at');
end;
$$;
revoke execute on function public.my_fasting(date) from public, anon;
grant execute on function public.my_fasting(date) to authenticated;

-- Your ended fasts, newest first.
create or replace function public.fasting_history(p_limit int default 30)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'started_at', f.started_at, 'ended_at', f.ended_at, 'hours', f.hours,
    'goal_hours', f.goal_hours, 'on_plan', f.on_plan, 'bones', f.bones, 'feel', f.feel, 'pack_id', f.pack_id) order by f.ended_at desc), '[]')
  from (select * from public.fasts where user_id = auth.uid() and ended_at is not null
        order by ended_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) f;
$$;
revoke execute on function public.fasting_history(int) from public, anon;
grant execute on function public.fasting_history(int) to authenticated;

-- ── Friends ──

-- Friends fasting now, and the board: days on plan this week, streak,
-- longest. Me included on the board.
create or replace function public.fasting_friends(p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  perform public.fasting_require_ok(me);
  perform public.fasting_check_date(p_local_date);
  return jsonb_build_object(
    'now', coalesce((
      select jsonb_agg(public.fasting_person(f.user_id) || jsonb_build_object(
               'fast', public.fasting_open_json(f),
               'cheered', exists (select 1 from public.fast_cheers ch where ch.fast_id = f.id and ch.from_user = me))
             order by f.started_at)
      from public.fasts f where f.ended_at is null and f.user_id in (select public.fasting_friend_ids(me))), '[]'),
    'board', coalesce((
      select jsonb_agg(b.j order by (b.j -> 'numbers' ->> 'week_days')::int desc, (b.j -> 'numbers' ->> 'streak')::int desc,
                       (b.j -> 'numbers' ->> 'longest')::numeric desc)
      from (select public.fasting_person(u) || jsonb_build_object('me', u = me, 'numbers', public.fasting_numbers(u, p_local_date),
                     'fasting', exists (select 1 from public.fasts f where f.user_id = u and f.ended_at is null)) j
            from (select me u union select public.fasting_friend_ids(me)) us
            where exists (select 1 from public.fasts f where f.user_id = us.u)) b), '[]'));
end;
$$;
revoke execute on function public.fasting_friends(date) from public, anon;
grant execute on function public.fasting_friends(date) to authenticated;

create or replace function public.fasting_cheer(p_fast_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  f public.fasts;
begin
  perform public.fasting_require_ok(me);
  select * into f from public.fasts where id = p_fast_id;
  if f.id is null or f.ended_at is not null then
    raise exception 'That fast is over.';
  end if;
  if f.user_id = me or not (f.user_id in (select public.fasting_friend_ids(me))) then
    raise exception 'You can cheer friends who are fasting.';
  end if;
  insert into public.fast_cheers (fast_id, from_user) values (p_fast_id, me) on conflict do nothing;
  if found then
    perform public.fasting_notify(me, array[f.user_id],
      format('{name} cheered you on, %s h into your fast 💪', floor(extract(epoch from (now() - f.started_at)) / 3600)::int), f.pack_id);
  end if;
end;
$$;
revoke execute on function public.fasting_cheer(uuid) from public, anon;
grant execute on function public.fasting_cheer(uuid) to authenticated;

-- You and a friend over the last 30 days.
create or replace function public.fasting_compare(p_friend uuid, p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  perform public.fasting_require_ok(me);
  perform public.fasting_check_date(p_local_date);
  if not (p_friend in (select public.fasting_friend_ids(me))) then
    raise exception 'You can compare with friends who share their fasting.';
  end if;
  return jsonb_build_object(
    'me', public.fasting_numbers(me, p_local_date),
    'them', public.fasting_person(p_friend) || jsonb_build_object('numbers', public.fasting_numbers(p_friend, p_local_date)),
    'together', (select count(distinct a.pack_id) from public.fasts a join public.fasts b on b.pack_id = a.pack_id
                 where a.user_id = me and b.user_id = p_friend and a.on_plan and b.on_plan));
end;
$$;
revoke execute on function public.fasting_compare(uuid, date) from public, anon;
grant execute on function public.fasting_compare(uuid, date) to authenticated;

-- ── Pack fasts ──

create or replace function public.fasting_pack(p_pack_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pk public.fast_packs;
  c public.fasting_config;
begin
  select * into pk from public.fast_packs where id = p_pack_id;
  if pk.id is null or not exists (select 1 from public.fast_pack_members m where m.pack_id = p_pack_id and m.user_id = me) then
    raise exception 'You''re not in that pack fast.';
  end if;
  select * into c from public.fasting_config where id;
  return jsonb_build_object(
    'id', pk.id, 'created_at', pk.created_at, 'created_by', pk.created_by,
    'join_until', pk.created_at + interval '12 hours',
    'bonus', c.pack_bonus, 'bonus_paid', pk.bonus_paid_at is not null,
    'members', coalesce((
      select jsonb_agg(public.fasting_person(m.user_id) || jsonb_build_object(
               'status', m.status, 'me', m.user_id = me,
               'fast', (select jsonb_build_object('goal_hours', f.goal_hours, 'started_at', f.started_at, 'ended_at', f.ended_at,
                         'hours', coalesce(f.hours, round(extract(epoch from (now() - f.started_at)) / 3600.0, 2)), 'on_plan', f.on_plan)
                        from public.fasts f where f.pack_id = pk.id and f.user_id = m.user_id))
             order by m.status = 'joined' desc, m.joined_at nulls last, m.invited_at)
      from public.fast_pack_members m where m.pack_id = pk.id), '[]'),
    'notes', coalesce((
      select jsonb_agg(public.fasting_person(n.user_id) || jsonb_build_object('note', n.note, 'at', n.created_at) order by n.created_at desc)
      from (select * from public.fast_pack_notes where pack_id = pk.id order by created_at desc limit 20) n), '[]'));
end;
$$;
revoke execute on function public.fasting_pack(uuid) from public, anon;
grant execute on function public.fasting_pack(uuid) to authenticated;

-- Join a pack fast you're invited to: your open fast joins it, or a new
-- one starts on your plan.
create or replace function public.fasting_pack_join(p_pack_id uuid, p_plan_hours int default null, p_started_at timestamptz default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  fp public.fasting_profiles;
  pk public.fast_packs;
  f public.fasts;
  fid uuid;
  others uuid[];
begin
  fp := public.fasting_require_ok(me);
  select * into pk from public.fast_packs where id = p_pack_id;
  if pk.id is null or not exists (select 1 from public.fast_pack_members m where m.pack_id = p_pack_id and m.user_id = me and m.status = 'invited') then
    raise exception 'That invite isn''t open.';
  end if;
  if pk.created_at < now() - interval '12 hours' then
    raise exception 'That pack fast closed to new people.';
  end if;
  select * into f from public.fasts where user_id = me and ended_at is null for update;
  if f.id is not null then
    if f.pack_id is not null then
      raise exception 'You''re already in a pack fast.';
    end if;
    update public.fasts set pack_id = p_pack_id where id = f.id;
    fid := f.id;
  else
    fid := public.fasting_begin(me, coalesce(p_plan_hours, fp.plan_hours), p_started_at, p_pack_id);
  end if;
  update public.fast_pack_members set status = 'joined', joined_at = now() where pack_id = p_pack_id and user_id = me;
  select array_agg(m.user_id) into others from public.fast_pack_members m where m.pack_id = p_pack_id and m.status = 'joined' and m.user_id <> me;
  perform public.fasting_notify(me, coalesce(others, '{}'), '{name} joined your pack fast 🐾', p_pack_id);
  return jsonb_build_object('fast_id', fid, 'pack_id', p_pack_id);
end;
$$;
revoke execute on function public.fasting_pack_join(uuid, int, timestamptz) from public, anon;
grant execute on function public.fasting_pack_join(uuid, int, timestamptz) to authenticated;

create or replace function public.fasting_pack_decline(p_pack_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.fast_pack_members set status = 'declined'
    where pack_id = p_pack_id and user_id = auth.uid() and status = 'invited';
  perform public.fasting_pack_settle(p_pack_id);
end;
$$;
revoke execute on function public.fasting_pack_decline(uuid) from public, anon;
grant execute on function public.fasting_pack_decline(uuid) to authenticated;

-- Invite more friends to a pack fast you're in, while it's open.
create or replace function public.fasting_pack_invite(p_pack_id uuid, p_friends uuid[])
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pk public.fast_packs;
  added uuid[];
begin
  perform public.fasting_require_ok(me);
  select * into pk from public.fast_packs where id = p_pack_id;
  if pk.id is null or not exists (select 1 from public.fast_pack_members m where m.pack_id = p_pack_id and m.user_id = me and m.status = 'joined') then
    raise exception 'You''re not in that pack fast.';
  end if;
  if pk.created_at < now() - interval '12 hours' then
    raise exception 'That pack fast closed to new people.';
  end if;
  with ins as (
    insert into public.fast_pack_members (pack_id, user_id)
    select p_pack_id, u from (select distinct u from unnest(coalesce(p_friends, '{}')) u) x
    where u <> me and public.fasting_are_friends(me, u)
    on conflict do nothing
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into added from ins;
  if (select count(*) from public.fast_pack_members where pack_id = p_pack_id) > 11 then
    raise exception 'A pack fast is up to 11 people.';
  end if;
  perform public.fasting_notify(me, added, '{name} started a fast. Fast together tonight?', p_pack_id);
  return cardinality(added);
end;
$$;
revoke execute on function public.fasting_pack_invite(uuid, uuid[]) from public, anon;
grant execute on function public.fasting_pack_invite(uuid, uuid[]) to authenticated;

-- A quick note to the pack: water break, you got this, coffee time,
-- hungry, done. Up to 12 each per pack fast.
create or replace function public.fasting_pack_note(p_pack_id uuid, p_note text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  others uuid[];
  words text;
begin
  if not exists (select 1 from public.fast_pack_members m where m.pack_id = p_pack_id and m.user_id = me and m.status = 'joined') then
    raise exception 'You''re not in that pack fast.';
  end if;
  if (select count(*) from public.fast_pack_notes n where n.pack_id = p_pack_id and n.user_id = me) >= 12 then
    raise exception 'That''s plenty of notes for one fast.';
  end if;
  words := case p_note when 'water' then '💧 Water break' when 'gotthis' then '💪 You got this' when 'coffee' then '☕ Coffee time'
                       when 'hungry' then '😮‍💨 Hungry, hanging in' when 'done' then '✅ Done!' end;
  if words is null then
    raise exception 'Pick a note.';
  end if;
  insert into public.fast_pack_notes (pack_id, user_id, note) values (p_pack_id, me, p_note);
  select array_agg(m.user_id) into others from public.fast_pack_members m
    where m.pack_id = p_pack_id and m.status = 'joined' and m.user_id <> me
      and exists (select 1 from public.fasts f where f.pack_id = p_pack_id and f.user_id = m.user_id and f.ended_at is null);
  perform public.fasting_notify(me, coalesce(others, '{}'), '{name}: ' || words, p_pack_id);
end;
$$;
revoke execute on function public.fasting_pack_note(uuid, text) from public, anon;
grant execute on function public.fasting_pack_note(uuid, text) to authenticated;

-- Pack fast invites waiting on you (Needs you).
create or replace function public.fasting_waiting()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'pack_id', pk.id, 'from', public.fasting_person(pk.created_by), 'created_at', pk.created_at,
    'join_until', pk.created_at + interval '12 hours',
    'joined', (select count(*) from public.fast_pack_members j where j.pack_id = pk.id and j.status = 'joined'))
    order by pk.created_at desc), '[]')
  from public.fast_pack_members m join public.fast_packs pk on pk.id = m.pack_id
  where m.user_id = auth.uid() and m.status = 'invited' and pk.created_at > now() - interval '12 hours'
    and exists (select 1 from public.fasting_profiles fp where fp.user_id = auth.uid() and fp.age = 'ok');
$$;
revoke execute on function public.fasting_waiting() from public, anon;
grant execute on function public.fasting_waiting() to authenticated;

-- ── Clubs ──

-- A club's members who fast and share: who's fasting now and the week's
-- board. Empty when nobody in it fasts.
create or replace function public.club_fasting(p_club_id uuid, p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = me) then
    raise exception 'You''re not in that club.';
  end if;
  perform public.fasting_check_date(p_local_date);
  return jsonb_build_object(
    'can_fast', exists (select 1 from public.fasting_profiles fp where fp.user_id = me and fp.age = 'ok'),
    'under', exists (select 1 from public.fasting_profiles fp where fp.user_id = me and fp.age = 'under'),
    'now', coalesce((
      select jsonb_agg(public.fasting_person(f.user_id) || jsonb_build_object('fast', public.fasting_open_json(f), 'me', f.user_id = me)
             order by f.started_at)
      from public.fasts f
      join public.club_members m on m.club_id = p_club_id and m.user_id = f.user_id
      join public.fasting_profiles fp on fp.user_id = f.user_id and fp.share and fp.age = 'ok'
      where f.ended_at is null), '[]'),
    'board', coalesce((
      select jsonb_agg(b.j order by (b.j -> 'numbers' ->> 'week_days')::int desc, (b.j -> 'numbers' ->> 'streak')::int desc,
                       (b.j -> 'numbers' ->> 'longest')::numeric desc)
      from (select public.fasting_person(m.user_id) || jsonb_build_object('me', m.user_id = me,
                     'numbers', public.fasting_numbers(m.user_id, p_local_date)) j
            from public.club_members m
            join public.fasting_profiles fp on fp.user_id = m.user_id and fp.share and fp.age = 'ok'
            where m.club_id = p_club_id
              and exists (select 1 from public.fasts f where f.user_id = m.user_id and f.created_at > now() - interval '30 days')) b), '[]'));
end;
$$;
revoke execute on function public.club_fasting(uuid, date) from public, anon;
grant execute on function public.club_fasting(uuid, date) to authenticated;

-- ── Admin ──

create or replace function public.admin_fasting_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only.';
  end if;
  return jsonb_build_object(
    'tried', (select count(distinct user_id) from public.fasts),
    'fasting_now', (select count(*) from public.fasts where ended_at is null),
    'fasted_7d', (select count(distinct user_id) from public.fasts where ended_at > now() - interval '7 days'),
    'fasts_7d', (select count(*) from public.fasts where ended_at > now() - interval '7 days'),
    'median_hours_7d', (select round(percentile_cont(0.5) within group (order by hours)::numeric, 1)
                        from public.fasts where ended_at > now() - interval '7 days'),
    'on_plan_pct_7d', (select round(100.0 * count(*) filter (where on_plan) / nullif(count(*), 0))
                       from public.fasts where ended_at > now() - interval '7 days'),
    'plans', coalesce((select jsonb_object_agg(goal_hours, n) from (
                 select goal_hours, count(distinct user_id) n from public.fasts
                 where created_at > now() - interval '30 days' group by goal_hours) x), '{}'),
    'streak_7', (select count(*) from public.fasting_profiles where streak >= 7 and last_on >= current_date - 2),
    'streak_30', (select count(*) from public.fasting_profiles where streak >= 30 and last_on >= current_date - 2),
    'best_streak', coalesce((select max(best_streak) from public.fasting_profiles), 0),
    'packs_7d', (select count(*) from public.fast_packs pk where pk.created_at > now() - interval '7 days'
                 and (select count(*) from public.fast_pack_members m where m.pack_id = pk.id and m.status = 'joined') >= 2),
    'pack_people_7d', (select count(distinct m.user_id) from public.fast_pack_members m join public.fast_packs pk on pk.id = m.pack_id
                       where m.status = 'joined' and pk.created_at > now() - interval '7 days'),
    'packs_paid_7d', (select count(*) from public.fast_packs where bonus_paid_at > now() - interval '7 days'),
    'cheers_7d', (select count(*) from public.fast_cheers where created_at > now() - interval '7 days'),
    'notes_7d', (select count(*) from public.fast_pack_notes where created_at > now() - interval '7 days'),
    'clubs_fasting', (select count(*) from (
                        select m.club_id from public.club_members m
                        where exists (select 1 from public.fasts f where f.user_id = m.user_id and f.created_at > now() - interval '30 days')
                        group by m.club_id having count(*) >= 2) x),
    'fasting_clubs', (select count(*) from public.clubs where sport = 'fasting' and removed_at is null),
    'over_36_7d', (select count(*) from public.fasts where ended_at > now() - interval '7 days' and hours >= 36),
    'open_over_36', (select count(*) from public.fasts where ended_at is null and started_at < now() - interval '36 hours'),
    'unwell_7d', (select count(*) from public.fasts where ended_at > now() - interval '7 days' and feel = 'unwell'),
    'feel_7d', coalesce((select jsonb_object_agg(feel, n) from (
                  select feel, count(*) n from public.fasts where ended_at > now() - interval '7 days' and feel is not null group by feel) x), '{}'),
    'under_16', (select count(*) from public.fasting_profiles where age = 'under'),
    'not_sharing', (select count(*) from public.fasting_profiles where age = 'ok' and not share),
    'bones_7d', coalesce((select sum(bones_points) from public.activity_events
                          where kind in ('fasting', 'fasting_pack') and created_at > now() - interval '7 days'), 0));
end;
$$;
revoke execute on function public.admin_fasting_overview() from public, anon;
grant execute on function public.admin_fasting_overview() to authenticated;

-- Admin → Bones: what fasting pays.
create or replace function public.admin_set_fasting_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'Admins only.';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('bones_12', 'bones_14', 'bones_16', 'bones_18', 'bones_20', 'streak_3', 'streak_7', 'streak_14', 'streak_30', 'streak_100', 'pack_bonus') then
      raise exception 'Unknown setting %.', k;
    end if;
    if jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric < 0 or (p ->> k)::numeric > 100000 or (p ->> k)::numeric <> floor((p ->> k)::numeric) then
      raise exception 'Enter a whole number of Bones from 0 to 100,000.';
    end if;
  end loop;
  update public.fasting_config c set
    bones_12 = coalesce((p ->> 'bones_12')::int, c.bones_12),
    bones_14 = coalesce((p ->> 'bones_14')::int, c.bones_14),
    bones_16 = coalesce((p ->> 'bones_16')::int, c.bones_16),
    bones_18 = coalesce((p ->> 'bones_18')::int, c.bones_18),
    bones_20 = coalesce((p ->> 'bones_20')::int, c.bones_20),
    streak_3 = coalesce((p ->> 'streak_3')::int, c.streak_3),
    streak_7 = coalesce((p ->> 'streak_7')::int, c.streak_7),
    streak_14 = coalesce((p ->> 'streak_14')::int, c.streak_14),
    streak_30 = coalesce((p ->> 'streak_30')::int, c.streak_30),
    streak_100 = coalesce((p ->> 'streak_100')::int, c.streak_100),
    pack_bonus = coalesce((p ->> 'pack_bonus')::int, c.pack_bonus),
    updated_at = now()
  where c.id;
end;
$$;
revoke execute on function public.admin_set_fasting_config(jsonb) from public, anon;
grant execute on function public.admin_set_fasting_config(jsonb) to authenticated;
