-- Hound: Soccer — seats added after the match is made.
--
-- 0142 names both line-ups at setup, and only those people can accept
-- an invite. The challenge screen's "Invite a friend" card kept working
-- for a Soccer match, though, and a friend invited from it had no seat,
-- so their accept was refused. Now the creator seats a late player first
-- (team and position), then the invite goes out as usual; a seat that
-- was never taken up can be cleared again. Same rules as setup: nine a
-- side, one keeper a team. A late joiner counts from the day they join.
--
-- Run this once, after 0142, in the SQL Editor.

create or replace function public.soccer_add_player(p_challenge_id uuid, p_user_id uuid, p_team text, p_position text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'soccer' and c.created_by = caller
  ) then
    raise exception 'Only the creator can change the line-ups.';
  end if;
  if not exists (select 1 from public.soccer_games g where g.challenge_id = p_challenge_id and g.status = 'active') then
    raise exception 'This match is over.';
  end if;
  if p_team not in ('a', 'b') or p_position not in ('forward', 'defender', 'keeper') then
    raise exception 'Each player is a forward, a defender or the keeper, on team A or B.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'That person isn''t on Hound.';
  end if;
  if exists (select 1 from public.soccer_players p where p.challenge_id = p_challenge_id and p.user_id = p_user_id) then
    raise exception 'They already have a seat in this match.';
  end if;
  if (select count(*) from public.soccer_players p where p.challenge_id = p_challenge_id and p.team = p_team) >= 9 then
    raise exception 'That team already has nine players.';
  end if;
  if p_position = 'keeper' and exists (
    select 1 from public.soccer_players p where p.challenge_id = p_challenge_id and p.team = p_team and p.position = 'keeper'
  ) then
    raise exception 'That team already has a keeper.';
  end if;

  insert into public.soccer_players (challenge_id, user_id, team, position, joined)
  values (p_challenge_id, p_user_id, p_team, p_position,
    exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = p_user_id));
end;
$$;

revoke execute on function public.soccer_add_player(uuid, uuid, text, text) from public, anon;
grant execute on function public.soccer_add_player(uuid, uuid, text, text) to authenticated;

-- Clears a seat nobody has taken up (the invite was never accepted).
create or replace function public.soccer_remove_player(p_challenge_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'soccer' and c.created_by = caller
  ) then
    raise exception 'Only the creator can change the line-ups.';
  end if;
  if p_user_id = caller then
    raise exception 'You can''t leave your own match.';
  end if;
  delete from public.soccer_players p
    where p.challenge_id = p_challenge_id and p.user_id = p_user_id and not p.joined;
  if not found then
    raise exception 'That seat is taken, or there isn''t one.';
  end if;
  delete from public.challenge_invites i where i.challenge_id = p_challenge_id and i.invitee_id = p_user_id;
end;
$$;

revoke execute on function public.soccer_remove_player(uuid, uuid) from public, anon;
grant execute on function public.soccer_remove_player(uuid, uuid) to authenticated;
