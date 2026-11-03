-- Hound: where each Android phone got the app, for Admin → App versions.
--
-- Android testers can install from Google Play (the closed testing
-- track) or download the APK from the website (houndchallenge.net/get,
-- a Google Drive file). Play Console only counts the first. The app asks
-- Play's install referrer service once and reports here, alongside the
-- version it already reports (0076):
--
--   app_install_source    'play' | 'website', or null when not known
--                         (iPhone, or not asked yet)
--   app_install_referrer  what the referrer service said, as it said it,
--                         to check the 'play' / 'website' call against
--                         the build numbers
--
-- Self-reported and harmless, like the other 0076 columns: the owner
-- writes them directly.
--
-- Run this once, after 0001-0162, in the SQL Editor.

alter table public.profiles
  add column app_install_source text check (app_install_source in ('play', 'website')),
  add column app_install_referrer text check (char_length(app_install_referrer) <= 300);

grant update (app_install_source, app_install_referrer) on public.profiles to authenticated;
