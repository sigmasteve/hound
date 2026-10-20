-- Hound: Bingo plays like real bingo.
--
-- A new card type, 'hound', for every new Bingo challenge. Bingo games
-- already running keep their old 9-square card and old scoring.
--
--   - The card's size follows the challenge's length: 3x3 for a week or
--     less, 4x4 (H-U-N-T) for 8 to 20 days, 5x5 (H-O-U-N-D) for 21 days
--     or more, with a FREE square in the middle of the N column.
--   - Everyone gets the same squares, shuffled within each column, so
--     no two cards line up the same way (bingo_cards, made when someone
--     joins).
--   - No caller: a square is marked by doing it. The phone decides which
--     square a workout or a day earns (src/challenges/houndBingo.ts) and
--     writes it to bingo_progress, as before. One workout marks one
--     square, and one day's steps mark one step square.
--   - A row, column or diagonal is a BINGO. The first one is noted the
--     moment Hound sees it (bingo_cards.bingo_at), and the order those
--     come in decides 1st, 2nd and 3rd. Play goes on for the full card
--     (blackout_at).
--   - Bingo can have a pot (0107): the first BINGO among the players in
--     the pot takes it; if nobody gets one, the most squares does.
--
-- Settlement (hound cards only):
--      full card   40 points (the Blackout achievement, as before)
--      1st BINGO   35
--      2nd BINGO   30
--      3rd BINGO   25
--      any BINGO   20
--      no BINGO    1 a square, up to 15
--   XP is 25 plus 1 a square, as before. Global prizes go in BINGO order,
--   then by squares.
--
-- Run this once, after 0001-0116, in the SQL Editor, before publishing
-- the app update that goes with it.

-- ── The card type and its squares ────────────────────────────────────

alter table public.challenges drop constraint if exists challenges_bingo_card_type_check;
alter table public.challenges add constraint challenges_bingo_card_type_check
  check (bingo_card_type in ('variety', 'strength', 'sports', 'hound'));

alter table public.bingo_progress drop constraint bingo_progress_category_check;
alter table public.bingo_progress add constraint bingo_progress_category_check check (
  category in (
    -- Variety
    'run', 'walk_hike', 'cycling', 'swim', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports', 'other',
    -- Strength
    'push', 'pull', 'legs', 'core', 'upper', 'lower', 'full_body', 'cardio_strength',
    -- Sports
    'basketball', 'soccer', 'tennis', 'golf', 'baseball_softball', 'volleyball', 'hockey', 'combat_sports',
    -- Hound cards (also run, swim, strength, yoga_pilates, hiit_cardio, sports)
    'steps_8k', 'steps_10k', 'steps_12k', 'steps_15k', 'steps_20k',
    'outdoor_walk', 'hike', 'bike', 'miles_3', 'run_walk_2mi',
    'before_7', 'before_9', 'lunch', 'after_7pm', 'weekend',
    'long_30', 'long_45', 'two_a_day', 'three_in_row', 'all_goals'
  )
);

-- 3x3 for a week or less, 4x4 up to 20 days, 5x5 after that.
create or replace function public.hound_bingo_size(p_days integer)
returns integer
language sql
immutable
as $$
  select case when p_days <= 7 then 3 when p_days <= 20 then 4 else 5 end;
$$;

-- A new card: each column's squares in a random order, laid out row by
-- row (index 1 is the top-left). Kept in sync by hand with
-- houndBingo.ts's CARD_COLUMNS.
create or replace function public.hound_bingo_new_card(p_size integer)
returns text[]
language plpgsql
volatile
as $$
declare
  cols jsonb := case p_size
    when 3 then '[["steps_10k", "strength", "before_9", "yoga_pilates", "weekend", "run_walk_2mi", "all_goals", "long_30", "hiit_cardio"]]'
    when 4 then '[["steps_8k", "steps_10k", "steps_12k", "steps_15k"],
                  ["before_9", "lunch", "after_7pm", "weekend"],
                  ["long_45", "two_a_day", "three_in_row", "all_goals"],
                  ["run", "strength", "yoga_pilates", "hiit_cardio"]]'
    else '[["steps_8k", "steps_10k", "steps_12k", "steps_15k", "steps_20k"],
           ["run", "outdoor_walk", "hike", "bike", "miles_3"],
           ["before_7", "before_9", "lunch", "after_7pm", "weekend"],
           ["long_45", "two_a_day", "three_in_row", "all_goals"],
           ["strength", "yoga_pilates", "hiit_cardio", "sports", "swim"]]'
  end::jsonb;
  card text[] := array_fill(null::text, array[p_size * p_size]);
  pool text[];
  i integer;
begin
  -- No columns on a 3x3: the whole card is one shuffle.
  if p_size = 3 then
    select array_agg(s order by random()) into pool from jsonb_array_elements_text(cols -> 0) s;
    return pool;
  end if;
  for c in 0 .. p_size - 1 loop
    select array_agg(s order by random()) into pool from jsonb_array_elements_text(cols -> c) s;
    i := 1;
    for r in 0 .. p_size - 1 loop
      if p_size = 5 and c = 3 and r = 2 then
        card[r * p_size + c + 1] := 'free';
      else
        card[r * p_size + c + 1] := pool[i];
        i := i + 1;
      end if;
    end loop;
  end loop;
  return card;
end;
$$;

-- How many rows, columns and diagonals are all marked (FREE counts).
create or replace function public.hound_bingo_lines(p_card text[], p_marked text[])
returns integer
language plpgsql
immutable
as $$
declare
  n integer := round(sqrt(coalesce(array_length(p_card, 1), 0)))::integer;
  marked text[] := coalesce(p_marked, '{}') || array['free'];
  lines integer := 0;
  row_ok boolean;
  col_ok boolean;
  diag_ok boolean := true;
  anti_ok boolean := true;
begin
  if n = 0 then
    return 0;
  end if;
  for a in 0 .. n - 1 loop
    row_ok := true;
    col_ok := true;
    for b in 0 .. n - 1 loop
      row_ok := row_ok and p_card[a * n + b + 1] = any (marked);
      col_ok := col_ok and p_card[b * n + a + 1] = any (marked);
    end loop;
    lines := lines + row_ok::integer + col_ok::integer;
    diag_ok := diag_ok and p_card[a * n + a + 1] = any (marked);
    anti_ok := anti_ok and p_card[a * n + (n - 1 - a) + 1] = any (marked);
  end loop;
  return lines + diag_ok::integer + anti_ok::integer;
end;
$$;

revoke execute on function public.hound_bingo_size(integer) from public, anon, authenticated;
revoke execute on function public.hound_bingo_new_card(integer) from public, anon, authenticated;
revoke execute on function public.hound_bingo_lines(text[], text[]) from public, anon, authenticated;

-- ── Cards ────────────────────────────────────────────────────────────

create table public.bingo_cards (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Row by row, top-left first; 'free' is the FREE square.
  squares text[] not null,
  -- When Hound first saw a full row, column or diagonal, and the full card.
  bingo_at timestamptz,
  blackout_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index bingo_cards_user_id on public.bingo_cards (user_id);

alter table public.bingo_cards enable row level security;

-- Everyone in the challenge sees every card, for "1 away" on the board.
create policy "Participants can view bingo cards"
  on public.bingo_cards for select to authenticated
  using (exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = bingo_cards.challenge_id and cp.user_id = auth.uid()
  ));

revoke all on public.bingo_cards from anon;
revoke insert, update, delete on public.bingo_cards from authenticated;

-- Deals a card to someone who joins a hound Bingo challenge.
create or replace function public.bingo_card_on_join()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges x where x.id = new.challenge_id;
  if found and c.kind::text = 'bingo' and c.bingo_card_type = 'hound' then
    insert into public.bingo_cards (challenge_id, user_id, squares)
      values (new.challenge_id, new.user_id, public.hound_bingo_new_card(public.hound_bingo_size(c.duration_days)))
      on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.bingo_card_on_join() from public, anon, authenticated;

create trigger bingo_card_on_join
  after insert on public.challenge_participants
  for each row execute procedure public.bingo_card_on_join();

-- The caller's card, dealt now if they don't have one yet (the app
-- calls this before marking anything).
create or replace function public.my_bingo_card(p_challenge_id uuid)
returns text[]
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  card text[];
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.kind::text <> 'bingo' or c.bingo_card_type is distinct from 'hound' then
    raise exception 'That challenge doesn''t deal Bingo cards.';
  end if;
  if not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me
  ) then
    raise exception 'Join the challenge first.';
  end if;
  insert into public.bingo_cards (challenge_id, user_id, squares)
    values (p_challenge_id, me, public.hound_bingo_new_card(public.hound_bingo_size(c.duration_days)))
    on conflict do nothing;
  select b.squares into card from public.bingo_cards b where b.challenge_id = p_challenge_id and b.user_id = me;
  return card;
end;
$$;

revoke execute on function public.my_bingo_card(uuid) from public, anon;
grant execute on function public.my_bingo_card(uuid) to authenticated;

-- Notes the first BINGO and the full card the moment a mark makes them.
-- Never cleared: a BINGO stays a BINGO, even if a mark later moves.
create or replace function public.bingo_progress_check_lines()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  card public.bingo_cards;
  marked text[];
begin
  select * into card from public.bingo_cards b
    where b.challenge_id = new.challenge_id and b.user_id = new.user_id
    for update;
  if not found or (card.bingo_at is not null and card.blackout_at is not null) then
    return null;
  end if;
  if exists (select 1 from public.challenges x where x.id = new.challenge_id and x.score_settled_at is not null) then
    return null;
  end if;
  select coalesce(array_agg(bp.category), '{}') into marked
    from public.bingo_progress bp
    where bp.challenge_id = new.challenge_id and bp.user_id = new.user_id;
  update public.bingo_cards b
    set bingo_at = coalesce(b.bingo_at, case when public.hound_bingo_lines(card.squares, marked) > 0 then now() end),
        blackout_at = coalesce(b.blackout_at, case when card.squares <@ (marked || array['free']) then now() end)
    where b.challenge_id = new.challenge_id and b.user_id = new.user_id;
  return null;
end;
$$;

revoke execute on function public.bingo_progress_check_lines() from public, anon, authenticated;

create trigger bingo_progress_check_lines
  after insert or update on public.bingo_progress
  for each row execute procedure public.bingo_progress_check_lines();

-- ── Settlement ───────────────────────────────────────────────────────
--
-- 0087's settlement (renamed _core in 0095), with the hound card's own
-- scoring added to the Bingo branch. Everything else is unchanged.

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


-- ── Pots for Bingo ───────────────────────────────────────────────────
--
-- 0107's pot functions, with Bingo added.

create or replace function public.set_challenge_pot(p_challenge_id uuid, p_bones integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or c.created_by is distinct from auth.uid() then
    raise exception 'Only the challenge''s creator can set its pot.';
  end if;
  if c.is_global or not (c.kind::text in ('steps', 'tictacgo') or (c.kind::text = 'bingo' and c.bingo_card_type = 'hound')) then
    raise exception 'Pots are for Step Race, Tic-Tac-Go and Bingo.';
  end if;
  if p_bones is not null and p_bones not in (10, 25, 50, 100) then
    raise exception 'A pot entry is 10, 25, 50 or 100 Bones.';
  end if;
  if exists (select 1 from public.challenge_pot_entries e where e.challenge_id = p_challenge_id) then
    raise exception 'Someone''s already in the pot.';
  end if;
  update public.challenges x set pot_bones = p_bones where x.id = p_challenge_id;
end;
$$;


revoke execute on function public.set_challenge_pot(uuid, integer) from public, anon;
grant execute on function public.set_challenge_pot(uuid, integer) to authenticated;

create or replace function public.settle_challenge_pot(p_challenge_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
  ttt public.tictacgo_games;
  total integer;
  entrants integer;
  winners uuid[];
  share integer;
  paid_results boolean;
begin
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or c.pot_settled_at is not null or c.score_settled_at is null then
    return;
  end if;
  update public.challenges x set pot_settled_at = now() where x.id = p_challenge_id;

  select coalesce(sum(e.bones), 0)::integer, count(*)::integer into total, entrants
  from public.challenge_pot_entries e where e.challenge_id = p_challenge_id;
  if entrants = 0 then
    return;
  end if;

  -- Settled with results, or closed with no payout?
  paid_results := exists (
    select 1 from public.activity_events a
    where a.challenge_id = p_challenge_id and (a.kind like '%\_result' or a.kind = 'participation'));

  if paid_results and entrants >= 2 and c.kind::text = 'steps' then
    with totals as (
      select e.user_id, coalesce(sum(ps.steps), 0) as steps
      from public.challenge_pot_entries e
      join public.challenge_participants cp on cp.challenge_id = e.challenge_id and cp.user_id = e.user_id
      left join public.progress_snapshots ps on ps.challenge_id = e.challenge_id and ps.user_id = e.user_id
      where e.challenge_id = p_challenge_id
      group by e.user_id
    )
    select array_agg(t.user_id) into winners
    from totals t
    where t.steps > 0 and t.steps = (select max(steps) from totals);
  elsif paid_results and entrants >= 2 and c.kind::text = 'tictacgo' then
    select * into ttt from public.tictacgo_games g where g.challenge_id = p_challenge_id;
    if ttt.status = 'won' and exists (
      select 1 from public.challenge_pot_entries e where e.challenge_id = p_challenge_id and e.user_id = ttt.winner_user_id
    ) then
      winners := array[ttt.winner_user_id];
    end if;
  elsif paid_results and entrants >= 2 and c.kind::text = 'bingo' then
    -- The first BINGO in the pot; with none, the most squares.
    with st as (
      select e.user_id, bc.bingo_at,
        (select count(*) from public.bingo_progress bp
          where bp.challenge_id = e.challenge_id and bp.user_id = e.user_id and bp.category = any (bc.squares)) as n
      from public.challenge_pot_entries e
      join public.challenge_participants cp on cp.challenge_id = e.challenge_id and cp.user_id = e.user_id
      left join public.bingo_cards bc on bc.challenge_id = e.challenge_id and bc.user_id = e.user_id
      where e.challenge_id = p_challenge_id
    )
    select array_agg(st.user_id) into winners
    from st
    where case
      when exists (select 1 from st s where s.bingo_at is not null) then st.bingo_at = (select min(s.bingo_at) from st s)
      else st.n > 0 and st.n = (select max(s.n) from st s)
    end;
  end if;

  if winners is null or array_length(winners, 1) is null then
    -- No winner in the pot: everyone's entry back.
    update public.challenge_pot_entries e set paid_out = e.bones where e.challenge_id = p_challenge_id;
    update public.profiles p set bones_balance = p.bones_balance + e.bones
      from public.challenge_pot_entries e
      where e.challenge_id = p_challenge_id and p.id = e.user_id;
    return;
  end if;

  share := total / array_length(winners, 1);
  update public.challenge_pot_entries e
    set paid_out = case when e.user_id = any (winners) then share else 0 end
    where e.challenge_id = p_challenge_id;
  update public.profiles p set bones_balance = p.bones_balance + share where p.id = any (winners);
  insert into public.activity_events (user_id, challenge_id, kind, score_points, xp_points, bones_points)
    select w, p_challenge_id, 'pot_won', 0, 0, share from unnest(winners) w;
end;
$$;


revoke execute on function public.settle_challenge_pot(uuid) from public, anon, authenticated;

-- 0107's global prizes, with hound Bingo placed by BINGO order.
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
  if c.kind::text = 'seventyfive' or c.prize_bones is null then
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

-- Undo, if needed (no hound Bingo challenges can be running):
--   drop trigger bingo_progress_check_lines on public.bingo_progress;
--   drop trigger bingo_card_on_join on public.challenge_participants;
--   drop function public.bingo_progress_check_lines();
--   drop function public.bingo_card_on_join();
--   drop function public.my_bingo_card(uuid);
--   drop table public.bingo_cards;
--   drop function public.hound_bingo_lines(text[], text[]);
--   drop function public.hound_bingo_new_card(integer);
--   drop function public.hound_bingo_size(integer);
--   then run 0107's set_challenge_pot, settle_challenge_pot and
--   pay_global_places, and 0087's settlement renamed to _core, again.
