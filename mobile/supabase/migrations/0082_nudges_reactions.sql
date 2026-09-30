-- Hound: nudges and challenge reactions.
--
--   Nudge     "Jordan nudged you 👋" — a push to a friend, or to someone
--             in a challenge with you, to get moving. One per person you
--             nudge per 20 hours. Nudges from the last day also show on
--             the recipient's Today, so one still lands for someone who
--             can't get pushes.
--   Reaction  🔥 💪 👏 😮 on someone's progress in a challenge you're
--             both in, for today. Tap again to take it back. The first
--             reaction you give someone in a challenge each day pushes
--             them; the rest just show on the leaderboard.
--
-- Both push through send-social-push, called from inside the RPCs via
-- pg_net and wrapped so a notification failure never undoes the nudge or
-- reaction (same shape as 0077's admin_signup_notify). Anyone can turn
-- these pushes off: Settings → Notifications → Advanced
-- (profiles.alert_social_push_enabled).
--
-- Before running: deploy the function —
--   supabase functions deploy send-social-push
--
-- Run this once, after 0001-0081, in the SQL Editor.

alter table public.profiles
  add column alert_social_push_enabled boolean not null default true;

grant update (alert_social_push_enabled) on public.profiles to authenticated;

-- ── Nudges ───────────────────────────────────────────────────────────

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  -- The challenge it was sent from, if any — the push opens it.
  challenge_id uuid references public.challenges (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create index nudges_to_user_created_at on public.nudges (to_user, created_at desc);
create index nudges_from_user_created_at on public.nudges (from_user, created_at desc);

alter table public.nudges enable row level security;

-- Written only through send_nudge.
create policy "Either side of a nudge can view it"
  on public.nudges for select
  to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- ── Reactions ────────────────────────────────────────────────────────

create table public.challenge_reactions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('🔥', '💪', '👏', '😮')),
  -- The reacting person's own calendar day, so "today" matches what
  -- their leaderboard shows.
  day date not null,
  created_at timestamptz not null default now(),
  check (from_user <> to_user),
  unique (challenge_id, from_user, to_user, emoji, day)
);

create index challenge_reactions_challenge_day on public.challenge_reactions (challenge_id, day);

alter table public.challenge_reactions enable row level security;

-- Written only through toggle_reaction.
create policy "Participants can view a challenge's reactions"
  on public.challenge_reactions for select
  to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));

-- ── Push ─────────────────────────────────────────────────────────────

create or replace function public.social_notify(p_body jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-social-push',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := p_body
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.social_notify(jsonb) from public, anon, authenticated;

-- Whether a push to this person can arrive: they haven't turned these
-- off, and a phone is registered (0081).
create or replace function public.social_push_reachable(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select p.alert_social_push_enabled from public.profiles p where p.id = p_user), false)
    and exists (select 1 from public.device_push_tokens t where t.user_id = p_user);
$$;

revoke execute on function public.social_push_reachable(uuid) from public, anon, authenticated;

-- ── RPCs ─────────────────────────────────────────────────────────────

-- Friends can nudge each other anytime; people in the same challenge can
-- nudge each other from it — except in a global challenge (0075), where
-- everyone's a stranger, so only friends there too.
-- Returns whether a push was sent; either way the nudge shows on their
-- Today.
create or replace function public.send_nudge(p_to uuid, p_challenge_id uuid default null)
returns table (pushed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  last_at timestamptz;
  is_friend boolean;
  in_challenge boolean;
  challenge_ok boolean;
  can_push boolean;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_to is null or p_to = me then
    raise exception 'You can''t nudge yourself.';
  end if;

  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = me and f.recipient_id = p_to) or (f.requester_id = p_to and f.recipient_id = me))
  ) into is_friend;

  in_challenge := p_challenge_id is not null
    and public.is_challenge_participant(p_challenge_id, me)
    and public.is_challenge_participant(p_challenge_id, p_to);
  challenge_ok := in_challenge
    and not coalesce((select c.is_global from public.challenges c where c.id = p_challenge_id), false);
  -- Only tie it to a challenge you're both in.
  if not in_challenge then
    p_challenge_id := null;
  end if;

  if not (is_friend or challenge_ok) then
    raise exception 'You can only nudge friends, or people in a challenge with you.';
  end if;

  select max(n.created_at) into last_at
    from public.nudges n
    where n.from_user = me and n.to_user = p_to and n.created_at > now() - interval '20 hours';
  if last_at is not null then
    raise exception 'You already nudged them today — try again %.',
      case when last_at + interval '20 hours' - now() < interval '1 hour' then 'in a bit'
           else 'in ' || ceil(extract(epoch from (last_at + interval '20 hours' - now())) / 3600)::int || 'h' end;
  end if;

  insert into public.nudges (from_user, to_user, challenge_id) values (me, p_to, p_challenge_id);

  can_push := public.social_push_reachable(p_to);
  if can_push then
    perform public.social_notify(jsonb_build_object(
      'kind', 'nudge', 'from_user', me, 'to_user', p_to, 'challenge_id', p_challenge_id));
  end if;
  return query select can_push;
end;
$$;

-- Who the caller has nudged in the last 20 hours, for the buttons.
create or replace function public.my_recent_nudges()
returns table (to_user uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select n.to_user, max(n.created_at)
  from public.nudges n
  where n.from_user = auth.uid() and n.created_at > now() - interval '20 hours'
  group by n.to_user;
$$;

-- Nudges the caller got in the last day, newest first, for Today.
create or replace function public.nudges_received()
returns table (
  from_user uuid,
  name text,
  initials text,
  frame_id text,
  background_id text,
  icon_id text,
  challenge_id uuid,
  challenge_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (n.from_user)
    n.from_user,
    case when p.use_username and p.username is not null then p.username else p.name end,
    p.initials, p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id,
    n.challenge_id, c.name, n.created_at
  from public.nudges n
  join public.profiles p on p.id = n.from_user
  left join public.challenges c on c.id = n.challenge_id
  where n.to_user = auth.uid() and n.created_at > now() - interval '24 hours'
  order by n.from_user, n.created_at desc;
$$;

-- Which reactions have already pushed today, so taking one back and
-- adding another doesn't push again. Internal.
create table public.reaction_pushes (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  primary key (challenge_id, from_user, to_user, day)
);

alter table public.reaction_pushes enable row level security;
-- No policies: only toggle_reaction (security definer) touches it.

-- Adds the reaction, or takes it back if it's already there. Returns
-- whether it's on now. p_day is the caller's local date, kept within a
-- day of the server's so it can't be backdated.
create or replace function public.toggle_reaction(p_challenge_id uuid, p_to uuid, p_emoji text, p_day date)
returns table (reacted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  removed int;
  first_today boolean;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if p_to is null or p_to = me then
    raise exception 'You can''t react to yourself.';
  end if;
  if p_emoji not in ('🔥', '💪', '👏', '😮') then
    raise exception 'That reaction isn''t available.';
  end if;
  if p_day is null or abs(p_day - current_date) > 1 then
    raise exception 'Check your phone''s date and try again.';
  end if;
  if not (public.is_challenge_participant(p_challenge_id, me) and public.is_challenge_participant(p_challenge_id, p_to)) then
    raise exception 'You can only react to people in a challenge with you.';
  end if;

  delete from public.challenge_reactions r
    where r.challenge_id = p_challenge_id and r.from_user = me and r.to_user = p_to
      and r.emoji = p_emoji and r.day = p_day;
  get diagnostics removed = row_count;
  if removed > 0 then
    return query select false;
    return;
  end if;

  -- Only the first reaction to someone in a challenge each day pushes,
  -- including one that was given and taken back.
  select not exists (
    select 1 from public.challenge_reactions r
    where r.challenge_id = p_challenge_id and r.from_user = me and r.to_user = p_to and r.day = p_day
  ) and not exists (
    select 1 from public.reaction_pushes rp
    where rp.challenge_id = p_challenge_id and rp.from_user = me and rp.to_user = p_to and rp.day = p_day
  ) into first_today;

  insert into public.challenge_reactions (challenge_id, from_user, to_user, emoji, day)
    values (p_challenge_id, me, p_to, p_emoji, p_day);

  if first_today then
    insert into public.reaction_pushes (challenge_id, from_user, to_user, day)
      values (p_challenge_id, me, p_to, p_day)
      on conflict do nothing;
    if public.social_push_reachable(p_to) then
      perform public.social_notify(jsonb_build_object(
        'kind', 'reaction', 'from_user', me, 'to_user', p_to, 'challenge_id', p_challenge_id, 'emoji', p_emoji));
    end if;
  end if;
  return query select true;
end;
$$;

-- A challenge's reactions for one day, with who gave each.
create or replace function public.challenge_reactions_for_day(p_challenge_id uuid, p_day date)
returns table (to_user uuid, emoji text, from_user uuid, from_name text)
language sql
stable
security definer
set search_path = public
as $$
  select r.to_user, r.emoji, r.from_user,
    case when p.use_username and p.username is not null then p.username else p.name end
  from public.challenge_reactions r
  join public.profiles p on p.id = r.from_user
  where r.challenge_id = p_challenge_id and r.day = p_day
    and public.is_challenge_participant(p_challenge_id, auth.uid())
  order by r.created_at;
$$;

revoke execute on function public.send_nudge(uuid, uuid) from public, anon;
grant execute on function public.send_nudge(uuid, uuid) to authenticated;
revoke execute on function public.my_recent_nudges() from public, anon;
grant execute on function public.my_recent_nudges() to authenticated;
revoke execute on function public.nudges_received() from public, anon;
grant execute on function public.nudges_received() to authenticated;
revoke execute on function public.toggle_reaction(uuid, uuid, text, date) from public, anon;
grant execute on function public.toggle_reaction(uuid, uuid, text, date) to authenticated;
revoke execute on function public.challenge_reactions_for_day(uuid, date) from public, anon;
grant execute on function public.challenge_reactions_for_day(uuid, date) to authenticated;
