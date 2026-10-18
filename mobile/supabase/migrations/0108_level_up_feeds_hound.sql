-- Hound: a level-up fills your hound's meal hearts (0104's Classic pet
-- care). Meals stay 10 Bones once a day; going up a level, however it
-- happens (challenge results, daily habits), brings a Classic hound back
-- to 3 hearts. Gentle care has no hearts, so nothing changes there.
--
-- profiles_level_up_feeds_hound runs after xp_total changes and compares
-- the level before and after (level_for_xp, 0100).
--
-- Run this once, after 0001-0107, in the SQL Editor.

create or replace function public.profiles_level_up_feeds_hound()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.level_for_xp(new.xp_total) > public.level_for_xp(old.xp_total) then
    update public.kennels k
      set hearts = 3,
          -- The server's day; a hound's day is within one of it.
          hearts_on = (now() at time zone 'utc')::date,
          updated_at = now()
      where k.user_id = new.id and k.care_mode = 'classic';
  end if;
  return null;
end;
$$;

revoke execute on function public.profiles_level_up_feeds_hound() from public, anon, authenticated;

drop trigger if exists profiles_level_up_feeds_hound on public.profiles;
create trigger profiles_level_up_feeds_hound
  after update of xp_total on public.profiles
  for each row
  when (new.xp_total > old.xp_total)
  execute procedure public.profiles_level_up_feeds_hound();

-- Undo, if needed:
--   drop trigger profiles_level_up_feeds_hound on public.profiles;
--   drop function public.profiles_level_up_feeds_hound();
