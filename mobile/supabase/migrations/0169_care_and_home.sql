-- Hound: bath day, homemade treats and the room inside the house
-- (lifestyle phase 4, the "Hound lifestyle: design" doc, ideas 8, 9 and
-- 12, with decisions 6 and 7).
--
-- Bath day, only the happy side (decision 6): a long walk today (30
-- minutes or 3,000 steps) brings the hound home muddy, and a good active
-- day (that long walk, 8,000 steps, or today's goals done) earns a bath
-- with bubbles. One bath a day; the hound's fresh and sparkly after it,
-- until the next long walk muddies it again. Never a scruffy coat.
--
--   hound_baths    one row per bath
--   give_bath()    today's bath, if it's been earned
--
-- Homemade treats: walk finds plus Bones go into treats, from four
-- recipes (treat_recipes). Each needs finds of a rarity; the kitchen
-- uses your spare ones (found, and not yet baked), most plentiful first.
-- A treat waits in your pantry until you feed it to your hound (it's
-- today's treat, with no Bones to pay) or send it to a friend's hound
-- with a note, like a gift from the shop.
--
--   treat_recipes, hound_treats
--   make_treat(), feed_homemade_treat(), gift_treat()
--   my_care()      the bath, the kitchen and the pantry, for the Kennel
--   my_new_gifts() now has treats from friends too
--
-- The room (decision 7, the next shop drop): a third zone, inside the
-- house, open to everyone. Eight things to buy, each with its own place:
-- a rug, a sofa, a fireplace, a photo wall, a bookshelf, a floor lamp, a
-- fireside cushion and a potted fern. yard_view gains 'room' (the room
-- items you have; friends see them too). They can be gifts.
--
-- Admin: admin_care_overview() (baths and treats) and
-- admin_room_overview() (rooms decorated).
--
-- Run this once, after 0001-0168, in the SQL Editor, before publishing
-- the app update that goes with it.

-- ── Bath day ─────────────────────────────────────────────────────────

create table public.hound_baths (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.hound_baths enable row level security;
revoke all on public.hound_baths from anon, authenticated;

-- Today's long walk, if there's been one: a finished walk of 30 minutes
-- or 3,000 steps. The latest one.
create or replace function public.care_long_walk(p_user uuid, p_day date)
returns public.hound_walks
language sql
stable
security definer set search_path = public
as $$
  select w.* from public.hound_walks w
  where w.user_id = p_user and w.day = p_day
    and (w.ended_at - w.started_at >= interval '30 minutes' or w.steps >= 3000)
    and w.ended_at <= now() - interval '20 minutes'
  order by w.ended_at desc
  limit 1;
$$;

revoke execute on function public.care_long_walk(uuid, date) from public, anon, authenticated;

-- The bath, as the Kennel shows it.
create or replace function public.care_bath(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  walk public.hound_walks;
  bath public.hound_baths;
  steps integer;
  goal boolean;
  muddy boolean;
  earned text;
begin
  walk := public.care_long_walk(p_user, p_day);
  select * into bath from public.hound_baths b where b.user_id = p_user and b.day = p_day;
  select s.steps into steps from public.daily_step_totals s where s.user_id = p_user and s.day = p_day;
  goal := exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day);
  -- Muddy from a long walk that ended after today's bath (or with no bath).
  muddy := walk.id is not null and (bath.user_id is null or walk.ended_at > bath.created_at);
  earned := case
    when walk.id is not null then 'walk'
    when coalesce(steps, 0) >= 8000 then 'steps'
    when goal then 'goal'
  end;
  return jsonb_build_object(
    'bathed', bath.user_id is not null,
    'bathed_at', bath.created_at,
    'muddy', muddy,
    'earned', earned,
    'can_bath', bath.user_id is null and earned is not null,
    'walk_steps', walk.steps,
    'walk_minutes', case when walk.id is null then null
      else round(extract(epoch from walk.ended_at - walk.started_at) / 60)::int end
  );
end;
$$;

revoke execute on function public.care_bath(uuid, date) from public, anon, authenticated;

-- ── Treats ───────────────────────────────────────────────────────────

create table public.treat_recipes (
  id text primary key,
  name text not null,
  -- Finds it takes, by rarity, and the Bones on top.
  common integer not null default 0,
  uncommon integer not null default 0,
  rare integer not null default 0,
  bones integer not null,
  sort integer not null
);

alter table public.treat_recipes enable row level security;
revoke all on public.treat_recipes from anon, authenticated;

-- src/care/care.ts mirrors these (and draws them).
insert into public.treat_recipes (id, name, common, uncommon, rare, bones, sort) values
  ('pumpkin_biscuits', 'Pumpkin biscuits', 2, 0, 0, 15, 10),
  ('pb_pupcake', 'Peanut butter pupcake', 1, 1, 0, 25, 20),
  ('frosty_paws', 'Frosty paws', 0, 2, 0, 35, 30),
  ('birthday_cake', 'Birthday cake', 2, 0, 1, 50, 40);

create table public.hound_treats (
  id uuid primary key default gen_random_uuid(),
  -- Whose pantry it's in; made_by baked it (the same, unless a gift).
  user_id uuid not null references public.profiles (id) on delete cascade,
  made_by uuid not null references public.profiles (id) on delete cascade,
  recipe_id text not null references public.treat_recipes (id),
  -- The find kinds it used, one entry per find.
  used text[] not null,
  bones integer not null,
  made_at timestamptz not null default now(),
  -- A gift: when it was sent, with the note; seen_at once the friend's
  -- been told.
  gifted_at timestamptz,
  note text check (note is null or char_length(note) between 1 and 80),
  seen_at timestamptz,
  eaten_on date,
  eaten_at timestamptz
);

create index hound_treats_user on public.hound_treats (user_id) where eaten_at is null;
create index hound_treats_made_by on public.hound_treats (made_by);

alter table public.hound_treats enable row level security;
revoke all on public.hound_treats from anon, authenticated;

-- Your spare finds: each kind found on a walk, less those baked into
-- treats.
create or replace function public.care_spare_finds(p_user uuid)
returns table (find_id text, rarity text, sort integer, spare integer)
language sql
stable
security definer set search_path = public
as $$
  select k.id, k.rarity, k.sort,
    (coalesce(f.n, 0) - coalesce(u.n, 0))::int
  from public.walk_find_kinds k
  left join (
    select w.find_id, count(*) as n from public.hound_walks w
    where w.user_id = p_user and w.find_id is not null group by w.find_id
  ) f on f.find_id = k.id
  left join (
    select x.find_id, count(*) as n
    from public.hound_treats t, unnest(t.used) as x (find_id)
    where t.made_by = p_user group by x.find_id
  ) u on u.find_id = k.id
  where coalesce(f.n, 0) - coalesce(u.n, 0) > 0;
$$;

revoke execute on function public.care_spare_finds(uuid) from public, anon, authenticated;

-- The bath, the recipes, your spare finds and your pantry.
create or replace function public.my_care(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
begin
  return jsonb_build_object(
    'bath', public.care_bath(me, p_day),
    'recipes', (
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'common', r.common,
        'uncommon', r.uncommon, 'rare', r.rare, 'bones', r.bones) order by r.sort)
      from public.treat_recipes r
    ),
    'spare', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.find_id, 'rarity', s.rarity, 'n', s.spare) order by s.sort)
      from public.care_spare_finds(me) s
    ), '[]'::jsonb),
    'pantry', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'recipe_id', t.recipe_id,
          'from', case when t.made_by <> me then
            (select case when p.use_username and p.username is not null then p.username else p.name end
             from public.profiles p where p.id = t.made_by) end,
          'note', case when t.made_by <> me then t.note end,
          'made_at', t.made_at
        ) order by t.made_at)
      from public.hound_treats t
      where t.user_id = me and t.eaten_at is null
    ), '[]'::jsonb),
    'treated_today', exists (select 1 from public.kennels k where k.user_id = me and k.treated_on >= p_day),
    'made', (select count(*) from public.hound_treats t where t.made_by = me)::int
  );
end;
$$;

revoke execute on function public.my_care(date) from public, anon;
grant execute on function public.my_care(date) to authenticated;

-- Today's bath, once it's been earned. Returns my_care.
create or replace function public.give_bath(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  b jsonb;
begin
  b := public.care_bath(me, p_day);
  if (b ->> 'bathed')::boolean then
    raise exception 'Already had a bath today. Squeaky clean.';
  end if;
  if not (b ->> 'can_bath')::boolean then
    raise exception 'A bath comes after an active day: a long walk, 8,000 steps or your goals done.';
  end if;
  insert into public.hound_baths (user_id, day) values (me, p_day);
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.give_bath(date) from public, anon;
grant execute on function public.give_bath(date) to authenticated;

-- Bakes a treat from your spare finds (the rarities the recipe asks for,
-- most plentiful kinds first) and Bones. Returns my_care.
create or replace function public.make_treat(p_day date, p_recipe text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  r public.treat_recipes;
  used text[] := '{}';
  need integer;
  tier text;
  pick record;
  balance integer;
begin
  select * into r from public.treat_recipes x where x.id = p_recipe;
  if not found then
    raise exception 'That recipe doesn''t exist.';
  end if;
  if (select count(*) from public.hound_treats t where t.user_id = me and t.eaten_at is null) >= 20 then
    raise exception 'The pantry''s full. Feed or send a few first.';
  end if;

  foreach tier in array array['common', 'uncommon', 'rare'] loop
    need := case tier when 'common' then r.common when 'uncommon' then r.uncommon else r.rare end;
    for pick in
      select s.find_id, s.spare from public.care_spare_finds(me) s
      where s.rarity = tier
      order by s.spare desc, s.sort
    loop
      exit when need = 0;
      for i in 1 .. least(need, pick.spare) loop
        used := used || pick.find_id;
      end loop;
      need := need - least(need, pick.spare);
    end loop;
    if need > 0 then
      raise exception 'Not enough % finds yet. Walks bring more home.', tier;
    end if;
  end loop;

  select p.bones_balance into balance from public.profiles p where p.id = me for update;
  if coalesce(balance, 0) < r.bones then
    raise exception 'Not enough Bones.';
  end if;
  update public.profiles p set bones_balance = p.bones_balance - r.bones where p.id = me;
  insert into public.hound_treats (user_id, made_by, recipe_id, used, bones)
    values (me, me, r.id, used, r.bones);
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.make_treat(date, text) from public, anon;
grant execute on function public.make_treat(date, text) to authenticated;

-- A treat from your pantry as today's treat: the same as the shop's, with
-- nothing to pay. Returns my_care.
create or replace function public.feed_homemade_treat(p_day date, p_treat uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  k public.kennels;
  h integer;
begin
  if not exists (select 1 from public.hound_treats t where t.id = p_treat and t.user_id = me and t.eaten_at is null) then
    raise exception 'That treat isn''t in your pantry.';
  end if;
  select * into k from public.kennels x where x.user_id = me for update;
  if k.treated_on >= p_day then
    raise exception 'Already had a treat today. Save it for tomorrow.';
  end if;
  h := least(3, public.kennel_hearts(k, p_day) + 1);
  update public.kennels x
    set treated_on = p_day,
        hearts = case when x.care_mode = 'classic' then h else x.hearts end,
        hearts_on = case when x.care_mode = 'classic' then p_day else x.hearts_on end,
        updated_at = now()
    where x.user_id = me;
  update public.hound_treats t set eaten_on = p_day, eaten_at = now(), seen_at = coalesce(t.seen_at, now())
    where t.id = p_treat;
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.feed_homemade_treat(date, uuid) from public, anon;
grant execute on function public.feed_homemade_treat(date, uuid) to authenticated;

-- Sends a treat you baked to a friend's hound, with a note. It goes in
-- their pantry. Counts toward the 10 gifts a day. Returns my_care.
create or replace function public.gift_treat(p_friend uuid, p_treat uuid, p_note text, p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_day);
  t public.hound_treats;
  clean_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  problem text;
  rname text;
begin
  if public.friend_relation(me, p_friend) <> 'friends' then
    raise exception 'You can only send gifts to friends.';
  end if;
  select * into t from public.hound_treats x where x.id = p_treat and x.user_id = me and x.eaten_at is null for update;
  if not found then
    raise exception 'That treat isn''t in your pantry.';
  end if;
  if t.made_by <> me then
    raise exception 'That one was a gift to you. Send one you baked.';
  end if;
  if clean_note is not null then
    if char_length(clean_note) > 80 then
      raise exception 'Keep the note to 80 characters.';
    end if;
    problem := public.community_words_problem(clean_note);
    if problem is not null then
      raise exception '%', problem;
    end if;
  end if;
  if (select count(*) from public.kennel_gifts g where g.from_id = me and g.created_at > now() - interval '1 day')
     + (select count(*) from public.hound_treats x where x.made_by = me and x.user_id <> me and x.gifted_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s 10 gifts today. Send more tomorrow.';
  end if;

  update public.hound_treats x set user_id = p_friend, gifted_at = now(), note = clean_note
    where x.id = p_treat;

  select r.name into rname from public.treat_recipes r where r.id = t.recipe_id;
  if public.social_push_reachable(p_friend) then
    perform public.social_notify(jsonb_build_object(
      'kind', 'gift', 'from_user', me, 'to_user', p_friend, 'challenge_id', null,
      'item_name', lower(rname),
      'hound_name', coalesce((select k.name from public.kennels k where k.user_id = p_friend), 'Scout')
    ));
  end if;
  return public.my_care(p_day);
end;
$$;

revoke execute on function public.gift_treat(uuid, uuid, text, date) from public, anon;
grant execute on function public.gift_treat(uuid, uuid, text, date) to authenticated;

-- 0157's, with treats from friends too.
create or replace function public.my_new_gifts()
returns table (id uuid, from_name text, item_id text, item_name text, note text, created_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  return query
    with fresh as (
      update public.kennel_gifts g set seen_at = now()
      where g.to_id = auth.uid() and g.seen_at is null
      returning g.id, g.from_id, g.item_id, g.note, g.created_at
    ),
    treats as (
      update public.hound_treats t set seen_at = now()
      where t.user_id = auth.uid() and t.made_by <> auth.uid() and t.gifted_at is not null and t.seen_at is null
      returning t.id, t.made_by, t.recipe_id, t.note, t.gifted_at
    )
    select x.id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      x.item_id, x.item_name, x.note, x.created_at
    from (
      select f.id, f.from_id, f.item_id, i.name as item_name, f.note, f.created_at
      from fresh f join public.kennel_items i on i.id = f.item_id
      union all
      select t.id, t.made_by, t.recipe_id, lower(r.name), t.note, t.gifted_at
      from treats t join public.treat_recipes r on r.id = t.recipe_id
    ) x
    join public.profiles p on p.id = x.from_id
    order by x.created_at;
end;
$$;

revoke execute on function public.my_new_gifts() from public, anon;
grant execute on function public.my_new_gifts() to authenticated;

-- ── The room ─────────────────────────────────────────────────────────

alter table public.kennel_items drop constraint if exists kennel_items_slot_check;
alter table public.kennel_items add constraint kennel_items_slot_check check (
  slot in ('neck', 'head', 'face', 'coat', 'breed', 'body', 'feet', 'house', 'bed', 'bowl', 'toy', 'plant', 'fence',
           'ground', 'tree', 'pond', 'zone', 'porch', 'trick', 'room')
);

-- src/kennel/roomItems.ts mirrors these (and draws them).
insert into public.kennel_items (id, slot, name, cost_bones) values
  ('room_rug', 'room', 'Cozy Rug', 200),
  ('room_sofa', 'room', 'Sofa', 600),
  ('room_fireplace', 'room', 'Fireplace', 900),
  ('room_photos', 'room', 'Photo Wall', 300),
  ('room_bookshelf', 'room', 'Bookshelf', 350),
  ('room_lamp', 'room', 'Floor Lamp', 150),
  ('room_cushion', 'room', 'Fireside Cushion', 250),
  ('room_fern', 'room', 'Potted Fern', 150)
on conflict (id) do nothing;

-- 0159's yard_view, with the room.
create or replace function public.yard_view(p_user uuid, p_day date, p_private boolean)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  y public.kennel_yards;
  sz int;
  won jsonb;
  shown text[];
  spots jsonb := '{}'::jsonb;
  spot text;
  item text;
  prints int;
  visitors jsonb := '[]'::jsonb;
  guest jsonb := null;
  friend uuid;
  together text;
  porch jsonb := null;
begin
  select public.yard_size(p.xp_total) into sz from public.profiles p where p.id = p_user;
  sz := coalesce(sz, 0);
  select * into y from public.kennel_yards k where k.user_id = p_user;
  foreach spot in array public.yard_spots(sz) loop
    item := case spot
      when 'house' then y.house_id
      when 'bed' then y.bed_id
      when 'bowl' then y.bowl_id
      when 'toy' then y.toy_id
      when 'plant_left' then y.plant_left_id
      when 'plant_right' then y.plant_right_id
      when 'fence' then y.fence_id
      when 'ground' then y.ground_id
      when 'tree' then y.tree_id
      when 'pond' then y.pond_id
    end;
    if item is null then
      select i.id into item from public.kennel_items i
        where i.slot = public.yard_spot_slot(spot) and i.cost_bones = 0
        order by i.id limit 1;
    end if;
    spots := spots || jsonb_build_object(spot, item);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'wins', t.wins, 'last_won', t.last_won) order by t.last_won desc, t.kind), '[]'::jsonb)
    into won
    from public.yard_trophies(p_user) t;

  if y.trophies is not null then
    select coalesce(array_agg(k order by o), '{}') into shown
    from unnest(y.trophies) with ordinality as u (k, o)
    where exists (select 1 from jsonb_array_elements(won) w where w ->> 'kind' = u.k)
      and o <= sz + 1;
  else
    select coalesce(array_agg(w ->> 'kind' order by n), '{}') into shown
    from jsonb_array_elements(won) with ordinality as x (w, n)
    where n <= sz + 1;
  end if;

  select count(distinct v.visitor_id)::int into prints
  from public.yard_visits v
  where v.host_id = p_user and v.pawprint and v.updated_at > now() - interval '1 day';

  if p_private then
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', x.visitor_id,
        'name', case when p.use_username and p.username is not null then p.username else p.name end,
        'pawprint', x.pawprint,
        'treat', x.treat
      ) order by x.at desc), '[]'::jsonb)
      into visitors
    from (
      select v.visitor_id, bool_or(v.pawprint) as pawprint, bool_or(v.treat) as treat, max(v.updated_at) as at
      from public.yard_visits v
      where v.host_id = p_user and v.updated_at > now() - interval '1 day'
      group by v.visitor_id
    ) x
    join public.profiles p on p.id = x.visitor_id;

    -- A friend's hound over to play: both of you finished your goals
    -- today, in a challenge together that's on now.
    if exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day) then
      select f.other, c.name into friend, together
      from (
        select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end as other
        from public.friendships fr
        where fr.status = 'accepted' and (fr.requester_id = p_user or fr.recipient_id = p_user)
      ) f
      join public.goal_streaks g on g.user_id = f.other and g.last_hit_on >= p_day
      join lateral (
        select c.name
        from public.challenge_participants a
        join public.challenge_participants b on b.challenge_id = a.challenge_id and b.user_id = f.other
        join public.challenges c on c.id = a.challenge_id
        where a.user_id = p_user and c.starts_at <= now() and c.ends_at > now()
        order by c.ends_at
        limit 1
      ) c on true
      order by md5(f.other::text || p_day::text)
      limit 1;

      if friend is not null then
        select jsonb_build_object(
            'user_id', friend,
            'owner', case when p.use_username and p.username is not null then p.username else p.name end,
            'challenge', together,
            'name', v.name,
            'xp_total', p.xp_total,
            'neck_id', v.neck_id,
            'head_id', v.head_id,
            'face_id', v.face_id,
            'coat_id', v.coat_id,
            'ears', v.ears,
            'tail', v.tail,
            'markings', v.markings,
            'breed_id', v.breed_id,
            'body_id', v.body_id,
            'feet_id', v.feet_id
          )
          into guest
        from public.kennel_view(friend, p_day) v
        cross join public.profiles p
        where p.id = friend;
      end if;
    end if;
  end if;

  -- The Porch (0157): what's on it, once it's been unlocked; null before.
  if exists (select 1 from public.kennel_purchases pu where pu.user_id = p_user and pu.item_id = 'zone_porch') then
    select coalesce(jsonb_agg(pu.item_id order by pu.item_id), '[]'::jsonb) into porch
    from public.kennel_purchases pu
    join public.kennel_items i on i.id = pu.item_id
    where pu.user_id = p_user and i.slot = 'porch';
  end if;

  return jsonb_build_object(
    'size', sz, 'spots', spots, 'trophies', won, 'shown', to_jsonb(shown),
    'pawprints', prints, 'visitors', visitors, 'guest', guest, 'porch', porch,
    -- 0159: the tricks this hound knows, so a friend's double-tap works.
    'tricks', coalesce((
      select jsonb_agg(pu.item_id order by pu.item_id)
      from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id
      where pu.user_id = p_user and i.slot = 'trick'
    ), '[]'::jsonb),
    -- 0169: the room inside the house, and what's in it.
    'room', coalesce((
      select jsonb_agg(pu.item_id order by pu.item_id)
      from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id
      where pu.user_id = p_user and i.slot = 'room'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.yard_view(uuid, date, boolean) from public, anon, authenticated;

-- ── Admin ────────────────────────────────────────────────────────────

-- Admin → Overview → Bath and treats.
create or replace function public.admin_care_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'baths_7d', (select count(*) from public.hound_baths b where b.created_at > now() - interval '7 days'),
    'bathers_7d', (select count(distinct b.user_id) from public.hound_baths b where b.created_at > now() - interval '7 days'),
    'baths_all', (select count(*) from public.hound_baths),
    'bathers_all', (select count(distinct b.user_id) from public.hound_baths b),
    'made_7d', (select count(*) from public.hound_treats t where t.made_at > now() - interval '7 days'),
    'bakers_7d', (select count(distinct t.made_by) from public.hound_treats t where t.made_at > now() - interval '7 days'),
    'made_all', (select count(*) from public.hound_treats),
    'bakers_all', (select count(distinct t.made_by) from public.hound_treats t),
    'fed_7d', (select count(*) from public.hound_treats t where t.eaten_at > now() - interval '7 days'),
    'gifted_7d', (select count(*) from public.hound_treats t where t.gifted_at > now() - interval '7 days'),
    'gifted_all', (select count(*) from public.hound_treats t where t.gifted_at is not null),
    'bones_7d', (select coalesce(sum(t.bones), 0) from public.hound_treats t where t.made_at > now() - interval '7 days'),
    'by_recipe', (
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name,
        'made', (select count(*) from public.hound_treats t where t.recipe_id = r.id)) order by r.sort)
      from public.treat_recipes r
    )
  );
end;
$$;

revoke execute on function public.admin_care_overview() from public, anon;
grant execute on function public.admin_care_overview() to authenticated;

-- Admin → Overview → Inside the house.
create or replace function public.admin_room_overview()
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
    with owned as (
      select pu.user_id, pu.item_id, pu.bones, pu.purchased_at
      from public.kennel_purchases pu
      join public.kennel_items i on i.id = pu.item_id
      where i.slot = 'room'
    ),
    per as (select o.user_id, count(*) as n from owned o group by o.user_id)
    select jsonb_build_object(
      'rooms', (select count(*) from per),
      'rooms_7d', (select count(distinct o.user_id) from owned o where o.purchased_at > now() - interval '7 days'),
      'full_rooms', (select count(*) from per where n = (select count(*) from public.kennel_items i where i.slot = 'room')),
      'placed', (select count(*) from owned),
      'bones_all', (select coalesce(sum(o.bones), 0) from owned o),
      'bones_7d', (select coalesce(sum(o.bones), 0) from owned o where o.purchased_at > now() - interval '7 days'),
      'gifted', (select count(*) from public.kennel_gifts g join public.kennel_items i on i.id = g.item_id where i.slot = 'room'),
      'by_item', (
        select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'owned',
          (select count(*) from owned o where o.item_id = i.id)) order by i.cost_bones desc)
        from public.kennel_items i where i.slot = 'room'
      )
    )
  );
end;
$$;

revoke execute on function public.admin_room_overview() from public, anon;
grant execute on function public.admin_room_overview() to authenticated;
