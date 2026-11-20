-- Hound: Send a push (Admin → Overview → Status). An admin writes one
-- push (a title and a message) to everyone who can get one, optionally
-- opening a Global challenge they can still join (an invite: then it can
-- go only to people not in it yet). Approved mockup:
-- claude.ai/artifact/1nVfRtiPpn2cX7FcoWDqrB.
--
--   who gets it   a phone registered for push (device_push_tokens) and
--                 "News and challenge invites" on in Settings (the new
--                 profiles.alert_news_push_enabled, on by default: Apple
--                 asks that promotional pushes can be turned off), minus
--                 anyone already in the challenge when 'not_in'.
--   how often     one a day: 24 hours from the last one.
--   sending       admin_send_broadcast snapshots the recipients and asks
--                 the send-broadcast-push Edge Function to send it (in
--                 batches, through Expo); the function marks it sent.
--   numbers       each push: who it went to, who opened it (the app
--                 calls broadcast_opened on a tap) and, for an invite, who
--                 joined the challenge within a day of it going out.
--
-- Run this once, after 0227, in the SQL Editor; then deploy
-- send-broadcast-push.

alter table public.profiles
  add column if not exists alert_news_push_enabled boolean not null default true;
grant update (alert_news_push_enabled) on public.profiles to authenticated;

create table public.push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 50),
  message text not null check (char_length(message) between 1 and 150),
  challenge_id uuid references public.challenges (id) on delete set null,
  challenge_name text,
  audience text not null default 'all' check (audience in ('all', 'not_in')),
  recipients integer not null default 0,
  delivered integer,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index push_broadcasts_at on public.push_broadcasts (created_at desc);

create table public.push_broadcast_recipients (
  broadcast_id uuid not null references public.push_broadcasts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  opened_at timestamptz,
  primary key (broadcast_id, user_id)
);
create index push_broadcast_recipients_user on public.push_broadcast_recipients (user_id);

alter table public.push_broadcasts enable row level security;
alter table public.push_broadcast_recipients enable row level security;
revoke all on public.push_broadcasts, public.push_broadcast_recipients from anon, authenticated;

-- Who a push would go to right now.
create or replace function public.broadcast_audience(p_challenge_id uuid, p_audience text)
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  select p.id from public.profiles p
  where p.alert_news_push_enabled
    and exists (select 1 from public.device_push_tokens t where t.user_id = p.id)
    and not (p_audience = 'not_in' and p_challenge_id is not null and exists (
      select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p.id));
$$;
revoke execute on function public.broadcast_audience(uuid, text) from public, anon, authenticated;

create or replace function public.broadcast_next_at()
returns timestamptz
language sql
stable
security definer set search_path = public
as $$
  select max(b.created_at) + interval '24 hours' from public.push_broadcasts b where b.status <> 'failed';
$$;
revoke execute on function public.broadcast_next_at() from public, anon, authenticated;

-- A challenge a push can invite people to: a Global one still open to join.
create or replace function public.broadcast_challenge_ok(p_challenge_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.challenges c where c.id = p_challenge_id and c.is_global
    and coalesce(c.join_closes_at, c.ends_at) > now() and c.ends_at > now());
$$;
revoke execute on function public.broadcast_challenge_ok(uuid) from public, anon, authenticated;

-- What the composer shows before sending: how many it reaches, who's
-- left out, and when the next push can go.
create or replace function public.admin_broadcast_preview(p_challenge_id uuid default null, p_audience text default 'all')
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_aud text := case when p_challenge_id is null then 'all' else coalesce(p_audience, 'all') end;
  v_next timestamptz := public.broadcast_next_at();
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'reach', (select count(*) from public.broadcast_audience(p_challenge_id, v_aud)),
    'already_in', case when v_aud = 'not_in' then (select count(*) from public.broadcast_audience(p_challenge_id, 'all'))
                        - (select count(*) from public.broadcast_audience(p_challenge_id, 'not_in')) else 0 end,
    'turned_off', (select count(*) from public.profiles p where not p.alert_news_push_enabled
                     and exists (select 1 from public.device_push_tokens t where t.user_id = p.id)),
    'next_at', case when v_next > now() then v_next end);
end;
$$;
revoke execute on function public.admin_broadcast_preview(uuid, text) from public, anon;
grant execute on function public.admin_broadcast_preview(uuid, text) to authenticated;

create or replace function public.admin_send_broadcast(p_title text, p_message text, p_challenge_id uuid default null, p_audience text default 'all')
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_msg text := trim(coalesce(p_message, ''));
  v_aud text := case when p_challenge_id is null then 'all' else coalesce(p_audience, 'all') end;
  v_next timestamptz;
  v_id uuid;
  v_n int;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only an admin can send a push to everyone.';
  end if;
  if char_length(v_title) not between 1 and 50 then
    raise exception 'A title of 1 to 50 characters.';
  end if;
  if char_length(v_msg) not between 1 and 150 then
    raise exception 'A message of 1 to 150 characters.';
  end if;
  if v_aud not in ('all', 'not_in') then
    raise exception 'Send it to everyone, or to everyone not in it yet.';
  end if;
  if p_challenge_id is not null and not public.broadcast_challenge_ok(p_challenge_id) then
    raise exception 'That challenge isn''t a Global one people can still join.';
  end if;
  -- One at a time, one a day.
  perform pg_advisory_xact_lock(hashtext('push_broadcasts'));
  v_next := public.broadcast_next_at();
  if v_next > now() then
    raise exception 'One push a day: the next can go at % UTC on %.', to_char(v_next at time zone 'utc', 'HH24:MI'), to_char(v_next at time zone 'utc', 'Mon FMDD');
  end if;
  insert into public.push_broadcasts (created_by, title, message, challenge_id, challenge_name, audience)
    values (auth.uid(), v_title, v_msg, p_challenge_id, (select c.name from public.challenges c where c.id = p_challenge_id), v_aud)
    returning id into v_id;
  insert into public.push_broadcast_recipients (broadcast_id, user_id)
    select v_id, u from public.broadcast_audience(p_challenge_id, v_aud) u;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody to send it to.';
  end if;
  update public.push_broadcasts set recipients = v_n where id = v_id;
  if public.edge_function_url('send-broadcast-push') is null then
    update public.push_broadcasts set status = 'failed', error = 'No project_url secret (0093)' where id = v_id;
    return v_id;
  end if;
  begin
    perform net.http_post(
      url := public.edge_function_url('send-broadcast-push'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('broadcast_id', v_id),
      timeout_milliseconds := 60000
    );
  exception when others then
    update public.push_broadcasts set status = 'failed', error = sqlerrm where id = v_id;
  end;
  return v_id;
end;
$$;
revoke execute on function public.admin_send_broadcast(text, text, uuid, text) from public, anon;
grant execute on function public.admin_send_broadcast(text, text, uuid, text) to authenticated;

-- The app, when someone taps the push.
create or replace function public.broadcast_opened(p_broadcast_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.push_broadcast_recipients set opened_at = now()
  where broadcast_id = p_broadcast_id and user_id = auth.uid() and opened_at is null;
$$;
revoke execute on function public.broadcast_opened(uuid) from public, anon;
grant execute on function public.broadcast_opened(uuid) to authenticated;

-- Admin → Overview → Status → Send a push: the reach, when the next can
-- go, and every push with sent / opened / joined.
create or replace function public.admin_broadcast_overview()
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_next timestamptz := public.broadcast_next_at();
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'reach', (select count(*) from public.broadcast_audience(null, 'all')),
    'turned_off', (select count(*) from public.profiles p where not p.alert_news_push_enabled
                     and exists (select 1 from public.device_push_tokens t where t.user_id = p.id)),
    'next_at', case when v_next > now() then v_next end,
    'sent_all', (select count(*) from public.push_broadcasts b where b.status = 'sent'),
    'broadcasts', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select b.id, b.title, b.message, b.challenge_id, b.challenge_name, b.audience, b.recipients, b.delivered, b.status, b.error,
        b.created_at, b.sent_at,
        (select count(*) from public.push_broadcast_recipients r where r.broadcast_id = b.id and r.opened_at is not null) as opened,
        case when b.challenge_id is null then null else (
          select count(*) from public.push_broadcast_recipients r
          join public.challenge_participants cp on cp.challenge_id = b.challenge_id and cp.user_id = r.user_id
          where r.broadcast_id = b.id and cp.joined_at >= b.created_at and cp.joined_at < b.created_at + interval '24 hours') end as joined
      from public.push_broadcasts b
      order by b.created_at desc
      limit 30) x));
end;
$$;
revoke execute on function public.admin_broadcast_overview() from public, anon;
grant execute on function public.admin_broadcast_overview() to authenticated;
