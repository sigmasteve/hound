-- Hound: getting new users onto push.
--
-- Server pushes (friend requests, Tic-Tac-Go turns, standings, reminders)
-- only reach a phone with a row in device_push_tokens, and until now that
-- row was only written when someone flipped a Push toggle in Settings.
-- The app now registers on every open once notifications are allowed,
-- and asks new users on Today (src/notifications/pushPermission.ts).
--
-- push_permission is what the phone's notification setting was at the
-- last app open, reported alongside the app version (0076):
--   'granted'       allowed
--   'denied'        turned off (only the phone's Settings can undo it)
--   'undetermined'  never asked yet
-- Null means the app hasn't reported it yet (an older update).
--
-- admin_push_reach() tells Admin who has a registered phone — the push
-- tokens themselves stay readable only by their owner.
--
-- Run this once, after 0001-0080, in the SQL Editor.

alter table public.profiles
  add column push_permission text
    check (push_permission in ('granted', 'denied', 'undetermined'));

grant update (push_permission) on public.profiles to authenticated;

create or replace function public.admin_push_reach()
returns table (user_id uuid, name text, push_permission text, has_token boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Only admins can do that.';
  end if;

  return query
    select p.id, p.name, p.push_permission,
      exists (select 1 from public.device_push_tokens t where t.user_id = p.id)
    from public.profiles p
    order by p.name;
end;
$$;

revoke execute on function public.admin_push_reach() from public, anon;
grant execute on function public.admin_push_reach() to authenticated;
