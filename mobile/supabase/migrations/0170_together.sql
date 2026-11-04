-- Hound: together (lifestyle phase 5, the "Hound lifestyle: design"
-- doc, ideas 14 and 15): playdates, walking together and the dog park.
--
-- Playdates: on a day you and a friend have both finished your goals,
-- their hound comes over to play in your Yard. Until now (0150) that
-- also needed a challenge together that's on now; now any friend will
-- do, with challenge-mates picked first. The first one picked each day
-- stays for the day, and is kept in hound_playdates (for Admin, and so it
-- doesn't change as more friends finish).
--
-- Walking together: a walk of yours that overlaps a friend's walk by 10
-- minutes or more was a walk together. The Kennel's walk recaps and the
-- diary say who with ("with Jordan's Scout").
--
-- The dog park: friends' hounds that have been out on a walk in the last
-- day, with how far they went; your hound too, once you've walked. Tap
-- one to visit.
--
--   hound_playdates      one row per person per day: whose hound came over
--   together_playmate()  today's playmate (internal)
--   my_together()        the playdate, walks together (last 7 days), the
--                        dog park; records the playdate
--   yard_view()          its guest is the playmate now
--   log_walk_event()     gains 'park_open'
--   admin_together_overview()  Admin → Overview → Together
--
-- Run this once, after 0001-0169, in the SQL Editor, before publishing
-- the app update that goes with it.

create table public.hound_playdates (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.hound_playdates enable row level security;
revoke all on public.hound_playdates from anon, authenticated;

-- A friend's display name: their username when they go by it.
create or replace function public.together_name(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case when p.use_username and p.username is not null then p.username else p.name end
  from public.profiles p where p.id = p_user;
$$;

revoke execute on function public.together_name(uuid) from public, anon, authenticated;

-- Your friends, with the friendship.
create or replace function public.together_friends(p_user uuid)
returns table (friend_id uuid, friendship_id uuid)
language sql
stable
security definer set search_path = public
as $$
  select case when fr.requester_id = p_user then fr.recipient_id else fr.requester_id end, fr.id
  from public.friendships fr
  where fr.status = 'accepted' and (fr.requester_id = p_user or fr.recipient_id = p_user);
$$;

revoke execute on function public.together_friends(uuid) from public, anon, authenticated;

-- Today's playmate: the one already picked today, or a friend who has
-- also finished their goals (challenge-mates first, then one picked for
-- the day). Nobody unless you've finished yours.
create or replace function public.together_playmate(p_user uuid, p_day date)
returns table (friend_id uuid, challenge text)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.goal_streaks g where g.user_id = p_user and g.last_hit_on >= p_day) then
    return;
  end if;
  return query
    select f.friend_id, c.name
    from public.together_friends(p_user) f
    join public.goal_streaks g on g.user_id = f.friend_id and g.last_hit_on >= p_day
    left join public.hound_playdates hp on hp.user_id = p_user and hp.day = p_day and hp.friend_id = f.friend_id
    left join lateral (
      select c.name
      from public.challenge_participants a
      join public.challenge_participants b on b.challenge_id = a.challenge_id and b.user_id = f.friend_id
      join public.challenges c on c.id = a.challenge_id
      where a.user_id = p_user and c.starts_at <= now() and c.ends_at > now()
      order by c.ends_at
      limit 1
    ) c on true
    order by (hp.user_id is not null) desc, (c.name is not null) desc, md5(f.friend_id::text || p_day::text)
    limit 1;
end;
$$;

revoke execute on function public.together_playmate(uuid, date) from public, anon, authenticated;

-- The playdate, walks together, and the dog park.
create or replace function public.my_together(p_day date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  mate record;
  playdate jsonb := null;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;
  if p_day < current_date - 2 or p_day > current_date + 1 then
    raise exception 'Invalid date.';
  end if;

  select * into mate from public.together_playmate(me, p_day);
  if mate.friend_id is not null then
    insert into public.hound_playdates (user_id, friend_id, day) values (me, mate.friend_id, p_day)
      on conflict (user_id, day) do nothing;
    playdate := jsonb_build_object(
      'user_id', mate.friend_id,
      'owner', public.together_name(mate.friend_id),
      'hound_name', coalesce((select k.name from public.kennels k where k.user_id = mate.friend_id), 'Scout'),
      'challenge', mate.challenge
    );
  end if;

  return jsonb_build_object(
    'playdate', playdate,
    -- Your walks in the last 7 days that overlapped a friend's by 10
    -- minutes or more.
    'together', coalesce((
      select jsonb_agg(jsonb_build_object(
          'walk_id', x.walk_id,
          'user_id', x.friend_id,
          'owner', public.together_name(x.friend_id),
          'hound_name', coalesce((select k.name from public.kennels k where k.user_id = x.friend_id), 'Scout'),
          'minutes', x.minutes
        ) order by x.walk_id, x.minutes desc)
      from (
        select distinct on (w.id, f.friend_id) w.id as walk_id, f.friend_id,
          round(extract(epoch from least(w.ended_at, o.ended_at) - greatest(w.started_at, o.started_at)) / 60)::int as minutes
        from public.hound_walks w
        join public.together_friends(me) f on true
        join public.hound_walks o on o.user_id = f.friend_id
          and o.started_at < w.ended_at and o.ended_at > w.started_at
          and least(w.ended_at, o.ended_at) - greatest(w.started_at, o.started_at) >= interval '10 minutes'
        where w.user_id = me and w.day > p_day - 7 and w.day <= p_day
        order by w.id, f.friend_id, least(w.ended_at, o.ended_at) - greatest(w.started_at, o.started_at) desc
      ) x
    ), '[]'::jsonb),
    -- Friends' hounds that have been out walking in the last day.
    'park', coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_id', p.friend_id,
          'friendship_id', p.friendship_id,
          'owner', public.together_name(p.friend_id),
          'frame_id', pr.equipped_frame_id,
          'background_id', pr.equipped_background_id,
          'icon_id', pr.equipped_icon_id,
          'xp_total', pr.xp_total,
          'walks', p.walks,
          'minutes', p.minutes,
          'steps', p.steps,
          'last_at', p.last_at,
          'with_me', p.with_me,
          'name', v.name,
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
        ) order by p.last_at desc)
      from (
        select f.friend_id, f.friendship_id,
          count(*)::int as walks,
          round(sum(extract(epoch from w.ended_at - w.started_at)) / 60)::int as minutes,
          sum(w.steps)::int as steps,
          max(w.ended_at) as last_at,
          bool_or(exists (
            select 1 from public.hound_walks m
            where m.user_id = me and m.started_at < w.ended_at and m.ended_at > w.started_at
              and least(m.ended_at, w.ended_at) - greatest(m.started_at, w.started_at) >= interval '10 minutes'
          )) as with_me
        from public.together_friends(me) f
        join public.hound_walks w on w.user_id = f.friend_id and w.ended_at > now() - interval '24 hours'
        group by f.friend_id, f.friendship_id
        order by max(w.ended_at) desc
        limit 12
      ) p
      join public.profiles pr on pr.id = p.friend_id
      cross join lateral public.kennel_view(p.friend_id, p_day) v
    ), '[]'::jsonb),
    'me_walked', exists (select 1 from public.hound_walks w where w.user_id = me and w.ended_at > now() - interval '24 hours')
  );
end;
$$;

revoke execute on function public.my_together(date) from public, anon;
grant execute on function public.my_together(date) to authenticated;

-- Park visits, for Admin.
alter table public.walk_events drop constraint if exists walk_events_kind_check;
alter table public.walk_events add constraint walk_events_kind_check
  check (kind in ('book_open', 'diary_open', 'diary_share', 'park_open'));

create or replace function public.log_walk_event(p_kind text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_kind not in ('book_open', 'diary_open', 'diary_share', 'park_open') then
    raise exception 'Unknown event.';
  end if;
  insert into public.walk_events (user_id, kind) values (auth.uid(), p_kind)
    on conflict do nothing;
end;
$$;

revoke execute on function public.log_walk_event(text) from public, anon;
grant execute on function public.log_walk_event(text) to authenticated;

-- 0169's yard_view, with today's playmate as the guest: any friend who's
-- finished their goals too, not only one in a challenge together.
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
    -- today (0170: any friend, challenge-mates first).
    select m.friend_id, m.challenge into friend, together
    from public.together_playmate(p_user, p_day) m;

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

-- Admin → Overview → Together: playdates, walks together and the park.
create or replace function public.admin_together_overview()
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
    with pairs as (
      select distinct a.user_id as a_id, b.user_id as b_id, a.id as a_walk
      from public.hound_walks a
      join public.hound_walks b on b.user_id > a.user_id
        and b.started_at < a.ended_at and b.ended_at > a.started_at
        and least(a.ended_at, b.ended_at) - greatest(a.started_at, b.started_at) >= interval '10 minutes'
      join public.friendships fr on fr.status = 'accepted'
        and ((fr.requester_id = a.user_id and fr.recipient_id = b.user_id) or (fr.requester_id = b.user_id and fr.recipient_id = a.user_id))
      where a.ended_at > now() - interval '7 days'
    )
    select jsonb_build_object(
      'playdates_7d', (select count(*) from public.hound_playdates h where h.created_at > now() - interval '7 days'),
      'playdate_people_7d', (select count(distinct h.user_id) from public.hound_playdates h where h.created_at > now() - interval '7 days'),
      'playdates_all', (select count(*) from public.hound_playdates),
      'walks_together_7d', (select count(*) from pairs),
      'walkers_together_7d', (select count(*) from (select a_id from pairs union select b_id from pairs) x),
      'park_opens_7d', (select count(*) from public.walk_events e where e.kind = 'park_open' and e.day > current_date - 7),
      'park_visitors_7d', (select count(distinct e.user_id) from public.walk_events e where e.kind = 'park_open' and e.day > current_date - 7),
      'park_visitors_all', (select count(distinct e.user_id) from public.walk_events e where e.kind = 'park_open')
    )
  );
end;
$$;

revoke execute on function public.admin_together_overview() from public, anon;
grant execute on function public.admin_together_overview() to authenticated;
