-- Admin ability to ban/unban a user's auth access — the missing half of
-- promoting someone via is_admin (0021_admin_flag.sql). Supabase's ban
-- feature works through auth.users.banned_until, a timestamp column, not
-- a boolean flag — setting it in the future (or 'infinity' for
-- permanent) is what actually blocks sign-in, which is why scanning the
-- table for a boolean never turns one up. Same "security definer +
-- is_admin check" shape as admin_archive_workout_history
-- (0029_workout_history.sql) and admin_user_overview
-- (0023_admin_user_directory.sql).
--
-- Setting banned_until alone stops future sign-ins but doesn't revoke a
-- session already issued, so this also clears the user's existing
-- sessions — the same effect as supabase.auth.admin.signOut(id, 'global').

create or replace function public.admin_ban_user(target_user_id uuid, ban_duration interval default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;

  update auth.users
  set banned_until = case when ban_duration is null then 'infinity' else now() + ban_duration end
  where id = target_user_id;

  delete from auth.sessions where user_id = target_user_id;
end;
$$;

grant execute on function public.admin_ban_user(uuid, interval) to authenticated;

create or replace function public.admin_unban_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;

  update auth.users set banned_until = null where id = target_user_id;
end;
$$;

grant execute on function public.admin_unban_user(uuid) to authenticated;
