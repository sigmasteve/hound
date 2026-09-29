-- Hound: which app build and OTA update each person is running, so an
-- admin can see who's on the latest code (Admin → App versions, and each
-- user's own detail page).
--
-- The app reports these on every open, alongside last_active_at
-- (src/admin/appVersions.ts → reportAppVersion). They're self-reported
-- and harmless — nothing gates on them — so the owner writes them
-- directly, the same way last_active_at already works (0043's column
-- grant list).
--
--   app_platform      'ios' | 'android'
--   os_version        e.g. '26.5' on iOS, the API level on Android
--   app_version       the store/TestFlight version, e.g. '0.10.0'
--   app_build         the build number, e.g. '42' — only from builds that
--                     include expo-application; null before that
--   ota_update_id     the EAS Update running, or null when running the
--                     code the build shipped with
--   code_published_at when the running code was published — the update's
--                     publish time, or the build's own bundle time when
--                     it's running the code it shipped with
--   app_reported_at   when these were last reported
--
-- Run this once, after 0001-0075, in the SQL Editor.

alter table public.profiles
  add column app_platform text,
  add column os_version text,
  add column app_version text,
  add column app_build text,
  add column ota_update_id text,
  add column code_published_at timestamptz,
  add column app_reported_at timestamptz;

grant update (
  app_platform,
  os_version,
  app_version,
  app_build,
  ota_update_id,
  code_published_at,
  app_reported_at
) on public.profiles to authenticated;
