-- Hound: your Kennel hound (0104, 0105) as your avatar, everywhere
-- avatars show: leaderboards, friends, chats and Today.
--
-- Every avatar already comes with equipped_icon_id, so the hound's look
-- is written there as a short code, and the app draws it:
--
--   hound:<coat>.<ears>.<tail>.<markings>.<neck>.<head>.<face>
--   e.g. hound:coat_golden.perky.curly.none.collar_red..
--
-- That means no screen or query changes. A build that doesn't know the
-- code shows the initials, as with any icon it doesn't know.
--
--   - use_hound_avatar turns it on or off. Equipping any Locker icon
--     replaces it, as icons always have.
--   - While it's on, changing the hound's coat, look or accessories
--     updates the avatar too (kennels_sync_avatar).
--   - equipped_icon_id loses its foreign key to cosmetic_items, since
--     the code isn't an item. Nobody can write the column directly
--     (0043's column grants); equip_cosmetic still only takes real
--     items, and use_hound_avatar only writes the code.
--
-- Run this once, after 0001-0105, in the SQL Editor, before publishing
-- the app update that goes with it.

alter table public.profiles drop constraint if exists profiles_equipped_icon_id_fkey;

-- The avatar code for someone's hound, from their kennel (or the default
-- hound if they've never opened it).
create or replace function public.kennel_avatar_code(p_user uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select 'hound:' || concat_ws('.',
    coalesce(k.coat_id, ''), coalesce(k.ears, 'floppy'), coalesce(k.tail, 'wavy'), coalesce(k.markings, 'none'),
    coalesce(k.neck_id, ''), coalesce(k.head_id, ''), coalesce(k.face_id, ''))
  from (select 1) one
  left join public.kennels k on k.user_id = p_user;
$$;

revoke execute on function public.kennel_avatar_code(uuid) from public, anon, authenticated;

create or replace function public.use_hound_avatar(p_local_date date, p_on boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := public.kennel_caller(p_local_date);
  code text;
begin
  if p_on then
    code := public.kennel_avatar_code(me);
    update public.profiles p set equipped_icon_id = code where p.id = me;
    return code;
  end if;
  update public.profiles p set equipped_icon_id = null where p.id = me and p.equipped_icon_id like 'hound:%';
  return null;
end;
$$;

revoke execute on function public.use_hound_avatar(date, boolean) from public, anon;
grant execute on function public.use_hound_avatar(date, boolean) to authenticated;

-- Keeps a hound avatar matching the hound.
create or replace function public.kennels_sync_avatar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles p
    set equipped_icon_id = public.kennel_avatar_code(new.user_id)
    where p.id = new.user_id and p.equipped_icon_id like 'hound:%';
  return null;
end;
$$;

revoke execute on function public.kennels_sync_avatar() from public, anon, authenticated;

drop trigger if exists kennels_sync_avatar on public.kennels;
create trigger kennels_sync_avatar
  after update on public.kennels
  for each row execute procedure public.kennels_sync_avatar();

-- Undo, if needed:
--   update public.profiles set equipped_icon_id = null where equipped_icon_id like 'hound:%';
--   drop trigger kennels_sync_avatar on public.kennels;
--   drop function public.kennels_sync_avatar();
--   drop function public.use_hound_avatar(date, boolean);
--   drop function public.kennel_avatar_code(uuid);
--   alter table public.profiles add constraint profiles_equipped_icon_id_fkey
--     foreign key (equipped_icon_id) references public.cosmetic_items (id);
