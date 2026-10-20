-- Hound: only an app that can draw a hound Bingo card can join one.
--
-- The 0.10.2 app (and any phone that opened on code from before 0117's
-- update) doesn't know the 'hound' card type: opening that Bingo, or
-- having it featured on Today, crashes it. Updates can't reach 0.10.2,
-- so the server keeps those phones out instead.
--
-- The app that knows the card sends an x-hound-features header with
-- 'hound-bingo' in it (src/lib/supabase.ts). Joining a hound Bingo
-- through the API without it is refused with a message the old app
-- already shows when a join fails. Inserts that don't come through the
-- API (the SQL Editor, sign-up, the tests) have no request headers and
-- are let through.
--
-- Run this once, after 0117, in the SQL Editor.

create or replace function public.bingo_join_needs_new_app()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
begin
  if headers is null or not exists (
    select 1 from public.challenges c
    where c.id = new.challenge_id and c.kind::text = 'bingo' and c.bingo_card_type = 'hound'
  ) then
    return new;
  end if;
  if not 'hound-bingo' = any (string_to_array(replace(coalesce(headers ->> 'x-hound-features', ''), ' ', ''), ',')) then
    raise exception 'Update Hound to join this Bingo: it needs the latest version of the app.';
  end if;
  return new;
end;
$$;

revoke execute on function public.bingo_join_needs_new_app() from public, anon, authenticated;

create trigger bingo_join_needs_new_app
  before insert on public.challenge_participants
  for each row execute procedure public.bingo_join_needs_new_app();

-- Undo, if needed:
--   drop trigger bingo_join_needs_new_app on public.challenge_participants;
--   drop function public.bingo_join_needs_new_app();
