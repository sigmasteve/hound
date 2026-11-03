-- Hound: a friend's tricks in their yard.
--
-- yard_view gains 'tricks', the tricks the yard's hound knows (0158), so
-- on a friend's page a double-tap on their hound does one of theirs, as
-- it does in your own yard.
--
-- Run this once, after 0001-0158, in the SQL Editor.

-- 0157's yard_view, with the hound's tricks.
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.yard_view(uuid, date, boolean) from public, anon, authenticated;
