-- 0193: Pack Activities (Pack Fun, renamed), easier to find and to fill.
--
-- invite_to_pack_fun: anyone in a Pack Activity can invite more of their
-- friends while it's on or coming up. It says who was added and who
-- wasn't (not a friend, or already in it), so the app can tell you.
--
-- my_pack_funs gains the club and who started it, for Today's Needs you
-- and the Clubs tab.

create or replace function public.invite_to_pack_fun(p_pack uuid, p_invite uuid[])
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs%rowtype;
  wanted uuid[];
  added uuid[];
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null or not exists (
    select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me and m.joined_at is not null
  ) then
    raise exception 'not authorized';
  end if;
  if pf.settled_at is not null or pf.ends_at <= now() then
    raise exception 'That Pack Activity is over.';
  end if;
  select coalesce(array_agg(distinct u), '{}') into wanted
    from unnest(coalesce(p_invite, '{}')) u where u is not null and u <> me;
  select coalesce(array_agg(u), '{}') into added
    from unnest(wanted) u
   where public.dog_photo_are_friends(u, me)
     and not exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = u);
  if (select count(*) from public.pack_fun_members m where m.pack_id = p_pack) + coalesce(array_length(added, 1), 0) > 31 then
    raise exception 'A Pack Activity has room for 31.';
  end if;
  insert into public.pack_fun_members (pack_id, user_id) select p_pack, u from unnest(added) u on conflict do nothing;
  perform public.pack_fun_notify(p_pack, me, added,
    case when pf.starts_at > now() + interval '5 minutes' then '{name} invited you to a Pack Activity. Tap to see when.'
         else '{name} invited you to a Pack Activity that''s on now. Tap to join in.' end);
  return jsonb_build_object(
    'added', to_jsonb(added),
    'skipped', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u,
        'why', case when exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = u and not (u = any(added)))
                    then 'already' else 'not_friend' end)), '[]'::jsonb)
      from unnest(wanted) u where not (u = any(added)))
  );
end;
$$;
revoke execute on function public.invite_to_pack_fun(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_pack_fun(uuid, uuid[]) to authenticated;

-- Pack Funs for me: invited, live, coming up, and the last week's, with
-- the club and who started it.
create or replace function public.my_pack_funs()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'starts_at', f.starts_at, 'ends_at', f.ends_at, 'settled', f.settled_at is not null,
    'joined', m.joined_at is not null, 'invited', m.user_id is not null and m.joined_at is null,
    'created_by', f.created_by, 'map_on', f.map_on,
    'creator_name', case when p.use_username and p.username is not null then p.username else p.name end,
    'club_id', f.club_id, 'club_name', c.name,
    'people', (select count(*) from public.pack_fun_members x where x.pack_id = f.id and x.joined_at is not null)
  ) order by f.settled_at is not null, f.starts_at desc), '[]'::jsonb)
  from public.pack_funs f
  left join public.pack_fun_members m on m.pack_id = f.id and m.user_id = auth.uid()
  left join public.profiles p on p.id = f.created_by
  left join public.clubs c on c.id = f.club_id
  where (m.user_id is not null
         or (f.club_id is not null and f.settled_at is null and exists (select 1 from public.club_members cm where cm.club_id = f.club_id and cm.user_id = auth.uid())))
    and f.ends_at > now() - interval '7 days'
$$;
revoke execute on function public.my_pack_funs() from public, anon;
grant execute on function public.my_pack_funs() to authenticated;

-- Renamed for people: Pack Fun is now "Pack Activities". The messages
-- these three send or raise say so (bodies otherwise as in 0192, plus a
-- push to the club's members when one is opened to a club).

create or replace function public.start_pack_fun(
  p_name text, p_minutes integer, p_invite uuid[] default '{}', p_club uuid default null,
  p_trails boolean default true, p_flash boolean default true, p_map boolean default false,
  p_starts_at timestamptz default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_start timestamptz := greatest(coalesce(p_starts_at, now()), now());
  invitees uuid[];
begin
  if me is null then
    raise exception 'not authorized';
  end if;
  if not (public.pack_fun_cfg()).enabled then
    raise exception 'Pack Activities are paused right now.';
  end if;
  if v_name = '' then
    raise exception 'Give it a name.';
  end if;
  if p_minutes not in (30, 60, 120, 240) then
    raise exception 'Pick 30 minutes, 1, 2 or 4 hours.';
  end if;
  if v_start > now() + interval '14 days' then
    raise exception 'Start it within two weeks.';
  end if;
  if p_club is not null and not exists (select 1 from public.club_members c where c.club_id = p_club and c.user_id = me) then
    raise exception 'You''re not in that club.';
  end if;
  if (select count(*) from public.pack_funs f where f.created_by = me and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'That''s plenty of Pack Activities for one day.';
  end if;
  select coalesce(array_agg(distinct u), '{}') into invitees
    from unnest(coalesce(p_invite, '{}')) u
   where u <> me and public.dog_photo_are_friends(u, me);
  if array_length(invitees, 1) > 30 then
    raise exception 'Invite up to 30 friends.';
  end if;
  insert into public.pack_funs (created_by, name, club_id, starts_at, ends_at, trails_on, flash_on, map_on)
  values (me, left(v_name, 60), p_club, v_start, v_start + make_interval(mins => p_minutes), coalesce(p_trails, true), coalesce(p_flash, true), coalesce(p_map, false))
  returning id into v_id;
  insert into public.pack_fun_members (pack_id, user_id, joined_at) values (v_id, me, now());
  insert into public.pack_fun_members (pack_id, user_id) select v_id, u from unnest(invitees) u on conflict do nothing;
  perform public.pack_fun_notify(v_id, me, invitees,
    case when v_start > now() + interval '5 minutes' then '{name} invited you to a Pack Activity. Tap to see when.'
         else '{name} started a Pack Activity. Tap to join in.' end);
  -- Opened to a club: its members hear about it too (not anyone who
  -- muted the club, or was invited above).
  if p_club is not null then
    perform public.pack_fun_notify(v_id, me,
      (select coalesce(array_agg(c.user_id), '{}') from public.club_members c
        where c.club_id = p_club and not c.muted and c.user_id <> me and not (c.user_id = any(invitees))),
      case when v_start > now() + interval '5 minutes' then '{name} planned a Pack Activity for the club. Tap to see when.'
           else '{name} started a Pack Activity for the club. Tap to join in.' end);
  end if;
  return v_id;
end;
$$;

create or replace function public.join_pack_fun(p_pack uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null or pf.settled_at is not null or pf.ends_at <= now() then
    raise exception 'That Pack Activity is over.';
  end if;
  if not exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me)
     and not (pf.club_id is not null and exists (select 1 from public.club_members c where c.club_id = pf.club_id and c.user_id = me)) then
    raise exception 'You weren''t invited to that one.';
  end if;
  if (select count(*) from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null) >= 40 then
    raise exception 'That pack is full.';
  end if;
  insert into public.pack_fun_members (pack_id, user_id, joined_at) values (p_pack, me, now())
  on conflict (pack_id, user_id) do update set joined_at = coalesce(public.pack_fun_members.joined_at, now());
end;
$$;

create or replace function public.pack_fun_state(p_pack uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  pf public.pack_funs;
  cfg public.pack_fun_config := public.pack_fun_cfg();
  total integer;
  trails integer;
  t public.pack_fun_trails;
  pz public.pack_fun_puzzles;
  fl public.pack_fun_flashes;
begin
  select * into pf from public.pack_funs f where f.id = p_pack;
  if pf.id is null then
    raise exception 'That Pack Activity is gone.';
  end if;
  if not exists (select 1 from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me)
     and not (pf.club_id is not null and exists (select 1 from public.club_members c where c.club_id = pf.club_id and c.user_id = me)) then
    raise exception 'not authorized';
  end if;
  select coalesce(sum(m.steps), 0) into total from public.pack_fun_members m where m.pack_id = p_pack and m.joined_at is not null;
  select count(*) into trails from public.pack_fun_trails x where x.pack_id = p_pack;
  select * into t from public.pack_fun_trails x where x.pack_id = p_pack order by x.seq desc limit 1;
  if t.id is not null then
    select * into pz from public.pack_fun_puzzles p where p.id = t.puzzle_id;
  end if;
  select * into fl from public.pack_fun_flashes x where x.pack_id = p_pack order by x.starts_at desc limit 1;
  return jsonb_build_object(
    'id', pf.id, 'name', pf.name, 'created_by', pf.created_by, 'club_id', pf.club_id,
    'starts_at', pf.starts_at, 'ends_at', pf.ends_at, 'settled', pf.settled_at is not null,
    'trails_on', pf.trails_on, 'flash_on', pf.flash_on, 'map_on', pf.map_on,
    'joined', public.pack_fun_member_of(p_pack, me),
    'muted', coalesce((select m.muted from public.pack_fun_members m where m.pack_id = p_pack and m.user_id = me), false),
    'pack_steps', total,
    'trail_every', cfg.trail_every_steps,
    'next_trail_at', (trails + 1) * cfg.trail_every_steps,
    'trails_solved', (select count(*) from public.pack_fun_trails x where x.pack_id = p_pack and x.first_user is not null),
    'bones', jsonb_build_object('trail_first', cfg.trail_first_bones, 'trail_answer', cfg.trail_answer_bones,
      'flash_win', cfg.flash_win_bones, 'push_bonus', cfg.push_bonus_bones, 'finish', cfg.finish_bonus_bones, 'bone_find', cfg.bone_find_bones),
    'my_bones', (select coalesce(sum(r.bones), 0) from public.pack_fun_rewards r where r.pack_id = p_pack and r.user_id = me),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', case when p.use_username and p.username is not null then p.username else p.name end,
        'initials', p.initials, 'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id,
        'joined', m.joined_at is not null, 'steps', m.steps, 'steps_at', m.steps_at, 'live', m.live_at > now() - interval '45 seconds',
        'lat', case when pf.map_on and pf.settled_at is null and m.loc_at > now() - interval '10 minutes' then m.lat end,
        'lng', case when pf.map_on and pf.settled_at is null and m.loc_at > now() - interval '10 minutes' then m.lng end,
        'loc_at', m.loc_at,
        'bones', (select coalesce(sum(r.bones), 0) from public.pack_fun_rewards r where r.pack_id = p_pack and r.user_id = m.user_id)
      ) order by m.joined_at is null, m.steps desc)
      from public.pack_fun_members m join public.profiles p on p.id = m.user_id
      where m.pack_id = p_pack
    ), '[]'::jsonb),
    'trail', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'seq', t.seq, 'opened_at', t.opened_at, 'closes_at', t.closes_at, 'open', t.closes_at > now() and t.first_user is null and pf.settled_at is null,
      'question', pz.question, 'choices', to_jsonb(pz.choices), 'kind', pz.kind,
      'first_user', t.first_user,
      'answer', case when t.first_user is not null or t.closes_at <= now() or exists (select 1 from public.pack_fun_answers a where a.trail_id = t.id and a.user_id = me) then pz.answer end,
      'my_choice', (select a.choice from public.pack_fun_answers a where a.trail_id = t.id and a.user_id = me),
      'answered', (select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) from public.pack_fun_answers a where a.trail_id = t.id)
    ) end,
    'flash', case when fl.id is null then null else jsonb_build_object(
      'id', fl.id, 'kind', fl.kind, 'started_by', fl.started_by, 'starts_at', fl.starts_at, 'ends_at', fl.ends_at, 'target', fl.target,
      'start_steps', fl.start_steps, 'settled', fl.settled_at is not null, 'result', fl.result
    ) end,
    'cheers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'kind', c.kind, 'at', c.created_at) order by c.created_at desc)
      from (select * from public.pack_fun_cheers c where c.pack_id = p_pack and c.created_at > now() - interval '10 minutes' order by c.created_at desc limit 10) c
    ), '[]'::jsonb),
    'map_bones', case when pf.map_on and pf.settled_at is null then coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'lat', b.lat, 'lng', b.lng))
      from public.pack_fun_bones b where b.pack_id = p_pack and b.found_by is null and b.expires_at > now()
    ), '[]'::jsonb) else '[]'::jsonb end,
    'bones_found', (select count(*) from public.pack_fun_bones b where b.pack_id = p_pack and b.found_by is not null)
  );
end;
$$;

