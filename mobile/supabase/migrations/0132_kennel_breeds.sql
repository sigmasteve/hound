-- Hound: Kennel breeds. Your hound can be a Corgi, a Poodle or a French
-- Bulldog, each a kennel item in a new 'breed' slot for 600 Bones,
-- bought and put on the same way as a coat (buy_kennel_item,
-- equip_kennel_item). Taking it off (null) goes back to the hound. A
-- breed brings its own ears and tail, so the free ears/tail/markings
-- looks don't apply while one is on; they're kept, and come back when
-- it's taken off. Coats apply to breeds too. The app draws each breed
-- (mobile/src/kennel/HoundArt.tsx).
--
-- The hound avatar code (0106) gains an eighth part, the breed, only
-- when one is on, so codes without a breed are unchanged:
--   hound:<coat>.<ears>.<tail>.<markings>.<neck>.<head>.<face>.<breed>
--
-- Run this once, after 0001-0131, in the SQL Editor.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (slot in ('neck', 'head', 'face', 'coat', 'breed'));

insert into public.kennel_items (id, slot, name, cost_bones) values
  ('breed_corgi', 'breed', 'Corgi', 600),
  ('breed_poodle', 'breed', 'Poodle', 600),
  ('breed_frenchie', 'breed', 'French Bulldog', 600)
on conflict (id) do nothing;

alter table public.kennels add column if not exists breed_id text;

-- kennel_view, my_kennel and friend_kennel each gain breed_id at the end.
-- Their columns change, so they're dropped and made again (0105's).
drop function if exists public.my_kennel(date);
drop function if exists public.friend_kennel(uuid, date);
drop function if exists public.kennel_view(uuid, date);

create function public.kennel_view(p_user uuid, p_day date)
returns table (
  name text,
  care_mode text,
  mood text,
  goal_days_7 integer,
  goal_day_today boolean,
  treated_today boolean,
  hearts integer,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  breed_id text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  k public.kennels;
  days integer;
  today_hit boolean;
  treated boolean;
  h integer;
  score integer;
  m text;
begin
  select * into k from public.kennels x where x.user_id = p_user;
  if not found then
    k.name := 'Scout';
    k.care_mode := 'gentle';
    k.hearts := 3;
    k.ears := 'floppy';
    k.tail := 'wavy';
    k.markings := 'none';
  end if;
  select count(*)::integer into days from public.activity_events e
    where e.user_id = p_user and e.kind = 'goal_day' and e.created_at > now() - interval '7 days';
  today_hit := exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day);
  treated := coalesce(k.treated_on >= p_day, false);
  h := public.kennel_hearts(k, p_day);
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
    k.neck_id, k.head_id, k.face_id, k.coat_id, k.ears, k.tail, k.markings, k.breed_id;
end;
$$;

revoke execute on function public.kennel_view(uuid, date) from public, anon, authenticated;

create function public.my_kennel(p_local_date date)
returns table (
  name text,
  care_mode text,
  mood text,
  goal_days_7 integer,
  goal_day_today boolean,
  treated_today boolean,
  hearts integer,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  owned text[],
  xp_total integer,
  bones_balance integer,
  breed_id text
)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  return query select
    v.name, v.care_mode, v.mood, v.goal_days_7, v.goal_day_today, v.treated_today, v.hearts,
    v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings,
    coalesce((select array_agg(pu.item_id order by pu.item_id) from public.kennel_purchases pu where pu.user_id = me), '{}'),
    p.xp_total, p.bones_balance, v.breed_id
  from public.kennel_view(me, p_local_date) v
  cross join public.profiles p
  where p.id = me;
end;
$$;

revoke execute on function public.my_kennel(date) from public, anon;
grant execute on function public.my_kennel(date) to authenticated;

create function public.friend_kennel(p_friend uuid, p_local_date date)
returns table (
  name text,
  mood text,
  neck_id text,
  head_id text,
  face_id text,
  coat_id text,
  ears text,
  tail text,
  markings text,
  xp_total integer,
  breed_id text
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if public.friend_relation(auth.uid(), p_friend) <> 'friends' then
    raise exception 'Only friends can see each other''s hounds.';
  end if;
  return query select v.name, v.mood, v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings, p.xp_total, v.breed_id
  from public.kennel_view(p_friend, p_local_date) v
  cross join public.profiles p
  where p.id = p_friend;
end;
$$;

revoke execute on function public.friend_kennel(uuid, date) from public, anon;
grant execute on function public.friend_kennel(uuid, date) to authenticated;

-- 0105's equip_kennel_item, with the breed slot.
create or replace function public.equip_kennel_item(p_local_date date, p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  if p_slot not in ('neck', 'head', 'face', 'coat', 'breed') then
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
        coat_id = case when p_slot = 'coat' then p_item_id else k.coat_id end,
        breed_id = case when p_slot = 'breed' then p_item_id else k.breed_id end,
        updated_at = now()
    where k.user_id = me;
end;
$$;

-- 0106's avatar code, with the breed as an eighth part when there is
-- one (concat_ws skips a null, so a hound without a breed keeps the same
-- code as before).
create or replace function public.kennel_avatar_code(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select 'hound:' || concat_ws('.',
    coalesce(k.coat_id, ''), coalesce(k.ears, 'floppy'), coalesce(k.tail, 'wavy'), coalesce(k.markings, 'none'),
    coalesce(k.neck_id, ''), coalesce(k.head_id, ''), coalesce(k.face_id, ''), k.breed_id)
  from (select 1) one
  left join public.kennels k on k.user_id = p_user;
$$;

-- Undo, if needed:
--   update public.kennels set breed_id = null;
--   alter table public.kennels drop column breed_id;
--   delete from public.kennel_items where slot = 'breed';
--   put back 0105's slot check, kennel_view, my_kennel, friend_kennel
--   and equip_kennel_item, and 0106's kennel_avatar_code.
