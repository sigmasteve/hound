-- Hound: Daily Doors, published as "Knock Knock, Hound". See
-- 0171_doors_challenge_kind.sql for the enum value this depends on (it
-- must already be committed).
--
-- A calendar of doors, one a day for the challenge's days. A door opens
-- only on its own day (the member's own date), and opening it is the
-- daily check-in. Behind it is the day's task, the same for everyone:
--
--   steps     walk a target: a tenth over your own average for the seven
--             days before, to the nearest 500, 3,000 to 15,000 (5,000
--             with no steps on record); counted from the synced day's
--             total, or the phone's own count (doors_claim_steps)
--   workout   any workout logged that day
--   water     your water goal met (water_days)
--   goal_day  every daily goal closed (a goal_day claim)
--   treat     your hound fed a treat (the Kennel's treated_on, or a
--             homemade one eaten)
--   walk      one walk of 10 minutes or more (hound_walks)
--   cheer     a nudge, or a reaction on a challenge, sent to someone
--
-- The tasks come round in a shuffled order, seeded by the challenge, each
-- once every seven doors and never the same two days running.
--
-- Points: 1 for opening a door, 2 more for doing its task that day, and 1
-- more for each done door from the third in a row. One missed day a week
-- (doors 1-7, 8-14, ...) doesn't break the run. Every third door also has
-- 5 to 10 Bones behind it, and the last one the Doorbell Ring for the
-- Locker, which can't be bought.
--
-- Nothing is ticked by hand. Opening a door checks what's already done;
-- triggers on the tables the tasks read mark it done the moment the
-- evidence lands (each wrapped so a problem here can never block a step
-- sync or a water log); and a morning sweep catches anything missed.
-- Highest points at the end wins, placed like a Step Race.
--
--   door_opens   one row per member and door they opened: its task, the
--                steps target, what was behind it, and when it was done.
--
-- Pushes: "Knock knock" in the morning (14:37 UTC) to everyone in a live
-- one, and "Door N is still shut" in the early evening (23:37 UTC) to
-- anyone who hasn't opened today's. They need the send-doors-notification
-- Edge Function deployed; without it the game plays, quietly.
--
-- Global only for now: publish_global_challenge takes 'doors'.
--
-- Run this once, after 0171 (as its own, separately committed
-- transaction), in the SQL Editor.
--
-- Undo, if needed: unschedule hound-doors-sweep, hound-doors-morning and
-- hound-doors-evening; drop door_opens, the doors_* functions and their
-- triggers; re-run settle_challenge_score_core from 0167 and
-- publish_global_challenge from 0136. The enum value stays.

-- ── The prize ────────────────────────────────────────────────────────

-- Behind the last door: a Locker frame that can't be bought or leveled
-- into, owned through cosmetic_purchases like a Dig item.
alter table public.cosmetic_items add column if not exists door_prize boolean not null default false;
alter table public.cosmetic_items drop constraint if exists cosmetic_items_one_way_to_get;
alter table public.cosmetic_items add constraint cosmetic_items_one_way_to_get
  check (num_nonnulls(unlock_xp, cost_bones, dig_pieces) + (case when door_prize then 1 else 0 end) = 1);

insert into public.cosmetic_items (id, slot, name, door_prize) values ('frame_doorbell', 'frame', 'Doorbell Ring', true)
on conflict (id) do nothing;

-- ── Doors opened ─────────────────────────────────────────────────────

create table public.door_opens (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  door_no int not null check (door_no >= 1),
  -- The member's own date it was opened on: the door's day.
  day date not null,
  task text not null check (task in ('steps', 'workout', 'water', 'goal_day', 'treat', 'walk', 'cheer')),
  steps_target int check (steps_target between 1000 and 30000),
  constraint door_opens_steps_target check ((task = 'steps') = (steps_target is not null)),
  bonus_bones int not null default 0 check (bonus_bones >= 0),
  prize_id text,
  opened_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (challenge_id, user_id, door_no)
);

create index door_opens_undone on public.door_opens (user_id, day) where done_at is null;
create index door_opens_day on public.door_opens (challenge_id, day);

alter table public.door_opens enable row level security;

create policy "Members see their own doors"
  on public.door_opens for select to authenticated
  using (user_id = auth.uid());

revoke all on public.door_opens from anon;
revoke insert, update, delete on public.door_opens from authenticated;

-- ── The calendar ─────────────────────────────────────────────────────

-- Door 1's day: the challenge's own start day, else its start in US
-- Eastern time (as Hound'opoly).
create or replace function public.doors_first_day(c public.challenges)
returns date
language sql
immutable
as $$
  select coalesce(c.start_day, (c.starts_at at time zone 'America/New_York')::date);
$$;

revoke execute on function public.doors_first_day(public.challenges) from public, anon, authenticated;

-- The seven tasks in a seeded order for one week of doors (block 0 is
-- doors 1-7).
create or replace function public.doors_week(p_challenge_id uuid, p_block int)
returns text[]
language sql
immutable
as $$
  select array_agg(t order by md5(p_challenge_id::text || ':' || p_block || ':' || t))
  from unnest(array['steps', 'workout', 'water', 'goal_day', 'treat', 'walk', 'cheer']) as t;
$$;

revoke execute on function public.doors_week(uuid, int) from public, anon, authenticated;

-- A door's task: its place in its week's order, with the first two of a
-- week swapped when the first would repeat the day before.
create or replace function public.doors_task(p_challenge_id uuid, p_door int)
returns text
language plpgsql
immutable
as $$
declare
  block int := (p_door - 1) / 7;
  pos int := (p_door - 1) % 7 + 1;
  week text[] := public.doors_week(p_challenge_id, block);
  prev text[];
begin
  if block > 0 then
    prev := public.doors_week(p_challenge_id, block - 1);
    if week[1] = prev[7] then
      week := array[week[2], week[1]] || week[3:7];
    end if;
  end if;
  return week[pos];
end;
$$;

revoke execute on function public.doors_task(uuid, int) from public, anon;
grant execute on function public.doors_task(uuid, int) to authenticated;

-- A tenth over the member's average for the seven days before, to the
-- nearest 500, 3,000 to 15,000; 5,000 with nothing on record.
create or replace function public.doors_steps_target(p_user uuid, p_day date)
returns int
language sql
stable
security definer set search_path = public
as $$
  select case when avg(d.steps) is null then 5000
              else least(15000, greatest(3000, (round(avg(d.steps) * 1.1 / 500) * 500)::int)) end
  from public.daily_step_totals d
  where d.user_id = p_user and d.day between p_day - 7 and p_day - 1 and d.steps > 0;
$$;

revoke execute on function public.doors_steps_target(uuid, date) from public, anon, authenticated;

-- Whether a task was done on a day, from what Hound already keeps.
create or replace function public.doors_evidence(p_user uuid, p_task text, p_day date, p_target int)
returns boolean
language plpgsql
stable
security definer set search_path = public
as $$
declare
  tz text := coalesce((select p.time_zone from public.profiles p where p.id = p_user), 'America/New_York');
begin
  case p_task
    when 'steps' then
      return coalesce((select d.steps >= p_target from public.daily_step_totals d where d.user_id = p_user and d.day = p_day), false);
    when 'workout' then
      return exists (
        select 1 from public.workout_history w
        where w.user_id = p_user
          and w.occurred_at >= (p_day - 1)::timestamp at time zone 'utc'
          and w.occurred_at < (p_day + 2)::timestamp at time zone 'utc'
          and (w.occurred_at at time zone tz)::date = p_day);
    when 'water' then
      return exists (select 1 from public.water_days w where w.user_id = p_user and w.day = p_day);
    when 'goal_day' then
      return exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on = p_day)
        or exists (
          select 1 from public.activity_events a
          where a.user_id = p_user and a.kind = 'goal_day'
            and a.created_at >= (p_day - 1)::timestamp at time zone 'utc'
            and a.created_at < (p_day + 2)::timestamp at time zone 'utc'
            and (a.created_at at time zone tz)::date = p_day);
    when 'treat' then
      return exists (select 1 from public.kennels k where k.user_id = p_user and k.treated_on = p_day)
        or exists (select 1 from public.hound_treats t where t.user_id = p_user and t.eaten_on = p_day);
    when 'walk' then
      return exists (
        select 1 from public.hound_walks w
        where w.user_id = p_user and w.day = p_day and w.ended_at - w.started_at >= interval '10 minutes');
    when 'cheer' then
      return exists (select 1 from public.challenge_reactions r where r.from_user = p_user and r.day = p_day)
        or exists (
          select 1 from public.nudges n
          where n.from_user = p_user
            and n.created_at >= (p_day - 1)::timestamp at time zone 'utc'
            and n.created_at < (p_day + 2)::timestamp at time zone 'utc'
            and (n.created_at at time zone tz)::date = p_day);
    else
      return false;
  end case;
end;
$$;

revoke execute on function public.doors_evidence(uuid, text, date, int) from public, anon, authenticated;

-- Marks any of a member's open doors from the last few days whose task
-- is now done. Returns how many it marked.
create or replace function public.doors_recheck(p_user uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  n int;
begin
  update public.door_opens o
    set done_at = now()
    where o.user_id = p_user
      and o.done_at is null
      and o.day >= (now() at time zone 'utc')::date - 3
      and public.doors_evidence(o.user_id, o.task, o.day, o.steps_target);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.doors_recheck(uuid) from public, anon, authenticated;

-- The trigger behind every task table: a cheap no-op for anyone without
-- an open, undone door, and never an error for the write that fired it.
create or replace function public.doors_on_evidence()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  who uuid;
begin
  begin
    who := case when tg_table_name in ('nudges', 'challenge_reactions') then (to_jsonb(new) ->> 'from_user')::uuid
                else (to_jsonb(new) ->> 'user_id')::uuid end;
    if who is not null and exists (select 1 from public.door_opens o where o.user_id = who and o.done_at is null) then
      perform public.doors_recheck(who);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

revoke execute on function public.doors_on_evidence() from public, anon, authenticated;

create trigger doors_on_steps after insert or update of steps on public.daily_step_totals
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_workout after insert on public.workout_history
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_water after insert on public.water_days
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_goal_day after insert on public.activity_events
  for each row when (new.kind = 'goal_day') execute procedure public.doors_on_evidence();
create trigger doors_on_kennel_treat after update of treated_on on public.kennels
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_homemade_treat after update of eaten_on on public.hound_treats
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_walk after insert or update on public.hound_walks
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_nudge after insert on public.nudges
  for each row execute procedure public.doors_on_evidence();
create trigger doors_on_reaction after insert on public.challenge_reactions
  for each row execute procedure public.doors_on_evidence();

-- ── Points ───────────────────────────────────────────────────────────

-- A member's points, run, and doors opened and done, as of p_today (their
-- own date: a door on that day not done yet isn't a miss yet).
create or replace function public.doors_points(p_challenge_id uuid, p_user uuid, p_today date)
returns table (points int, run int, opened int, done int)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges;
  first date;
  r record;
  forgiven int[] := '{}';
begin
  points := 0; run := 0; opened := 0; done := 0;
  select * into c from public.challenges where id = p_challenge_id;
  if not found then
    return next;
    return;
  end if;
  first := public.doors_first_day(c);
  for r in
    select g.no, first + g.no - 1 as day, o.door_no is not null as was_opened, o.done_at is not null as was_done
    from generate_series(1, c.duration_days) g(no)
    left join public.door_opens o on o.challenge_id = p_challenge_id and o.user_id = p_user and o.door_no = g.no
    where first + g.no - 1 <= p_today
    order by g.no
  loop
    if r.was_opened then
      points := points + 1;
      opened := opened + 1;
    end if;
    if r.was_done then
      points := points + 2;
      done := done + 1;
      run := run + 1;
      if run >= 3 then
        points := points + 1;
      end if;
    elsif r.day < p_today then
      -- A miss: the week's one free miss, else the run ends.
      if not (((r.no - 1) / 7) = any (forgiven)) then
        forgiven := forgiven || ((r.no - 1) / 7);
      else
        run := 0;
      end if;
    end if;
  end loop;
  return next;
end;
$$;

revoke execute on function public.doors_points(uuid, uuid, date) from public, anon, authenticated;

-- Everyone in it, by points (then done doors), each at their own date.
create or replace function public.doors_board(p_challenge_id uuid)
returns table (user_id uuid, points int, run int, opened int, done int, place bigint)
language sql
stable
security definer set search_path = public
as $$
  with scored as (
    select cp.user_id, s.points, s.run, s.opened, s.done
    from public.challenge_participants cp
    cross join lateral public.doors_points(p_challenge_id, cp.user_id, public.soccer_today(cp.user_id)) s
    where cp.challenge_id = p_challenge_id
  )
  select s.user_id, s.points, s.run, s.opened, s.done, rank() over (order by s.points desc, s.done desc)
  from scored s;
$$;

revoke execute on function public.doors_board(uuid) from public, anon, authenticated;

-- ── What the app shows ───────────────────────────────────────────────

-- The calendar for the caller, as of p_day (the phone's date): each
-- door's state and, once opened or past, its task; their points, run and
-- place; the top ten and their own row; and today's numbers for the
-- steps and water doors.
create or replace function public.doors_state(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  first date;
  doors jsonb;
  mine record;
  board jsonb;
  players int;
  water_ml int;
  water_target int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind <> 'doors' then
    raise exception 'That isn''t a Daily Doors challenge.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge to open its doors.';
  end if;
  first := public.doors_first_day(c);

  select coalesce(jsonb_agg(jsonb_build_object(
      'no', g.no,
      'day', first + g.no - 1,
      'state', case
        when o.done_at is not null then 'done'
        when o.door_no is not null then 'opened'
        when first + g.no - 1 < p_day then 'missed'
        when first + g.no - 1 = p_day then 'ready'
        else 'locked' end,
      'task', case when o.door_no is not null then o.task
                   when first + g.no - 1 < p_day then public.doors_task(p_challenge_id, g.no) end,
      'stepsTarget', o.steps_target,
      'bonusBones', o.bonus_bones,
      'prizeId', o.prize_id
    ) order by g.no), '[]'::jsonb)
  into doors
  from generate_series(1, c.duration_days) g(no)
  left join public.door_opens o on o.challenge_id = p_challenge_id and o.user_id = me and o.door_no = g.no;

  select * into mine from public.doors_points(p_challenge_id, me, p_day);

  select count(*) into players from public.challenge_participants cp where cp.challenge_id = p_challenge_id;

  select coalesce(jsonb_agg(jsonb_build_object('userId', b.user_id, 'points', b.points, 'done', b.done, 'run', b.run, 'place', b.place)
                            order by b.place, b.user_id), '[]'::jsonb)
  into board
  from (
    select * from public.doors_board(p_challenge_id) x
    order by x.place, x.user_id
  ) b
  where b.place <= 10 or b.user_id = me;

  select coalesce(sum(l.ml), 0) into water_ml from public.water_log l where l.user_id = me and l.day = p_day;
  select coalesce((select w.target_ml from public.water_goals w where w.user_id = me), 1893) into water_target;

  return jsonb_build_object(
    'firstDay', first,
    'doors', doors,
    'points', mine.points,
    'run', mine.run,
    'opened', mine.opened,
    'done', mine.done,
    'place', (select (b->>'place')::int from jsonb_array_elements(board) b where (b->>'userId')::uuid = me),
    'players', players,
    'board', board,
    'stepsToday', (select d.steps from public.daily_step_totals d where d.user_id = me and d.day = p_day),
    'waterMl', water_ml,
    'waterTargetMl', water_target,
    'settled', c.score_settled_at is not null
  );
end;
$$;

revoke execute on function public.doors_state(uuid, date) from public, anon;
grant execute on function public.doors_state(uuid, date) to authenticated;

-- Opens the caller's door for p_day (the phone's date): the check-in.
-- Only that day's door, and only once; what's behind it is paid on the
-- spot, and a task already done counts straight away. Returns the state.
create or replace function public.doors_open(p_challenge_id uuid, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  c public.challenges;
  no int;
  t text;
  target int;
  bonus int := 0;
  prize text;
  added int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  -- A door opens only on its own day: the member's date where the phone
  -- has told us their time zone, else within a day of UTC's.
  if exists (select 1 from public.profiles p where p.id = me and p.time_zone is not null)
     and p_day <> public.soccer_today(me) then
    raise exception 'That door isn''t open today.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or c.kind <> 'doors' then
    raise exception 'That isn''t a Daily Doors challenge.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge to open its doors.';
  end if;
  if c.score_settled_at is not null then
    raise exception 'This one''s over.';
  end if;
  no := p_day - public.doors_first_day(c) + 1;
  if no < 1 or no > c.duration_days then
    raise exception 'There''s no door to open today.';
  end if;

  t := public.doors_task(p_challenge_id, no);
  target := case when t = 'steps' then public.doors_steps_target(me, p_day) end;
  if no % 3 = 0 then
    bonus := 5 + abs(hashtext(p_challenge_id::text || ':' || me::text || ':' || no)) % 6;
  end if;
  if no = c.duration_days then
    prize := 'frame_doorbell';
  end if;

  insert into public.door_opens (challenge_id, user_id, door_no, day, task, steps_target, bonus_bones, prize_id)
  values (p_challenge_id, me, no, p_day, t, target, bonus, prize)
  on conflict do nothing;
  get diagnostics added = row_count;

  if added > 0 then
    if bonus > 0 then
      update public.profiles p
        set bones_balance = p.bones_balance + bonus, bones_earned_total = p.bones_earned_total + bonus
        where p.id = me;
    end if;
    if prize is not null then
      insert into public.cosmetic_purchases (user_id, item_id) values (me, prize) on conflict do nothing;
    end if;
    update public.door_opens o set done_at = now()
      where o.challenge_id = p_challenge_id and o.user_id = me and o.door_no = no
        and public.doors_evidence(me, t, p_day, target);
  end if;

  return public.doors_state(p_challenge_id, p_day);
end;
$$;

revoke execute on function public.doors_open(uuid, date) from public, anon;
grant execute on function public.doors_open(uuid, date) to authenticated;

-- A steps door done on the phone's own count. daily_step_totals is kept
-- by UTC day (0027), so late in a US evening today's steps land on
-- tomorrow's row; the phone knows its own day's total, and is trusted for
-- it the way it is for a water day (0153) or a goal day (0099).
create or replace function public.doors_claim_steps(p_challenge_id uuid, p_day date, p_steps int)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  n int;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_day is null or p_day < utc_today - 1 or p_day > utc_today + 1 or p_steps is null or p_steps < 0 or p_steps > 150000 then
    raise exception 'Invalid steps.';
  end if;
  update public.door_opens o
    set done_at = now()
    where o.challenge_id = p_challenge_id and o.user_id = me and o.day = p_day
      and o.task = 'steps' and o.done_at is null and p_steps >= o.steps_target;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.doors_claim_steps(uuid, date, int) from public, anon;
grant execute on function public.doors_claim_steps(uuid, date, int) to authenticated;

-- ── Jobs ─────────────────────────────────────────────────────────────

-- Every morning, once yesterday is over everywhere: one last look at the
-- last few days' undone doors, in case a trigger missed something.
create or replace function public.doors_sweep()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  n int;
begin
  update public.door_opens o
    set done_at = now()
    where o.done_at is null
      and o.day >= (now() at time zone 'utc')::date - 3
      and public.doors_evidence(o.user_id, o.task, o.day, o.steps_target);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.doors_sweep() from public, anon, authenticated;

select cron.schedule('hound-doors-sweep', '50 11 * * *', $$ select public.doors_sweep(); $$);

create or replace function public.doors_notify(p_kind text, p_challenge_id uuid, p_door int, p_recipients uuid[])
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(array_length(p_recipients, 1), 0) = 0 then
    return;
  end if;
  perform net.http_post(
    url := public.edge_function_url('send-doors-notification'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', p_kind, 'challenge_id', p_challenge_id, 'door_no', p_door, 'recipient_ids', to_jsonb(p_recipients))
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.doors_notify(text, uuid, int, uuid[]) from public, anon, authenticated;

-- "Knock knock": today's door is open (US morning). p_kind 'shut' sends
-- the evening one, only to those who haven't opened today's. Returns how
-- many people it was sent for.
create or replace function public.doors_push(p_kind text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  n int := 0;
  door int;
  who uuid[];
begin
  for c in
    select * from public.challenges ch
    where ch.kind = 'doors' and ch.score_settled_at is null and ch.starts_at <= now() + interval '1 day'
  loop
    door := (now() at time zone 'America/New_York')::date - public.doors_first_day(c) + 1;
    continue when door < 1 or door > c.duration_days;
    select array_agg(cp.user_id) into who
    from public.challenge_participants cp
    where cp.challenge_id = c.id
      and (p_kind = 'open' or not exists (
        select 1 from public.door_opens o
        where o.challenge_id = c.id and o.user_id = cp.user_id and o.day = public.soccer_today(cp.user_id)));
    perform public.doors_notify(p_kind, c.id, door, who);
    n := n + coalesce(array_length(who, 1), 0);
  end loop;
  return n;
end;
$$;

revoke execute on function public.doors_push(text) from public, anon, authenticated;

select cron.schedule('hound-doors-morning', '37 14 * * *', $$ select public.doors_push('open'); $$);
select cron.schedule('hound-doors-evening', '37 23 * * *', $$ select public.doors_push('shut'); $$);

-- ── Admin ────────────────────────────────────────────────────────────

-- Admin → Overview → Daily Doors: how many have joined, and how many open
-- and do their door each day.
create or replace function public.admin_doors_overview()
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
    'challenges', (select count(*) from public.challenges c where c.kind = 'doors'),
    'live', (select count(*) from public.challenges c where c.kind = 'doors' and c.score_settled_at is null and c.starts_at <= now()),
    'joined', (select count(distinct cp.user_id) from public.challenge_participants cp join public.challenges c on c.id = cp.challenge_id where c.kind = 'doors'),
    'everOpened', (select count(distinct o.user_id) from public.door_opens o),
    'openedToday', (select count(*) from public.door_opens o where o.day = today),
    'doneToday', (select count(*) from public.door_opens o where o.day = today and o.done_at is not null),
    'opens', (select count(*) from public.door_opens),
    'done', (select count(*) from public.door_opens o where o.done_at is not null),
    'prizes', (select count(*) from public.door_opens o where o.prize_id is not null),
    -- The last 14 days: doors opened and done each day.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'opened', d.opened, 'done', d.done) order by d.day desc)
      from (
        select o.day, count(*) as opened, count(o.done_at) as done
        from public.door_opens o
        where o.day > today - 14
        group by o.day
      ) d
    ), '[]'::jsonb),
    -- How often each task gets done once its door is open.
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('task', t.task, 'opened', t.opened, 'done', t.done) order by t.task)
      from (
        select o.task, count(*) as opened, count(o.done_at) as done
        from public.door_opens o
        group by o.task
      ) t
    ), '[]'::jsonb),
    -- Each live one: players, and today's door opened and done.
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name,
          'players', (select count(*) from public.challenge_participants cp where cp.challenge_id = c.id),
          'door', today - public.doors_first_day(c) + 1,
          'doors', c.duration_days,
          'openedToday', (select count(*) from public.door_opens o where o.challenge_id = c.id and o.day = today),
          'doneToday', (select count(*) from public.door_opens o where o.challenge_id = c.id and o.day = today and o.done_at is not null)
        ) order by c.starts_at desc)
      from public.challenges c
      where c.kind = 'doors' and c.score_settled_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_doors_overview() from public, anon;
grant execute on function public.admin_doors_overview() to authenticated;

-- ── Scoring and publishing ───────────────────────────────────────────

-- Scoring: 0167's core with a Daily Doors branch. The wrapper (0167)
-- needs no change: Daily Doors is time-based, settled 24 hours after it
-- ends like a Step Race.
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
    -- Most points wins, placed like a Step Race. Every door's day is
    -- past by now, so each is counted as done, opened or missed.
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

-- Publishing: 0136's, with Daily Doors among the global kinds (3 to 60
-- days, a door a day).
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
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist', 'houndopoly', 'doors') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey, Accountability, Hound''opoly or Daily Doors.';
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
