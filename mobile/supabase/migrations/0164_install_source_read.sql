-- Hound: fixes Admin → App versions ("permission denied for table
-- profiles") after 0163.
--
-- Since 0092, a column added to profiles can't be read by signed-in
-- users until it's granted by name. 0163 let the app write its two new
-- columns but not read them, so the App versions list (which reads
-- app_install_source) failed. This grants the read.
--
-- Run this once, after 0001-0163,
-- in the SQL Editor.

grant select (app_install_source, app_install_referrer) on public.profiles to authenticated;
