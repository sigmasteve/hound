-- 0260: each player's hound under the chess clock (Steve, 24 Nov 2026:
-- "time, Hound picture, You, Steps"). chess_looks gives the two players'
-- avatar looks (initials, icon, frame, background; the icon can be their
-- dog's photo, 0191) to the players in the game. Against the bot, its
-- side is null.
--
-- Run this once, after 0001-0259, in the SQL Editor.

create or replace function public.chess_looks(p_challenge_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  g public.chess_games;
begin
  select * into g from public.chess_games where challenge_id = p_challenge_id;
  if g.challenge_id is null or me is null
     or not exists (select 1 from public.challenge_participants cp where cp.challenge_id = p_challenge_id and cp.user_id = me) then
    raise exception 'You''re not playing in this game.';
  end if;
  return jsonb_build_object(
    'w', (select jsonb_build_object('initials', p.initials, 'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id)
          from public.profiles p where p.id = g.white),
    'b', (select jsonb_build_object('initials', p.initials, 'icon_id', p.equipped_icon_id, 'frame_id', p.equipped_frame_id, 'background_id', p.equipped_background_id)
          from public.profiles p where p.id = g.black));
end;
$$;
revoke execute on function public.chess_looks(uuid) from public, anon;
grant execute on function public.chess_looks(uuid) to authenticated;
