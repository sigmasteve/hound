-- Hound: Bone Dig. Once a day, after every daily goal is done (a goal
-- day, 0099), dig up a small free surprise.
--
--   What a dig turns up (the odds are in Help, too):
--     5 Bones    35%
--     10 Bones   25%
--     20 Bones   10%
--     50 Bones    3%
--     a piece    27%  toward the next Dig item in the Locker
--
--   Pieces unlock three Dig items, in order, that can't be bought or
--   reached by leveling: the Fossil Ring at 5 pieces, the Dig Site
--   background at 10 and the Bone icon at 15. Once you have all
--   three, a piece is worth 25 Bones instead.
--
--   Digging is free and can't be bought, so the luck in it isn't
--   gambling. Bones go to bones_balance, like a goal day's.
--
--   Dig items are owned through cosmetic_purchases, like shop items, so
--   equip_cosmetic needs no change. They have neither unlock_xp nor
--   cost_bones, so purchase_cosmetic already refuses them.
--
-- Run this once, after 0001-0102, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.cosmetic_items add column dig_pieces integer check (dig_pieces > 0);
alter table public.cosmetic_items drop constraint cosmetic_items_unlock_xor_price;
alter table public.cosmetic_items add constraint cosmetic_items_one_way_to_get
  check (num_nonnulls(unlock_xp, cost_bones, dig_pieces) = 1);

insert into public.cosmetic_items (id, slot, name, dig_pieces) values
  ('frame_fossil', 'frame', 'Fossil Ring', 5),
  ('bg_dig_site', 'background', 'Dig Site', 10),
  ('icon_bone', 'icon', 'Bone', 15);

create table public.bone_digs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  prize text not null check (prize in ('bones', 'piece')),
  bones integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.bone_digs enable row level security;

create policy "Users can view their own digs"
  on public.bone_digs for select to authenticated
  using (user_id = auth.uid());

revoke all on public.bone_digs from anon;
revoke insert, update, delete on public.bone_digs from authenticated;

-- One dig for p_local_date (the phone's own date, within a day of UTC's),
-- once that day is a goal day.
create or replace function public.dig_bone(p_local_date date)
returns table (prize text, bones integer, pieces integer, unlocked_item_id text)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
  roll double precision := random();
  got_prize text;
  got_bones integer := 0;
  have integer;
  unlocked text;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if not exists (select 1 from public.goal_streaks g where g.user_id = me and g.last_hit_on >= p_local_date) then
    raise exception 'Finish today''s goals first.';
  end if;

  -- Locks this user's row so two digs at once count pieces right.
  perform 1 from public.profiles p where p.id = me for update;
  if exists (select 1 from public.bone_digs d where d.user_id = me and d.day = p_local_date) then
    raise exception 'You''ve already dug today. Come back tomorrow.';
  end if;

  if roll < 0.35 then
    got_prize := 'bones'; got_bones := 5;
  elsif roll < 0.60 then
    got_prize := 'bones'; got_bones := 10;
  elsif roll < 0.70 then
    got_prize := 'bones'; got_bones := 20;
  elsif roll < 0.73 then
    got_prize := 'bones'; got_bones := 50;
  else
    got_prize := 'piece';
  end if;

  select count(*) into have from public.bone_digs d where d.user_id = me and d.prize = 'piece';
  -- Every Dig item already found: a piece is worth 25 Bones instead.
  if got_prize = 'piece' and have >= (select max(c.dig_pieces) from public.cosmetic_items c) then
    got_prize := 'bones'; got_bones := 25;
  end if;

  insert into public.bone_digs (user_id, day, prize, bones) values (me, p_local_date, got_prize, got_bones);

  if got_prize = 'piece' then
    have := have + 1;
    select c.id into unlocked from public.cosmetic_items c where c.dig_pieces = have;
    if unlocked is not null then
      insert into public.cosmetic_purchases (user_id, item_id) values (me, unlocked) on conflict do nothing;
    end if;
  end if;

  if got_bones > 0 then
    update public.profiles p set bones_balance = p.bones_balance + got_bones where p.id = me;
    insert into public.activity_events (user_id, kind, score_points, xp_points, bones_points)
      values (me, 'bone_dig', 0, 0, got_bones);
  end if;

  return query select got_prize, got_bones, have, unlocked;
end;
$$;

revoke execute on function public.dig_bone(date) from public, anon;
grant execute on function public.dig_bone(date) to authenticated;

-- Today's dig, if there's been one, and how many pieces you have.
create or replace function public.my_bone_dig(p_local_date date)
returns table (dug_today boolean, prize text, bones integer, pieces integer)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  d public.bone_digs;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  select * into d from public.bone_digs x where x.user_id = me and x.day = p_local_date;
  return query select
    d.user_id is not null,
    d.prize,
    coalesce(d.bones, 0),
    (select count(*)::integer from public.bone_digs x where x.user_id = me and x.prize = 'piece');
end;
$$;

revoke execute on function public.my_bone_dig(date) from public, anon;
grant execute on function public.my_bone_dig(date) to authenticated;

-- Undo, if needed:
--   drop function public.my_bone_dig(date);
--   drop function public.dig_bone(date);
--   drop table public.bone_digs;
--   delete from public.cosmetic_purchases where item_id in ('frame_fossil', 'bg_dig_site', 'icon_bone');
--   (and set equipped_* back to null for anyone wearing one)
--   delete from public.cosmetic_items where dig_pieces is not null;
--   alter table public.cosmetic_items drop constraint cosmetic_items_one_way_to_get;
--   alter table public.cosmetic_items add constraint cosmetic_items_unlock_xor_price
--     check ((unlock_xp is not null) <> (cost_bones is not null));
--   alter table public.cosmetic_items drop column dig_pieces;
