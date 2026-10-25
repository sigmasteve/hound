-- Hound: Accountability challenge — a daily checklist you keep with
-- friends. The creator writes the list (up to an admin-set number of
-- items, 6 unless Admin says otherwise), everyone in the challenge has
-- the same list, and each person can add one line of their own. A day
-- counts only when every item is ticked; a miss resets your current
-- streak but never puts you out (the 75 Day rule, 0062). It's personal:
-- you're not ranked against anyone, you're scored by complete days.
--
--   checklist_settings   the one admin setting: how many shared items
--                        a list can hold.
--   checklist_items      the list. owner_id null = a shared item, set by
--                        the creator; owner_id set = that person's own
--                        line (one each). Item kinds:
--                          manual       a plain checkbox
--                          workout      ticks itself from any workout
--                                       logged that day
--                          mindfulness  ticks itself from a yoga,
--                                       pilates or meditation workout
--                          steps        ticks itself at steps_target
--                                       steps for the day (the creator
--                                       picks the count; a global one
--                                       can set it low)
--                        Every kind can also be ticked by hand.
--   checklist_checkins   one row per person, day and item. done is the
--                        tick; source says whether the phone set it
--                        ('device') or a finger did ('tap'), so the
--                        phone's sync never undoes an untick: the app
--                        only writes device rows where there's no tap
--                        row yet.
--
-- The shared list is locked once anyone has ticked anything, so what a
-- "complete day" means can't change under people's feet. Personal lines
-- can be written or changed any time (the check-ins keep their item)
-- and count from the day they were written (from_day).
--
-- Run this once, after 0125 (which must already have committed on its
-- own — see that file's own comment), in the SQL Editor.
--
-- Undo, if needed: drop the two tables and checklist_settings, re-run
-- the settlement and start-day functions from 0122 and 0086. The enum
-- value stays (Postgres can't drop one).

-- ── Admin setting ────────────────────────────────────────────────────

create table public.checklist_settings (
  id boolean primary key default true,
  constraint checklist_settings_singleton check (id),
  max_items int not null default 6 check (max_items between 1 and 12),
  updated_at timestamptz not null default now()
);

insert into public.checklist_settings (id) values (true);

alter table public.checklist_settings enable row level security;

create policy "Anyone signed in can read checklist settings"
  on public.checklist_settings for select
  to authenticated
  using (true);

create policy "Only admins can update checklist settings"
  on public.checklist_settings for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- ── The list ─────────────────────────────────────────────────────────

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  -- null = shared (the creator's list); otherwise this person's own line.
  owner_id uuid references public.profiles (id) on delete cascade,
  position int not null default 0,
  label text not null check (char_length(trim(label)) between 1 and 60),
  kind text not null default 'manual' check (kind in ('manual', 'workout', 'mindfulness', 'steps')),
  steps_target int check (steps_target between 1000 and 30000),
  constraint checklist_items_steps_target check ((kind = 'steps') = (steps_target is not null)),
  -- A personal line is a plain checkbox.
  constraint checklist_items_personal_manual check (owner_id is null or kind = 'manual'),
  -- A personal line counts from this day (the phone's own date when it
  -- was written), so one added on day 10 doesn't undo days 1 to 9. The
  -- app sets it; without it, the UTC date it was written. Shared items
  -- always count: the list is locked before anyone ticks.
  from_day date,
  constraint checklist_items_from_day_personal check (from_day is null or owner_id is not null),
  created_at timestamptz not null default now()
);

create index checklist_items_challenge on public.checklist_items (challenge_id);
create index checklist_items_owner on public.checklist_items (owner_id);
create unique index checklist_items_one_personal_line
  on public.checklist_items (challenge_id, owner_id) where owner_id is not null;

alter table public.checklist_items enable row level security;

create policy "Participants can view checklist items"
  on public.checklist_items for select
  to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid())
    or exists (select 1 from public.challenges c where c.id = challenge_id and (c.created_by = auth.uid() or c.is_global)));

-- The creator writes the shared list; anyone in the challenge writes
-- their own line. The trigger below adds the cap and the lock.
create policy "Creators write shared items, participants their own line"
  on public.checklist_items for insert
  to authenticated
  with check (
    (owner_id is null and exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid()))
    or (owner_id = auth.uid() and public.is_challenge_participant(challenge_id, auth.uid()))
  );

create policy "Creators update shared items, owners their own line"
  on public.checklist_items for update
  to authenticated
  using (
    (owner_id is null and exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid()))
    or owner_id = auth.uid()
  )
  with check (
    (owner_id is null and exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid()))
    or owner_id = auth.uid()
  );

create policy "Creators delete shared items, owners their own line"
  on public.checklist_items for delete
  to authenticated
  using (
    (owner_id is null and exists (select 1 from public.challenges c where c.id = challenge_id and c.created_by = auth.uid()))
    or owner_id = auth.uid()
  );

-- Only on a checklist challenge; no more shared items than Admin allows;
-- and the shared list is locked once anyone has ticked anything.
-- Server functions (not signed in as 'authenticated') are trusted. Like
-- 0090's guards these run as the caller, so current_user is the role
-- that made the request, and RLS covers what they read (a creator sees
-- their challenge and its items; a participant sees the check-ins).
create or replace function public.checklist_items_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c public.challenges%rowtype;
  cap int;
  shared int;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found or c.kind::text <> 'checklist' then
    raise exception 'Only an Accountability challenge has a checklist.';
  end if;
  if tg_op = 'UPDATE' and (new.challenge_id <> old.challenge_id or new.owner_id is distinct from old.owner_id) then
    raise exception 'An item can''t move to another list.';
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.owner_id is null then
    if exists (select 1 from public.checklist_checkins ck where ck.challenge_id = new.challenge_id) then
      raise exception 'The list is set — people have started ticking it.';
    end if;
    if tg_op = 'INSERT' then
      select s.max_items into cap from public.checklist_settings s;
      select count(*) into shared from public.checklist_items i
        where i.challenge_id = new.challenge_id and i.owner_id is null;
      if shared >= coalesce(cap, 6) then
        raise exception 'A list can hold % items.', coalesce(cap, 6);
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger checklist_items_guard
  before insert or update on public.checklist_items
  for each row execute procedure public.checklist_items_guard();

-- The same lock for deletes, so a creator can't shrink the list after
-- the fact either. Your own line you can always take back.
create or replace function public.checklist_items_delete_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and old.owner_id is null
     and exists (select 1 from public.checklist_checkins ck where ck.challenge_id = old.challenge_id) then
    raise exception 'The list is set — people have started ticking it.';
  end if;
  return old;
end;
$$;

create trigger checklist_items_delete_guard
  before delete on public.checklist_items
  for each row execute procedure public.checklist_items_delete_guard();

revoke execute on function public.checklist_items_guard() from public, anon, authenticated;
revoke execute on function public.checklist_items_delete_guard() from public, anon, authenticated;

-- ── The ticks ────────────────────────────────────────────────────────

create table public.checklist_checkins (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  item_id uuid not null references public.checklist_items (id) on delete cascade,
  done boolean not null default true,
  source text not null default 'tap' check (source in ('tap', 'device')),
  updated_at timestamptz not null default now(),
  primary key (challenge_id, user_id, day, item_id)
);

create index checklist_checkins_user on public.checklist_checkins (user_id);
create index checklist_checkins_item on public.checklist_checkins (item_id);

alter table public.checklist_checkins enable row level security;

-- Everyone in the challenge sees everyone's ticks — that's the
-- accountability — same as 75 Day (0062).
create policy "Participants can view checklist checkins"
  on public.checklist_checkins for select
  to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));

create policy "Users can record their own checklist checkins"
  on public.checklist_checkins for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own checklist checkins"
  on public.checklist_checkins for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 0090's rules (you must be in the challenge; no days from the future)
-- plus: the item must be on this challenge's list and either shared or
-- yours, and a day outside the challenge's own days is skipped quietly,
-- as 0086 does for 75 Day.
create or replace function public.checklist_checkins_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c public.challenges%rowtype;
  item public.checklist_items%rowtype;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if not found then
    raise exception 'You are not in that challenge.';
  end if;
  select * into item from public.checklist_items i where i.id = new.item_id;
  if not found or item.challenge_id <> new.challenge_id
     or (item.owner_id is not null and item.owner_id <> new.user_id) then
    raise exception 'That item isn''t on your list.';
  end if;
  if current_user in ('authenticated', 'anon') then
    if not exists (select 1 from public.challenge_participants cp
                   where cp.challenge_id = new.challenge_id and cp.user_id = new.user_id) then
      raise exception 'You are not in that challenge.';
    end if;
    if new.day > least(c.ends_at::date + 1, current_date + 1) then
      raise exception 'That day is outside the challenge.';
    end if;
  end if;
  if c.start_day is not null and (new.day < c.start_day or new.day > c.start_day + c.duration_days - 1) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger checklist_checkins_guard
  before insert or update on public.checklist_checkins
  for each row execute procedure public.checklist_checkins_guard();

revoke execute on function public.checklist_checkins_guard() from public, anon, authenticated;

-- ── Settlement ───────────────────────────────────────────────────────
--
-- 0122's four functions, each with one more branch for the new kind:
-- an Accountability challenge scores by complete days (like 75 Day),
-- is personal (one player is enough, and no Bones places on a global
-- one), and can be published as a Global Hound Challenge. Everything
-- else in them is as 0122 left it.

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

create or replace function public.settle_challenge_score(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges%rowtype;
  grace constant interval := interval '24 hours';
  min_players constant int := 2;
  players int;
  caller uuid := auth.uid();
  personal boolean;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.score_settled_at is not null then
    return;
  end if;

  -- A signed-in caller must be in the challenge. The scheduled job runs as
  -- the database and has no signed-in user.
  if caller is not null and not exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = p_challenge_id and cp.user_id = caller
  ) then
    return;
  end if;

  select count(*) into players
  from public.challenge_participants cp
  where cp.challenge_id = p_challenge_id;

  -- Played for your own effort, so one player is enough.
  personal := c.kind::text in ('seventyfive', 'bingo', 'checklist');

  -- Game-event kinds (and a Journey, which ends when someone reaches the
  -- end of the course) can end before ends_at; the core decides if they have.
  if c.kind::text in ('hunt', 'tag', 'tictacgo', 'journey') then
    if players >= min_players then
      perform public.settle_challenge_score_core(p_challenge_id);
    elsif now() >= c.ends_at + grace then
      -- Never had an opponent: close it without paying anyone.
      update public.challenges set score_settled_at = now() where id = p_challenge_id;
    end if;
    return;
  end if;

  -- Time-based kinds wait for the grace period.
  if now() < c.ends_at + grace then
    return;
  end if;

  if players < min_players and not personal then
    -- Nobody to compete against: close it without paying anyone.
    update public.challenges set score_settled_at = now() where id = p_challenge_id;
    return;
  end if;

  perform public.settle_challenge_score_core(p_challenge_id);
end;
$$;


revoke execute on function public.settle_challenge_score(uuid) from public, anon;
grant execute on function public.settle_challenge_score(uuid) to authenticated;

create or replace function public.pay_global_places(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global or c.places_paid_at is not null or c.score_settled_at is null then
    return;
  end if;
  update public.challenges x set places_paid_at = now() where x.id = p_challenge_id;
  if c.kind::text in ('seventyfive', 'checklist') or c.prize_bones is null then
    return;
  end if;

  with scores as (
    select cp.user_id,
      -- What decides the order first.
      case
        -- Hound Bingo: a BINGO beats any number of squares, and an
        -- earlier one beats a later one.
        when c.kind::text = 'bingo' and c.bingo_card_type = 'hound' then coalesce((
          select case
            when bc.bingo_at is not null then 1e12 - extract(epoch from bc.bingo_at)
            else (select count(*) from public.bingo_progress bp
                  where bp.challenge_id = p_challenge_id and bp.user_id = cp.user_id and bp.category = any (bc.squares))
          end
          from public.bingo_cards bc where bc.challenge_id = p_challenge_id and bc.user_id = cp.user_id), 0)
        when c.kind::text in ('streak', 'bingo') then coalesce((
          select max(a.score_points) from public.activity_events a
          where a.challenge_id = p_challenge_id and a.user_id = cp.user_id and a.kind in ('streak_result', 'bingo_result')), 0)
        when c.kind::text = 'journey' then coalesce(sum(ps.distance_mi), 0)
        when c.kind::text = 'distance' and c.distance_goal_unit = 'miles' then coalesce(sum(ps.distance_mi), 0)
        else coalesce(sum(ps.steps), 0)
      end as main,
      coalesce(sum(ps.steps), 0) as steps
    from public.challenge_participants cp
    left join public.progress_snapshots ps on ps.challenge_id = cp.challenge_id and ps.user_id = cp.user_id
    where cp.challenge_id = p_challenge_id
    group by cp.user_id
  ),
  placed as (
    select user_id, rank() over (order by main desc, steps desc) as place
    from scores
    where main > 0 or steps > 0
  ),
  prizes as (
    select user_id, c.prize_bones[place::int] as bones
    from placed
    where place <= 3 and c.prize_bones[place::int] > 0
  ),
  paid as (
    update public.profiles p
      set bones_balance = p.bones_balance + z.bones,
          bones_earned_total = p.bones_earned_total + z.bones
      from prizes z
      where p.id = z.user_id
      returning p.id, z.bones
  )
  insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select id, p_challenge_id, 'global_place', 0, 0, bones from paid;
end;
$$;


revoke execute on function public.pay_global_places(uuid) from public, anon, authenticated;

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
  p_course_id text default null
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
  if p_kind not in ('steps', 'streak', 'distance', 'bingo', 'seventyfive', 'journey', 'checklist') then
    raise exception 'That kind of challenge can''t be global — pick Step Race, Daily Streak, Distance, Bingo, 75 Day, Journey or Accountability.';
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

  insert into public.challenges (
    name, kind, created_by, duration_days, starts_at, ends_at,
    daily_goal_steps, distance_goal_unit, distance_goal_mi, distance_goal_steps, bingo_card_type, course_id,
    is_global, join_closes_at
  ) values (
    trim(p_name), p_kind, auth.uid(), p_duration_days, p_starts_at, ends,
    case when p_kind = 'streak' then p_daily_goal_steps end,
    case when p_kind = 'distance' then p_distance_goal_unit when p_kind = 'journey' then 'miles' end,
    case when (p_kind = 'distance' and p_distance_goal_unit = 'miles') or p_kind = 'journey' then p_distance_goal_mi end,
    case when p_kind = 'distance' and p_distance_goal_unit = 'steps' then p_distance_goal_steps end,
    case when p_kind = 'bingo' then coalesce(p_bingo_card_type, 'variety') end,
    case when p_kind = 'journey' then p_course_id end,
    true, p_join_closes_at
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text) from public, anon;
grant execute on function public.publish_global_challenge(text, public.challenge_kind, int, timestamptz, timestamptz, int, text, numeric, int, text, text) to authenticated;

-- ── Setting the start day (0085) also tidies the check-ins ───────────

create or replace function public.set_challenge_start_day(p_challenge_id uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if c.id is null or c.created_by <> auth.uid() then
    raise exception 'Only the creator can do that.';
  end if;
  if p_day is null or abs(p_day - (c.starts_at at time zone 'UTC')::date) > 1 then
    raise exception 'That day doesn''t match the challenge''s start.';
  end if;
  update public.challenges set start_day = p_day where id = p_challenge_id;
  -- Days recorded before the fix that no longer belong.
  delete from public.progress_snapshots ps
    where ps.challenge_id = p_challenge_id
      and (ps.day < p_day or ps.day > p_day + c.duration_days - 1);
  delete from public.seventyfive_checkins sc
    where sc.challenge_id = p_challenge_id
      and (sc.day < p_day or sc.day > p_day + c.duration_days - 1);
  delete from public.bingo_progress bp
    where bp.challenge_id = p_challenge_id
      and (bp.workout_day < p_day or bp.workout_day > p_day + c.duration_days - 1);
  delete from public.checklist_checkins ck
    where ck.challenge_id = p_challenge_id
      and (ck.day < p_day or ck.day > p_day + c.duration_days - 1);
end;
$$;

revoke execute on function public.set_challenge_start_day(uuid, date) from public, anon;
grant execute on function public.set_challenge_start_day(uuid, date) to authenticated;
