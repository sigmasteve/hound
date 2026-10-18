-- Hound: the Kennel (0104) for friends, coat colors and looks.
--
-- 1. friend_kennel shows an accepted friend's hound on their friend page:
--    its name, mood, rank (from their XP), look, coat and accessories. Never
--    their Bones, hearts or what they own. Someone who's never opened
--    the Kennel shows the default hound, with a mood from their goal
--    days like anyone's.
--
-- 2. Coats, a new kennel_items slot. Tan is the default (no coat_id).
--    Chocolate, Cream and Gray are free (0 Bones: "buying" one is just
--    picking it); Black & Tan, Golden, Midnight Blue and Cotton Candy
--    cost Bones. src/kennel/kennelItems.ts mirrors these and holds the
--    colors.
--
-- 3. Looks, free to change any time (set_kennel_look): ears (floppy,
--    perky or short), tail (wavy, curly or stubby) and markings (none, an
--    eye patch or spots). HoundArt draws each.
--
-- my_kennel is rebuilt on kennel_view, which friend_kennel shares, so
-- the mood rule lives in one place. It also returns the coat and look.
--
-- Run this once, after 0001-0104, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (slot in ('neck', 'head', 'face', 'coat'));
alter table public.kennel_items drop constraint if exists kennel_items_cost_bones_check;
alter table public.kennel_items add constraint kennel_items_cost_bones_check check (cost_bones >= 0);

insert into public.kennel_items (id, slot, name, cost_bones) values
  ('coat_chocolate', 'coat', 'Chocolate', 0),
  ('coat_cream', 'coat', 'Cream', 0),
  ('coat_gray', 'coat', 'Gray', 0),
  ('coat_black_tan', 'coat', 'Black & Tan', 60),
  ('coat_golden', 'coat', 'Golden', 100),
  ('coat_midnight', 'coat', 'Midnight Blue', 150),
  ('coat_candy', 'coat', 'Cotton Candy', 150);

alter table public.kennels
  add column coat_id text,
  add column ears text not null default 'floppy' check (ears in ('floppy', 'perky', 'short')),
  add column tail text not null default 'wavy' check (tail in ('wavy', 'curly', 'stubby')),
  add column markings text not null default 'none' check (markings in ('none', 'eye_patch', 'spots'));

-- Anyone's hound as of p_day, without making a kennel row: the defaults
-- stand in for someone who's never opened the Kennel. The one place the
-- mood rule (0104) is worked out.
create or replace function public.kennel_view(p_user uuid, p_day date)
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
  markings text
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
    k.neck_id, k.head_id, k.face_id, k.coat_id, k.ears, k.tail, k.markings;
end;
$$;

revoke execute on function public.kennel_view(uuid, date) from public, anon, authenticated;

-- Its columns change, so it's dropped and made again.
drop function public.my_kennel(date);

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
  bones_balance integer
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
    p.xp_total, p.bones_balance
  from public.kennel_view(me, p_local_date) v
  cross join public.profiles p
  where p.id = me;
end;
$$;

revoke execute on function public.my_kennel(date) from public, anon;
grant execute on function public.my_kennel(date) to authenticated;

-- A friend's hound, for their friend page. p_local_date is the viewer's
-- own date, which is close enough for a friend's mood.
create or replace function public.friend_kennel(p_friend uuid, p_local_date date)
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
  xp_total integer
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
  return query select v.name, v.mood, v.neck_id, v.head_id, v.face_id, v.coat_id, v.ears, v.tail, v.markings, p.xp_total
  from public.kennel_view(p_friend, p_local_date) v
  cross join public.profiles p
  where p.id = p_friend;
end;
$$;

revoke execute on function public.friend_kennel(uuid, date) from public, anon;
grant execute on function public.friend_kennel(uuid, date) to authenticated;

-- 0104's equip_kennel_item, with the coat slot.
create or replace function public.equip_kennel_item(p_local_date date, p_slot text, p_item_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  if p_slot not in ('neck', 'head', 'face', 'coat') then
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
        updated_at = now()
    where k.user_id = me;
end;
$$;

revoke execute on function public.equip_kennel_item(date, text, text) from public, anon;
grant execute on function public.equip_kennel_item(date, text, text) to authenticated;

-- Changes the hound's ears, tail and markings; null leaves one as it is.
create or replace function public.set_kennel_look(p_local_date date, p_ears text, p_tail text, p_markings text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  update public.kennels k
    set ears = coalesce(p_ears, k.ears),
        tail = coalesce(p_tail, k.tail),
        markings = coalesce(p_markings, k.markings),
        updated_at = now()
    where k.user_id = me;
end;
$$;

revoke execute on function public.set_kennel_look(date, text, text, text) from public, anon;
grant execute on function public.set_kennel_look(date, text, text, text) to authenticated;

-- Undo, if needed:
--   drop function public.set_kennel_look(date, text, text, text);
--   drop function public.friend_kennel(uuid, date);
--   drop function public.my_kennel(date); then run 0104's my_kennel and
--   equip_kennel_item again;
--   drop function public.kennel_view(uuid, date);
--   update public.kennels set coat_id = null;
--   alter table public.kennels drop column coat_id, drop column ears,
--     drop column tail, drop column markings;
--   delete from public.kennel_purchases where item_id like 'coat_%';
--   delete from public.kennel_items where slot = 'coat';
--   (and put back 0104's slot and cost_bones > 0 checks)
