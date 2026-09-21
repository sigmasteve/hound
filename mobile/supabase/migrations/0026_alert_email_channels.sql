-- 0025_challenge_alerts.sql's two Alerts toggles were push-only, which
-- turned out to be a real gap testing on a simulator surfaced (no way
-- to register a push token there at all). Extends both to a Push +
-- Email pair, mirroring Login reminders' own notify_push_enabled /
-- notify_email_enabled shape exactly, so Settings' Alerts card reads
-- the same way that card already does.

alter table public.profiles
  rename column alert_stale_data_enabled to alert_stale_data_push_enabled;
alter table public.profiles
  rename column alert_daily_standings_enabled to alert_daily_standings_push_enabled;

alter table public.profiles
  add column alert_stale_data_email_enabled boolean not null default false,
  add column alert_daily_standings_email_enabled boolean not null default false;
