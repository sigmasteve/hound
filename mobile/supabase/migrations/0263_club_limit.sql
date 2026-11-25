-- 0263: running clubs (Steve, 25 Nov 2026: "I'm the admin, this
-- shouldn't apply to me, and for everyone else - make the limit 4").
--   - Admins can start clubs without the limits: level, account age and
--     how many they run (they still need a username: clubs show them).
--   - Everyone else can run up to 4 clubs, up from 3 (club_config,
--     changeable in Admin → Clubs).
--
-- Run this once, after 0001-0262, in the SQL Editor.

update public.club_config set max_owned = 4 where id;
alter table public.club_config alter column max_owned set default 4;

create or replace function public.club_create_problem(p_user uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  cfg public.club_config;
  p public.profiles;
begin
  select * into cfg from public.club_config;
  if not cfg.enabled then
    return 'Clubs are switched off right now.';
  end if;
  select * into p from public.profiles where id = p_user;
  if not coalesce(p.is_admin, false) then
    if public.level_for_xp(coalesce(p.xp_total, 0)) < cfg.min_level then
      return format('Reach level %s to start a club.', cfg.min_level);
    end if;
    if p.created_at > now() - make_interval(days => cfg.min_account_days) then
      return format('Your account needs to be %s days old to start a club.', cfg.min_account_days);
    end if;
    if exists (select 1 from auth.users u where u.id = p_user and u.banned_until is not null)
      or (select count(*) from public.community_strikes s where s.user_id = p_user) >= 2 then
      return 'This account can''t start clubs.';
    end if;
  end if;
  if p.username is null then
    return 'Pick a username first (Settings → Profile): clubs show usernames.';
  end if;
  if not coalesce(p.is_admin, false)
     and (select count(*) from public.clubs c where c.created_by = p_user and c.removed_at is null) >= cfg.max_owned then
    return format('You can run up to %s clubs.', cfg.max_owned);
  end if;
  return null;
end;
$$;
revoke execute on function public.club_create_problem(uuid) from public, anon, authenticated;
