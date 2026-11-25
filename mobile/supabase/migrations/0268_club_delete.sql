-- 0268: the owner can delete their club (Steve, 25 Nov 2026: "How do I
-- delete a club"). Until now a club closed only when its last member
-- left, or when Admin took it down.
--
-- Deleting takes the club down the way Admin's "Take down" does: it
-- leaves everyone's Clubs tab and search, its code stops working, and
-- challenges already posted to it carry on. Members who haven't muted the
-- club get a push saying it was closed (send-social-push, kind
-- 'club_closed': deploy the function before publishing the app update).
-- Returns how many members were told.
--
-- Run this once, after 0001-0267, in the SQL Editor.

create or replace function public.delete_club(p_club_id uuid)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cl public.clubs;
  to_users uuid[];
begin
  select * into cl from public.clubs c where c.id = p_club_id and c.removed_at is null;
  if cl.id is null then
    raise exception 'That club isn''t open.';
  end if;
  if not exists (select 1 from public.club_members m where m.club_id = cl.id and m.user_id = me and m.role = 'owner') then
    raise exception 'Only the club''s owner can delete it.';
  end if;

  update public.clubs c set removed_at = now(), removed_reason = 'deleted by owner' where c.id = cl.id;

  select array_agg(m.user_id) into to_users from public.club_members m
    where m.club_id = cl.id and m.user_id <> me and not m.muted
      and public.social_push_reachable(m.user_id);
  if to_users is not null then
    perform public.social_notify(jsonb_build_object(
      'kind', 'club_closed',
      'from_user', me,
      'to_users', to_jsonb(to_users),
      'challenge_id', null,
      'club_id', cl.id,
      'club_name', cl.name
    ));
  end if;
  return coalesce(array_length(to_users, 1), 0);
end;
$$;
revoke execute on function public.delete_club(uuid) from public, anon;
grant execute on function public.delete_club(uuid) to authenticated;
