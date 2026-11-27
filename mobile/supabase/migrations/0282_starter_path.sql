-- Hound: the starter path, "Your first week" (Steve, Nov 2026; mock-up
-- claude.ai/artifact/KdjJsJ8YK3tvsFXHyn8MMf).
--
-- For new accounts, Finish setting up becomes one step for each part of
-- Hound they ticked in the welcome wizard, then one Global challenge, with
-- Bones for each and a Starter Bandana for the hound at the end:
--   goal    hit your step goal for a day (always)
--   fast    start your first fast (ticked Intermittent fasting; not under 16)
--   move    log an activity, time a routine or a watch workout (ticked
--           Workouts, Activities or Strength, or answered nothing)
--   global  join a Global challenge yourself (one Hound joined you to on
--           the first open doesn't count) (always)
-- Seven days from the first open. Each step pays when it's done (the next
-- time Today asks), "Not for me" skips one, and when every step left is
-- done the finish is claimed from the card. After seven days unfinished
-- steps drop off and the card goes.
--
--   starter_config   amounts and days (Admin → Bones → Starter path), and
--                    from when accounts get it (accounts made before keep
--                    Finish setting up)
--   starter_paths    one row per person
--   my_starter_path(p_local_date)  makes it on the first call, ticks and
--                    pays what's done, and says which steps just finished
--   starter_skip(step), starter_claim()
--   admin_starter_overview(), admin_set_starter_config(p)
--
-- Run this once, after 0281, in the SQL Editor.

create table if not exists public.starter_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  step_bones int not null default 10 check (step_bones between 0 and 500),
  global_bones int not null default 15 check (global_bones between 0 and 500),
  finish_bones int not null default 15 check (finish_bones between 0 and 500),
  days int not null default 7 check (days between 1 and 30),
  -- Accounts made from here on get the path.
  start_after timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.starter_config (id) values (true) on conflict do nothing;
alter table public.starter_config enable row level security;
revoke all on public.starter_config from anon, authenticated;

create table if not exists public.starter_paths (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  steps text[] not null,
  -- step → when it was done
  done jsonb not null default '{}'::jsonb,
  skipped text[] not null default '{}',
  bones_paid int not null default 0,
  finished_at timestamptz,
  claimed_at timestamptz
);
alter table public.starter_paths enable row level security;
revoke all on public.starter_paths from anon, authenticated;

insert into public.kennel_items (id, slot, name, cost_bones, available_until)
  values ('bandana_starter', 'neck', 'Starter Bandana', 0, '2000-01-01')
  on conflict (id) do nothing;

-- The starter path's Bones count as earned by play (0217), like setup's.
create or replace function public.bones_earned_from_play()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind in ('goal_day', 'goal_week', 'daily_bonus', 'bone_dig', 'achievement', 'onboarding_reward', 'starter_step', 'starter_done')
     and coalesce(new.bones_points, 0) > 0 then
    update public.profiles p
      set bones_earned_total = coalesce(p.bones_earned_total, 0) + new.bones_points
      where p.id = new.user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.bones_earned_from_play() from public, anon, authenticated;

-- Whether a step is done (since the path started, for its window).
create or replace function public.starter_step_done(p_user uuid, p_step text, p_since timestamptz)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case p_step
    when 'goal' then
      exists (select 1 from public.activity_events e where e.user_id = p_user and e.kind = 'goal_day' and e.created_at >= p_since)
      or exists (
        select 1 from public.daily_step_totals d
        where d.user_id = p_user and d.day >= (p_since - interval '1 day')::date
          and d.steps >= coalesce((select min(g.target) from public.goals g where g.user_id = p_user and g.metric = 'steps' and g.period = 'day'), 10000))
    when 'fast' then
      exists (select 1 from public.fasts f where f.user_id = p_user)
    when 'move' then
      exists (select 1 from public.workout_history w where w.user_id = p_user and w.occurred_at >= p_since - interval '1 day')
    when 'global' then
      exists (
        select 1 from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id
        where cp.user_id = p_user and c.is_global
          and not exists (select 1 from public.global_auto_joins a where a.user_id = p_user and a.challenge_id = c.id))
    else false
  end;
$$;
revoke execute on function public.starter_step_done(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.starter_json(p public.starter_paths, p_new text[])
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'show', p.claimed_at is null and (p.finished_at is not null or now() < p.ends_at),
    'started_at', p.started_at,
    'ends_at', p.ends_at,
    'finished_at', p.finished_at,
    'claimed_at', p.claimed_at,
    'finish_bones', c.finish_bones,
    'bones_paid', p.bones_paid,
    'just_done', to_jsonb(coalesce(p_new, '{}')),
    'steps', (
      select jsonb_agg(jsonb_build_object(
        'id', s,
        'done_at', p.done -> s,
        'skipped', s = any (p.skipped),
        'bones', case when s = 'global' then c.global_bones else c.step_bones end) order by i)
      from unnest(p.steps) with ordinality u(s, i)))
  from public.starter_config c where c.id;
$$;
revoke execute on function public.starter_json(public.starter_paths, text[]) from public, anon, authenticated;

create or replace function public.my_starter_path(p_local_date date default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cfg public.starter_config;
  prof public.profiles;
  p public.starter_paths;
  uses text[];
  steps text[];
  s text;
  b int;
  fresh text[] := '{}';
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into cfg from public.starter_config where id;
  select * into p from public.starter_paths where user_id = me for update;
  if p.user_id is null then
    select * into prof from public.profiles where id = me;
    if not cfg.enabled or prof.created_at < cfg.start_after or prof.onboarding_reward_claimed_at is not null then
      return jsonb_build_object('show', false);
    end if;
    uses := coalesce(prof.hound_uses, '{}');
    steps := array['goal'];
    if 'fasting' = any (uses)
       and coalesce((select fp.age from public.fasting_profiles fp where fp.user_id = me), 'ok') <> 'under' then
      steps := array_append(steps, 'fast');
    end if;
    if uses && array['workouts', 'activities', 'strength']
       or not (uses && array['steps', 'fasting', 'water', 'friends', 'workouts', 'activities', 'strength']) then
      steps := array_append(steps, 'move');
    end if;
    steps := array_append(steps, 'global');
    insert into public.starter_paths (user_id, ends_at, steps)
      values (me, now() + make_interval(days => cfg.days), steps)
      returning * into p;
  end if;

  -- Tick and pay what's been done, inside the window.
  if p.claimed_at is null and p.finished_at is null and now() < p.ends_at then
    foreach s in array p.steps loop
      if not (p.done ? s) and not (s = any (p.skipped)) and public.starter_step_done(me, s, p.started_at) then
        b := case when s = 'global' then cfg.global_bones else cfg.step_bones end;
        p.done := p.done || jsonb_build_object(s, now());
        p.bones_paid := p.bones_paid + b;
        fresh := fresh || s;
        if b > 0 then
          update public.profiles set bones_balance = bones_balance + b where id = me;
          insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
            values (me, 'starter_step', 0, 0, b);
        end if;
      end if;
    end loop;
    if not exists (select 1 from unnest(p.steps) x where not (p.done ? x) and not (x = any (p.skipped))) then
      p.finished_at := now();
    end if;
    update public.starter_paths
      set done = p.done, bones_paid = p.bones_paid, finished_at = p.finished_at
      where user_id = me;
  end if;
  return public.starter_json(p, fresh);
end;
$$;
revoke execute on function public.my_starter_path(date) from public, anon;
grant execute on function public.my_starter_path(date) to authenticated;

-- "Not for me": a step left out (no Bones for it).
create or replace function public.starter_skip(p_step text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.starter_paths;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into p from public.starter_paths where user_id = me for update;
  if p.user_id is null or not (p_step = any (p.steps)) then
    raise exception 'That isn''t one of your steps.';
  end if;
  if p.claimed_at is not null or now() >= p.ends_at then
    raise exception 'Your first week is over.';
  end if;
  if p.done ? p_step then
    raise exception 'That one''s done already.';
  end if;
  if not (p_step = any (p.skipped)) then
    p.skipped := p.skipped || p_step;
  end if;
  if not exists (select 1 from unnest(p.steps) x where not (p.done ? x) and not (x = any (p.skipped))) then
    p.finished_at := coalesce(p.finished_at, now());
  end if;
  update public.starter_paths set skipped = p.skipped, finished_at = p.finished_at where user_id = me;
  return public.starter_json(p, '{}');
end;
$$;
revoke execute on function public.starter_skip(text) from public, anon;
grant execute on function public.starter_skip(text) to authenticated;

-- The finish: its Bones and the Starter Bandana, once every step left is
-- done (skipping them all earns no finish).
create or replace function public.starter_claim()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  p public.starter_paths;
  b int := (select c.finish_bones from public.starter_config c where c.id);
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into p from public.starter_paths where user_id = me for update;
  if p.user_id is null or p.finished_at is null then
    raise exception 'Finish your first week''s steps first.';
  end if;
  if p.claimed_at is not null then
    raise exception 'You already claimed this.';
  end if;
  if jsonb_typeof(p.done) <> 'object' or (select count(*) from jsonb_object_keys(p.done)) = 0 then
    raise exception 'Do at least one step first.';
  end if;
  p.claimed_at := now();
  update public.starter_paths set claimed_at = p.claimed_at where user_id = me;
  -- Finish setting up (0074) is done with too.
  update public.profiles
    set bones_balance = bones_balance + b,
        onboarding_reward_claimed_at = coalesce(onboarding_reward_claimed_at, now())
    where id = me;
  if b > 0 then
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      values (me, 'starter_done', 0, 0, b);
  end if;
  insert into public.kennel_purchases (user_id, item_id, bones) values (me, 'bandana_starter', 0)
    on conflict do nothing;
  return public.starter_json(p, '{}') || jsonb_build_object('bones', b);
end;
$$;
revoke execute on function public.starter_claim() from public, anon;
grant execute on function public.starter_claim() to authenticated;

create or replace function public.admin_starter_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'id' - 'updated_at' from public.starter_config c where c.id),
    'started', (select count(*) from public.starter_paths),
    'started_7d', (select count(*) from public.starter_paths where started_at >= now() - interval '7 days'),
    'finished', (select count(*) from public.starter_paths where finished_at is not null),
    'claimed', (select count(*) from public.starter_paths where claimed_at is not null),
    'bones_paid', (select coalesce(sum(bones_paid), 0) from public.starter_paths)
                  + (select coalesce(sum(e.bones_points), 0) from public.activity_events e where e.kind = 'starter_done'),
    'bandanas_worn', (select count(*) from public.kennels k where k.neck_id = 'bandana_starter'),
    'steps', coalesce((
      select jsonb_object_agg(s, jsonb_build_object('offered', offered, 'done', done, 'skipped', skipped, 'median_hours', med))
      from (
        select u.s, count(*) as offered,
          count(*) filter (where p.done ? u.s) as done,
          count(*) filter (where u.s = any (p.skipped)) as skipped,
          round((percentile_cont(0.5) within group (order by extract(epoch from ((p.done ->> u.s)::timestamptz - p.started_at)) / 3600)
                 filter (where p.done ? u.s))::numeric, 1) as med
        from public.starter_paths p, unnest(p.steps) u(s)
        group by u.s
      ) g
    ), '{}'::jsonb),
    -- Back after the week: synced steps on a day 7 to 13 days after starting,
    -- for paths started at least 14 days ago.
    'back_week2', (
      select jsonb_build_object(
        'finished', count(*) filter (where p.finished_at is not null),
        'finished_back', count(*) filter (where p.finished_at is not null and b.back),
        'not_finished', count(*) filter (where p.finished_at is null),
        'not_finished_back', count(*) filter (where p.finished_at is null and b.back))
      from public.starter_paths p
      cross join lateral (select exists (
        select 1 from public.daily_step_totals d
        where d.user_id = p.user_id and d.steps > 0
          and d.day between (p.started_at + interval '7 days')::date and (p.started_at + interval '13 days')::date) as back) b
      where p.started_at <= now() - interval '14 days')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.admin_starter_overview() from public, anon;
grant execute on function public.admin_starter_overview() to authenticated;

-- p: {"enabled": true, "step_bones": 10, "global_bones": 15, "finish_bones": 15, "days": 7}
create or replace function public.admin_set_starter_config(p jsonb)
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
  if p ? 'enabled' then
    if jsonb_typeof(p -> 'enabled') <> 'boolean' then
      raise exception 'On or off.';
    end if;
    update public.starter_config set enabled = (p ->> 'enabled')::boolean, updated_at = now() where id;
  end if;
  foreach k in array array['step_bones', 'global_bones', 'finish_bones', 'days'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'number' or (p ->> k)::numeric <> floor((p ->> k)::numeric)
         or (p ->> k)::numeric < (case when k = 'days' then 1 else 0 end)
         or (p ->> k)::numeric > (case when k = 'days' then 30 else 500 end) then
        raise exception 'Whole numbers: Bones 0 to 500, days 1 to 30.';
      end if;
    end if;
  end loop;
  update public.starter_config set
    step_bones = coalesce((p ->> 'step_bones')::int, step_bones),
    global_bones = coalesce((p ->> 'global_bones')::int, global_bones),
    finish_bones = coalesce((p ->> 'finish_bones')::int, finish_bones),
    days = coalesce((p ->> 'days')::int, days),
    updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_starter_config(jsonb) from public, anon;
grant execute on function public.admin_set_starter_config(jsonb) to authenticated;

-- To undo:
--   drop function public.admin_set_starter_config(jsonb);
--   drop function public.admin_starter_overview();
--   drop function public.starter_claim();
--   drop function public.starter_skip(text);
--   drop function public.my_starter_path(date);
--   drop function public.starter_json(public.starter_paths, text[]);
--   drop function public.starter_step_done(uuid, text, timestamptz);
--   drop table public.starter_paths;
--   drop table public.starter_config;
--   (bones_earned_from_play as in 0217; the bandana item stays.)
