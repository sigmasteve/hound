-- Hound: community challenges (K-04). Members publish challenges that
-- anyone with the challenge's code, link or QR code can join. They are
-- listed nowhere: Discover and Today show only global challenges, plus
-- any community challenge an admin features.
--
-- Decided in the K-04 design doc:
--   Who publishes   Tracker rank (level 5), an account at least 7 days old,
--                   never banned, with a username.
--   Kinds           The crowd-safe ones global challenges allow.
--   Words           Name (40) and description (120): no slurs, no swear
--                   words, no links, emails or phone numbers.
--   Codes           7 letters and digits that can't be mixed up (shown
--                   XXX-XXXX); typed in, opened from a link, or scanned.
--                   Wrong codes are limited per member per hour.
--   Review          With pre_review on (the default for the beta), a new
--                   one waits for an admin before its code works; off,
--                   it works straight away. Either way, report_threshold
--                   reports pause it (hidden) until an admin restores or
--                   removes it. A removal ends it with no results and
--                   gives the creator a strike: 30 days without
--                   publishing, and a second ends it for good.
--   Limits          Live per creator, published a week, players, and
--                   community challenges joined at once (community_config).
--   Prizes, bots    None: no pots, no bots, taunts-only walls.
--   Names           Leaderboards show usernames (the app forces it), so
--                   joining needs a username.
--   Age             With age_gate on, a one-time "I'm 13 or older" before
--                   the first publish or join, and community codes don't
--                   work for members of a school organization unless it
--                   opts in (organizations.community_ok).
--   Featured        An admin can feature one; it then shows with the
--                   global challenges, joined the same way.
--
-- Admin → Community reads and changes all of it.
--
-- Run this once, after 0001-0151, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.challenges
  add column if not exists community boolean not null default false,
  add column if not exists join_code text unique,
  add column if not exists description text check (description is null or char_length(description) <= 120),
  add column if not exists review_state text check (review_state in ('pending', 'listed', 'hidden', 'removed')),
  add column if not exists featured boolean not null default false,
  add column if not exists code_off boolean not null default false;

alter table public.organizations add column if not exists community_ok boolean not null default false;

create table public.community_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  pre_review boolean not null default true,
  age_gate boolean not null default true,
  min_level int not null default 5,
  min_account_days int not null default 7,
  max_live int not null default 3,
  max_per_week int not null default 5,
  max_players int not null default 500,
  max_joined int not null default 10,
  report_threshold int not null default 3,
  wrong_codes_per_hour int not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.community_config default values on conflict do nothing;
alter table public.community_config enable row level security;
create policy "Anyone signed in can read the community settings"
  on public.community_config for select to authenticated using (true);
revoke all on public.community_config from anon;
revoke insert, update, delete on public.community_config from authenticated;

create table public.community_age_ok (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  confirmed_at timestamptz not null default now()
);
alter table public.community_age_ok enable row level security;
create policy "Users can see their own age confirmation"
  on public.community_age_ok for select to authenticated using (user_id = auth.uid());
revoke all on public.community_age_ok from anon;
revoke insert, update, delete on public.community_age_ok from authenticated;

create table public.community_reports (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('offensive', 'spam', 'misleading', 'other')),
  created_at timestamptz not null default now(),
  primary key (challenge_id, reporter_id)
);
create index community_reports_reporter on public.community_reports (reporter_id);
alter table public.community_reports enable row level security;
revoke all on public.community_reports from anon, authenticated;

create table public.community_code_attempts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  hour timestamptz not null,
  wrong int not null default 0,
  primary key (user_id, hour)
);
alter table public.community_code_attempts enable row level security;
revoke all on public.community_code_attempts from anon, authenticated;

create table public.community_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete set null,
  created_at timestamptz not null default now()
);
create index community_strikes_user on public.community_strikes (user_id);
create index community_strikes_challenge on public.community_strikes (challenge_id);
alter table public.community_strikes enable row level security;
revoke all on public.community_strikes from anon, authenticated;

-- No pots and no bots in a community challenge, whatever calls what.
create or replace function public.community_no_extras()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'challenges' then
    if new.community and new.pot_bones is not null then
      raise exception 'Community challenges don''t have pots.';
    end if;
  elsif exists (select 1 from public.challenges c where c.id = new.challenge_id and c.community) then
    raise exception 'Community challenges are people only.';
  end if;
  return new;
end;
$$;
revoke execute on function public.community_no_extras() from public, anon, authenticated;
create trigger community_no_pot before insert or update of pot_bones, community on public.challenges
  for each row execute function public.community_no_extras();
create trigger community_no_bots before insert on public.challenge_bots
  for each row execute function public.community_no_extras();

-- Letters and digits that can't be mixed up.
create or replace function public.community_new_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..7 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.challenges c where c.join_code = code);
  end loop;
  return code;
end;
$$;
revoke execute on function public.community_new_code() from public, anon, authenticated;

-- "hnd-7k2q", "HND 7K2Q" and "HND7K2Q" are the same code.
create or replace function public.community_norm_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;
revoke execute on function public.community_norm_code(text) from public, anon, authenticated;

-- Null when the words are fine for strangers to read, else why not.
create or replace function public.community_words_problem(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_text is null or p_text = '' then null
    when public.trash_talk_has_slur(p_text) or public.trash_talk_mask(p_text) <> p_text then 'Keep it clean: one of those words isn''t allowed.'
    when p_text ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|app|co|me|ly|gg)\M|@[a-z0-9-]+\.)' then 'No links or email addresses, please.'
    when length(regexp_replace(coalesce(substring(p_text from '[0-9+][0-9 ().-]{8,}[0-9]'), ''), '[^0-9]', '', 'g')) >= 10
      then 'No phone numbers, please.'
    else null
  end;
$$;
revoke execute on function public.community_words_problem(text) from public, anon, authenticated;

-- Why this person can't publish right now, or null.
create or replace function public.community_publish_problem(p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.community_config;
  p public.profiles;
  strikes int;
  last_strike timestamptz;
begin
  select * into cfg from public.community_config;
  if not cfg.enabled then
    return 'Community challenges are switched off right now.';
  end if;
  select * into p from public.profiles where id = p_user;
  if public.level_for_xp(coalesce(p.xp_total, 0)) < cfg.min_level then
    return format('Reach level %s (Tracker rank) to publish one.', cfg.min_level);
  end if;
  if p.created_at > now() - make_interval(days => cfg.min_account_days) then
    return format('Your account needs to be %s days old to publish one.', cfg.min_account_days);
  end if;
  if exists (select 1 from auth.users u where u.id = p_user and u.banned_until is not null) then
    return 'This account can''t publish community challenges.';
  end if;
  select count(*), max(s.created_at) into strikes, last_strike from public.community_strikes s where s.user_id = p_user;
  if strikes >= 2 then
    return 'This account can''t publish community challenges anymore.';
  end if;
  if strikes = 1 and last_strike > now() - interval '30 days' then
    return format('You can publish again on %s.', to_char(last_strike + interval '30 days', 'Mon FMDD'));
  end if;
  if p.username is null then
    return 'Pick a username first (Settings → Profile): community leaderboards show usernames.';
  end if;
  return null;
end;
$$;
revoke execute on function public.community_publish_problem(uuid) from public, anon, authenticated;

-- Why this person can't join this community challenge, or null. 'age'
-- and 'username' are asks the app answers (confirm 13+, pick a
-- username) rather than refusals.
create or replace function public.community_join_problem(p_challenge_id uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.community_config;
  c public.challenges;
  my_org uuid;
  org_kind text;
  org_ok boolean;
begin
  select * into cfg from public.community_config;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not c.community or c.review_state = 'removed' then
    return 'That challenge isn''t available anymore.';
  end if;
  select p.organization_id into my_org from public.profiles p where p.id = p_user;
  if c.organization_id is not null and c.organization_id is distinct from my_org then
    return 'That challenge isn''t available anymore.';
  end if;
  if exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = p_user) then
    return null;
  end if;
  if c.review_state = 'pending' then
    return 'This challenge is waiting for review. Try again soon.';
  end if;
  if c.review_state = 'hidden' or c.code_off then
    return 'This challenge isn''t taking new players right now.';
  end if;
  if now() >= c.join_closes_at or now() >= c.ends_at then
    return 'Joining for this challenge has closed.';
  end if;
  if (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id) >= cfg.max_players then
    return 'This challenge is full.';
  end if;
  if cfg.age_gate then
    select o.kind, o.community_ok into org_kind, org_ok from public.organizations o where o.id = my_org;
    if org_kind = 'school' and not coalesce(org_ok, false) then
      return 'Community challenges aren''t available through your school.';
    end if;
    if not exists (select 1 from public.community_age_ok a where a.user_id = p_user) then
      return 'age';
    end if;
  end if;
  if (select p.username from public.profiles p where p.id = p_user) is null then
    return 'username';
  end if;
  if (
    select count(*) from public.challenge_participants cp
    join public.challenges x on x.id = cp.challenge_id
    where cp.user_id = p_user and x.community and x.ends_at > now() and x.created_by <> p_user
  ) >= cfg.max_joined then
    return format('You''re in %s community challenges already. Finish one first.', cfg.max_joined);
  end if;
  return null;
end;
$$;
revoke execute on function public.community_join_problem(uuid, uuid) from public, anon, authenticated;

-- What the app needs to know before showing publish and join.
create or replace function public.my_community_status()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.community_config;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  return jsonb_build_object(
    'enabled', cfg.enabled,
    'publish_problem', public.community_publish_problem(me),
    'age_gate', cfg.age_gate,
    'age_ok', exists (select 1 from public.community_age_ok a where a.user_id = me),
    'pre_review', cfg.pre_review
  );
end;
$$;
revoke execute on function public.my_community_status() from public, anon;
grant execute on function public.my_community_status() to authenticated;

create or replace function public.confirm_community_age()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  insert into public.community_age_ok (user_id) values (auth.uid()) on conflict do nothing;
end;
$$;
revoke execute on function public.confirm_community_age() from public, anon;
grant execute on function public.confirm_community_age() to authenticated;

-- 0136's publish_global_challenge, for members: their own limits and
-- words, a code, and the creator joined straight away.
create or replace function public.publish_community_challenge(
  p_name text,
  p_description text,
  p_kind public.challenge_kind,
  p_duration_days int,
  p_starts_at timestamptz,
  p_join_closes_at timestamptz,
  p_org_only boolean default false,
  p_daily_goal_steps int default null,
  p_distance_goal_unit text default null,
  p_distance_goal_mi numeric default null,
  p_distance_goal_steps int default null,
  p_bingo_card_type text default null,
  p_course_id text default null,
  p_distance_source text default null
)
returns table (id uuid, join_code text, review_state text)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  cfg public.community_config;
  problem text;
  ends timestamptz;
  new_id uuid;
  code text;
  state text;
  my_org uuid;
  nm text := trim(coalesce(p_name, ''));
  descr text := nullif(trim(coalesce(p_description, '')), '');
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  problem := public.community_publish_problem(me);
  if problem is not null then
    raise exception '%', problem;
  end if;
  if cfg.age_gate and not exists (select 1 from public.community_age_ok a where a.user_id = me) then
    raise exception 'Confirm you''re 13 or older first.';
  end if;
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly') then
    raise exception 'That kind of challenge can''t be a community challenge.';
  end if;
  if char_length(nm) < 1 or char_length(nm) > 40 then
    raise exception 'Give it a name of up to 40 characters.';
  end if;
  if char_length(coalesce(descr, '')) > 120 then
    raise exception 'Keep the description to 120 characters.';
  end if;
  problem := coalesce(public.community_words_problem(nm), public.community_words_problem(descr));
  if problem is not null then
    raise exception '%', problem;
  end if;
  if p_kind = 'seventyfive' then
    if p_duration_days <> 75 then
      raise exception 'A 75 Day Challenge runs 75 days.';
    end if;
  elsif p_duration_days is null or p_duration_days < 3 or p_duration_days > 30 then
    raise exception 'A community challenge runs 3 to 30 days.';
  end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 day' or p_starts_at > now() + interval '15 days' then
    raise exception 'Pick a start date in the next two weeks.';
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
  if (
    select count(*) from public.challenges c
    where c.created_by = me and c.community and c.ends_at > now() and c.review_state <> 'removed'
  ) >= cfg.max_live then
    raise exception 'You have % community challenges running. Wait for one to end first.', cfg.max_live;
  end if;
  if (
    select count(*) from public.challenges c
    where c.created_by = me and c.community and c.created_at > now() - interval '7 days'
  ) >= cfg.max_per_week then
    raise exception 'You''ve published % this week. Try again in a few days.', cfg.max_per_week;
  end if;
  if p_org_only then
    select p.organization_id into my_org from public.profiles p where p.id = me;
    if my_org is null then
      raise exception 'You''re not in an organization.';
    end if;
  end if;

  code := public.community_new_code();
  state := case when cfg.pre_review then 'pending' else 'listed' end;
  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    distance_source, is_global, join_closes_at, organization_id,
    community, join_code, description, review_state
  ) values (
    nm, p_kind, me, p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' or (p_kind = 'distance' and p_distance_goal_unit = 'miles') then p_course_id end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'miles' then p_distance_source end,
    false, p_join_closes_at, my_org,
    true, code, descr, state
  )
  returning challenges.id into new_id;
  insert into public.challenge_participants (challenge_id, user_id) values (new_id, me)
    on conflict (challenge_id, user_id) do nothing;
  return query select new_id, code, state;
end;
$$;
revoke execute on function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text) from public, anon;
grant execute on function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text) to authenticated;

-- A code typed in, opened from a link or scanned: what it is, and
-- whether you can join (problem: null, 'age', 'username' or why not).
-- No row: no challenge has that code. Wrong codes count toward the
-- hourly limit, here and in join_by_code.
create or replace function public.preview_by_code(p_code text)
returns table (
  id uuid,
  name text,
  description text,
  kind public.challenge_kind,
  creator text,
  participant_count int,
  duration_days int,
  starts_at timestamptz,
  ends_at timestamptz,
  join_closes_at timestamptz,
  joined boolean,
  problem text
)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  cfg public.community_config;
  c public.challenges;
  wrong_now int;
  hr timestamptz := date_trunc('hour', now());
  problem text;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  select coalesce(sum(a.wrong), 0) into wrong_now from public.community_code_attempts a where a.user_id = me and a.hour = hr;
  if wrong_now >= cfg.wrong_codes_per_hour then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select * into c from public.challenges x
    where x.join_code = public.community_norm_code(p_code) and x.community;
  problem := case when found then public.community_join_problem(c.id, me) end;
  -- A wrong code returns nothing (an error would undo the count).
  if not found or problem = 'That challenge isn''t available anymore.' then
    insert into public.community_code_attempts (user_id, hour, wrong) values (me, hr, 1)
      on conflict (user_id, hour) do update set wrong = community_code_attempts.wrong + 1;
    return;
  end if;
  return query select c.id, c.name, c.description, c.kind,
    (select p.username from public.profiles p where p.id = c.created_by),
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id),
    c.duration_days, c.starts_at, c.ends_at, c.join_closes_at,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = me),
    problem;
end;
$$;
revoke execute on function public.preview_by_code(text) from public, anon;
grant execute on function public.preview_by_code(text) to authenticated;

-- The challenge joined, or null when no challenge has that code.
create or replace function public.join_by_code(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.community_config;
  c public.challenges;
  problem text;
  hr timestamptz := date_trunc('hour', now());
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  if coalesce((select a.wrong from public.community_code_attempts a where a.user_id = me and a.hour = hr), 0) >= cfg.wrong_codes_per_hour then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select * into c from public.challenges x
    where x.join_code = public.community_norm_code(p_code) and x.community;
  problem := case when found then public.community_join_problem(c.id, me) end;
  if not found or problem = 'That challenge isn''t available anymore.' then
    insert into public.community_code_attempts (user_id, hour, wrong) values (me, hr, 1)
      on conflict (user_id, hour) do update set wrong = community_code_attempts.wrong + 1;
    return null;
  end if;
  if problem = 'age' then
    raise exception 'Confirm you''re 13 or older first.';
  elsif problem = 'username' then
    raise exception 'Pick a username first (Settings → Profile): community leaderboards show usernames.';
  elsif problem is not null then
    raise exception '%', problem;
  end if;
  insert into public.challenge_participants (challenge_id, user_id) values (c.id, me)
    on conflict (challenge_id, user_id) do nothing;
  return c.id;
end;
$$;
revoke execute on function public.join_by_code(text) from public, anon;
grant execute on function public.join_by_code(text) to authenticated;

-- The website's /c/<code> page, for people who may not be signed in:
-- just enough to recognise it. Only working codes of challenges open to
-- everyone answer.
create or replace function public.community_code_public(p_code text)
returns table (name text, kind public.challenge_kind, starts_at timestamptz, participant_count int)
language sql
stable
security definer set search_path = public
as $$
  select c.name, c.kind, c.starts_at,
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id)
  from public.challenges c
  where c.join_code = public.community_norm_code(p_code)
    and c.community and c.review_state = 'listed' and not c.code_off
    and c.organization_id is null and c.ends_at > now();
$$;
revoke execute on function public.community_code_public(text) from public;
grant execute on function public.community_code_public(text) to anon, authenticated;

-- The creator's controls: switch the code off or on, or get a new one.
-- Returns the code as it now stands.
create or replace function public.set_community_code(p_challenge_id uuid, p_action text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not c.community or c.created_by is distinct from auth.uid() then
    raise exception 'Only the person who made it can change its code.';
  end if;
  if p_action = 'off' then
    update public.challenges set code_off = true where id = c.id;
  elsif p_action = 'on' then
    update public.challenges set code_off = false where id = c.id;
  elsif p_action = 'new' then
    update public.challenges set join_code = public.community_new_code(), code_off = false where id = c.id
      returning join_code into c.join_code;
  else
    raise exception 'Unknown action.';
  end if;
  return c.join_code;
end;
$$;
revoke execute on function public.set_community_code(uuid, text) from public, anon;
grant execute on function public.set_community_code(uuid, text) to authenticated;

-- The creator's description edit, before it starts.
create or replace function public.set_community_description(p_challenge_id uuid, p_description text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  descr text := nullif(trim(coalesce(p_description, '')), '');
  problem text;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not c.community or c.created_by is distinct from auth.uid() then
    raise exception 'Only the person who made it can change it.';
  end if;
  if now() >= c.starts_at then
    raise exception 'It''s started, so the description stays as it is.';
  end if;
  if char_length(coalesce(descr, '')) > 120 then
    raise exception 'Keep the description to 120 characters.';
  end if;
  problem := public.community_words_problem(descr);
  if problem is not null then
    raise exception '%', problem;
  end if;
  update public.challenges set description = descr where id = c.id;
end;
$$;
revoke execute on function public.set_community_description(uuid, text) from public, anon;
grant execute on function public.set_community_description(uuid, text) to authenticated;

create or replace function public.report_community_challenge(p_challenge_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  cfg public.community_config;
  c public.challenges;
  n int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not c.community then
    raise exception 'Only community challenges can be reported here.';
  end if;
  if c.created_by = auth.uid() then
    raise exception 'You can''t report your own challenge.';
  end if;
  insert into public.community_reports (challenge_id, reporter_id, reason)
    values (c.id, auth.uid(), coalesce(p_reason, 'other'))
    on conflict (challenge_id, reporter_id) do nothing;
  select count(*) into n from public.community_reports r where r.challenge_id = c.id;
  if n >= cfg.report_threshold and c.review_state = 'listed' then
    update public.challenges set review_state = 'hidden', featured = false where id = c.id;
  end if;
end;
$$;
revoke execute on function public.report_community_challenge(uuid, text) from public, anon;
grant execute on function public.report_community_challenge(uuid, text) to authenticated;

-- The creator can call it off while nobody else has joined: it ends,
-- with no results. It still counts toward their week.
create or replace function public.cancel_community_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not c.community or c.created_by is distinct from auth.uid() then
    raise exception 'Only the person who made it can call it off.';
  end if;
  if exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id <> c.created_by) then
    raise exception 'Someone has joined, so it can''t be called off now.';
  end if;
  update public.challenges
    set review_state = 'removed', ends_at = least(ends_at, now()), score_settled_at = coalesce(score_settled_at, now()), featured = false
    where id = c.id;
end;
$$;
revoke execute on function public.cancel_community_challenge(uuid) from public, anon;
grant execute on function public.cancel_community_challenge(uuid) to authenticated;

-- ── Admin ─────────────────────────────────────────────────────────────

create or replace function public.community_require_admin()
returns void
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can do that.';
  end if;
end;
$$;
revoke execute on function public.community_require_admin() from public, anon, authenticated;

-- 'review': waiting, paused or reported (newest first); 'all': the latest 100.
create or replace function public.admin_list_community(p_filter text default 'review')
returns table (
  id uuid,
  name text,
  description text,
  kind public.challenge_kind,
  creator text,
  creator_id uuid,
  review_state text,
  featured boolean,
  code_off boolean,
  join_code text,
  participant_count int,
  report_count int,
  reasons text[],
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.community_require_admin();
  return query
  select c.id, c.name, c.description, c.kind,
    coalesce(p.username, p.name), c.created_by, c.review_state, c.featured, c.code_off, c.join_code,
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id),
    (select count(*)::int from public.community_reports r where r.challenge_id = c.id),
    (select coalesce(array_agg(distinct r.reason), '{}') from public.community_reports r where r.challenge_id = c.id),
    c.starts_at, c.ends_at, c.created_at
  from public.challenges c
  left join public.profiles p on p.id = c.created_by
  where c.community
    and (
      p_filter <> 'review'
      or c.review_state in ('pending', 'hidden')
      or (c.review_state = 'listed' and exists (select 1 from public.community_reports r where r.challenge_id = c.id))
    )
  order by c.created_at desc
  limit 100;
end;
$$;
revoke execute on function public.admin_list_community(text) from public, anon;
grant execute on function public.admin_list_community(text) to authenticated;

-- approve | restore: its code works · remove: ends, no results, a strike
-- for the creator · feature | unfeature: shown with the global challenges.
create or replace function public.admin_review_community(p_challenge_id uuid, p_action text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  perform public.community_require_admin();
  select * into c from public.challenges where id = p_challenge_id and community;
  if not found then
    raise exception 'That isn''t a community challenge.';
  end if;
  if p_action in ('approve', 'restore') then
    update public.challenges set review_state = 'listed' where id = c.id and review_state <> 'removed';
    if p_action = 'restore' then
      delete from public.community_reports r where r.challenge_id = c.id;
    end if;
  elsif p_action = 'remove' then
    if c.review_state <> 'removed' then
      update public.challenges
        set review_state = 'removed', featured = false, ends_at = least(ends_at, now()),
            score_settled_at = coalesce(score_settled_at, now())
        where id = c.id;
      insert into public.community_strikes (user_id, challenge_id) values (c.created_by, c.id);
    end if;
  elsif p_action = 'feature' then
    if c.review_state <> 'listed' then
      raise exception 'Only a challenge whose code works can be featured.';
    end if;
    update public.challenges set featured = true where id = c.id;
  elsif p_action = 'unfeature' then
    update public.challenges set featured = false where id = c.id;
  else
    raise exception 'Unknown action.';
  end if;
end;
$$;
revoke execute on function public.admin_review_community(uuid, text) from public, anon;
grant execute on function public.admin_review_community(uuid, text) to authenticated;

-- Any of the settings; keys left out stay as they are.
create or replace function public.admin_set_community_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.community_require_admin();
  update public.community_config cfg set
    enabled = coalesce((p ->> 'enabled')::boolean, cfg.enabled),
    pre_review = coalesce((p ->> 'pre_review')::boolean, cfg.pre_review),
    age_gate = coalesce((p ->> 'age_gate')::boolean, cfg.age_gate),
    min_level = coalesce((p ->> 'min_level')::int, cfg.min_level),
    min_account_days = coalesce((p ->> 'min_account_days')::int, cfg.min_account_days),
    max_live = coalesce((p ->> 'max_live')::int, cfg.max_live),
    max_per_week = coalesce((p ->> 'max_per_week')::int, cfg.max_per_week),
    max_players = coalesce((p ->> 'max_players')::int, cfg.max_players),
    max_joined = coalesce((p ->> 'max_joined')::int, cfg.max_joined),
    report_threshold = coalesce((p ->> 'report_threshold')::int, cfg.report_threshold),
    wrong_codes_per_hour = coalesce((p ->> 'wrong_codes_per_hour')::int, cfg.wrong_codes_per_hour),
    updated_at = now();
end;
$$;
revoke execute on function public.admin_set_community_config(jsonb) from public, anon;
grant execute on function public.admin_set_community_config(jsonb) to authenticated;

-- A school opting its members in to community codes.
create or replace function public.admin_set_org_community(p_org_id uuid, p_ok boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.community_require_admin();
  update public.organizations set community_ok = coalesce(p_ok, false) where id = p_org_id;
end;
$$;
revoke execute on function public.admin_set_org_community(uuid, boolean) from public, anon;
grant execute on function public.admin_set_org_community(uuid, boolean) to authenticated;

-- ── Featured ones, with the global challenges ─────────────────────────

-- 0130's list_global_challenges, with featured community challenges.
create or replace function public.list_global_challenges(p_include_ended boolean default false)
returns table (
  id uuid,
  name text,
  kind public.challenge_kind,
  duration_days int,
  starts_at timestamptz,
  ends_at timestamptz,
  join_closes_at timestamptz,
  created_at timestamptz,
  daily_goal_steps int,
  distance_goal_unit text,
  distance_goal_mi numeric,
  distance_goal_steps int,
  bingo_card_type text,
  participant_count int,
  joined boolean,
  course_id text,
  distance_source text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.kind, c.duration_days, c.starts_at, c.ends_at, c.join_closes_at, c.created_at,
    c.daily_goal_steps, c.distance_goal_unit, c.distance_goal_mi, c.distance_goal_steps, c.bingo_card_type,
    (select count(*)::int from public.challenge_participants cp where cp.challenge_id = c.id),
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = c.id and cp.user_id = auth.uid()),
    c.course_id,
    c.distance_source
  from public.challenges c
  -- Global ones, and community ones you've featured (0152).
  where (c.is_global or (c.community and c.featured and c.review_state = 'listed' and not c.code_off))
    and auth.uid() is not null
    and (c.ends_at > now() or p_include_ended)
  order by case when p_include_ended then c.created_at end desc, c.starts_at asc
  limit 50;
$$;

revoke execute on function public.list_global_challenges(boolean) from public, anon;
grant execute on function public.list_global_challenges(boolean) to authenticated;

-- 0075's join_global_challenge: a featured community challenge joins
-- here too, under the community rules.
create or replace function public.join_global_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  problem text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id and (is_global or (community and featured));
  if not found then
    raise exception 'That challenge isn''t available anymore.';
  end if;
  if c.community then
    problem := public.community_join_problem(c.id, auth.uid());
    if problem = 'age' then
      raise exception 'Confirm you''re 13 or older first.';
    elsif problem = 'username' then
      raise exception 'Pick a username first (Settings → Profile): community leaderboards show usernames.';
    elsif problem is not null then
      raise exception '%', problem;
    end if;
  elsif now() >= c.join_closes_at or now() >= c.ends_at then
    raise exception 'Joining for this challenge has closed.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id)
    values (p_challenge_id, auth.uid())
    on conflict (challenge_id, user_id) do nothing;
end;
$$;

-- ── Taunts only, like global challenges (0083's, with community) ──────
create or replace function public.trash_talk_status(p_challenge_id uuid)
returns table (
  can_post boolean,
  free_text_allowed boolean,
  free_text_reason text,
  read_only boolean,
  retention_days int,
  pushes_muted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg public.trash_talk_config;
  c public.challenges;
  participant boolean;
  ended boolean;
begin
  select * into cfg from public.trash_talk_config;
  select * into c from public.challenges where id = p_challenge_id;
  participant := public.is_challenge_participant(p_challenge_id, auth.uid());
  ended := c.ends_at is not null and c.ends_at <= now();
  return query select
    participant and not ended,
    participant and not ended and cfg.free_text_enabled and not (coalesce(c.is_global, false) or coalesce(c.community, false)),
    case
      when not cfg.free_text_enabled then 'off'
      when (coalesce(c.is_global, false) or coalesce(c.community, false)) then 'global'
      when ended then 'ended'
      else null
    end,
    ended,
    cfg.retention_days,
    exists (
      select 1 from public.trash_talk_challenge_mutes cm
      where cm.challenge_id = p_challenge_id and cm.user_id = auth.uid()
    );
end;
$$;

revoke execute on function public.trash_talk_status(uuid) from public, anon;
grant execute on function public.trash_talk_status(uuid) to authenticated;

create or replace function public.post_trash_talk(
  p_challenge_id uuid,
  p_body text default null,
  p_taunt text default null,
  p_target uuid default null,
  p_n numeric default null,
  p_unit text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.trash_talk_config;
  c public.challenges;
  target_name text;
  msg_kind text;
  msg text;
  new_id uuid;
  recent int;
  recipients uuid[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or not public.is_challenge_participant(p_challenge_id, me) then
    raise exception 'Only people in this challenge can talk trash here.';
  end if;
  if c.ends_at <= now() then
    raise exception 'This challenge is over — the wall is read-only now.';
  end if;
  select * into cfg from public.trash_talk_config;

  select count(*) into recent from public.challenge_messages m
    where m.user_id = me and m.challenge_id = p_challenge_id and m.created_at > now() - interval '5 minutes';
  if recent >= 8 then
    raise exception 'Easy there — give it a few minutes before posting again.';
  end if;

  if p_taunt is not null then
    msg_kind := 'taunt';
    if p_target is not null then
      if p_target = me or not public.is_challenge_participant(p_challenge_id, p_target) then
        raise exception 'Pick someone in this challenge.';
      end if;
      select case when p.use_username and p.username is not null then p.username else split_part(p.name, ' ', 1) end
        into target_name from public.profiles p where p.id = p_target;
    end if;
    if p_taunt in ('coming_for', 'ahead_by', 'behind_by', 'wake_up') and target_name is null then
      raise exception 'That one needs someone to aim at.';
    end if;
    if p_taunt in ('ahead_by', 'behind_by') and (p_n is null or p_n <= 0 or p_n > 10000000
        or coalesce(p_unit, 'steps') not in ('steps', 'mi', 'squares', 'days')) then
      raise exception 'That one needs a number.';
    end if;
    msg := case p_taunt
      when 'catch_me' then 'Catch me if you can 🐾'
      when 'rearview' then 'See you in my rearview 👋'
      when 'all_you_got' then 'Is that all you got?'
      when 'couch' then 'Somebody''s couch is getting comfy 🛋️'
      when 'warming_up' then 'I''m just warming up 🔥'
      when 'coming_for' then target_name || ', I''m coming for you 👀'
      when 'ahead_by' then 'I''m ' || public.trash_talk_amount(p_n, coalesce(p_unit, 'steps')) || ' ahead of ' || target_name || ' 😏'
      when 'behind_by' then 'Only ' || public.trash_talk_amount(p_n, coalesce(p_unit, 'steps')) || ' behind ' || target_name || '… for now 😤'
      when 'wake_up' then 'Wake up, ' || target_name || '! ⏰'
      else null
    end;
    if msg is null then
      raise exception 'That taunt isn''t available.';
    end if;
  else
    msg_kind := 'text';
    if not cfg.free_text_enabled then
      raise exception 'Typed messages are turned off right now — try a taunt instead.';
    end if;
    if (coalesce(c.is_global, false) or coalesce(c.community, false)) then
      raise exception 'Global and community challenges are taunts only.';
    end if;
    msg := regexp_replace(trim(coalesce(p_body, '')), '\s+', ' ', 'g');
    if msg = '' then
      raise exception 'Write something first.';
    end if;
    if char_length(msg) > 140 then
      raise exception 'Keep it to 140 characters.';
    end if;
    if public.trash_talk_has_slur(msg) then
      raise exception 'That message can''t be posted.';
    end if;
    if cfg.filter_profanity then
      msg := public.trash_talk_mask(msg);
    end if;
  end if;

  insert into public.challenge_messages (challenge_id, user_id, kind, body)
    values (p_challenge_id, me, msg_kind, msg)
    returning id into new_id;

  -- Push everyone else who hasn't had one for this challenge in the last
  -- 2 hours, hasn't muted the author or this challenge's trash talk, and
  -- can get these pushes.
  select coalesce(array_agg(cp.user_id), '{}') into recipients
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id
    and cp.user_id <> me
    and public.social_push_reachable(cp.user_id)
    and not exists (select 1 from public.trash_talk_mutes mu where mu.user_id = cp.user_id and mu.muted_user_id = me)
    and not exists (
      select 1 from public.trash_talk_challenge_mutes cm
      where cm.challenge_id = p_challenge_id and cm.user_id = cp.user_id
    )
    and not exists (
      select 1 from public.trash_talk_pushes tp
      where tp.challenge_id = p_challenge_id and tp.user_id = cp.user_id and tp.last_at > now() - interval '2 hours'
    );

  if array_length(recipients, 1) > 0 then
    insert into public.trash_talk_pushes (challenge_id, user_id, last_at)
      select p_challenge_id, r, now() from unnest(recipients) r
      on conflict (challenge_id, user_id) do update set last_at = excluded.last_at;
    perform public.social_notify(jsonb_build_object(
      'kind', 'trash_talk', 'from_user', me, 'challenge_id', p_challenge_id,
      'to_users', to_jsonb(recipients), 'message', msg));
  end if;

  return new_id;
end;
$$;

revoke execute on function public.post_trash_talk(uuid, text, text, uuid, numeric, text) from public, anon;
grant execute on function public.post_trash_talk(uuid, text, text, uuid, numeric, text) to authenticated;

-- Undo, if needed (run 0075's join_global_challenge, 0130's
-- list_global_challenges and 0083's trash_talk_status and
-- post_trash_talk again first):
--   drop function public.admin_set_org_community(uuid, boolean);
--   drop function public.admin_set_community_config(jsonb);
--   drop function public.admin_review_community(uuid, text);
--   drop function public.admin_list_community(text);
--   drop function public.community_require_admin();
--   drop function public.cancel_community_challenge(uuid);
--   drop function public.report_community_challenge(uuid, text);
--   drop function public.set_community_description(uuid, text);
--   drop function public.set_community_code(uuid, text);
--   drop function public.community_code_public(text);
--   drop function public.join_by_code(text);
--   drop function public.preview_by_code(text);
--   drop function public.publish_community_challenge(text, text, public.challenge_kind, int, timestamptz, timestamptz, boolean, int, text, numeric, int, text, text, text);
--   drop function public.confirm_community_age();
--   drop function public.my_community_status();
--   drop function public.community_join_problem(uuid, uuid);
--   drop function public.community_publish_problem(uuid);
--   drop function public.community_words_problem(text);
--   drop function public.community_norm_code(text);
--   drop function public.community_new_code();
--   drop trigger community_no_bots on public.challenge_bots;
--   drop trigger community_no_pot on public.challenges;
--   drop function public.community_no_extras();
--   drop table public.community_strikes, public.community_code_attempts, public.community_reports,
--     public.community_age_ok, public.community_config;
--   alter table public.organizations drop column community_ok;
--   alter table public.challenges drop column code_off, drop column featured, drop column review_state,
--     drop column description, drop column join_code, drop column community;
