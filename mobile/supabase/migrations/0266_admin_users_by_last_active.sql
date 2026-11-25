-- 0266: the Admin user directory, most recently active first (Steve,
-- 25 Nov 2026: "sort the admin people list by last time user logged in,
-- vs alphabetically"). last_active_at is set by the app on every open
-- (0010). Never opened sorts last; ties by name. Searching keeps the same
-- order. Otherwise admin_search_users is as in 0232.
--
-- Run this once, after 0001-0265, in the SQL Editor.

create or replace function public.admin_search_users(p_query text, p_limit int, p_offset int)
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
    where q is null
       or p.name ilike '%' || q || '%'
       or p.username ilike '%' || q || '%'
       or p.email ilike '%' || q || '%'
    order by p.last_active_at desc nulls last, p.name asc, p.id asc
    limit least(200, greatest(1, coalesce(p_limit, 50)))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke execute on function public.admin_search_users(text, int, int) from public, anon;
grant execute on function public.admin_search_users(text, int, int) to authenticated;
