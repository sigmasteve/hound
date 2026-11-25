-- 0267: filters on the Admin user directory (Steve, 25 Nov 2026: "Last
-- 24 hours (x), Last 3 days (y), Last 7 days (z), Over 7 days (v)... to
-- give me a quick look"). By last_active_at (set on every app open):
--
--   'day'    active in the last 24 hours
--   '3d'     in the last 3 days
--   '7d'     in the last 7 days
--   'over7'  not in the last 7 days, or never opened the app
--   null     everyone
--
-- The 'last' ones include the shorter ones, so 7d + over7 is everyone.
-- admin_search_users_active is admin_search_users (0266) with the filter;
-- admin_user_activity_counts gives the count for each, for the same
-- search.
--
-- Run this once, after 0001-0266, in the SQL Editor.

create or replace function public.admin_activity_match(p_at timestamptz, p_active text)
returns boolean
language sql
stable
as $$
  select case p_active
    when 'day' then p_at > now() - interval '24 hours'
    when '3d' then p_at > now() - interval '3 days'
    when '7d' then p_at > now() - interval '7 days'
    when 'over7' then p_at is null or p_at <= now() - interval '7 days'
    else true end;
$$;
revoke execute on function public.admin_activity_match(timestamptz, text) from public, anon, authenticated;

create or replace function public.admin_search_users_active(p_query text, p_limit int, p_offset int, p_active text)
returns table (
  id uuid, name text, initials text, username text, use_username boolean, email text,
  is_admin boolean, last_active_at timestamptz, created_at timestamptz, organization_id uuid,
  equipped_frame_id text, equipped_background_id text, equipped_icon_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return query
    select p.id, p.name, p.initials, p.username, p.use_username, p.email,
           p.is_admin, p.last_active_at, p.created_at, p.organization_id,
           p.equipped_frame_id, p.equipped_background_id, p.equipped_icon_id
    from public.profiles p
    where (q is null
       or p.name ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
       or p.email ilike '%' || q || '%')
      and public.admin_activity_match(p.last_active_at, p_active)
    order by p.last_active_at desc nulls last, p.name asc, p.id asc
    limit least(200, greatest(1, coalesce(p_limit, 50)))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke execute on function public.admin_search_users_active(text, int, int, text) from public, anon;
grant execute on function public.admin_search_users_active(text, int, int, text) to authenticated;

create or replace function public.admin_user_activity_counts(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := nullif(trim(coalesce(p_query, '')), '');
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized';
  end if;
  return (
    select jsonb_build_object(
      'all', count(*),
      'day', count(*) filter (where p.last_active_at > now() - interval '24 hours'),
      '3d', count(*) filter (where p.last_active_at > now() - interval '3 days'),
      '7d', count(*) filter (where p.last_active_at > now() - interval '7 days'),
      'over7', count(*) filter (where p.last_active_at is null or p.last_active_at <= now() - interval '7 days'),
      'never', count(*) filter (where p.last_active_at is null))
    from public.profiles p
    where q is null
       or p.name ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
       or p.email ilike '%' || q || '%');
end;
$$;
revoke execute on function public.admin_user_activity_counts(text) from public, anon;
grant execute on function public.admin_user_activity_counts(text) to authenticated;
