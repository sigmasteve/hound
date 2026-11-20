-- Hound: Send a push, "Send only to me" (0228). An admin tries a push
-- on their own phone before it goes to everyone: the same title, message
-- and challenge, sent through the same Edge Function, but only to them.
-- A test doesn't use the day's push and stays out of the history and
-- the numbers (push_broadcasts.is_test). Up to 20 tests a day.
--
-- Run this once, after 0228, in the SQL Editor. send-broadcast-push needs
-- no change.

alter table public.push_broadcasts add column if not exists is_test boolean not null default false;

-- 0228's, with tests left out.
create or replace function public.broadcast_next_at()
returns timestamptz
language sql
stable
security definer set search_path = public
as $$
  select max(b.created_at) + interval '24 hours' from public.push_broadcasts b where b.status <> 'failed' and not b.is_test;
$$;
revoke execute on function public.broadcast_next_at() from public, anon, authenticated;

-- 0228's, with tests left out.
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
    'sent_all', (select count(*) from public.push_broadcasts b where b.status = 'sent' and not b.is_test),
    'broadcasts', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select b.id, b.title, b.message, b.challenge_id, b.challenge_name, b.audience, b.recipients, b.delivered, b.status, b.error,
        b.created_at, b.sent_at,
        (select count(*) from public.push_broadcast_recipients r where r.broadcast_id = b.id and r.opened_at is not null) as opened,
        case when b.challenge_id is null then null else (
          select count(*) from public.push_broadcast_recipients r
          join public.challenge_participants cp on cp.challenge_id = b.challenge_id and cp.user_id = r.user_id
          where r.broadcast_id = b.id and cp.joined_at >= b.created_at and cp.joined_at < b.created_at + interval '24 hours') end as joined
      from public.push_broadcasts b
      where not b.is_test
      order by b.created_at desc
      limit 30) x));
end;
$$;
revoke execute on function public.admin_broadcast_overview() from public, anon;
grant execute on function public.admin_broadcast_overview() to authenticated;

create or replace function public.admin_send_broadcast_test(p_title text, p_message text, p_challenge_id uuid default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_msg text := trim(coalesce(p_message, ''));
  v_id uuid;
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
  if p_challenge_id is not null and not public.broadcast_challenge_ok(p_challenge_id) then
    raise exception 'That challenge isn''t a Global one people can still join.';
  end if;
  if not exists (select 1 from public.device_push_tokens t where t.user_id = auth.uid()) then
    raise exception 'Your phone isn''t registered for pushes. Turn notifications on for Hound, open it once, and try again.';
  end if;
  if (select count(*) from public.push_broadcasts b where b.is_test and b.created_by = auth.uid()
      and b.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'That''s 20 tests today. Try again tomorrow.';
  end if;
  insert into public.push_broadcasts (created_by, title, message, challenge_id, challenge_name, audience, recipients, is_test)
    values (auth.uid(), v_title, v_msg, p_challenge_id, (select c.name from public.challenges c where c.id = p_challenge_id), 'all', 1, true)
    returning id into v_id;
  insert into public.push_broadcast_recipients (broadcast_id, user_id) values (v_id, auth.uid());
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
revoke execute on function public.admin_send_broadcast_test(text, text, uuid) from public, anon;
grant execute on function public.admin_send_broadcast_test(text, text, uuid) to authenticated;
