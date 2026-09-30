-- Hound: Tic-Tac-Go's activity window, per game, with nothing reused.
--
-- 0078 counted activity from 24 hours before your turn, but cut it off at
-- your last claim of any kind — so claiming a square with a workout also
-- reset your step count, and a 10K-steps square that was really met over
-- the last day wouldn't close. Now:
--   * the window's length is a per-game choice made in Create
--     (activity_window_hours: 12, 24 or 48; 24 for every existing game);
--   * activity from that many hours before your turn began counts;
--   * claiming a steps square uses up those steps — your next steps
--     square counts steps from that claim on (x/o_steps_claimed_at);
--   * claiming any other square uses up only the one workout that met it
--     (x/o_used_workouts), not your steps or your other workouts.
-- Still one square per turn. The goal check itself still runs on the
-- player's device (0057's design); this stores what each claim used so
-- the device can leave it out next time.
--
-- Run this once, after 0001-0078, in the SQL Editor.

alter table public.tictacgo_games
  add column activity_window_hours int not null default 24 check (activity_window_hours between 1 and 72),
  add column x_steps_claimed_at timestamptz,
  add column o_steps_claimed_at timestamptz,
  add column x_used_workouts text[] not null default '{}',
  add column o_used_workouts text[] not null default '{}';

-- Set by the game's creator right after tictacgo_setup, while it's still
-- waiting for the opponent.
create or replace function public.tictacgo_set_window(p_challenge_id uuid, p_hours int)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.kind = 'tictacgo' and c.created_by = auth.uid()
  ) then
    raise exception 'Only the creator can change this game''s settings.';
  end if;
  if p_hours is null or p_hours not in (12, 24, 48) then
    raise exception 'Pick 12, 24 or 48 hours.';
  end if;
  update public.tictacgo_games
    set activity_window_hours = p_hours, updated_at = now()
    where challenge_id = p_challenge_id and status = 'waiting';
  if not found then
    raise exception 'This game has already started — its settings can''t change now.';
  end if;
end;
$$;

-- Claims a square (0057's tictacgo_claim_square does the move itself, in
-- this same transaction) and records what the claim used: the steps up
-- to now for a steps square, or the one workout (the device's own
-- workout id) for any other square.
create or replace function public.tictacgo_claim(p_challenge_id uuid, p_square int, p_workout_id text default null)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  g public.tictacgo_games%rowtype;
  result text;
  is_steps boolean;
begin
  result := public.tictacgo_claim_square(p_challenge_id, p_square);

  select * into g from public.tictacgo_games where challenge_id = p_challenge_id;
  is_steps := g.goals[p_square + 1] like 'steps\_%';

  if is_steps then
    update public.tictacgo_games
      set x_steps_claimed_at = case when caller = g.x_user_id then now() else x_steps_claimed_at end,
          o_steps_claimed_at = case when caller = g.o_user_id then now() else o_steps_claimed_at end
      where challenge_id = p_challenge_id;
  elsif p_workout_id is not null and length(p_workout_id) <= 200 then
    update public.tictacgo_games
      set x_used_workouts = case when caller = g.x_user_id then array_append(x_used_workouts, p_workout_id) else x_used_workouts end,
          o_used_workouts = case when caller = g.o_user_id then array_append(o_used_workouts, p_workout_id) else o_used_workouts end
      where challenge_id = p_challenge_id;
  end if;

  return result;
end;
$$;

revoke execute on function public.tictacgo_set_window(uuid, int) from public, anon;
grant execute on function public.tictacgo_set_window(uuid, int) to authenticated;
revoke execute on function public.tictacgo_claim(uuid, int, text) from public, anon;
grant execute on function public.tictacgo_claim(uuid, int, text) to authenticated;
