-- Hound: tell admins when someone new signs up — an instant push per
-- signup, and a once-a-day summary of the last 24 hours. Each admin can
-- turn either off on the Admin screen.
--
-- Same event-driven push shape as 0065's friend notifications: a
-- trigger calls send-admin-signup-alerts via pg_net, wrapped so a
-- notification failure (pg_net missing, no vault secret, network) never
-- rolls back the signup that triggered it. The summary runs on pg_cron,
-- like 0025's daily alerts.
--
-- Before running: deploy the function —
--   supabase functions deploy send-admin-signup-alerts
--
-- Run this once, after 0001-0076, in the SQL Editor.

-- Only read for admins. Default on, so a new admin gets both until they
-- turn one off.
alter table public.profiles
  add column admin_signup_push boolean not null default true,
  add column admin_signup_digest boolean not null default true;

grant update (admin_signup_push, admin_signup_digest) on public.profiles to authenticated;

create or replace function public.admin_signup_notify(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-admin-signup-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('kind', 'signup', 'user_id', p_user_id)
  );
exception when others then
  null;
end;
$$;

-- Internal only — see 0065's same revoke on friend_notify.
revoke execute on function public.admin_signup_notify(uuid) from public, anon, authenticated;

-- Every signup gets a profiles row from 0001's handle_new_user trigger,
-- so a new profile is a new user. pg_net sends after this transaction
-- commits, so the function always finds the row.
create or replace function public.profiles_after_insert_admin_alert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.admin_signup_notify(new.id);
  return new;
end;
$$;

create trigger profiles_after_insert_admin_alert
  after insert on public.profiles
  for each row execute procedure public.profiles_after_insert_admin_alert();

-- The daily summary: 15:55 UTC is 8:55am in US Pacific daylight time
-- (7:55am in winter). Covers the 24 hours before it runs, and sends
-- nothing on a day with no signups.
select cron.schedule(
  'hound-admin-signup-digest',
  '55 15 * * *',
  $$
  select net.http_post(
    url := 'https://vaypjksgpuuopqvurcus.supabase.co/functions/v1/send-admin-signup-alerts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"kind": "digest"}'::jsonb
  );
  $$
);
