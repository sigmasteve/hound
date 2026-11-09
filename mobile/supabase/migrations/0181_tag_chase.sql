-- Hound: Game of Tag, redone as a daily chase (Steve's "completely redo
-- the game of tag"). The old game needed everyone watching at once: IT
-- had an hour or two to out-walk someone, and steps only arrive when a
-- phone opens the app, so catches rarely counted.
--
-- The chase plays one round a day, settled once the day is over
-- everywhere (11:00 UTC, the same as Baseball):
--   - One hound is IT. On day 1 it's a random player.
--   - Everyone else starts the day with a head start (the creator picks
--     1,000, 2,000 or 3,000 steps).
--   - IT tags everyone it out-walks: IT's steps that day beat theirs plus
--     the head start. Everyone else got away.
--   - The tagged hound with the fewest steps is IT tomorrow. Nobody
--     tagged: IT stays IT.
--   - +3 for each tag, +1 for each day you get away. Most points when it
--     ends wins (fewer days as IT breaks a tie). A chase runs 3 to 14
--     days.
-- The app plays each day back on a running track (ChaseTrack).
--
--   challenges.tag_mode         'chase' for the new game; empty is the
--                               old game, which games already running
--                               keep until they end
--   challenges.tag_head_start   1000, 2000 or 3000
--   tag_chase_state             who's IT now
--   tag_chase_days              each settled day: IT, everyone's steps,
--                               who was tagged and who got away (by how
--                               many steps), and the next IT
--   tag_chase_advance()         settles the days that are over; daily
--                               cron (hound-tag-chase), and on view
--   tag_chase_view()            the game, for its screen
--   tag_chase_standings()       points
--   settle_challenge_score_core()  a chase ends when its last day is
--                               settled, placed by points
--   admin_tag_overview()        Admin → Overview → Tag
--
-- Pushes, the morning a day settles: "You're IT today" to the new IT,
-- and "Ana tagged you by 312 steps" to each hound tagged. They need
-- send-tag-notification redeployed; without it the game plays, quietly.
--
-- Run this once, after 0180, in the SQL Editor, before publishing the
-- app update that goes with it.
--
-- Undo, if needed: unschedule hound-tag-chase; re-run
-- settle_challenge_score_core from 0174 and handle_new_tag_challenge
-- from 0045; drop the tag_chase_* functions and tables and
-- admin_tag_overview. The columns can stay.

alter table public.challenges
  add column tag_mode text check (tag_mode in ('rounds', 'chase')),
  add column tag_head_start int check (tag_head_start in (1000, 2000, 3000)),
  add constraint challenges_tag_chase_length check (tag_mode is distinct from 'chase' or duration_days between 3 and 14);

-- The old game's round starts with the challenge; a chase has none.
create or replace function public.handle_new_tag_challenge()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind = 'tag' and new.tag_mode is distinct from 'chase' then
    insert into public.tag_rounds (challenge_id, it_user_id) values (new.id, new.created_by);
  end if;
  return new;
end;
$$;

create table public.tag_chase_state (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  it_user uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.tag_chase_days (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day_no int not null,
  day date not null,
  it_user uuid references public.profiles (id) on delete set null,
  head_start int not null,
  -- {user_id: steps}
  steps jsonb not null default '{}'::jsonb,
  -- [{user, margin}]: margin is their steps plus the head start minus
  -- IT's; below zero is tagged.
  tagged jsonb not null default '[]'::jsonb,
  escaped jsonb not null default '[]'::jsonb,
  next_it uuid references public.profiles (id) on delete set null,
  settled_at timestamptz not null default now(),
  primary key (challenge_id, day_no)
);

alter table public.tag_chase_state enable row level security;
alter table public.tag_chase_days enable row level security;
revoke all on public.tag_chase_state from anon, authenticated;
revoke all on public.tag_chase_days from anon, authenticated;

-- Who's IT now: on a new game, a random player.
create or replace function public.tag_chase_it(p_challenge_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  it uuid;
begin
  select s.it_user into it from public.tag_chase_state s where s.challenge_id = p_challenge_id;
  if it is not null then
    return it;
  end if;
  select cp.user_id into it from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id order by random() limit 1;
  if it is null then
    return null;
  end if;
  insert into public.tag_chase_state (challenge_id, it_user) values (p_challenge_id, it)
    on conflict (challenge_id) do update set it_user = coalesce(public.tag_chase_state.it_user, excluded.it_user), updated_at = now();
  select s.it_user into it from public.tag_chase_state s where s.challenge_id = p_challenge_id;
  return it;
end;
$$;

revoke execute on function public.tag_chase_it(uuid) from public, anon, authenticated;

create or replace function public.tag_chase_notify(p_kind text, p_challenge_id uuid, p_recipient uuid, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-tag-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', p_kind, 'challenge_id', p_challenge_id, 'new_it_user_id', p_recipient) || p_extra
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.tag_chase_notify(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- Settles every day of a chase that's over everywhere and not settled
-- yet, in order. Returns how many it settled.
create or replace function public.tag_chase_advance(p_challenge_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  first_day date;
  last_day date;
  cutoff date;
  d date;
  n int := 0;
  it uuid;
  it_steps int;
  head int;
  steps jsonb;
  tagged jsonb;
  escaped jsonb;
  nxt uuid;
  latest int;
begin
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'tag' or c.tag_mode is distinct from 'chase' then
    return 0;
  end if;
  -- One at a time per game.
  perform pg_advisory_xact_lock(hashtext('tag_chase:' || p_challenge_id::text));
  first_day := public.soccer_first_day(c);
  last_day := first_day + c.duration_days - 1;
  cutoff := (now() at time zone 'utc')::date - case when extract(hour from now() at time zone 'utc') >= 11 then 1 else 2 end;
  head := coalesce(c.tag_head_start, 2000);
  for d in
    select s::date from generate_series(first_day::timestamp, least(last_day, cutoff)::timestamp, interval '1 day') s
  loop
    continue when exists (select 1 from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day = d);
    it := public.tag_chase_it(p_challenge_id);
    exit when it is null;
    select coalesce(jsonb_object_agg(cp.user_id::text, coalesce(ps.steps, 0)), '{}'::jsonb) into steps
      from public.challenge_participants cp
      left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id and ps.day = d
      where cp.challenge_id = p_challenge_id;
    it_steps := coalesce((steps ->> it::text)::int, 0);
    select coalesce(jsonb_agg(jsonb_build_object('user', k, 'margin', (v::int + head - it_steps)) order by v::int) filter (where v::int + head < it_steps), '[]'::jsonb),
           coalesce(jsonb_agg(jsonb_build_object('user', k, 'margin', (v::int + head - it_steps)) order by v::int desc) filter (where v::int + head >= it_steps), '[]'::jsonb)
      into tagged, escaped
      from jsonb_each_text(steps) e(k, v)
      where k <> it::text;
    -- The slowest tagged hound is IT next; nobody tagged, IT stays.
    nxt := coalesce((tagged -> 0 ->> 'user')::uuid, it);
    insert into public.tag_chase_days (challenge_id, day_no, day, it_user, head_start, steps, tagged, escaped, next_it)
      values (p_challenge_id, d - first_day + 1, d, it, head, steps, tagged, escaped, nxt);
    update public.tag_chase_state set it_user = nxt, updated_at = now() where challenge_id = p_challenge_id;
    n := n + 1;
  end loop;

  -- Pushes for the latest day settled just now, if the game isn't over.
  if n > 0 then
    select max(x.day_no) into latest from public.tag_chase_days x where x.challenge_id = p_challenge_id;
    if latest < c.duration_days then
      select x.next_it, x.tagged into nxt, tagged from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day_no = latest;
      select x.it_user into it from public.tag_chase_days x where x.challenge_id = p_challenge_id and x.day_no = latest;
      perform public.tag_chase_notify('chase_it', p_challenge_id, nxt, jsonb_build_object('head_start', head));
      perform public.tag_chase_notify('chase_tagged', p_challenge_id, (t ->> 'user')::uuid,
          jsonb_build_object('tagger_id', it, 'margin', abs((t ->> 'margin')::int)))
        from jsonb_array_elements(tagged) t
        where (t ->> 'user')::uuid is distinct from nxt;
    end if;
  end if;
  return n;
end;
$$;

revoke execute on function public.tag_chase_advance(uuid) from public, anon, authenticated;

-- Every chase that has a day to settle: the daily job.
create or replace function public.tag_chase_advance_all()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
begin
  for r in
    select c.id from public.challenges c
    where c.kind::text = 'tag' and c.tag_mode = 'chase' and c.score_settled_at is null
      and c.starts_at < now()
  loop
    begin
      perform public.tag_chase_advance(r.id);
      perform public.settle_challenge_score(r.id);
    exception when others then
      raise warning 'tag_chase_advance_all: % failed: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke execute on function public.tag_chase_advance_all() from public, anon, authenticated;

select cron.schedule('hound-tag-chase', '47 11 * * *', $$ select public.tag_chase_advance_all(); $$);

-- Points so far: +3 a tag, +1 a day got away; and days as IT.
create or replace function public.tag_chase_standings(p_challenge_id uuid)
returns table (user_id uuid, tags int, escapes int, days_it int, points int)
language sql
stable
security definer set search_path = public
as $$
  select cp.user_id,
    coalesce((select sum(jsonb_array_length(d.tagged)) from public.tag_chase_days d
              where d.challenge_id = p_challenge_id and d.it_user = cp.user_id), 0)::int,
    (select count(*) from public.tag_chase_days d, jsonb_array_elements(d.escaped) e
     where d.challenge_id = p_challenge_id and (e ->> 'user')::uuid = cp.user_id)::int,
    (select count(*) from public.tag_chase_days d where d.challenge_id = p_challenge_id and d.it_user = cp.user_id)::int,
    (coalesce((select sum(jsonb_array_length(d.tagged)) from public.tag_chase_days d
               where d.challenge_id = p_challenge_id and d.it_user = cp.user_id), 0) * 3
     + (select count(*) from public.tag_chase_days d, jsonb_array_elements(d.escaped) e
        where d.challenge_id = p_challenge_id and (e ->> 'user')::uuid = cp.user_id))::int
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;
$$;

revoke execute on function public.tag_chase_standings(uuid) from public, anon, authenticated;

-- The game, for its screen: settles what's over first. p_day is the
-- caller's today, for today's steps.
create or replace function public.tag_chase_view(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  first_day date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'tag' or c.tag_mode is distinct from 'chase' then
    raise exception 'That isn''t a Tag chase.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge first.';
  end if;
  perform public.tag_chase_advance(p_challenge_id);
  first_day := public.soccer_first_day(c);
  return jsonb_build_object(
    'head_start', coalesce(c.tag_head_start, 2000),
    'days', c.duration_days,
    'first_day', first_day,
    'it', case when now() >= c.starts_at then public.tag_chase_it(p_challenge_id) end,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id,
          'name', case when p.use_username and p.username is not null then p.username else p.name end,
          'hound', public.kennel_avatar_code(p.id)) order by p.name), '[]'::jsonb)
      from public.challenge_participants cp join public.profiles p on p.id = cp.user_id
      where cp.challenge_id = p_challenge_id
    ),
    'today', (
      select coalesce(jsonb_object_agg(ps.user_id::text, ps.steps), '{}'::jsonb)
      from public.progress_snapshots ps
      where ps.challenge_id = p_challenge_id and ps.day = p_day
    ),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'day_no', d.day_no, 'day', d.day, 'it', d.it_user, 'head_start', d.head_start,
          'steps', d.steps, 'tagged', d.tagged, 'escaped', d.escaped, 'next_it', d.next_it) order by d.day_no), '[]'::jsonb)
      from public.tag_chase_days d where d.challenge_id = p_challenge_id
    ),
    'standings', (
      select coalesce(jsonb_agg(jsonb_build_object('user', s.user_id, 'tags', s.tags, 'escapes', s.escapes,
          'days_it', s.days_it, 'points', s.points) order by s.points desc, s.days_it), '[]'::jsonb)
      from public.tag_chase_standings(p_challenge_id) s
    )
  );
end;
$$;

revoke execute on function public.tag_chase_view(uuid, date) from public, anon;
grant execute on function public.tag_chase_view(uuid, date) to authenticated;

-- Admin → Overview → Tag.
create or replace function public.admin_tag_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    with chases as (
      select c.* from public.challenges c where c.kind::text = 'tag' and c.tag_mode = 'chase'
    ),
    wk as (
      select d.* from public.tag_chase_days d where d.settled_at > now() - interval '7 days'
    )
    select jsonb_build_object(
      'running', (select count(*) from chases c where c.starts_at <= now() and c.score_settled_at is null),
      'upcoming', (select count(*) from chases c where c.starts_at > now()),
      'finished', (select count(*) from chases c where c.score_settled_at is not null),
      'players', (select count(distinct cp.user_id) from public.challenge_participants cp join chases c on c.id = cp.challenge_id
                  where c.score_settled_at is null),
      'old_running', (select count(*) from public.challenges c where c.kind::text = 'tag' and c.tag_mode is distinct from 'chase'
                      and c.score_settled_at is null and c.ends_at > now()),
      'days_7d', (select count(*) from wk),
      'tags_7d', (select coalesce(sum(jsonb_array_length(wk.tagged)), 0) from wk),
      'escapes_7d', (select coalesce(sum(jsonb_array_length(wk.escaped)), 0) from wk),
      'no_tag_days_7d', (select count(*) from wk where jsonb_array_length(wk.tagged) = 0),
      'head_starts', (
        select coalesce(jsonb_object_agg(h.head_start, h.n), '{}'::jsonb)
        from (select coalesce(c.tag_head_start, 2000)::text as head_start, count(*) as n from chases c group by 1) h
      )
    )
  );
end;
$$;

revoke execute on function public.admin_tag_overview() from public, anon;
grant execute on function public.admin_tag_overview() to authenticated;

-- ── Scoring ──────────────────────────────────────────────────────────

-- 0174's core: the old Tag's group goal ends only the old game, and a
-- chase ends when its last day is settled, placed by points.
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

  if not concluded and c.kind = 'tag' and c.tag_mode is distinct from 'chase' then
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

  -- A Tag chase (0181) ends once its last day is settled, the morning
  -- after ends_at.
  if c.kind = 'tag' and c.tag_mode = 'chase' then
    perform public.tag_chase_advance(p_challenge_id);
    concluded := (select count(*) from public.tag_chase_days d where d.challenge_id = p_challenge_id) >= c.duration_days;
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

  elsif c.kind = 'tag' and c.tag_mode = 'chase' then
    -- Placed by points (+3 a tag, +1 a day got away), fewer days as IT
    -- breaking a tie, and scored like a Step Race.
    with ranked as (
      select s.user_id, row_number() over (order by s.points desc, s.days_it asc) as rnk
      from public.tag_chase_standings(p_challenge_id) s
    )
    insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select user_id, p_challenge_id, 'tag_result',
      case rnk when 1 then 50 when 2 then 25 when 3 then 15 else 5 end,
      25,
      bones_trickle
    from ranked;

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
