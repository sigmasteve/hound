-- Hound: Movement snacks and Move together (Move points' second batch,
-- from the mock-ups Steve signed off).
--
-- Movement snacks: for people who just move around. Off by default; you
-- turn them on in Move and pick when (morning, midday, afternoon,
-- evening). The phone nudges you once in each window with its own local
-- notification ("250 steps in the next 10 minutes?"), and the snack
-- screen counts the phone's own steps. The server only times it and pays:
--   move_snack_settings   on/off and the windows
--   move_snack_start      a snack, now (from a nudge or "Take one now")
--   move_snack_finish     done in time: Bones, up to the day's paid snacks
--   my_move_snacks        your settings, today's snacks, the open one
--
-- Move together: a guided routine with friends at the same time, like a
-- pack fast. Start it from Start a routine → With friends; friends get a
-- push and a Needs you invite for an hour. Each member's routine is their
-- own timed session (move_session_start), linked to the pack, so progress
-- shows from when they started. When at least two have finished and no
-- one who joined is still going, everyone who finished gets the bonus.
--   move_pack_start / _join / _decline / _began / _done
--   move_pack             the lobby and live progress (and settles it)
--   move_pack_waiting     invites for Needs you
--
-- The numbers are Admin's (Admin → Bones → Move points), starting at
-- Steve's: a snack is 250 steps in 10 minutes for 3 Bones, 3 paid a day;
-- Move together pays 10 Bones each. Admin → Fitness → Move points has the
-- engagement numbers (admin_move_social_overview).
--
-- Run this once, after 0274, in the SQL Editor.

alter table public.move_config
  add column if not exists snack_steps int not null default 250 check (snack_steps between 50 and 5000),
  add column if not exists snack_minutes int not null default 10 check (snack_minutes between 3 and 60),
  add column if not exists snack_bones int not null default 3 check (snack_bones between 0 and 100),
  add column if not exists snack_max_day int not null default 3 check (snack_max_day between 0 and 10),
  add column if not exists together_bones int not null default 10 check (together_bones between 0 and 200);

-- ── Movement snacks ─────────────────────────────────────────────────

create table if not exists public.move_snack_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  windows text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.move_snack_prefs enable row level security;

create table if not exists public.move_snacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  local_day date not null,
  source text not null default 'self' check (source in ('nudge', 'self')),
  steps_target int not null,
  minutes int not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  steps_done int,
  done_at timestamptz,
  bones int not null default 0
);
create index if not exists move_snacks_user_day on public.move_snacks (user_id, local_day);
alter table public.move_snacks enable row level security;
revoke all on public.move_snack_prefs, public.move_snacks from anon, authenticated;

create or replace function public.move_snack_today(u uuid, p_day date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'done', (select count(*) from public.move_snacks s where s.user_id = u and s.local_day = p_day and s.done_at is not null),
    'paid', (select count(*) from public.move_snacks s where s.user_id = u and s.local_day = p_day and s.bones > 0),
    'bones', (select coalesce(sum(s.bones), 0) from public.move_snacks s where s.user_id = u and s.local_day = p_day),
    'open', (
      select jsonb_build_object('id', s.id, 'started_at', s.started_at, 'expires_at', s.expires_at, 'steps', s.steps_target, 'minutes', s.minutes)
      from public.move_snacks s
      where s.user_id = u and s.done_at is null and s.expires_at > now()
      order by s.started_at desc limit 1
    )
  );
$$;
revoke execute on function public.move_snack_today(uuid, date) from public, anon, authenticated;

create or replace function public.my_move_snacks(p_local_date date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.move_config;
  p public.move_snack_prefs;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.move_config where id;
  select * into p from public.move_snack_prefs where user_id = me;
  return jsonb_build_object(
    'enabled', coalesce(p.enabled, false),
    'windows', to_jsonb(coalesce(p.windows, '{}')),
    'steps', c.snack_steps, 'minutes', c.snack_minutes, 'bones', c.snack_bones, 'max_day', c.snack_max_day,
    'today', public.move_snack_today(me, p_local_date)
  );
end;
$$;
revoke execute on function public.my_move_snacks(date) from public, anon;
grant execute on function public.my_move_snacks(date) to authenticated;

create or replace function public.move_snack_settings(p_enabled boolean, p_windows text[])
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  w text[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into w
    from unnest(coalesce(p_windows, '{}')) x where x in ('morning', 'midday', 'afternoon', 'evening');
  insert into public.move_snack_prefs (user_id, enabled, windows, updated_at) values (me, coalesce(p_enabled, false), w, now())
    on conflict (user_id) do update set enabled = excluded.enabled, windows = excluded.windows, updated_at = now();
end;
$$;
revoke execute on function public.move_snack_settings(boolean, text[]) from public, anon;
grant execute on function public.move_snack_settings(boolean, text[]) to authenticated;

-- A snack, now. One at a time: an open one comes back as it is.
create or replace function public.move_snack_start(p_local_date date, p_source text default 'self')
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.move_config;
  s public.move_snacks;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or abs(p_local_date - (now() at time zone 'UTC')::date) > 1 then
    raise exception 'That date is off.';
  end if;
  select * into s from public.move_snacks
    where user_id = me and done_at is null and expires_at > now() order by started_at desc limit 1;
  if s.id is null then
    select * into c from public.move_config where id;
    insert into public.move_snacks (user_id, local_day, source, steps_target, minutes, expires_at)
      values (me, p_local_date, case when p_source = 'nudge' then 'nudge' else 'self' end,
              c.snack_steps, c.snack_minutes, now() + make_interval(mins => c.snack_minutes))
      returning * into s;
  end if;
  return jsonb_build_object('id', s.id, 'started_at', s.started_at, 'expires_at', s.expires_at,
    'steps', s.steps_target, 'minutes', s.minutes, 'today', public.move_snack_today(me, s.local_day));
end;
$$;
revoke execute on function public.move_snack_start(date, text) from public, anon;
grant execute on function public.move_snack_start(date, text) to authenticated;

-- Done: the phone's steps since the start. In time (a minute's grace for
-- the network), and no more than a person can walk in the time. Bones
-- while the day's paid snacks are under the limit.
create or replace function public.move_snack_finish(p_id uuid, p_steps int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.move_config;
  s public.move_snacks;
  paid int;
  pay int := 0;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into s from public.move_snacks where id = p_id and user_id = me for update;
  if s.id is null then
    raise exception 'That snack isn''t yours.';
  end if;
  if s.done_at is not null then
    return jsonb_build_object('bones', s.bones, 'today', public.move_snack_today(me, s.local_day), 'repeat', true);
  end if;
  if now() > s.expires_at + interval '1 minute' then
    raise exception 'Time ran out on that one. Try another!';
  end if;
  if coalesce(p_steps, 0) < s.steps_target then
    raise exception 'Not there yet: % of % steps.', coalesce(p_steps, 0), s.steps_target;
  end if;
  -- About 220 steps a minute is a fast run.
  if p_steps > greatest(1, ceil(extract(epoch from (now() - s.started_at)) / 60.0)) * 220 + 100 then
    raise exception 'That''s more steps than fit in the time.';
  end if;
  select * into c from public.move_config where id;
  select count(*) into paid from public.move_snacks x where x.user_id = me and x.local_day = s.local_day and x.bones > 0;
  if paid < c.snack_max_day then
    pay := c.snack_bones;
  end if;
  update public.move_snacks set steps_done = p_steps, done_at = now(), bones = pay where id = s.id;
  if pay > 0 then
    update public.profiles set bones_balance = bones_balance + pay where id = me;
  end if;
  return jsonb_build_object('bones', pay, 'today', public.move_snack_today(me, s.local_day));
end;
$$;
revoke execute on function public.move_snack_finish(uuid, int) from public, anon;
grant execute on function public.move_snack_finish(uuid, int) to authenticated;

-- ── Move together ───────────────────────────────────────────────────

create table if not exists public.move_packs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  routine_ref text not null,
  routine_name text not null,
  minutes int not null check (minutes between 3 and 60),
  created_at timestamptz not null default now(),
  join_until timestamptz not null
);
alter table public.move_packs enable row level security;

create table if not exists public.move_pack_members (
  pack_id uuid not null references public.move_packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'joined', 'declined')),
  joined_at timestamptz,
  session_id uuid references public.move_sessions (id) on delete set null,
  bones int not null default 0,
  primary key (pack_id, user_id)
);
create index if not exists move_pack_members_user on public.move_pack_members (user_id);
alter table public.move_pack_members enable row level security;
revoke all on public.move_packs, public.move_pack_members from anon, authenticated;

create or replace function public.move_notify(p_from uuid, p_to uuid[], p_message text, p_pack uuid)
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
    'kind', 'move', 'from_user', p_from, 'to_users', to_jsonb(reach), 'message', p_message, 'pack_id', p_pack));
exception when others then
  null;
end;
$$;
revoke execute on function public.move_notify(uuid, uuid[], text, uuid) from public, anon, authenticated;

-- Each member's state: done (their linked session finished), going
-- (started within the routine's time and half an hour), waiting (joined,
-- not started, within the hour), or out.
create or replace function public.move_pack_state(p public.move_packs, m public.move_pack_members)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
    when m.status <> 'joined' then m.status
    when s.finished_at is not null and not s.cancelled then 'done'
    when s.id is not null and not s.cancelled and s.started_at > now() - make_interval(mins => p.minutes + 30) then 'going'
    when s.id is null and m.joined_at > now() - interval '1 hour' then 'waiting'
    else 'out'
  end
  from (select 1) x left join public.move_sessions s on s.id = m.session_id;
$$;
revoke execute on function public.move_pack_state(public.move_packs, public.move_pack_members) from public, anon, authenticated;

-- The bonus: when two or more are done and no one who joined is still
-- waiting or going, everyone who finished is paid, once (members.bones);
-- a late joiner who finishes is paid when they do.
create or replace function public.move_pack_settle(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  p public.move_packs;
  c public.move_config;
  done_ids uuid[];
  pending int;
  newly uuid[];
begin
  select * into p from public.move_packs where id = p_pack for update;
  if p.id is null then
    return;
  end if;
  select array_agg(m.user_id) filter (where public.move_pack_state(p, m) = 'done'),
         count(*) filter (where public.move_pack_state(p, m) in ('waiting', 'going'))
    into done_ids, pending
    from public.move_pack_members m where m.pack_id = p.id;
  if coalesce(cardinality(done_ids), 0) < 2 or pending > 0 then
    return;
  end if;
  select * into c from public.move_config where id;
  if c.together_bones <= 0 then
    return;
  end if;
  with paid as (
    update public.move_pack_members m set bones = c.together_bones
    where m.pack_id = p.id and m.user_id = any (done_ids) and m.bones = 0
    returning m.user_id
  )
  select array_agg(user_id) into newly from paid;
  if newly is not null then
    update public.profiles pr set bones_balance = bones_balance + c.together_bones where pr.id = any (newly);
    perform public.move_notify(null, newly,
      format('You all finished the %s together. +%s Bones each 🐾', p.routine_name, c.together_bones), p.id);
  end if;
end;
$$;
revoke execute on function public.move_pack_settle(uuid) from public, anon, authenticated;

-- Start a routine with friends (up to 10): you're in; they're invited for
-- an hour. minutes is the routine's length, for working out who's still
-- going.
create or replace function public.move_pack_start(p_routine text, p_name text, p_minutes int, p_invite uuid[])
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  invitees uuid[];
  id uuid;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_routine is null or length(trim(p_routine)) not between 1 and 40 or p_name is null or length(trim(p_name)) not between 1 and 60 then
    raise exception 'Pick a routine.';
  end if;
  if p_minutes is null or p_minutes not between 3 and 60 then
    raise exception 'That routine''s length is off.';
  end if;
  select coalesce(array_agg(distinct u), '{}') into invitees
    from unnest(coalesce(p_invite, '{}')) u where u <> me and public.fasting_are_friends(me, u);
  if cardinality(invitees) = 0 then
    raise exception 'Pick a friend to move with.';
  end if;
  if cardinality(invitees) > 10 then
    raise exception 'Invite up to 10 friends.';
  end if;
  insert into public.move_packs (created_by, routine_ref, routine_name, minutes, join_until)
    values (me, trim(p_routine), trim(p_name), p_minutes, now() + interval '1 hour') returning move_packs.id into id;
  insert into public.move_pack_members (pack_id, user_id, status, joined_at) values (id, me, 'joined', now());
  insert into public.move_pack_members (pack_id, user_id) select id, u from unnest(invitees) u;
  perform public.move_notify(me, invitees, format('{name} is doing the %s. Do it together? 🐾', trim(p_name)), id);
  return id;
end;
$$;
revoke execute on function public.move_pack_start(text, text, int, uuid[]) from public, anon;
grant execute on function public.move_pack_start(text, text, int, uuid[]) to authenticated;

create or replace function public.move_pack_join(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.move_packs;
begin
  select * into p from public.move_packs where id = p_pack;
  if p.id is null or not exists (select 1 from public.move_pack_members m where m.pack_id = p.id and m.user_id = me) then
    raise exception 'That invite isn''t yours.';
  end if;
  if now() > p.join_until then
    raise exception 'That one''s closed. Start your own and invite them back!';
  end if;
  update public.move_pack_members set status = 'joined', joined_at = coalesce(joined_at, now())
    where pack_id = p.id and user_id = me and status <> 'joined';
  perform public.move_notify(me, array(select m.user_id from public.move_pack_members m where m.pack_id = p.id and m.status = 'joined'),
    format('{name} is in for the %s.', p.routine_name), p.id);
end;
$$;
revoke execute on function public.move_pack_join(uuid) from public, anon;
grant execute on function public.move_pack_join(uuid) to authenticated;

create or replace function public.move_pack_decline(p_pack uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.move_pack_members set status = 'declined'
  where pack_id = p_pack and user_id = auth.uid() and status = 'invited';
$$;
revoke execute on function public.move_pack_decline(uuid) from public, anon;
grant execute on function public.move_pack_decline(uuid) to authenticated;

-- Your routine for this pack has started: its timed session (from
-- move_session_start) is linked, so the others see your progress.
create or replace function public.move_pack_began(p_pack uuid, p_session uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.move_sessions s where s.id = p_session and s.user_id = me and s.kind = 'routine') then
    raise exception 'That session isn''t yours.';
  end if;
  update public.move_pack_members set session_id = p_session, status = 'joined', joined_at = coalesce(joined_at, now())
    where pack_id = p_pack and user_id = me and status <> 'declined';
  if not found then
    raise exception 'You''re not in that one.';
  end if;
end;
$$;
revoke execute on function public.move_pack_began(uuid, uuid) from public, anon;
grant execute on function public.move_pack_began(uuid, uuid) to authenticated;

-- The lobby and the live strip: the routine, everyone's state and start,
-- your bonus. Reading it settles the pack, so the bonus arrives even if
-- the last finisher's phone went quiet.
create or replace function public.move_pack(p_pack uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.move_packs;
  c public.move_config;
begin
  if not exists (select 1 from public.move_pack_members m where m.pack_id = p_pack and m.user_id = me) then
    raise exception 'That isn''t one of yours.';
  end if;
  perform public.move_pack_settle(p_pack);
  select * into p from public.move_packs where id = p_pack;
  select * into c from public.move_config where id;
  return jsonb_build_object(
    'id', p.id, 'routine_ref', p.routine_ref, 'routine_name', p.routine_name, 'minutes', p.minutes,
    'created_by', p.created_by, 'created_at', p.created_at, 'join_until', p.join_until,
    'bonus', c.together_bones,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person', public.fasting_person(m.user_id),
        'me', m.user_id = me,
        'state', public.move_pack_state(p, m),
        'started_at', s.started_at, 'finished_at', s.finished_at,
        'bones', m.bones) order by m.joined_at nulls last, m.user_id)
      from public.move_pack_members m left join public.move_sessions s on s.id = m.session_id
      where m.pack_id = p.id and m.status <> 'declined'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.move_pack(uuid) from public, anon;
grant execute on function public.move_pack(uuid) to authenticated;

-- Your routine's finished (move_session_finish has run): settle, and say
-- what you got.
create or replace function public.move_pack_done(p_pack uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  perform public.move_pack_settle(p_pack);
  return (select jsonb_build_object('bones', m.bones) from public.move_pack_members m where m.pack_id = p_pack and m.user_id = me);
end;
$$;
revoke execute on function public.move_pack_done(uuid) from public, anon;
grant execute on function public.move_pack_done(uuid) to authenticated;

-- Invites still open, for Needs you.
create or replace function public.move_pack_waiting()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'pack_id', p.id, 'routine_name', p.routine_name, 'routine_ref', p.routine_ref,
    'from', public.fasting_person(p.created_by), 'join_until', p.join_until,
    'joined', (select count(*) from public.move_pack_members x where x.pack_id = p.id and x.status = 'joined'))
    order by p.created_at desc), '[]'::jsonb)
  from public.move_pack_members m join public.move_packs p on p.id = m.pack_id
  where m.user_id = auth.uid() and m.status = 'invited' and p.join_until > now();
$$;
revoke execute on function public.move_pack_waiting() from public, anon;
grant execute on function public.move_pack_waiting() to authenticated;

-- ── Admin ───────────────────────────────────────────────────────────

-- The numbers (Admin → Bones → Move points).
create or replace function public.admin_set_move_social_config(p jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'not authorized';
  end if;
  update public.move_config set
    snack_steps = coalesce((p ->> 'snack_steps')::int, snack_steps),
    snack_minutes = coalesce((p ->> 'snack_minutes')::int, snack_minutes),
    snack_bones = coalesce((p ->> 'snack_bones')::int, snack_bones),
    snack_max_day = coalesce((p ->> 'snack_max_day')::int, snack_max_day),
    together_bones = coalesce((p ->> 'together_bones')::int, together_bones),
    updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_move_social_config(jsonb) from public, anon;
grant execute on function public.admin_set_move_social_config(jsonb) to authenticated;

-- Admin → Fitness → Move points: who has snacks on and when, snacks taken
-- and finished, Move together packs, who joined and who finished.
create or replace function public.admin_move_social_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.move_config;
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.move_config where id;
  return jsonb_build_object(
    'config', jsonb_build_object('snack_steps', c.snack_steps, 'snack_minutes', c.snack_minutes, 'snack_bones', c.snack_bones,
                                 'snack_max_day', c.snack_max_day, 'together_bones', c.together_bones),
    'snacks_on', (select count(*) from public.move_snack_prefs p where p.enabled),
    'snack_windows', coalesce((
      select jsonb_object_agg(w, n) from (
        select w, count(*) as n from public.move_snack_prefs p, unnest(p.windows) w where p.enabled group by w
      ) x
    ), '{}'::jsonb),
    'snacks_tried', (select count(distinct s.user_id) from public.move_snacks s),
    'snacks_7d', (select count(*) from public.move_snacks s where s.started_at > now() - interval '7 days'),
    'snacks_done_7d', (select count(*) from public.move_snacks s where s.done_at > now() - interval '7 days'),
    'snacks_nudge_7d', (select count(*) from public.move_snacks s where s.started_at > now() - interval '7 days' and s.source = 'nudge'),
    'snack_people_7d', (select count(distinct s.user_id) from public.move_snacks s where s.done_at > now() - interval '7 days'),
    'snack_bones_7d', (select coalesce(sum(s.bones), 0) from public.move_snacks s where s.done_at > now() - interval '7 days'),
    'packs_7d', (select count(*) from public.move_packs p where p.created_at > now() - interval '7 days'),
    'packs_paid_7d', (select count(distinct m.pack_id) from public.move_pack_members m join public.move_packs p on p.id = m.pack_id
                      where p.created_at > now() - interval '7 days' and m.bones > 0),
    'pack_people_7d', (select count(distinct m.user_id) from public.move_pack_members m join public.move_packs p on p.id = m.pack_id
                       where p.created_at > now() - interval '7 days' and m.status = 'joined'),
    'pack_tried', (select count(distinct m.user_id) from public.move_pack_members m where m.status = 'joined'),
    'pack_bones_7d', (select coalesce(sum(m.bones), 0) from public.move_pack_members m join public.move_packs p on p.id = m.pack_id
                      where p.created_at > now() - interval '7 days'),
    'pack_routines_7d', coalesce((
      select jsonb_object_agg(r, n) from (
        select p.routine_name as r, count(*) as n from public.move_packs p where p.created_at > now() - interval '7 days' group by p.routine_name
      ) x
    ), '{}'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_move_social_overview() from public, anon;
grant execute on function public.admin_move_social_overview() to authenticated;

-- To undo:
--   drop function public.my_move_snacks(date), public.move_snack_settings(boolean, text[]), public.move_snack_start(date, text),
--     public.move_snack_finish(uuid, int), public.move_snack_today(uuid, date), public.move_pack_start(text, text, int, uuid[]),
--     public.move_pack_join(uuid), public.move_pack_decline(uuid), public.move_pack_began(uuid, uuid), public.move_pack(uuid),
--     public.move_pack_done(uuid), public.move_pack_waiting(), public.move_pack_settle(uuid),
--     public.move_pack_state(public.move_packs, public.move_pack_members), public.move_notify(uuid, uuid[], text, uuid),
--     public.admin_set_move_social_config(jsonb), public.admin_move_social_overview();
--   drop table public.move_pack_members, public.move_packs, public.move_snacks, public.move_snack_prefs;
--   alter table public.move_config drop column snack_steps, drop column snack_minutes, drop column snack_bones,
--     drop column snack_max_day, drop column together_bones;
