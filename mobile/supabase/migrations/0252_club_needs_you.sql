-- 0252: club games on Today's Needs you. A challenge posted to one of
-- your clubs that you can still join shows there with Join and Not now,
-- until you join, say Not now, or joining closes. Muted clubs, your own
-- posts and challenges you've been invited to directly (the invite shows
-- instead) are left out. Admin sees how many it reaches and what they do.

-- "Not now" on a club game in Needs you.
create table if not exists public.club_post_dismissals (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
alter table public.club_post_dismissals enable row level security;
revoke all on public.club_post_dismissals from anon, authenticated;

-- Where a club join came from: the club's page or Needs you.
alter table public.club_joins add column if not exists via text not null default 'club'
  check (via in ('club', 'needs_you'));

-- When a challenge stops taking new players (club_challenge_open's window).
create or replace function public.club_join_closes(c public.challenges)
returns timestamptz
language sql
stable
as $$
  select least(
    c.ends_at,
    coalesce(c.join_closes_at, 'infinity'::timestamptz),
    case
      when c.kind = 'hunt' and coalesce(c.head_start_days, 0) > 0 then c.starts_at + make_interval(days => c.head_start_days)
      else greatest(c.starts_at, c.created_at) + interval '24 hours'
    end
  );
$$;
revoke execute on function public.club_join_closes(public.challenges) from public, anon, authenticated;

-- The club games waiting on someone, one row per challenge (the club it
-- was first posted to), soonest to close first.
create or replace function public.club_waiting_for(p_user uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(w.row order by w.closes, w.posted_at), '[]'::jsonb)
  from (
    select distinct on (c.id)
      c.id, cp.posted_at, public.club_join_closes(c) as closes,
      jsonb_build_object(
        'club_id', cl.id,
        'club_name', cl.name,
        'club_sport', cl.sport,
        'club_color', cl.color,
        'challenge_id', c.id,
        'challenge_name', c.name,
        'kind', c.kind,
        'starts_at', c.starts_at,
        'ends_at', c.ends_at,
        'closes_at', public.club_join_closes(c),
        'posted_by', public.club_name_of(cp.posted_by),
        'posted_at', cp.posted_at,
        'players', (select count(*) from public.challenge_participants p where p.challenge_id = c.id)
      ) as row
    from public.club_members m
    join public.clubs cl on cl.id = m.club_id and cl.removed_at is null
    join public.club_posts cp on cp.club_id = cl.id
    join public.challenges c on c.id = cp.challenge_id
    where m.user_id = p_user
      and not m.muted
      and cp.posted_by is distinct from p_user
      and public.club_challenge_open(c)
      and not exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = p_user)
      and not exists (select 1 from public.challenge_invites i where i.challenge_id = c.id and i.invitee_id = p_user)
      and not exists (select 1 from public.club_post_dismissals d where d.challenge_id = c.id and d.user_id = p_user)
    order by c.id, cp.posted_at
  ) w;
$$;
revoke execute on function public.club_waiting_for(uuid) from public, anon, authenticated;

create or replace function public.club_waiting()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select public.club_waiting_for(auth.uid());
$$;
revoke execute on function public.club_waiting() from public, anon;
grant execute on function public.club_waiting() to authenticated;

-- "Not now": it leaves Needs you. It stays on the club's page.
create or replace function public.dismiss_club_waiting(p_challenge_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.club_post_dismissals (user_id, challenge_id)
  select auth.uid(), p_challenge_id where auth.uid() is not null
  on conflict do nothing;
$$;
revoke execute on function public.dismiss_club_waiting(uuid) from public, anon;
grant execute on function public.dismiss_club_waiting(uuid) to authenticated;

-- Joining through a club, now saying where from (an older app leaves
-- p_via out: the club's page).
drop function if exists public.join_club_challenge(uuid, uuid);
create or replace function public.join_club_challenge(p_club_id uuid, p_challenge_id uuid, p_via text default 'club')
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c public.challenges;
begin
  if not exists (select 1 from public.club_members m join public.clubs x on x.id = m.club_id
                 where m.club_id = p_club_id and m.user_id = me and x.removed_at is null) then
    raise exception 'Join the club first.';
  end if;
  if not exists (select 1 from public.club_posts cp where cp.club_id = p_club_id and cp.challenge_id = p_challenge_id) then
    raise exception 'That challenge isn''t in this club anymore.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if exists (select 1 from public.challenge_participants p where p.challenge_id = c.id and p.user_id = me) then
    return;
  end if;
  if not public.club_challenge_open(c) then
    raise exception 'Joining for this challenge has closed.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id, role)
    values (c.id, me, case when c.kind = 'hunt' then 'hunted' end)
    on conflict (challenge_id, user_id) do nothing;
  delete from public.challenge_invites i where i.challenge_id = c.id and i.invitee_id = me;
  insert into public.club_joins (club_id, challenge_id, user_id, via)
    values (p_club_id, c.id, me, case when p_via = 'needs_you' then 'needs_you' else 'club' end)
    on conflict do nothing;
end;
$$;
revoke execute on function public.join_club_challenge(uuid, uuid, text) from public, anon;
grant execute on function public.join_club_challenge(uuid, uuid, text) to authenticated;

-- Admin → Clubs: how many have a club game waiting in Needs you now, and
-- what people did with them over 30 days.
create or replace function public.admin_club_needs_overview()
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
  with people as (
    select distinct m.user_id from public.club_members m
    join public.clubs cl on cl.id = m.club_id and cl.removed_at is null
    where not m.muted
  ), waiting as (
    select u.user_id, jsonb_array_length(public.club_waiting_for(u.user_id)) as n from people u
  )
  select jsonb_build_object(
    'people_waiting', (select count(*) from waiting where n > 0),
    'games_waiting', (select coalesce(sum(n), 0) from waiting),
    'joined_needs_you_30d', (select count(*) from public.club_joins j where j.via = 'needs_you' and j.joined_at > now() - interval '30 days'),
    'joined_club_page_30d', (select count(*) from public.club_joins j where j.via = 'club' and j.joined_at > now() - interval '30 days'),
    'people_needs_you', (select count(distinct j.user_id) from public.club_joins j where j.via = 'needs_you'),
    'not_now_30d', (select count(*) from public.club_post_dismissals d where d.dismissed_at > now() - interval '30 days')
  ) into result;
  return result;
end;
$$;
revoke execute on function public.admin_club_needs_overview() from public, anon;
grant execute on function public.admin_club_needs_overview() to authenticated;
