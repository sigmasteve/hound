-- Hound: the Kennel. Your own hound, who's happy when you hit your goals.
--
--   Mood: happy, okay or sleepy, from your goal days (0099) in the last
--   7 days. A goal day today always makes it happy. A treat (10 Bones,
--   one a day) counts for two extra goal days today.
--
--     score = goal days in the last 7 days + 2 if treated today
--     happy  a goal day today, or a score of 4 or more
--     okay   2 or 3
--     sleepy 0 or 1
--
--   Care style (care_mode), chosen on the Kennel screen:
--     gentle   the default. Nothing to keep up; a lazy week just makes
--              it sleepy.
--     classic  it also has 3 meal hearts. One empties for each day it
--              isn't fed; a meal (10 Bones, once a day) fills one. With
--              no hearts left it's hungry, whatever the goal days say.
--              Nothing else is ever lost, and you can switch back.
--
--   It grows with your rank (the app works out the stage from your XP).
--   Accessories for its neck, head and face are bought with Bones and
--   kept for good.
--
--   Spending comes off bones_balance only, like the Locker shop.
--
-- Run this once, after 0001-0103, in the SQL Editor, before publishing
-- the app update that goes with it.

create table public.kennels (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  name text not null default 'Scout' check (char_length(name) between 1 and 20),
  care_mode text not null default 'gentle' check (care_mode in ('gentle', 'classic')),
  -- The last local day it had a treat or a meal.
  treated_on date,
  -- Classic only: meal hearts as of hearts_on; one empties per day since.
  hearts integer not null default 3 check (hearts between 0 and 3),
  hearts_on date,
  neck_id text,
  head_id text,
  face_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kennels enable row level security;

create policy "Users can view their own kennel"
  on public.kennels for select to authenticated
  using (user_id = auth.uid());

revoke all on public.kennels from anon;
revoke insert, update, delete on public.kennels from authenticated;

create table public.kennel_items (
  id text primary key,
  slot text not null check (slot in ('neck', 'head', 'face')),
  name text not null,
  cost_bones integer not null check (cost_bones > 0)
);

alter table public.kennel_items enable row level security;

create policy "Anyone signed in can browse kennel items"
  on public.kennel_items for select to authenticated
  using (true);

revoke all on public.kennel_items from anon;
revoke insert, update, delete on public.kennel_items from authenticated;

-- src/kennel/kennelItems.ts mirrors these (and draws them).
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('collar_red', 'neck', 'Red Collar', 40),
  ('collar_blue', 'neck', 'Blue Collar', 40),
  ('bandana_purple', 'neck', 'Purple Bandana', 60),
  ('bandana_red', 'neck', 'Red Bandana', 60),
  ('collar_gold', 'neck', 'Gold Collar', 150),
  ('hat_beanie', 'head', 'Beanie', 80),
  ('hat_party', 'head', 'Party Hat', 100),
  ('hat_crown', 'head', 'Crown', 300),
  ('glasses_round', 'face', 'Round Glasses', 90),
  ('glasses_sun', 'face', 'Sunglasses', 120);

create table public.kennel_purchases (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_id text not null references public.kennel_items (id),
  bones integer not null,
  purchased_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.kennel_purchases enable row level security;

create policy "Users can view their own kennel purchases"
  on public.kennel_purchases for select to authenticated
  using (user_id = auth.uid());

revoke all on public.kennel_purchases from anon;
revoke insert, update, delete on public.kennel_purchases from authenticated;

-- Shared by the RPCs below: the caller, with a kennel row made if needed,
-- and p_local_date checked to be within a day of UTC's.
create or replace function public.kennel_caller(p_local_date date)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  utc_today date := (now() at time zone 'utc')::date;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  insert into public.kennels (user_id, hearts_on) values (me, p_local_date) on conflict (user_id) do nothing;
  return me;
end;
$$;

revoke execute on function public.kennel_caller(date) from public, anon, authenticated;

-- Hearts left on p_day: one empties per day since hearts_on.
create or replace function public.kennel_hearts(k public.kennels, p_day date)
returns integer
language sql
immutable
as $$
  select greatest(0, k.hearts - greatest(0, p_day - coalesce(k.hearts_on, p_day)));
$$;

revoke execute on function public.kennel_hearts(public.kennels, date) from public, anon, authenticated;

create or replace function public.my_kennel(p_local_date date)
returns table (
  name text,
  care_mode text,
  mood text,
  goal_days_7 integer,
  goal_day_today boolean,
  treated_today boolean,
  -- Null in gentle care.
  hearts integer,
  neck_id text,
  head_id text,
  face_id text,
  owned text[],
  xp_total integer,
  bones_balance integer
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  k public.kennels;
  days integer;
  today_hit boolean;
  treated boolean;
  h integer;
  score integer;
  m text;
begin
  select * into k from public.kennels x where x.user_id = me;
  select count(*)::integer into days from public.activity_events e
    where e.user_id = me and e.kind = 'goal_day' and e.created_at > now() - interval '7 days';
  today_hit := exists (select 1 from public.goal_streaks g where g.user_id = me and g.last_hit_on >= p_local_date);
  treated := coalesce(k.treated_on >= p_local_date, false);
  h := public.kennel_hearts(k, p_local_date);
  score := least(days, 7) + case when treated then 2 else 0 end;
  m := case
    when k.care_mode = 'classic' and h = 0 then 'hungry'
    when today_hit or score >= 4 then 'happy'
    when score >= 2 then 'okay'
    else 'sleepy'
  end;

  return query select
    k.name, k.care_mode, m, least(days, 7), today_hit, treated,
    case when k.care_mode = 'classic' then h end,
    k.neck_id, k.head_id, k.face_id,
    coalesce((select array_agg(pu.item_id order by pu.item_id) from public.kennel_purchases pu where pu.user_id = me), '{}'),
    p.xp_total, p.bones_balance
  from public.profiles p where p.id = me;
end;
$$;

revoke execute on function public.my_kennel(date) from public, anon;
grant execute on function public.my_kennel(date) to authenticated;

-- Renames the hound and/or changes the care style. Switching to classic
-- starts with full hearts.
create or replace function public.set_kennel(p_local_date date, p_name text, p_care_mode text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  clean text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  if clean is not null and char_length(clean) > 20 then
    raise exception 'Keep the name to 20 characters.';
  end if;
  if p_care_mode is not null and p_care_mode not in ('gentle', 'classic') then
    raise exception 'Unknown care style.';
  end if;
  update public.kennels k
    set name = coalesce(clean, k.name),
        hearts = case when p_care_mode = 'classic' and k.care_mode <> 'classic' then 3 else k.hearts end,
        hearts_on = case when p_care_mode = 'classic' and k.care_mode <> 'classic' then p_local_date else k.hearts_on end,
        care_mode = coalesce(p_care_mode, k.care_mode),
        updated_at = now()
    where k.user_id = me;
end;
$$;

revoke execute on function public.set_kennel(date, text, text) from public, anon;
grant execute on function public.set_kennel(date, text, text) to authenticated;

-- A treat (gentle) or a meal (classic): 10 Bones, once a day. A meal
-- also fills one heart.
create or replace function public.give_treat(p_local_date date)
returns table (hearts integer, bones_balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  price constant integer := 10;
  k public.kennels;
  balance integer;
  h integer;
begin
  select * into k from public.kennels x where x.user_id = me for update;
  if k.treated_on >= p_local_date then
    raise exception 'Already fed today. Back tomorrow.';
  end if;
  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if coalesce(balance, 0) < price then
    raise exception 'Not enough Bones: a treat costs %.', price;
  end if;

  h := least(3, public.kennel_hearts(k, p_local_date) + 1);
  update public.profiles p set bones_balance = p.bones_balance - price where p.id = me;
  update public.kennels x
    set treated_on = p_local_date,
        hearts = case when x.care_mode = 'classic' then h else x.hearts end,
        hearts_on = case when x.care_mode = 'classic' then p_local_date else x.hearts_on end,
        updated_at = now()
    where x.user_id = me;

  return query select case when k.care_mode = 'classic' then h end, balance - price;
end;
$$;

revoke execute on function public.give_treat(date) from public, anon;
grant execute on function public.give_treat(date) to authenticated;

create or replace function public.buy_kennel_item(p_local_date date, p_item_id text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  item public.kennel_items;
  balance integer;
begin
  select * into item from public.kennel_items i where i.id = p_item_id;
  if not found then
    raise exception 'That item doesn''t exist.';
  end if;
  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = me and pu.item_id = p_item_id) then
    raise exception 'You already have that.';
  end if;
  if coalesce(balance, 0) < item.cost_bones then
    raise exception 'Not enough Bones.';
  end if;
  update public.profiles p set bones_balance = p.bones_balance - item.cost_bones where p.id = me;
  insert into public.kennel_purchases (user_id, item_id, bones) values (me, p_item_id, item.cost_bones);
  return balance - item.cost_bones;
end;
$$;

revoke execute on function public.buy_kennel_item(date, text) from public, anon;
grant execute on function public.buy_kennel_item(date, text) to authenticated;

-- Puts an owned item on (or takes the slot's item off with null).
create or replace function public.equip_kennel_item(p_local_date date, p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  if p_slot not in ('neck', 'head', 'face') then
    raise exception 'Unknown slot.';
  end if;
  if p_item_id is not null and not exists (
    select 1 from public.kennel_purchases pu
    join public.kennel_items i on i.id = pu.item_id
    where pu.user_id = me and pu.item_id = p_item_id and i.slot = p_slot
  ) then
    raise exception 'You don''t have that yet.';
  end if;
  update public.kennels k
    set neck_id = case when p_slot = 'neck' then p_item_id else k.neck_id end,
        head_id = case when p_slot = 'head' then p_item_id else k.head_id end,
        face_id = case when p_slot = 'face' then p_item_id else k.face_id end,
        updated_at = now()
    where k.user_id = me;
end;
$$;

revoke execute on function public.equip_kennel_item(date, text, text) from public, anon;
grant execute on function public.equip_kennel_item(date, text, text) to authenticated;

-- Undo, if needed:
--   drop function public.equip_kennel_item(date, text, text);
--   drop function public.buy_kennel_item(date, text);
--   drop function public.give_treat(date);
--   drop function public.set_kennel(date, text, text);
--   drop function public.my_kennel(date);
--   drop function public.kennel_hearts(public.kennels, date);
--   drop function public.kennel_caller(date);
--   drop table public.kennel_purchases;
--   drop table public.kennel_items;
--   drop table public.kennels;
