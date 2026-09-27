-- Hound: the Bones shop — Phase 3 of the gamification workshop (see
-- GitHub discussion). Closes the loop the original ask described: "some
-- things can just take more gameplay [Phase 2's level-unlocked frames/
-- backgrounds, already shipped], and some can be bought" — this is the
-- "can be bought" half. A new soft currency (Bones), earned automatically
-- from the same challenge settlements that already award Hound Score/XP,
-- spendable only on a small new set of shop-only cosmetics that no level
-- ever unlocks.
--
-- Earning is deliberately folded into settle_challenge_score rather than
-- a separate function: every settlement already inserts one
-- activity_events row and updates profiles in one place, so Bones just
-- rides along as a third number on the same ledger row, same "auditable
-- ledger, not a bare counter" reasoning 0058 already established. Two
-- sources, both flat and modest by design (this is a soft-currency
-- shop, not a grind treadmill):
--   - a flat trickle per settled challenge, regardless of kind/outcome
--   - a level-up bonus, awarded exactly once per level actually crossed
--     by that settlement's own XP award (multi-level jumps in one
--     settlement are handled correctly, not silently dropped)
--
-- level_for_xp mirrors src/challenges/leveling.ts's own xpForLevel loop
-- exactly (same "two implementations, kept in sync by hand" shape
-- 0059's cosmetic_items<->catalog.ts pairing already uses) — a plain
-- integer loop, not sqrt(), so there's no floating-point edge case to
-- worry about at a level boundary.
--
-- This is entirely additive: two new columns on existing tables, one
-- extended (already-nullable-safe) column on cosmetic_items, two new
-- tables, one new function, and settle_challenge_score/equip_cosmetic
-- are replaced with strictly additive logic — every existing branch's
-- score/xp amounts are byte-for-byte unchanged. An app that gets this
-- migration before its own matching client update (or the reverse) sees
-- no behavior change until both are in place, same guarantee 0058/0059
-- already made.
--
-- Run this once, in the SQL Editor.

alter table public.profiles
  add column bones_balance int not null default 0;

alter table public.activity_events
  add column bones_points int not null default 0;

-- Nullable, defaults to meaning "Bones" everywhere the currency name is
-- shown — same "null is the old-only/default meaning" convention
-- distance_goal_unit and equipped_frame_id already use. There's no
-- in-app way to set this yet (same "no in-app way to do this directly"
-- shape is_admin and org creation already have) — a fast-follow if an
-- org actually wants to rename it, not built preemptively.
alter table public.organizations
  add column currency_name text;

create or replace function public.level_for_xp(p_xp int)
returns int
language plpgsql
immutable
as $$
declare
  lvl bigint := 0;
begin
  while 50::bigint * (lvl + 1) * (lvl + 1) <= p_xp loop
    lvl := lvl + 1;
  end loop;
  return lvl::int;
end;
$$;

-- A shop item has a price instead of a level gate — exactly one of
-- unlock_xp/cost_bones is ever set per row, enforced below. Kept in the
-- same table (rather than a separate shop_items table) so
-- profiles.equipped_frame_id/equipped_background_id's existing foreign
-- key and src/cosmetics/catalog.ts's existing frameById/backgroundById
-- lookups keep working unchanged for a shop item exactly as they do for
-- a leveled one.
alter table public.cosmetic_items
  alter column unlock_xp drop not null,
  add column cost_bones int;

alter table public.cosmetic_items
  add constraint cosmetic_items_unlock_xor_price
  check ((unlock_xp is not null) <> (cost_bones is not null));

insert into public.cosmetic_items (id, slot, name, cost_bones) values
  ('frame_neon', 'frame', 'Neon Ring', 250),
  ('frame_shadow', 'frame', 'Shadow Ring', 600),
  ('bg_galaxy', 'background', 'Galaxy', 400),
  ('bg_lava', 'background', 'Lava', 900);

-- An ownership ledger, not a balance — once bought, always owned, same
-- "append-only record of a real event" shape activity_events already is.
-- No insert/update/delete policy at all: every write goes through
-- purchase_cosmetic below.
create table public.cosmetic_purchases (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.cosmetic_items (id),
  purchased_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.cosmetic_purchases enable row level security;

create policy "Users can view their own purchases"
  on public.cosmetic_purchases for select
  to authenticated
  using (user_id = auth.uid());

-- Re-derives the price from the catalog and the caller's own real
-- balance server-side — same "server re-derives, never trusts the
-- client" principle equip_cosmetic (0059) and settle_challenge_score
-- (0058) already follow, so a stale local bones_balance can't let
-- someone buy something they can't actually afford.
--
-- `for update` on the caller's own profiles row makes two concurrent
-- purchase attempts (e.g. a double-tap) serialize rather than both
-- reading the same starting balance and double-spending it — same
-- anti-race shape as settle_challenge_score's own `for update` on the
-- challenges row.
create or replace function public.purchase_cosmetic(p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item public.cosmetic_items%rowtype;
  my_balance int;
begin
  select * into item from public.cosmetic_items where id = p_item_id;
  if not found then
    raise exception 'That item doesn''t exist.';
  end if;
  if item.cost_bones is null then
    raise exception 'That item isn''t sold in the shop.';
  end if;
  if exists (select 1 from public.cosmetic_purchases where user_id = caller and item_id = p_item_id) then
    raise exception 'You already own that.';
  end if;

  select bones_balance into my_balance from public.profiles where id = caller for update;
  if coalesce(my_balance, 0) < item.cost_bones then
    raise exception 'Not enough Bones.';
  end if;

  update public.profiles set bones_balance = bones_balance - item.cost_bones where id = caller;
  insert into public.cosmetic_purchases (user_id, item_id) values (caller, p_item_id);
end;
$$;

grant execute on function public.purchase_cosmetic(text) to authenticated;

-- Same signature and null-un-equips-always shape as 0059's original —
-- the only change is the branch inside: a shop item (cost_bones set)
-- checks ownership in cosmetic_purchases instead of an XP threshold.
create or replace function public.equip_cosmetic(p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item public.cosmetic_items%rowtype;
  my_xp int;
begin
  if p_slot not in ('frame', 'background') then
    raise exception 'Unknown cosmetic slot.';
  end if;

  if p_item_id is not null then
    select * into item from public.cosmetic_items where id = p_item_id and slot = p_slot;
    if not found then
      raise exception 'That item doesn''t exist for this slot.';
    end if;

    if item.unlock_xp is not null then
      select xp_total into my_xp from public.profiles where id = caller;
      if coalesce(my_xp, 0) < item.unlock_xp then
        raise exception 'You haven''t unlocked that yet.';
      end if;
    else
      if not exists (select 1 from public.cosmetic_purchases where user_id = caller and item_id = p_item_id) then
        raise exception 'You need to buy that first.';
      end if;
    end if;
  end if;

  if p_slot = 'frame' then
    update public.profiles set equipped_frame_id = p_item_id where id = caller;
  else
    update public.profiles set equipped_background_id = p_item_id where id = caller;
  end if;
end;
$$;

grant execute on function public.equip_cosmetic(text, text) to authenticated;

-- Same conclusion-detection logic as 0058, byte-for-byte — only the
-- awarding half changes: each branch now only inserts into
-- activity_events (score/xp amounts unchanged, plus a flat bones
-- trickle), and a single unified pass at the end applies hound_score,
-- xp_total, AND bones_balance together, including the level-up bonus.
-- Computing the bonus once here (rather than duplicating an "old xp,
-- new xp, level_for_xp both, diff" lookup in all eight branches above)
-- is the whole reason this is one pass instead of inline updates.
create or replace function public.settle_challenge_score(p_challenge_id uuid)
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
    with survival as (
      select cp.user_id,
        not exists (
          select 1
          from generate_series(
            greatest(cp.joined_at, c.starts_at)::timestamp,
            (c.ends_at - interval '1 day')::timestamp,
            interval '1 day'
          ) d
          left join public.progress_snapshots ps
            on ps.challenge_id = p_challenge_id and ps.user_id = cp.user_id and ps.day = to_char(d, 'YYYY-MM-DD')
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
        bones_balance = p.bones_balance + pu.bones_points + (pu.new_level - pu.old_level) * bones_per_level
    from per_user pu
    where p.id = pu.user_id;
end;
$$;

grant execute on function public.settle_challenge_score(uuid) to authenticated;
