-- Hound: people can set their own name.
--
-- A new account takes its name from sign-up (handle_new_user, 0034).
-- Sign in with Apple only shares a name the first time an Apple ID signs
-- in to Hound, so an account made after that (or with no name from its
-- provider) starts out named after its email, like "ydr97ntcw4". Nobody
-- could fix that: the app can't write profiles.name (0043).
--
-- set_my_name() sets the caller's name and initials. The app asks for a
-- name in setup when sign-up didn't bring one, and Settings can change
-- it any time.
--
-- Run this once, after 0118, in the SQL Editor.

create or replace function public.set_my_name(p_name text)
returns table (name text, initials text)
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  short text;
begin
  if me is null then
    raise exception 'Sign in to do that.';
  end if;
  if clean = '' or clean = '-' or char_length(clean) > 40 then
    raise exception 'Your name needs 1 to 40 characters.';
  end if;
  -- Two letters, like the app's initialsFor: "Stephen Washington" is SW.
  short := upper(left(split_part(clean, ' ', 1), 1) || left(split_part(clean, ' ', 2), 1));
  update public.profiles p set name = clean, initials = short where p.id = me;
  return query select clean, short;
end;
$$;

revoke execute on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;

-- Undo, if needed:
--   drop function public.set_my_name(text);
