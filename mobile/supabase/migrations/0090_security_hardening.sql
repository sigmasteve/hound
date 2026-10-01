-- Hound: security hardening — by Roshan Trivedi.
--
-- Written and tested by Roshan Trivedi as 0083_security_hardening.sql in
-- his security review of the repository (1 Oct 2026, at master db220ae /
-- PR #275). Renumbered to 0090 because 0083 is trash talk, and so it runs
-- after 0084-0089 — its sweep of function permissions (section 2) then
-- covers every function those added too. The body below is his,
-- unchanged; it was re-tested against a copy that includes 0084-0089
-- (start-day triggers, streak scoring, local-time alerts, username
-- filter): it applies cleanly, runs twice, and the app's normal flows
-- still work alongside 0085/0086's start-day triggers.
--
-- Fixes from his review: C1 (organization admin checks), C2 (challenges
-- created already finished; daily reward cap), H2 (step limits, members
-- only, days near the challenge), H3 (friendships need a yes), H9 (join
-- time and role set by the server), M1 (functions closed to signed-out
-- callers), M10 (indexes), and the column the H5 invite-email fix needs.
-- Follow-ups are in 0091.
--
-- Run this once, after 0001-0089, in the SQL Editor.
--
-- ── Original header ───────────────────────────────────────────────────
-- Hound: security hardening.
--
-- Everything in this file was tested against a local Postgres 16 copy of
-- the schema built from migrations 0001-0082 (see the review document),
-- first to reproduce each problem, then to confirm the fix closes it and
-- the normal app flows still work.
--
-- Written so it can be run once in the Supabase SQL Editor. It is safe to
-- run twice: policies and triggers are dropped first, functions use
-- CREATE OR REPLACE, constraints and indexes are guarded.
--
-- What changes for the current app: nothing it legitimately does. Each
-- rule below matches what the client already sends (challenge dates are
-- start + duration, friend requests are pending, step counts are
-- human-sized). What stops working is the same call made by someone
-- writing to the API directly.
--
-- NOT in this file (needs an app update first): hiding other people's
-- email / friend_code on `profiles`, and a create_challenge() RPC. See
-- "How to close H1" and the fix plan in the review document.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Organization permission checks that let people in no org through
-- ─────────────────────────────────────────────────────────────────────
-- The old test was
--   if not (is_admin or (caller_org = target_org and caller_org_role = 'admin'))
-- For someone in no organization, caller_org and caller_org_role are NULL,
-- so the inside becomes NULL, NOT NULL is NULL, and IF NULL does not
-- raise. The check was skipped. coalesce() turns NULL into false so the
-- exception fires. Same fix in all four functions. An explicit sign-in
-- check is added too, because an anonymous caller has no profile row and
-- every variable comes back NULL.

create or replace function public.org_set_member_role(target_user_id uuid, role text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_org uuid;
  caller_is_platform_admin boolean;
  caller_org_role text;
  caller_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if role not in ('member', 'admin') then
    raise exception 'role must be ''member'' or ''admin''';
  end if;

  select organization_id into target_org from public.profiles where id = target_user_id;
  if target_org is null then
    raise exception 'That person is not in an organization.';
  end if;

  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = target_org, false) and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  update public.profiles set org_role = role where id = target_user_id;
end;
$$;

create or replace function public.admin_regenerate_org_invite_code(organization_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller_is_platform_admin boolean;
  caller_org uuid;
  caller_org_role text;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;

  select p.is_admin, p.organization_id, p.org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles p where p.id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = admin_regenerate_org_invite_code.organization_id, false)
        and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  new_code := public.generate_org_invite_code();
  update public.organizations set invite_code = new_code where id = admin_regenerate_org_invite_code.organization_id;
  return new_code;
end;
$$;

create or replace function public.org_remove_member(target_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  target_org uuid;
  caller_is_platform_admin boolean;
  caller_org_role text;
  caller_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;

  select organization_id into target_org from public.profiles where id = target_user_id;
  if target_org is null then
    raise exception 'That person is not in an organization.';
  end if;

  select is_admin, organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = target_org, false) and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  update public.profiles set organization_id = null, org_role = null where id = target_user_id;
end;
$$;

create or replace function public.org_set_currency_name(organization_id uuid, currency_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller_is_platform_admin boolean;
  caller_org uuid;
  caller_org_role text;
  trimmed text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;

  select is_admin, profiles.organization_id, org_role
    into caller_is_platform_admin, caller_org, caller_org_role
    from public.profiles where id = auth.uid();

  if not (
    coalesce(caller_is_platform_admin, false)
    or (coalesce(caller_org = org_set_currency_name.organization_id, false)
        and coalesce(caller_org_role = 'admin', false))
  ) then
    raise exception 'not authorized';
  end if;

  trimmed := nullif(trim(org_set_currency_name.currency_name), '');
  if trimmed is not null and char_length(trimmed) > 24 then
    raise exception 'Keep the currency name to 24 characters or fewer.';
  end if;
  update public.organizations set currency_name = trimmed where id = org_set_currency_name.organization_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Functions anonymous visitors can call
-- ─────────────────────────────────────────────────────────────────────
-- Postgres gives EXECUTE to PUBLIC on every new function, and Supabase
-- also grants it to anon. Several older functions only ever ran
-- `grant ... to authenticated`, which does not take anything away. This
-- removes PUBLIC and anon access from every function in the public
-- schema, then puts back the two that a signed-out person needs (the
-- invite page's name lookup and the beta download links), and keeps
-- signed-in access exactly as it was.

do $$
declare
  f record;
  auth_had boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    auth_had := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if auth_had and not has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

grant execute on function public.friend_code_owner_name(text) to anon, authenticated;
grant execute on function public.beta_download_links() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Friendships: nobody can be befriended without saying yes
-- ─────────────────────────────────────────────────────────────────────
-- The insert rule only checked who the requester was, and the table
-- allows status 'accepted', so a request could arrive already accepted.
-- Now a new row must be a pending request to someone else. Accepting
-- stays with the recipient. The update grant is narrowed to the status
-- column so nobody can re-point requester_id or recipient_id.
-- (Column-level revoke on its own does nothing while a table-level grant
-- exists, which is the lesson in 0043, so the table-level one goes first.)

drop policy if exists "Users can send a friend request" on public.friendships;
create policy "Users can send a friend request"
  on public.friendships for insert
  to authenticated
  with check (requester_id = auth.uid() and recipient_id <> auth.uid() and status = 'pending');

revoke update on public.friendships from authenticated, anon;
grant update (status) on public.friendships to authenticated;

-- A push for a friend request should only go out for a real pending
-- request, not for the accepted rows the signup code creates.
drop trigger if exists friendships_after_insert on public.friendships;
create trigger friendships_after_insert
  after insert on public.friendships
  for each row
  when (new.status = 'pending')
  execute procedure public.friendships_after_insert();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Challenges: dates and size have to make sense
-- ─────────────────────────────────────────────────────────────────────
-- The app works out ends_at itself, and nothing on the server checked it.
-- A challenge created with an end date in the past could be settled
-- straight away for XP and Bones. The rule matches what the app sends:
-- end = start + duration (an hour of slack for clock and daylight-saving
-- differences), a duration of 1 to 100 days, a start within a sensible
-- window, and an end that is still in the future when it is created.
-- A creator can only attach a challenge to an organization they belong to.

drop policy if exists "Signed-in users can create challenges" on public.challenges;
create policy "Signed-in users can create challenges"
  on public.challenges for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and not is_global
    and score_settled_at is null
    and duration_days between 1 and 100
    and abs(extract(epoch from (ends_at - starts_at)) - duration_days * 86400) <= 3600
    and starts_at >= now() - interval '2 days'
    and starts_at <= now() + interval '365 days'
    and ends_at > now()
    and char_length(name) <= 60
    and (
      organization_id is null
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.organization_id = challenges.organization_id
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 5. Participants: the server decides when you joined
-- ─────────────────────────────────────────────────────────────────────
-- joined_at feeds the streak and head-start maths, so a hand-written
-- value could make a player "survive" a streak challenge without a single
-- step. Role is limited to what the app uses, and a role can only change
-- from hunted to zombie, which is the one thing "I got caught" does.
-- Server functions run as the table owner, so they are not affected; only
-- direct calls from signed-in clients are checked.

create or replace function public.challenge_participants_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.joined_at := now();
    new.tags_made := 0;
    new.highlighted := false;
    new.last_tagged_by := null;
    if new.role is not null and new.role not in ('hunter', 'hunted') then
      raise exception 'That role is not allowed.';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role
       and not (old.role = 'hunted' and new.role = 'zombie') then
      raise exception 'That role change is not allowed.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists challenge_participants_guard on public.challenge_participants;
create trigger challenge_participants_guard
  before insert or update on public.challenge_participants
  for each row execute procedure public.challenge_participants_guard();

-- ─────────────────────────────────────────────────────────────────────
-- 6. Step and distance numbers have to be human
-- ─────────────────────────────────────────────────────────────────────
-- Anyone could write 2,000,000,000 steps for a day. The limits are
-- generous (150,000 steps or 150 miles in one day) and only apply to new
-- and changed rows, so existing data cannot block this migration.

alter table public.progress_snapshots
  drop constraint if exists progress_snapshots_sane_values,
  add constraint progress_snapshots_sane_values
    check (steps between 0 and 150000 and distance_mi between 0 and 150) not valid;

alter table public.daily_step_totals
  drop constraint if exists daily_step_totals_sane_values,
  add constraint daily_step_totals_sane_values
    check (steps between 0 and 150000) not valid;

-- A progress row also has to belong to a challenge you are in, and to a
-- day that is inside that challenge (one day of slack either side,
-- because the app sends your local date and the server thinks in UTC).
create or replace function public.progress_snapshots_guard()
returns trigger
language plpgsql
as $$
declare
  c public.challenges%rowtype;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select * into c from public.challenges where id = new.challenge_id;
  if not found
     or not exists (select 1 from public.challenge_participants cp
                    where cp.challenge_id = new.challenge_id and cp.user_id = new.user_id) then
    raise exception 'You are not in that challenge.';
  end if;

  if new.day < (c.starts_at::date - 1 - coalesce(c.head_start_days, 0))
     or new.day > least(c.ends_at::date + 1, current_date + 1) then
    raise exception 'That day is outside the challenge.';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_snapshots_guard on public.progress_snapshots;
create trigger progress_snapshots_guard
  before insert or update on public.progress_snapshots
  for each row execute procedure public.progress_snapshots_guard();

create or replace function public.daily_step_totals_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.day not between current_date - 1 and current_date + 1 then
    raise exception 'That day is not allowed.';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_step_totals_guard on public.daily_step_totals;
create trigger daily_step_totals_guard
  before insert or update on public.daily_step_totals
  for each row execute procedure public.daily_step_totals_guard();

-- 75 Hard check-ins: same two rules, so days cannot be invented.
create or replace function public.seventyfive_checkins_guard()
returns trigger
language plpgsql
as $$
declare
  c public.challenges%rowtype;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select * into c from public.challenges where id = new.challenge_id;
  if not found
     or not exists (select 1 from public.challenge_participants cp
                    where cp.challenge_id = new.challenge_id and cp.user_id = new.user_id) then
    raise exception 'You are not in that challenge.';
  end if;

  if new.day < (c.starts_at::date - 1)
     or new.day > least(c.ends_at::date + 1, current_date + 1) then
    raise exception 'That day is outside the challenge.';
  end if;
  return new;
end;
$$;

drop trigger if exists seventyfive_checkins_guard on public.seventyfive_checkins;
create trigger seventyfive_checkins_guard
  before insert or update on public.seventyfive_checkins
  for each row execute procedure public.seventyfive_checkins_guard();

-- ─────────────────────────────────────────────────────────────────────
-- 7. A daily limit on rewards from finished challenges
-- ─────────────────────────────────────────────────────────────────────
-- Even with honest dates, someone can create many one-day challenges
-- with a friend or a bot and collect the finishing reward from each.
-- This caps paid results per person per rolling 24 hours. Past the cap
-- the result is still recorded, but pays no score, XP or Bones.
-- The number is a product decision: change `cap` below if 5 is too tight
-- or too loose. A normal player finishes one or two a day.

create or replace function public.activity_events_daily_cap()
returns trigger
language plpgsql
as $$
declare
  cap constant int := 5;
  recent int;
begin
  if new.challenge_id is null
     or (new.xp_points <= 0 and new.bones_points <= 0 and new.score_points <= 0) then
    return new;
  end if;

  select count(*) into recent
    from public.activity_events ae
    where ae.user_id = new.user_id
      and ae.challenge_id is not null
      and ae.created_at > now() - interval '24 hours'
      and (ae.xp_points > 0 or ae.bones_points > 0 or ae.score_points > 0);

  if recent >= cap then
    new.score_points := 0;
    new.xp_points := 0;
    new.bones_points := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists activity_events_daily_cap on public.activity_events;
create trigger activity_events_daily_cap
  before insert on public.activity_events
  for each row execute procedure public.activity_events_daily_cap();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Indexes for the queries the app runs on every screen
-- ─────────────────────────────────────────────────────────────────────
create index if not exists challenge_participants_user_idx on public.challenge_participants (user_id);
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_recipient_idx on public.friendships (recipient_id);
create index if not exists activity_events_user_created_idx on public.activity_events (user_id, created_at desc);
create index if not exists daily_step_totals_day_steps_idx on public.daily_step_totals (day, steps desc);
create index if not exists challenge_invites_invitee_idx on public.challenge_invites (invitee_id);
create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 9. Invite emails: remember which ones were sent
-- ─────────────────────────────────────────────────────────────────────
-- Used by the patched send-invite-email function so each invite is emailed
-- once, and so a person can only send a limited number a day. No policy
-- lets signed-in users write to it; only the function (service role) does.
alter table public.pending_invites add column if not exists email_sent_at timestamptz;

-- The trigger functions above are only ever run by their triggers. Nobody
-- needs to be able to call them directly.
revoke execute on function public.challenge_participants_guard() from public, anon, authenticated;
revoke execute on function public.progress_snapshots_guard() from public, anon, authenticated;
revoke execute on function public.daily_step_totals_guard() from public, anon, authenticated;
revoke execute on function public.seventyfive_checkins_guard() from public, anon, authenticated;
revoke execute on function public.activity_events_daily_cap() from public, anon, authenticated;
