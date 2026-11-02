-- Hound: visiting yards (the Yard's phase 3, after 0148 and 0149).
--
--   Pawprints: on a friend's yard, leave a pawprint. Free, once a day
--   per friend. They show by your friend's gate for a day, and the
--   Kennel lists who stopped by.
--
--   Treats: toss a friend's hound a treat for 10 Bones, once a day per
--   friend, if it hasn't had one today. It counts as its treat for the
--   day (0104's mood rules: two extra goal days), and in classic care
--   it fills a heart, just as their own would.
--
--   Both send the yard's owner a push (send-social-push, kinds
--   yard_pawprint and yard_treat) when they have those turned on.
--
--   Hound visits: on a day you and a friend have both finished your
--   goals and are in a challenge together, their hound comes over to
--   play in your yard. If there's more than one, one is picked for the
--   day. Nothing is stored for it; my_yard works it out.
--
-- Run this once, after 0001-0149, in the SQL Editor, then deploy
-- send-social-push, before publishing the app update that goes with it.

create table public.yard_visits (
  host_id uuid not null references public.profiles (id) on delete cascade,
  visitor_id uuid not null references public.profiles (id) on delete cascade,
  -- The visitor's own day.
  day date not null,
  pawprint boolean not null default false,
  treat boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (host_id, visitor_id, day),
  check (host_id <> visitor_id)
);

create index yard_visits_host_recent on public.yard_visits (host_id, updated_at desc);

alter table public.yard_visits enable row level security;

-- Written only through leave_pawprint and toss_yard_treat.
create policy "Hosts and visitors can view their visits"
  on public.yard_visits for select to authenticated
  using (host_id = auth.uid() or visitor_id = auth.uid());

revoke all on public.yard_visits from anon;
revoke insert, update, delete on public.yard_visits from authenticated;

-- 0148's yard_view, now for a day, with visits:
--   pawprints  how many friends left one in the last day
--   visitors   who stopped by in the last day, and what they left
--              (only with p_private: the yard's owner looking)
--   guest      a friend's hound over to play (also only for the owner)
drop function if exists public.yard_view(uuid);

create function public.yard_view(p_user uuid, p_day date, p_private boolean)
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
            'breed_id', v.breed_id
          )
          into guest
        from public.kennel_view(friend, p_day) v
        cross join public.profiles p
        where p.id = friend;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'size', sz, 'spots', spots, 'trophies', won, 'shown', to_jsonb(shown),
    'pawprints', prints, 'visitors', visitors, 'guest', guest
  );
end;
$$;

revoke execute on function public.yard_view(uuid, date, boolean) from public, anon, authenticated;

create or replace function public.my_yard(p_local_date date)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  return public.yard_view(public.kennel_caller(p_local_date), p_local_date, true);
end;
$$;

-- A friend's yard, with what you've left there today (mine).
create or replace function public.friend_yard(p_friend uuid, p_local_date date)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'utc')::date;
  v public.yard_visits;
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_local_date is null or p_local_date < utc_today - 1 or p_local_date > utc_today + 1 then
    raise exception 'Invalid date.';
  end if;
  if public.friend_relation(auth.uid(), p_friend) <> 'friends' then
    raise exception 'Only friends can visit each other''s yards.';
  end if;
  select * into v from public.yard_visits x
    where x.host_id = p_friend and x.visitor_id = auth.uid() and x.day = p_local_date;
  return public.yard_view(p_friend, p_local_date, false)
    || jsonb_build_object('mine', jsonb_build_object('pawprint', coalesce(v.pawprint, false), 'treat', coalesce(v.treat, false)));
end;
$$;

-- Free, once a day per friend; a second one the same day does nothing.
create or replace function public.leave_pawprint(p_friend uuid, p_local_date date)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
begin
  if public.friend_relation(me, p_friend) <> 'friends' then
    raise exception 'Only friends can visit each other''s yards.';
  end if;
  if exists (
    select 1 from public.yard_visits v
    where v.host_id = p_friend and v.visitor_id = me and v.day = p_local_date and v.pawprint
  ) then
    return;
  end if;
  insert into public.yard_visits (host_id, visitor_id, day, pawprint) values (p_friend, me, p_local_date, true)
  on conflict (host_id, visitor_id, day) do update set pawprint = true, updated_at = now();
  if public.social_push_reachable(p_friend) then
    perform public.social_notify(jsonb_build_object(
      'kind', 'yard_pawprint', 'from_user', me, 'to_user', p_friend, 'challenge_id', null,
      'hound_name', coalesce((select k.name from public.kennels k where k.user_id = p_friend), 'Scout')
    ));
  end if;
end;
$$;

revoke execute on function public.leave_pawprint(uuid, date) from public, anon;
grant execute on function public.leave_pawprint(uuid, date) to authenticated;

-- 10 Bones from you; their hound's treat for the day. Returns your
-- balance after.
create or replace function public.toss_yard_treat(p_friend uuid, p_local_date date)
returns integer
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
  if public.friend_relation(me, p_friend) <> 'friends' then
    raise exception 'Only friends can visit each other''s yards.';
  end if;
  if exists (
    select 1 from public.yard_visits v
    where v.host_id = p_friend and v.visitor_id = me and v.day = p_local_date and v.treat
  ) then
    raise exception 'You''ve tossed them a treat today. Back tomorrow.';
  end if;
  insert into public.kennels (user_id, hearts_on) values (p_friend, p_local_date) on conflict (user_id) do nothing;
  select * into k from public.kennels x where x.user_id = p_friend for update;
  if k.treated_on >= p_local_date then
    raise exception 'They''ve had a treat today. Try tomorrow.';
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
    where x.user_id = p_friend;
  insert into public.yard_visits (host_id, visitor_id, day, treat) values (p_friend, me, p_local_date, true)
  on conflict (host_id, visitor_id, day) do update set treat = true, updated_at = now();

  if public.social_push_reachable(p_friend) then
    perform public.social_notify(jsonb_build_object(
      'kind', 'yard_treat', 'from_user', me, 'to_user', p_friend, 'challenge_id', null, 'hound_name', k.name
    ));
  end if;
  return balance - price;
end;
$$;

revoke execute on function public.toss_yard_treat(uuid, date) from public, anon;
grant execute on function public.toss_yard_treat(uuid, date) to authenticated;

-- Undo, if needed:
--   drop function public.toss_yard_treat(uuid, date);
--   drop function public.leave_pawprint(uuid, date);
--   drop table public.yard_visits;
--   then run 0148's yard_view, my_yard and friend_yard again (dropping
--   yard_view(uuid, date, boolean) first).
