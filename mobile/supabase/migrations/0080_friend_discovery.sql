-- Hound: easier ways to find friends in the beta.
--   * Find people — search Hound by name or username from the Friends tab.
--   * People you may know — people in your challenges, friends of
--     friends, and people who just joined.
--   * Beta download links — the TestFlight public link and the Android
--     APK link, shown on the friend-invite page and in the app's share
--     message, so an invite reaches someone who doesn't have Hound yet.
--
-- Admin → Find people switches search and suggestions on or off for
-- everyone, and holds the two links. Each person can also hide
-- themselves from both (Settings → Show me in Find people).
--
-- Both lists only ever return a display name, initials and equipped
-- cosmetics — never an email. Someone using their username in
-- challenges (0030) is shown, and matched, by their username only, so
-- searching their real name doesn't find them.
--
-- Run this once, after 0001-0079, in the SQL Editor.

create table public.friend_discovery_config (
  id boolean primary key default true,
  constraint friend_discovery_config_singleton check (id),
  search_enabled boolean not null default true,
  suggestions_enabled boolean not null default true,
  ios_beta_url text,
  android_beta_url text,
  updated_at timestamptz not null default now()
);

-- Starts with the current beta links; change them in Admin → Find people.
insert into public.friend_discovery_config (id, ios_beta_url, android_beta_url)
  values (true, 'https://testflight.apple.com/join/1UAWscQs', 'https://houndchallenge.net/get');

alter table public.friend_discovery_config enable row level security;

create policy "Anyone signed in can read the friend discovery config"
  on public.friend_discovery_config for select
  to authenticated
  using (true);

create policy "Only admins can update the friend discovery config"
  on public.friend_discovery_config for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- Per person: whether they show up in search and suggestions.
alter table public.profiles add column discoverable boolean not null default true;
grant update (discoverable) on public.profiles to authenticated;

-- How the caller relates to another person, for the Add button.
create or replace function public.friend_relation(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when f.status = 'accepted' then 'friends'
      when f.requester_id = p_me then 'requested'
      else 'incoming'
    end
    from public.friendships f
    where (f.requester_id = p_me and f.recipient_id = p_other)
       or (f.requester_id = p_other and f.recipient_id = p_me)
    limit 1
  ), 'none');
$$;

revoke execute on function public.friend_relation(uuid, uuid) from public, anon, authenticated;

create or replace function public.find_people(p_query text)
returns table (
  user_id uuid,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text,
  relation text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to do that.';
  end if;
  if not (select search_enabled from public.friend_discovery_config) then
    raise exception 'Find people is turned off right now.';
  end if;
  if length(q) < 2 then
    return;
  end if;
  -- Treat the search as plain text, not a LIKE pattern.
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
      public.friend_relation(auth.uid(), p.id)
    from public.profiles p
    where p.id <> auth.uid()
      and p.discoverable
      and (
        p.username ilike '%' || q || '%'
        or (not (p.use_username and p.username is not null) and p.name ilike '%' || q || '%')
      )
    order by
      (case when p.use_username and p.username is not null then p.username else p.name end) ilike q || '%' desc,
      (case when p.use_username and p.username is not null then p.username else p.name end)
    limit 20;
end;
$$;

-- Up to 10 people the caller isn't connected to yet, best reason first:
-- in a challenge with you, then friends of friends, then new to Hound
-- (joined in the last 14 days).
create or replace function public.people_you_may_know()
returns table (
  user_id uuid,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if not (select suggestions_enabled from public.friend_discovery_config) then
    return;
  end if;

  return query
    with my_friends as (
      select case when f.requester_id = me then f.recipient_id else f.requester_id end as fid
      from public.friendships f
      where f.status = 'accepted' and (f.requester_id = me or f.recipient_id = me)
    ),
    connected as (
      select case when f.requester_id = me then f.recipient_id else f.requester_id end as uid
      from public.friendships f
      where f.requester_id = me or f.recipient_id = me
    ),
    challenge_mates as (
      select distinct other.user_id as uid
      from public.challenge_participants mine
      join public.challenge_participants other
        on other.challenge_id = mine.challenge_id and other.user_id <> me
      where mine.user_id = me
    ),
    mutuals as (
      select case when f.requester_id = mf.fid then f.recipient_id else f.requester_id end as uid,
        count(*)::int as n
      from my_friends mf
      join public.friendships f
        on f.status = 'accepted' and (f.requester_id = mf.fid or f.recipient_id = mf.fid)
      group by 1
    ),
    candidates as (
      select p.id,
        case
          when cm.uid is not null then 1
          when mu.uid is not null then 2
          else 3
        end as rank,
        case
          when cm.uid is not null then 'In a challenge with you'
          when mu.n = 1 then '1 mutual friend'
          when mu.uid is not null then mu.n || ' mutual friends'
          else 'New to Hound'
        end as why,
        coalesce(mu.n, 0) as mutual_count,
        p.created_at
      from public.profiles p
      left join challenge_mates cm on cm.uid = p.id
      left join mutuals mu on mu.uid = p.id
      where p.id <> me
        and p.discoverable
        and not p.is_default_friend
        and p.id not in (select uid from connected)
        and (cm.uid is not null or mu.uid is not null or p.created_at > now() - interval '14 days')
    )
    select p.id,
      case when p.use_username and p.username is not null then p.username else p.name end,
      p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
      c.why
    from candidates c
    join public.profiles p on p.id = c.id
    order by c.rank, c.mutual_count desc, c.created_at desc
    limit 10;
end;
$$;

-- For the invite page (houndchallenge.net/f/<code>), which has no
-- session: just the two download links.
create or replace function public.beta_download_links()
returns table (ios_url text, android_url text)
language sql
stable
security definer
set search_path = public
as $$
  select ios_beta_url, android_beta_url from public.friend_discovery_config;
$$;

revoke execute on function public.find_people(text) from public, anon;
grant execute on function public.find_people(text) to authenticated;
revoke execute on function public.people_you_may_know() from public, anon;
grant execute on function public.people_you_may_know() to authenticated;
grant execute on function public.beta_download_links() to anon, authenticated;
