-- Hound: the first real use of 0021_admin_flag.sql's is_admin flag —
-- 0015_app_labels.sql's own comment named this exact policy as what a
-- real admin/role concept would need to tighten, and that concept now
-- exists.
--
-- Replaces "Anyone signed in can update the app's labels" with a version
-- that also requires the caller's own profiles.is_admin — reading the
-- shared Chase labels stays open to everyone signed in (0015's own
-- select policy, untouched), only *changing* them is gated. The app's
-- own SettingsScreen now hides the "Chase labels" card entirely for a
-- non-admin, but that's a UI convenience, not the actual enforcement —
-- this policy is what a non-admin can't get around even by calling the
-- update directly.
--
-- Run this once, after 0001-0021, in the SQL Editor.

drop policy "Anyone signed in can update the app's labels" on public.app_labels;

create policy "Only admins can update the app's labels"
  on public.app_labels for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
