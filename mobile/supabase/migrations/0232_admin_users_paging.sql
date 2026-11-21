-- 0232: Admin → People's user directory, a page at a time. 0091's
-- admin_search_users returned at most 25 people, so once Hound passed 25
-- users the directory stopped at the 25th name (Steve: "I can no longer
-- scroll through the entire list"). This takes a page size (1 to 200) and
-- an offset, in the same order (admins first, then by name, then id so
-- pages never overlap); the app loads the next page as you scroll. The
-- one-argument call (the organization "add member" search, older apps)
-- stays as it was.
--
-- Run after 0231.

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
    order by p.is_admin desc, p.name asc, p.id asc
    limit least(200, greatest(1, coalesce(p_limit, 50)))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke execute on function public.admin_search_users(text, int, int) from public, anon;
grant execute on function public.admin_search_users(text, int, int) to authenticated;
