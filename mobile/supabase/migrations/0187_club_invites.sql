-- Hound: invite friends to a club (Steve: "As a club creator, I need
-- the option to add/invite users directly to the club - from my friend
-- list"). Anyone in a club picks friends from their friends list; each
-- gets a push and an invite at the top of their Clubs tab, with Join and
-- No thanks. An invite gets them into a private club without its code.
-- Joining still asks the usual: a username and the "13 or older" check.
--
-- Run this once, after 0186, in the SQL Editor, then redeploy the
-- send-social-push function (the invite push), before publishing the
-- app update that goes with it.

create table if not exists public.club_invites (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (club_id, user_id)
);
create index if not exists club_invites_user on public.club_invites (user_id) where status = 'pending';
alter table public.club_invites enable row level security;
revoke all on public.club_invites from anon, authenticated;

-- Your friends, for a club's Invite friends list: who's in it already
-- and who's been invited.
create or replace function public.friends_for_club(p_club_id uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.id,
      'name', case when p.use_username and p.username is not null then p.username else p.name end,
      'initials', p.initials,
      'frame', p.equipped_frame_id, 'background', p.equipped_background_id, 'icon', p.equipped_icon_id,
      'member', exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = p.id),
      'invited', exists (select 1 from public.club_invites i where i.club_id = p_club_id and i.user_id = p.id and i.status = 'pending')
    ) order by p.name), '[]'::jsonb)
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.recipient_id else f.requester_id end
  where f.status = 'accepted' and (f.requester_id = auth.uid() or f.recipient_id = auth.uid())
    and exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid());
$$;
revoke execute on function public.friends_for_club(uuid) from public, anon;
grant execute on function public.friends_for_club(uuid) to authenticated;

-- Invite friends to a club you're in. Only your friends, and only those
-- not in it or already invited. A declined invite can be sent again.
-- Returns how many were invited.
create or replace function public.invite_to_club(p_club_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cl public.clubs;
  invited uuid[];
begin
  select * into cl from public.clubs c where c.id = p_club_id and c.removed_at is null;
  if not found or not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = me) then
    raise exception 'Only people in the club can invite to it.';
  end if;
  with picked as (
    select distinct u from unnest(coalesce(p_user_ids, '{}')) u
    where u <> me
      and exists (
        select 1 from public.friendships f where f.status = 'accepted'
          and ((f.requester_id = me and f.recipient_id = u) or (f.recipient_id = me and f.requester_id = u))
      )
      and not exists (select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = u)
  ),
  upserted as (
    insert into public.club_invites (club_id, user_id, invited_by)
    select p_club_id, u, me from picked
    on conflict (club_id, user_id) do update
      set invited_by = excluded.invited_by, status = 'pending', created_at = now(), responded_at = null
      where public.club_invites.status <> 'pending'
    returning user_id
  )
  select array_agg(user_id) into invited from upserted;
  if invited is not null then
    perform public.social_notify(jsonb_build_object(
      'kind', 'club_invite',
      'from_user', me,
      'to_users', to_jsonb((select array_agg(u) from unnest(invited) u where public.social_push_reachable(u))),
      'club_id', cl.id,
      'club_name', cl.name
    ))
    where exists (select 1 from unnest(invited) u where public.social_push_reachable(u));
  end if;
  return coalesce(array_length(invited, 1), 0);
end;
$$;
revoke execute on function public.invite_to_club(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_club(uuid, uuid[]) to authenticated;

-- Club invites waiting on you, newest first.
create or replace function public.my_club_invites()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(public.club_row(c, auth.uid()) || jsonb_build_object(
      'invited_by', (select case when p.use_username and p.username is not null then p.username else p.name end
                     from public.profiles p where p.id = i.invited_by)
    ) order by i.created_at desc), '[]'::jsonb)
  from public.club_invites i join public.clubs c on c.id = i.club_id
  where i.user_id = auth.uid() and i.status = 'pending' and c.removed_at is null;
$$;
revoke execute on function public.my_club_invites() from public, anon;
grant execute on function public.my_club_invites() to authenticated;

-- Join from an invite (private or public), with the usual asks.
create or replace function public.accept_club_invite(p_club_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.club_invites i where i.club_id = p_club_id and i.user_id = me and i.status = 'pending') then
    raise exception 'That invite isn''t there anymore.';
  end if;
  perform public.club_raise(public.club_join_problem(p_club_id, me));
  insert into public.club_members (club_id, user_id) values (p_club_id, me) on conflict do nothing;
  update public.club_invites i set status = 'accepted', responded_at = now() where i.club_id = p_club_id and i.user_id = me;
end;
$$;
revoke execute on function public.accept_club_invite(uuid) from public, anon;
grant execute on function public.accept_club_invite(uuid) to authenticated;

create or replace function public.decline_club_invite(p_club_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.club_invites i set status = 'declined', responded_at = now()
  where i.club_id = p_club_id and i.user_id = auth.uid() and i.status = 'pending';
$$;
revoke execute on function public.decline_club_invite(uuid) from public, anon;
grant execute on function public.decline_club_invite(uuid) to authenticated;

-- Joining by code or search also settles any invite.
create or replace function public.club_invites_settle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.club_invites i set status = 'accepted', responded_at = now()
  where i.club_id = new.club_id and i.user_id = new.user_id and i.status = 'pending';
  return new;
end;
$$;
revoke execute on function public.club_invites_settle() from public, anon, authenticated;
drop trigger if exists club_invites_settle on public.club_members;
create trigger club_invites_settle after insert on public.club_members
  for each row execute function public.club_invites_settle();

-- The Clubs tab's badge: new club challenges you haven't joined, and
-- club invites waiting on you (0187).
create or replace function public.clubs_badge()
returns int
language sql
stable
security definer set search_path = public
as $$
  select (
    coalesce((
      select sum((public.club_row(c, auth.uid())->>'new')::int)
      from public.club_members m join public.clubs c on c.id = m.club_id
      where m.user_id = auth.uid() and c.removed_at is null and not m.muted
    ), 0)
    + (select count(*) from public.club_invites i join public.clubs c on c.id = i.club_id
       where i.user_id = auth.uid() and i.status = 'pending' and c.removed_at is null)
  )::int;
$$;
revoke execute on function public.clubs_badge() from public, anon;
grant execute on function public.clubs_badge() to authenticated;

-- 0185's, with invites.
create or replace function public.admin_clubs_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  with live as (select * from public.clubs c where c.removed_at is null)
  select jsonb_build_object(
    'config', (select to_jsonb(cfg) - 'id' from public.club_config cfg),
    'clubs', (select count(*) from live),
    'public', (select count(*) from live where is_public),
    'private', (select count(*) from live where not is_public),
    'new_7d', (select count(*) from live where created_at > now() - interval '7 days'),
    'people', (select count(distinct m.user_id) from public.club_members m join live l on l.id = m.club_id),
    'memberships', (select count(*) from public.club_members m join live l on l.id = m.club_id),
    'joined_7d', (select count(*) from public.club_members m join live l on l.id = m.club_id where m.joined_at > now() - interval '7 days' and m.role <> 'owner'),
    'active_30d', (select count(distinct cp.club_id) from public.club_posts cp join live l on l.id = cp.club_id where cp.posted_at > now() - interval '30 days'),
    'posts_30d', (select count(*) from public.club_posts cp where cp.posted_at > now() - interval '30 days'),
    'club_joins_30d', (select count(*) from public.club_joins j where j.joined_at > now() - interval '30 days'),
    'invites_30d', (select count(*) from public.club_invites i where i.created_at > now() - interval '30 days'),
    'invites_accepted_30d', (select count(*) from public.club_invites i where i.status = 'accepted' and i.created_at > now() - interval '30 days'),
    'by_sport', coalesce((select jsonb_object_agg(s.sport, s.n) from (select sport, count(*) n from live group by sport) s), '{}'::jsonb),
    'newest', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'sport', c.sport, 'city', c.city, 'is_public', c.is_public, 'created_at', c.created_at,
        'members', (select count(*) from public.club_members m where m.club_id = c.id),
        'posts', (select count(*) from public.club_posts cp where cp.club_id = c.id),
        'owner', (select coalesce(p.username, p.name) from public.club_members m join public.profiles p on p.id = m.user_id where m.club_id = c.id and m.role = 'owner')
      ) order by c.created_at desc)
      from (select * from live order by created_at desc limit 20) c
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke execute on function public.admin_clubs_overview() from public, anon;
grant execute on function public.admin_clubs_overview() to authenticated;
