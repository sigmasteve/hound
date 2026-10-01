-- Hound: other people can no longer read your email or friend code
-- (H1 in Roshan Trivedi's security review, step 2 of 2).
--
-- ⚠ DO NOT RUN THIS UNTIL THE APP UPDATE HAS REACHED EVERYONE. Run 0090
-- and 0091 first, publish the OTA update from the same PR, then wait
-- until Admin → App versions shows (nearly) everyone on the new update.
-- An app still on older code reads these columns directly and would
-- fail to load its own profile and friend code until it updates.
--
-- Until now any signed-in user could download every profile's email and
-- friend code (and the friend code is a key: add_friend_by_code accepts
-- instantly). The app now gets them through 0091's functions instead:
-- my_friend_code() for your own code, profile_id_for_email() for invite
-- by email, admin_search_users() and org_members() for admins. Your own
-- email comes from your sign-in.
--
-- How: Postgres ignores a column-level revoke while a table-level grant
-- exists (see 0043), so the table-level SELECT is removed and every
-- other column is granted back by name.
--
-- Note for later migrations: a column added to profiles after this one
-- is NOT readable by signed-in users until it is granted:
--   grant select (new_column) on public.profiles to authenticated;
--
-- Run this once, after 0091 and after the app update has rolled out.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name not in ('email', 'friend_code');
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to authenticated', cols);
end $$;
