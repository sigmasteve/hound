-- Hound: clubs. A run club, a cycling club, a walking group: members
-- start challenges and post them to their clubs, and the rest of the
-- club sees them on the club's page (and a push) with a Join button.
-- A club never narrows who you can play with: a club challenge is an
-- ordinary challenge, open to invites and its code as always.
--
--   Starting one   Level 3 (club_config.min_level, set on Admin), an
--                  account at least 7 days old, a username, never
--                  banned and not barred from community challenges.
--   Public or      Chosen when it's made. Public clubs show in Find a
--   private        club (while Admin's search switch is on) and anyone
--                  can join; private ones only by their code, link or
--                  QR. Every club has a code (6 letters and digits, so
--                  it can't be mistaken for a 7-character challenge
--                  code) and the same /c/<code> link.
--   Joining        The community rules for meeting strangers (0152):
--                  a username, the "13 or older" check, and not through
--                  a school that hasn't opted in.
--   Roles          The owner, organizers (can take posts down and remove
--                  members) and members. Anyone in a club can post.
--   Posting        The challenge's creator posts it to any of their
--                  clubs. Crowd-friendly kinds only (the community ones,
--                  and Chase, where joiners run as Foxes). Members who
--                  haven't muted the club get a push.
--   Joining a      Through the club, while the challenge takes new
--   challenge      players (a day after it starts, or a Chase's head
--                  start), the same window an invite has.
--   The tab        my_clubs() and clubs_badge() count what's new: club
--                  challenges posted since you last opened that club
--                  that you haven't joined.
--
-- The Clubs tab also lists community challenges (0152), the featured
-- ones and, while Admin's switch is on, the popular ones that week.
--
-- Admin → Clubs: the numbers, the settings, and removing a club.
--
-- Run this once, after 0184, in the SQL Editor, then redeploy the
-- send-social-push function, before publishing the app update.

create table if not exists public.club_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  min_level int not null default 3,
  min_account_days int not null default 7,
  search_on boolean not null default true,
  community_list_on boolean not null default true,
  max_owned int not null default 3,
  max_joined int not null default 20,
  max_members int not null default 500,
  updated_at timestamptz not null default now()
);
insert into public.club_config default values on conflict do nothing;
alter table public.club_config enable row level security;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 2 and 40),
  sport text not null check (sport in ('running', 'cycling', 'walking', 'hiking', 'swimming', 'mixed')),
  city text check (city is null or char_length(city) <= 40),
  description text check (description is null or char_length(description) <= 160),
  color text not null default 'orange' check (color in ('orange', 'blue', 'green', 'purple', 'red', 'teal')),
  is_public boolean not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text
);
alter table public.clubs enable row level security;

create table if not exists public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'organizer', 'member')),
  joined_at timestamptz not null default now(),
  muted boolean not null default false,
  -- When they last opened the club's page: posts after it are "new".
  seen_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user on public.club_members (user_id);
alter table public.club_members enable row level security;

create table if not exists public.club_posts (
  club_id uuid not null references public.clubs (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  posted_by uuid references public.profiles (id) on delete set null,
  posted_at timestamptz not null default now(),
  primary key (club_id, challenge_id)
);
create index if not exists club_posts_challenge on public.club_posts (challenge_id);
alter table public.club_posts enable row level security;

-- Who joined a challenge through a club, for Admin.
create table if not exists public.club_joins (
  club_id uuid not null references public.clubs (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, challenge_id, user_id)
);
alter table public.club_joins enable row level security;

revoke all on public.club_config, public.clubs, public.club_members, public.club_posts, public.club_joins from anon, authenticated;

-- ── Helpers ──────────────────────────────────────────────────────────

-- Six letters and digits that can't be mixed up.
create or replace function public.club_new_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.clubs c where c.code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.club_new_code() from public, anon, authenticated;

-- What strangers see of someone in a club: their username.
create or replace function public.club_name_of(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(p.username, split_part(p.name, ' ', 1)) from public.profiles p where p.id = p_user;
$$;
revoke execute on function public.club_name_of(uuid) from public, anon, authenticated;

-- The kinds that can be posted to a club: anyone can join them part
-- way (a Chase's joiners are Foxes).
create or replace function public.club_kind_ok(p_kind public.challenge_kind)
returns boolean
language sql
immutable
as $$
  select p_kind::text in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'hunt');
$$;
revoke execute on function public.club_kind_ok(public.challenge_kind) from public, anon, authenticated;

-- Whether a challenge still takes new players: the window an invite
-- has (a day after it starts, or a Chase's head start).
create or replace function public.club_challenge_open(c public.challenges)
returns boolean
language sql
stable
as $$
  select now() < c.ends_at
    and (c.join_closes_at is null or now() < c.join_closes_at)
    and case
      when c.kind = 'hunt' and coalesce(c.head_start_days, 0) > 0 then now() < c.starts_at + make_interval(days => c.head_start_days)
      else now() < greatest(c.starts_at, c.created_at) + interval '24 hours'
    end;
$$;
revoke execute on function public.club_challenge_open(public.challenges) from public, anon, authenticated;

-- Why this person can't start a club, or null.
create or replace function public.club_create_problem(p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.club_config;
  p public.profiles;
begin
  select * into cfg from public.club_config;
  if not cfg.enabled then
    return 'Clubs are switched off right now.';
  end if;
  select * into p from public.profiles where id = p_user;
  if public.level_for_xp(coalesce(p.xp_total, 0)) < cfg.min_level then
    return format('Reach level %s to start a club.', cfg.min_level);
  end if;
  if p.created_at > now() - make_interval(days => cfg.min_account_days) then
    return format('Your account needs to be %s days old to start a club.', cfg.min_account_days);
  end if;
  if exists (select 1 from auth.users u where u.id = p_user and u.banned_until is not null)
    or (select count(*) from public.community_strikes s where s.user_id = p_user) >= 2 then
    return 'This account can''t start clubs.';
  end if;
  if p.username is null then
    return 'Pick a username first (Settings → Profile): clubs show usernames.';
  end if;
  if (select count(*) from public.clubs c where c.created_by = p_user and c.removed_at is null) >= cfg.max_owned then
    return format('You can run up to %s clubs.', cfg.max_owned);
  end if;
  return null;
end;
$$;
revoke execute on function public.club_create_problem(uuid) from public, anon, authenticated;

-- Why this person can't join this club, or null. 'age' and 'username'
-- are asks the app answers, like community challenges'.
create or replace function public.club_join_problem(p_club uuid, p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.club_config;
  comm public.community_config;
  cl public.clubs;
  org_kind text;
  org_ok boolean;
begin
  select * into cfg from public.club_config;
  select * into comm from public.community_config;
  select * into cl from public.clubs where id = p_club;
  if not found or cl.removed_at is not null then
    return 'That club isn''t on Hound anymore.';
  end if;
  if exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = p_user) then
    return null;
  end if;
  if not cfg.enabled then
    return 'Clubs are switched off right now.';
  end if;
  if (select count(*) from public.club_members m where m.club_id = p_club) >= cfg.max_members then
    return 'This club is full.';
  end if;
  if (select count(*) from public.club_members m join public.clubs c on c.id = m.club_id
      where m.user_id = p_user and c.removed_at is null) >= cfg.max_joined then
    return format('You''re in %s clubs already. Leave one first.', cfg.max_joined);
  end if;
  if comm.age_gate then
    select o.kind, o.community_ok into org_kind, org_ok
      from public.organizations o join public.profiles p on p.organization_id = o.id where p.id = p_user;
    if org_kind = 'school' and not coalesce(org_ok, false) then
      return 'Clubs aren''t available through your school.';
    end if;
    if not exists (select 1 from public.community_age_ok a where a.user_id = p_user) then
      return 'age';
    end if;
  end if;
  if (select p.username from public.profiles p where p.id = p_user) is null then
    return 'username';
  end if;
  return null;
end;
$$;
revoke execute on function public.club_join_problem(uuid, uuid) from public, anon, authenticated;

create or replace function public.club_raise(p_problem text)
returns void
language plpgsql
as $$
begin
  if p_problem = 'age' then
    raise exception 'Confirm you''re 13 or older first.';
  elsif p_problem = 'username' then
    raise exception 'Pick a username first (Settings → Profile): clubs show usernames.';
  elsif p_problem is not null then
    raise exception '%', p_problem;
  end if;
end;
$$;
revoke execute on function public.club_raise(text) from public, anon, authenticated;

-- The words a club shows strangers: no slurs, links or phone numbers.
create or replace function public.club_words_check(p_name text, p_city text, p_description text)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  problem text;
begin
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(p_name)) > 40 then
    raise exception 'Give your club a name of 2 to 40 characters.';
  end if;
  if char_length(coalesce(p_city, '')) > 40 then
    raise exception 'Keep the city to 40 characters.';
  end if;
  if char_length(coalesce(p_description, '')) > 160 then
    raise exception 'Keep the description to 160 characters.';
  end if;
  problem := coalesce(public.community_words_problem(p_name), public.community_words_problem(p_city), public.community_words_problem(p_description));
  if problem is not null then
    raise exception '%', problem;
  end if;
end;
$$;
revoke execute on function public.club_words_check(text, text, text) from public, anon, authenticated;

-- One club as a list row, for the person asking.
create or replace function public.club_row(cl public.clubs, p_user uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', cl.id,
    'name', cl.name,
    'sport', cl.sport,
    'city', cl.city,
    'description', cl.description,
    'color', cl.color,
    'is_public', cl.is_public,
    'members', (select count(*) from public.club_members m where m.club_id = cl.id),
    'role', (select m.role from public.club_members m where m.club_id = cl.id and m.user_id = p_user),
    'muted', coalesce((select m.muted from public.club_members m where m.club_id = cl.id and m.user_id = p_user), false),
    -- Open challenges you haven't joined, and how many are new since
    -- you last opened the club.
    'open', (
      select count(*) from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
      where cp.club_id = cl.id and public.club_challenge_open(c)
        and not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.user_id = p_user)
    ),
    'new', (
      select count(*) from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
      join public.club_members m on m.club_id = cl.id and m.user_id = p_user
      where cp.club_id = cl.id and cp.posted_at > m.seen_at and public.club_challenge_open(c)
        and cp.posted_by is distinct from p_user
        and not exists (select 1 from public.challenge_participants x where x.challenge_id = c.id and x.user_id = p_user)
    )
  );
$$;
revoke execute on function public.club_row(public.clubs, uuid) from public, anon, authenticated;

-- ── For everyone ─────────────────────────────────────────────────────

create or replace function public.my_club_status()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'create_problem', public.club_create_problem(auth.uid()),
    'min_level', cfg.min_level,
    'search_on', cfg.search_on and cfg.enabled,
    'community_list_on', cfg.community_list_on,
    'enabled', cfg.enabled
  )
  from public.club_config cfg;
$$;
revoke execute on function public.my_club_status() from public, anon;
grant execute on function public.my_club_status() to authenticated;

create or replace function public.create_club(
  p_name text,
  p_sport text,
  p_city text,
  p_description text,
  p_color text,
  p_public boolean
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  problem text;
  cl public.clubs;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  problem := public.club_create_problem(me);
  if problem is not null then
    raise exception '%', problem;
  end if;
  perform public.club_words_check(p_name, nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_description, '')), ''));
  insert into public.clubs (code, name, sport, city, description, color, is_public, created_by)
  values (
    public.club_new_code(), trim(p_name), p_sport, nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''), coalesce(p_color, 'orange'), coalesce(p_public, true), me
  )
  returning * into cl;
  insert into public.club_members (club_id, user_id, role) values (cl.id, me, 'owner');
  return jsonb_build_object('id', cl.id, 'code', cl.code);
end;
$$;
revoke execute on function public.create_club(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_club(text, text, text, text, text, boolean) to authenticated;

-- The owner or an organizer changes the club's details (not public or
-- private: that's set when it's made).
create or replace function public.update_club(p_club_id uuid, p_name text, p_sport text, p_city text, p_description text, p_color text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role in ('owner', 'organizer')) then
    raise exception 'Only the club''s organizers can change it.';
  end if;
  perform public.club_words_check(p_name, nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_description, '')), ''));
  update public.clubs c set
    name = trim(p_name),
    sport = p_sport,
    city = nullif(trim(coalesce(p_city, '')), ''),
    description = nullif(trim(coalesce(p_description, '')), ''),
    color = coalesce(p_color, c.color)
  where c.id = p_club_id and c.removed_at is null;
end;
$$;
revoke execute on function public.update_club(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_club(uuid, text, text, text, text, text) to authenticated;

create or replace function public.my_clubs()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(public.club_row(c, auth.uid()) order by m.joined_at), '[]'::jsonb)
  from public.club_members m join public.clubs c on c.id = m.club_id
  where m.user_id = auth.uid() and c.removed_at is null;
$$;
revoke execute on function public.my_clubs() from public, anon;
grant execute on function public.my_clubs() to authenticated;

-- The Clubs tab's badge: new club challenges you haven't joined.
create or replace function public.clubs_badge()
returns int
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum((public.club_row(c, auth.uid())->>'new')::int), 0)::int
  from public.club_members m join public.clubs c on c.id = m.club_id
  where m.user_id = auth.uid() and c.removed_at is null and not m.muted;
$$;
revoke execute on function public.clubs_badge() from public, anon;
grant execute on function public.clubs_badge() to authenticated;

-- Find a club: public ones, by name or city and sport.
create or replace function public.search_clubs(p_query text default '', p_sport text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  q text := '%' || replace(replace(trim(coalesce(p_query, '')), '%', ''), '_', '') || '%';
begin
  if not (select cfg.search_on and cfg.enabled from public.club_config cfg) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(r.j order by r.members desc, r.name)
    from (
      select public.club_row(c, auth.uid()) as j, c.name,
        (select count(*) from public.club_members m where m.club_id = c.id) as members
      from public.clubs c
      where c.is_public and c.removed_at is null
        and (p_sport is null or c.sport = p_sport)
        and (c.name ilike q or coalesce(c.city, '') ilike q)
      order by members desc, c.name
      limit 30
    ) r
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.search_clubs(text, text) from public, anon;
grant execute on function public.search_clubs(text, text) to authenticated;

-- A club from its code (6 characters), counting wrong codes the same
-- way community codes do. Nothing for a wrong code.
create or replace function public.preview_club_by_code(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.community_config;
  cl public.clubs;
  hr timestamptz := date_trunc('hour', now());
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.community_config;
  if coalesce((select a.wrong from public.community_code_attempts a where a.user_id = me and a.hour = hr), 0) >= cfg.wrong_codes_per_hour then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select * into cl from public.clubs c where c.code = public.community_norm_code(p_code) and c.removed_at is null;
  if not found then
    insert into public.community_code_attempts (user_id, hour, wrong) values (me, hr, 1)
      on conflict (user_id, hour) do update set wrong = community_code_attempts.wrong + 1;
    return null;
  end if;
  return public.club_row(cl, me) || jsonb_build_object('problem', public.club_join_problem(cl.id, me));
end;
$$;
revoke execute on function public.preview_club_by_code(text) from public, anon;
grant execute on function public.preview_club_by_code(text) to authenticated;

create or replace function public.join_club_by_code(p_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cl public.clubs;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cl from public.clubs c where c.code = public.community_norm_code(p_code) and c.removed_at is null;
  if not found then
    raise exception 'That club code doesn''t work. Check it and try again.';
  end if;
  perform public.club_raise(public.club_join_problem(cl.id, me));
  insert into public.club_members (club_id, user_id) values (cl.id, me) on conflict do nothing;
  return cl.id;
end;
$$;
revoke execute on function public.join_club_by_code(text) from public, anon;
grant execute on function public.join_club_by_code(text) to authenticated;

-- Join a public club from Find a club.
create or replace function public.join_club(p_club_id uuid)
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
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.is_public and c.removed_at is null) then
    raise exception 'That club is joined with its code.';
  end if;
  perform public.club_raise(public.club_join_problem(p_club_id, me));
  insert into public.club_members (club_id, user_id) values (p_club_id, me) on conflict do nothing;
end;
$$;
revoke execute on function public.join_club(uuid) from public, anon;
grant execute on function public.join_club(uuid) to authenticated;

-- Leave. An owner leaving hands the club to the longest-standing
-- organizer (or member); the last one out closes it.
create or replace function public.leave_club(p_club_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  was text;
  heir uuid;
begin
  delete from public.club_members m where m.club_id = p_club_id and m.user_id = me returning m.role into was;
  if was = 'owner' then
    select m.user_id into heir from public.club_members m where m.club_id = p_club_id
      order by (m.role = 'organizer') desc, m.joined_at limit 1;
    if heir is null then
      update public.clubs c set removed_at = now(), removed_reason = 'closed' where c.id = p_club_id;
    else
      update public.club_members m set role = 'owner' where m.club_id = p_club_id and m.user_id = heir;
    end if;
  end if;
end;
$$;
revoke execute on function public.leave_club(uuid) from public, anon;
grant execute on function public.leave_club(uuid) to authenticated;

create or replace function public.set_club_muted(p_club_id uuid, p_muted boolean)
returns void
language sql
security definer set search_path = public
as $$
  update public.club_members m set muted = coalesce(p_muted, false) where m.club_id = p_club_id and m.user_id = auth.uid();
$$;
revoke execute on function public.set_club_muted(uuid, boolean) from public, anon;
grant execute on function public.set_club_muted(uuid, boolean) to authenticated;

-- The owner makes someone an organizer or a member again.
create or replace function public.set_club_role(p_club_id uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_role not in ('organizer', 'member') then
    raise exception 'Organizer or member.';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the club''s owner can do that.';
  end if;
  update public.club_members m set role = p_role where m.club_id = p_club_id and m.user_id = p_user and m.role <> 'owner';
end;
$$;
revoke execute on function public.set_club_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_club_role(uuid, uuid, text) to authenticated;

-- An organizer removes a member (not the owner, and an organizer only
-- by the owner).
create or replace function public.remove_club_member(p_club_id uuid, p_user uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  mine text;
  theirs text;
begin
  select m.role into mine from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid();
  select m.role into theirs from public.club_members m where m.club_id = p_club_id and m.user_id = p_user;
  if mine is null or mine = 'member' or theirs = 'owner' or (theirs = 'organizer' and mine <> 'owner') then
    raise exception 'You can''t remove them.';
  end if;
  delete from public.club_members m where m.club_id = p_club_id and m.user_id = p_user;
end;
$$;
revoke execute on function public.remove_club_member(uuid, uuid) from public, anon;
grant execute on function public.remove_club_member(uuid, uuid) to authenticated;

-- A new code (the old one stops working).
create or replace function public.new_club_code(p_club_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  c text;
begin
  if not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role in ('owner', 'organizer')) then
    raise exception 'Only the club''s organizers can do that.';
  end if;
  c := public.club_new_code();
  update public.clubs x set code = c where x.id = p_club_id;
  return c;
end;
$$;
revoke execute on function public.new_club_code(uuid) from public, anon;
grant execute on function public.new_club_code(uuid) to authenticated;

-- A club's page. Members see everything (and opening it marks what's
-- new as seen); anyone else sees a public club's details and counts,
-- or nothing for a private one.
create or replace function public.club_page(p_club_id uuid, p_week_start date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cl public.clubs;
  mine public.club_members;
  wk date := coalesce(p_week_start, date_trunc('week', current_date)::date);
  result jsonb;
begin
  select * into cl from public.clubs c where c.id = p_club_id and c.removed_at is null;
  if not found then
    raise exception 'That club isn''t on Hound anymore.';
  end if;
  select * into mine from public.club_members m where m.club_id = cl.id and m.user_id = me;
  if mine.user_id is null and not cl.is_public then
    raise exception 'That club is joined with its code.';
  end if;

  result := public.club_row(cl, me) || jsonb_build_object(
    'code', case when mine.user_id is not null then cl.code end,
    'problem', case when mine.user_id is null then public.club_join_problem(cl.id, me) end,
    'week', (
      select jsonb_build_object(
        'mi', coalesce(sum(d.all_mi) filter (where d.day >= wk), 0),
        'last_mi', coalesce(sum(d.all_mi) filter (where d.day < wk), 0),
        'people', count(distinct d.user_id) filter (where d.day >= wk and d.all_mi > 0)
      )
      from public.daily_miles d join public.club_members m on m.user_id = d.user_id and m.club_id = cl.id
      where d.day >= wk - 7 and d.day < wk + 7
    )
  );
  if mine.user_id is null then
    return result || jsonb_build_object(
      'open_names', coalesce((
        select jsonb_agg(c.name order by cp.posted_at desc) from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
        where cp.club_id = cl.id and public.club_challenge_open(c)
      ), '[]'::jsonb)
    );
  end if;

  result := result || jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'mi', t.mi, 'me', t.user_id = me) order by t.mi desc)
      from (
        select d.user_id, public.club_name_of(d.user_id) as name, sum(d.all_mi) as mi
        from public.daily_miles d join public.club_members m on m.user_id = d.user_id and m.club_id = cl.id
        where d.day >= wk and d.day < wk + 7
        group by d.user_id having sum(d.all_mi) > 0
        order by mi desc limit 3
      ) t
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(x.j order by x.joined, x.starts_at)
      from (
        select
          exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = me) as joined,
          c.starts_at,
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'kind', c.kind,
            'starts_at', c.starts_at,
            'ends_at', c.ends_at,
            'duration_days', c.duration_days,
            'posted_by', public.club_name_of(cp.posted_by),
            'posted_by_me', cp.posted_by = me,
            'players', (select count(*) from public.challenge_participants p where p.challenge_id = c.id),
            'from_club', (
              select coalesce(jsonb_agg(jsonb_build_object('initials', pr.initials, 'frame', pr.equipped_frame_id, 'background', pr.equipped_background_id, 'icon', pr.equipped_icon_id)), '[]'::jsonb)
              from (
                select p.user_id from public.challenge_participants p join public.club_members m on m.user_id = p.user_id and m.club_id = cl.id
                where p.challenge_id = c.id order by p.user_id limit 4
              ) f join public.profiles pr on pr.id = f.user_id
            ),
            'club_players', (
              select count(*) from public.challenge_participants p join public.club_members m on m.user_id = p.user_id and m.club_id = cl.id
              where p.challenge_id = c.id
            ),
            'joined', exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = me),
            'open', public.club_challenge_open(c)
          ) as j
        from public.club_posts cp join public.challenges c on c.id = cp.challenge_id
        where cp.club_id = cl.id and c.ends_at > now()
          and (public.club_challenge_open(c) or exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = me))
      ) x
    ), '[]'::jsonb),
    'members_list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', public.club_name_of(m.user_id), 'initials', p.initials, 'role', m.role,
        'frame', p.equipped_frame_id, 'background', p.equipped_background_id, 'icon', p.equipped_icon_id, 'me', m.user_id = me
      ) order by (m.role = 'owner') desc, (m.role = 'organizer') desc, m.joined_at)
      from (select * from public.club_members m where m.club_id = cl.id order by (m.role = 'owner') desc, (m.role = 'organizer') desc, m.joined_at limit 60) m
      join public.profiles p on p.id = m.user_id
    ), '[]'::jsonb)
  );
  update public.club_members m set seen_at = now() where m.club_id = cl.id and m.user_id = me;
  return result;
end;
$$;
revoke execute on function public.club_page(uuid, date) from public, anon;
grant execute on function public.club_page(uuid, date) to authenticated;

-- Post a challenge you made to some of your clubs; their members (not
-- muted, not already in it) get a push. Returns how many clubs.
create or replace function public.post_to_clubs(p_challenge_id uuid, p_club_ids uuid[])
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  cl public.clubs;
  n int := 0;
  to_users uuid[];
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.created_by is distinct from me then
    raise exception 'Only the challenge''s creator can post it to clubs.';
  end if;
  if not public.club_kind_ok(c.kind) then
    raise exception 'That kind of challenge can''t be posted to a club.';
  end if;
  if not public.club_challenge_open(c) then
    raise exception 'This challenge isn''t taking new players anymore.';
  end if;
  for cl in
    select x.* from public.clubs x
    join public.club_members m on m.club_id = x.id and m.user_id = me
    where x.id = any (coalesce(p_club_ids, '{}')) and x.removed_at is null
  loop
    insert into public.club_posts (club_id, challenge_id, posted_by) values (cl.id, c.id, me) on conflict do nothing;
    if found then
      n := n + 1;
      select array_agg(m.user_id) into to_users from public.club_members m
        where m.club_id = cl.id and m.user_id <> me and not m.muted
          and not exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = m.user_id)
          and public.social_push_reachable(m.user_id);
      if to_users is not null then
        perform public.social_notify(jsonb_build_object(
          'kind', 'club_post',
          'from_user', me,
          'to_users', to_jsonb(to_users),
          'challenge_id', c.id,
          'challenge_name', c.name,
          'club_id', cl.id,
          'club_name', cl.name
        ));
      end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.post_to_clubs(uuid, uuid[]) from public, anon;
grant execute on function public.post_to_clubs(uuid, uuid[]) to authenticated;

-- Take a post down: whoever posted it, or the club's organizers.
create or replace function public.remove_club_post(p_club_id uuid, p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.club_posts cp where cp.club_id = p_club_id and cp.challenge_id = p_challenge_id
      and (cp.posted_by = auth.uid() or exists (
        select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role in ('owner', 'organizer')
      ))
  ) then
    raise exception 'Only whoever posted it, or the club''s organizers, can take it down.';
  end if;
  delete from public.club_posts cp where cp.club_id = p_club_id and cp.challenge_id = p_challenge_id;
end;
$$;
revoke execute on function public.remove_club_post(uuid, uuid) from public, anon;
grant execute on function public.remove_club_post(uuid, uuid) to authenticated;

-- Join a challenge posted to your club.
create or replace function public.join_club_challenge(p_club_id uuid, p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
begin
  if not exists (select 1 from public.club_members m join public.clubs x on x.id = m.club_id
                 where m.club_id = p_club_id and m.user_id = me and x.removed_at is null) then
    raise exception 'Join the club first.';
  end if;
  if not exists (select 1 from public.club_posts cp where cp.club_id = p_club_id and cp.challenge_id = p_challenge_id) then
    raise exception 'That challenge isn''t in this club anymore.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = me) then
    return;
  end if;
  if not public.club_challenge_open(c) then
    raise exception 'Joining for this challenge has closed.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id, role)
    values (c.id, me, case when c.kind = 'hunt' then 'hunted' end)
    on conflict (challenge_id, user_id) do nothing;
  delete from public.challenge_invites i where i.challenge_id = c.id and i.invitee_id = me;
  insert into public.club_joins (club_id, challenge_id, user_id) values (p_club_id, c.id, me) on conflict do nothing;
end;
$$;
revoke execute on function public.join_club_challenge(uuid, uuid) from public, anon;
grant execute on function public.join_club_challenge(uuid, uuid) to authenticated;

-- Your clubs a challenge can be posted to, and which it's in already.
create or replace function public.clubs_for_challenge(p_challenge_id uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'sport', c.sport, 'color', c.color,
    'members', (select count(*) from public.club_members x where x.club_id = c.id),
    'posted', exists (select 1 from public.club_posts cp where cp.club_id = c.id and cp.challenge_id = p_challenge_id)
  ) order by m.joined_at), '[]'::jsonb)
  from public.club_members m join public.clubs c on c.id = m.club_id
  where m.user_id = auth.uid() and c.removed_at is null;
$$;
revoke execute on function public.clubs_for_challenge(uuid) from public, anon;
grant execute on function public.clubs_for_challenge(uuid) to authenticated;

create or replace function public.community_list_row(
  p_id uuid, p_name text, p_description text, p_kind public.challenge_kind, p_creator uuid, p_players bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_days int, p_code text, p_joined boolean
)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', p_id, 'name', p_name, 'description', p_description, 'kind', p_kind,
    'creator', (select p.username from public.profiles p where p.id = p_creator),
    'players', p_players, 'starts_at', p_starts_at, 'ends_at', p_ends_at, 'duration_days', p_days,
    'code', p_code, 'joined', p_joined
  );
$$;
-- The Clubs tab's Community challenges: the featured ones, and (while
-- Admin's switch is on) the most joined this week. Each with its code,
-- joined the usual way (join_by_code).
create or replace function public.list_community_challenges()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with live as (
    select c.*,
      (select count(*) from public.challenge_participants p where p.challenge_id = c.id) as players,
      (select count(*) from public.challenge_participants p where p.challenge_id = c.id and p.joined_at > now() - interval '7 days') as week_joins,
      exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = auth.uid()) as joined
    from public.challenges c
    where c.community and c.review_state = 'listed' and not c.code_off and c.organization_id is null
      and c.ends_at > now() and (c.join_closes_at is null or c.join_closes_at > now())
  )
  select jsonb_build_object(
    'featured', coalesce((
      select jsonb_agg(public.community_list_row(l.id, l.name, l.description, l.kind, l.created_by, l.players, l.starts_at, l.ends_at, l.duration_days, l.join_code, l.joined) order by l.starts_at)
      from live l where l.featured
    ), '[]'::jsonb),
    'popular', case when (select cfg.community_list_on from public.club_config cfg) then coalesce((
      select jsonb_agg(x.j order by x.week_joins desc, x.players desc)
      from (
        select l.week_joins, l.players,
          public.community_list_row(l.id, l.name, l.description, l.kind, l.created_by, l.players, l.starts_at, l.ends_at, l.duration_days, l.join_code, l.joined) as j
        from live l where not l.featured and l.players >= 3
        order by l.week_joins desc, l.players desc limit 15
      ) x
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

revoke execute on function public.community_list_row(uuid, text, text, public.challenge_kind, uuid, bigint, timestamptz, timestamptz, int, text, boolean) from public, anon, authenticated;
revoke execute on function public.list_community_challenges() from public, anon;
grant execute on function public.list_community_challenges() to authenticated;

-- The website's /c/<code> page for a club code: just enough to
-- recognise it, signed out.
create or replace function public.club_code_public(p_code text)
returns table (name text, sport text, city text, members int)
language sql
stable
security definer set search_path = public
as $$
  select c.name, c.sport, c.city, (select count(*)::int from public.club_members m where m.club_id = c.id)
  from public.clubs c
  where c.code = public.community_norm_code(p_code) and c.removed_at is null;
$$;
revoke execute on function public.club_code_public(text) from public;
grant execute on function public.club_code_public(text) to anon, authenticated;

-- ── Admin ────────────────────────────────────────────────────────────

create or replace function public.admin_clubs_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  with live as (select * from public.clubs c where c.removed_at is null)
  select jsonb_build_object(
    'config', (select to_jsonb(cfg) - 'id' from public.club_config cfg),
    'clubs', (select count(*) from live),
    'public', (select count(*) from live where is_public),
    'private', (select count(*) from live where not is_public),
    'new_7d', (select count(*) from live where created_at > now() - interval '7 days'),
    'people', (select count(distinct m.user_id) from public.club_members m join live l on l.id = m.club_id),
    'memberships', (select count(*) from public.club_members m join live l on l.id = m.club_id),
    'joined_7d', (select count(*) from public.club_members m join live l on l.id = m.club_id where m.joined_at > now() - interval '7 days' and m.role <> 'owner'),
    'active_30d', (select count(distinct cp.club_id) from public.club_posts cp join live l on l.id = cp.club_id where cp.posted_at > now() - interval '30 days'),
    'posts_30d', (select count(*) from public.club_posts cp where cp.posted_at > now() - interval '30 days'),
    'club_joins_30d', (select count(*) from public.club_joins j where j.joined_at > now() - interval '30 days'),
    'by_sport', coalesce((select jsonb_object_agg(s.sport, s.n) from (select sport, count(*) n from live group by sport) s), '{}'::jsonb),
    'newest', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sport', c.sport, 'city', c.city, 'is_public', c.is_public, 'created_at', c.created_at,
        'members', (select count(*) from public.club_members m where m.club_id = c.id),
        'posts', (select count(*) from public.club_posts cp where cp.club_id = c.id),
        'owner', (select coalesce(p.username, p.name) from public.club_members m join public.profiles p on p.id = m.user_id where m.club_id = c.id and m.role = 'owner')
      ) order by c.created_at desc)
      from (select * from live order by created_at desc limit 20) c
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.admin_clubs_overview() from public, anon;
grant execute on function public.admin_clubs_overview() to authenticated;

create or replace function public.admin_set_club_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  if (p ? 'min_level') and ((p->>'min_level')::int < 1 or (p->>'min_level')::int > 50) then
    raise exception 'The level is 1 to 50.';
  end if;
  update public.club_config cfg set
    enabled = coalesce((p->>'enabled')::boolean, cfg.enabled),
    min_level = coalesce((p->>'min_level')::int, cfg.min_level),
    min_account_days = coalesce((p->>'min_account_days')::int, cfg.min_account_days),
    search_on = coalesce((p->>'search_on')::boolean, cfg.search_on),
    community_list_on = coalesce((p->>'community_list_on')::boolean, cfg.community_list_on),
    max_owned = coalesce((p->>'max_owned')::int, cfg.max_owned),
    max_joined = coalesce((p->>'max_joined')::int, cfg.max_joined),
    max_members = coalesce((p->>'max_members')::int, cfg.max_members),
    updated_at = now()
  where cfg.id;
end;
$$;
revoke execute on function public.admin_set_club_config(jsonb) from public, anon;
grant execute on function public.admin_set_club_config(jsonb) to authenticated;

create or replace function public.admin_remove_club(p_club_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles x where x.id = auth.uid() and x.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.clubs c set removed_at = now(), removed_reason = coalesce(nullif(trim(p_reason), ''), 'removed by Hound')
    where c.id = p_club_id and c.removed_at is null;
end;
$$;
revoke execute on function public.admin_remove_club(uuid, text) from public, anon;
grant execute on function public.admin_remove_club(uuid, text) to authenticated;
