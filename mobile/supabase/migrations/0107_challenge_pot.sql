-- Hound: challenge pots, and Bones for the top 3 in a global challenge.
--
-- 1. Pots, for Step Race and Tic-Tac-Go (not global ones):
--    - The creator sets an entry: 10, 25, 50 or 100 Bones
--      (set_challenge_pot, right after creating it).
--    - Joining the pot is optional. Anyone in the challenge can put the
--      entry in until a day after it starts (join_challenge_pot); people
--      without Bones still play the challenge.
--    - Only Bones earned through play can go in: your lifetime earned
--      Bones (bones_earned_total) has to cover this entry plus the pots
--      you're already in that haven't settled. Bought Bones don't count.
--    - When the challenge settles:
--        Step Race    the pot player with the most steps takes the pot;
--                     a tie splits it.
--        Tic-Tac-Go   the winner takes it if they're in the pot.
--      Everyone gets their entry back when there's no winner in the pot
--      (a draw, a winner who isn't in it, fewer than 2 in the pot, or the
--      challenge closing with no payout).
--    - Winnings go to bones_balance only: they came from other players,
--      not from Hound (like Bounties, 0102).
--
-- 2. Global challenges can pay the top 3 from Hound. The admin sets the
--    Bones for 1st, 2nd and 3rd when publishing it (set_global_prizes;
--    the app suggests 100, 50 and 25, and 0 means no prize for a place).
--    A global challenge without prizes, including ones already running,
--    pays no places. Paid to bones_balance and bones_earned_total like
--    any settlement payout. Ties share a place. Places only go to someone
--    with something to show for it.
--      Step Race, Distance   total steps (or miles, for a miles goal)
--      Daily Streak          finishing the streak first, then steps
--      Bingo                 squares filled, then steps
--      75 Day                no places
--
-- Both run once a challenge's settlement commits (challenges_after_settle,
-- a deferred trigger, so the settlement's own results are there to read).
-- A failure is logged and skipped, never blocking the settlement.
--
-- Run this once, after 0001-0106, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.challenges
  add column pot_bones integer check (pot_bones in (10, 25, 50, 100)),
  add column pot_settled_at timestamptz,
  add column places_paid_at timestamptz,
  -- Global challenges only: Bones for 1st, 2nd and 3rd place.
  add column prize_bones integer[] check (
    prize_bones is null or (array_length(prize_bones, 1) = 3 and 0 <= all (prize_bones) and 1000 >= all (prize_bones))
  );

create table public.challenge_pot_entries (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bones integer not null check (bones > 0),
  -- What it paid out: winnings, or the entry back on a refund.
  paid_out integer,
  created_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index challenge_pot_entries_user on public.challenge_pot_entries (user_id);

alter table public.challenge_pot_entries enable row level security;

-- Everyone in the challenge sees who's in its pot.
create policy "Members can view their challenge's pot"
  on public.challenge_pot_entries for select to authenticated
  using (exists (
    select 1 from public.challenge_participants cp
    where cp.challenge_id = challenge_pot_entries.challenge_id and cp.user_id = auth.uid()
  ));

revoke all on public.challenge_pot_entries from anon;
revoke insert, update, delete on public.challenge_pot_entries from authenticated;

-- The creator sets the entry, before anyone is in the pot.
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
  if c.is_global or c.kind::text not in ('steps', 'tictacgo') then
    raise exception 'Pots are for Step Race and Tic-Tac-Go.';
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

create or replace function public.join_challenge_pot(p_challenge_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
  p public.profiles;
  staked integer;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  if not found or c.pot_bones is null then
    raise exception 'This challenge has no pot.';
  end if;
  if not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'Join the challenge first.';
  end if;
  if c.score_settled_at is not null or now() > least(c.starts_at + interval '1 day', c.ends_at) then
    raise exception 'The pot closed a day after the challenge started.';
  end if;
  if exists (select 1 from public.challenge_pot_entries e where e.challenge_id = p_challenge_id and e.user_id = me) then
    raise exception 'You''re already in the pot.';
  end if;

  select * into p from public.profiles x where x.id = me for update;
  if p.bones_balance < c.pot_bones then
    raise exception 'Not enough Bones: the pot entry is %.', c.pot_bones;
  end if;
  select coalesce(sum(e.bones), 0) into staked
  from public.challenge_pot_entries e
  join public.challenges x on x.id = e.challenge_id
  where e.user_id = me and x.pot_settled_at is null;
  if p.bones_earned_total < staked + c.pot_bones then
    if staked > 0 then
      raise exception 'Only Bones you''ve earned by playing can go in a pot, and yours are already in other pots.';
    end if;
    raise exception 'Only Bones you''ve earned by playing can go in a pot. Bought Bones can''t.';
  end if;

  update public.profiles x set bones_balance = x.bones_balance - c.pot_bones where x.id = me;
  insert into public.challenge_pot_entries (challenge_id, user_id, bones) values (p_challenge_id, me, c.pot_bones);
  return c.pot_bones;
end;
$$;

revoke execute on function public.join_challenge_pot(uuid) from public, anon;
grant execute on function public.join_challenge_pot(uuid) to authenticated;

-- What the challenge page shows: the entry, who's in, and how it ended.
create or replace function public.challenge_pot(p_challenge_id uuid)
returns table (
  pot_bones integer,
  total integer,
  players uuid[],
  i_am_in boolean,
  open boolean,
  settled boolean,
  winners uuid[],
  refunded boolean
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  if not exists (
    select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = auth.uid()
  ) then
    raise exception 'Join the challenge first.';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id;
  return query select
    c.pot_bones,
    coalesce((select sum(e.bones)::integer from public.challenge_pot_entries e where e.challenge_id = p_challenge_id), 0),
    coalesce((select array_agg(e.user_id order by e.created_at) from public.challenge_pot_entries e where e.challenge_id = p_challenge_id), '{}'),
    exists (select 1 from public.challenge_pot_entries e where e.challenge_id = p_challenge_id and e.user_id = auth.uid()),
    c.pot_bones is not null and c.score_settled_at is null and now() <= least(c.starts_at + interval '1 day', c.ends_at),
    c.pot_settled_at is not null,
    coalesce((select array_agg(e.user_id) from public.challenge_pot_entries e
              where e.challenge_id = p_challenge_id and e.paid_out > e.bones), '{}'),
    c.pot_settled_at is not null and not exists (
      select 1 from public.challenge_pot_entries e where e.challenge_id = p_challenge_id and e.paid_out is distinct from e.bones);
end;
$$;

revoke execute on function public.challenge_pot(uuid) from public, anon;
grant execute on function public.challenge_pot(uuid) to authenticated;

-- An admin sets a global challenge's prizes (0 for no prize at a place).
create or replace function public.set_global_prizes(p_challenge_id uuid, p_first integer, p_second integer, p_third integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  c public.challenges;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  select * into c from public.challenges x where x.id = p_challenge_id for update;
  if not found or not c.is_global then
    raise exception 'That isn''t a global challenge.';
  end if;
  if c.places_paid_at is not null then
    raise exception 'Its places have already been paid.';
  end if;
  if least(p_first, p_second, p_third) < 0 or greatest(p_first, p_second, p_third) > 1000 then
    raise exception 'Prizes are 0 to 1,000 Bones.';
  end if;
  update public.challenges x
    set prize_bones = case when coalesce(p_first, 0) + coalesce(p_second, 0) + coalesce(p_third, 0) = 0 then null
                           else array[coalesce(p_first, 0), coalesce(p_second, 0), coalesce(p_third, 0)] end
    where x.id = p_challenge_id;
end;
$$;

revoke execute on function public.set_global_prizes(uuid, integer, integer, integer) from public, anon;
grant execute on function public.set_global_prizes(uuid, integer, integer, integer) to authenticated;

-- Pays out (or refunds) a settled challenge's pot.
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

-- Pays a settled global challenge's top 3.
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

create or replace function public.challenges_after_settle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  begin
    perform public.settle_challenge_pot(new.id);
    perform public.pay_global_places(new.id);
  exception when others then
    raise warning 'challenges_after_settle: % failed: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.challenges_after_settle() from public, anon, authenticated;

drop trigger if exists challenges_after_settle on public.challenges;
create constraint trigger challenges_after_settle
  after update of score_settled_at on public.challenges
  deferrable initially deferred
  for each row
  when (old.score_settled_at is null and new.score_settled_at is not null)
  execute procedure public.challenges_after_settle();

-- Undo, if needed (refund open pots first):
--   update public.profiles p set bones_balance = p.bones_balance + e.bones
--     from public.challenge_pot_entries e join public.challenges c on c.id = e.challenge_id
--     where c.pot_settled_at is null and p.id = e.user_id;
--   drop trigger challenges_after_settle on public.challenges;
--   drop function public.challenges_after_settle();
--   drop function public.pay_global_places(uuid);
--   drop function public.settle_challenge_pot(uuid);
--   drop function public.set_global_prizes(uuid, integer, integer, integer);
--   drop function public.challenge_pot(uuid);
--   drop function public.join_challenge_pot(uuid);
--   drop function public.set_challenge_pot(uuid, integer);
--   drop table public.challenge_pot_entries;
--   alter table public.challenges drop column pot_bones, drop column pot_settled_at,
--     drop column places_paid_at, drop column prize_bones;
