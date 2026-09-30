-- Hound: Tic-Tac-Go — activity from the 24 hours before your turn counts.
--
-- Before this, only activity after your turn began could claim a square,
-- so a workout done during your opponent's turn was wasted the moment
-- they moved. Now a claim can use anything from the 24 hours before your
-- turn began onward — except activity from before your own last claim,
-- so one workout (or one day's steps) can't take two squares. Still one
-- square per turn.
--
-- The goal check itself runs on the player's device (0057's own design);
-- all this adds is when each player last claimed, which the device needs
-- to draw that line. Set by a trigger rather than by editing
-- tictacgo_claim_square, so 0057's function stays as it is.
--
-- Run this once, after 0001-0077, in the SQL Editor.

alter table public.tictacgo_games
  add column x_last_claim_at timestamptz,
  add column o_last_claim_at timestamptz;

create or replace function public.tictacgo_track_last_claim()
returns trigger
language plpgsql
as $$
declare
  i int;
begin
  if new.marks is not distinct from old.marks then
    return new;
  end if;
  -- A claim fills exactly one open square; whoever's mark it is claimed it.
  for i in 1..9 loop
    if old.marks[i] is null and new.marks[i] is not null then
      if new.marks[i] = new.x_user_id then
        new.x_last_claim_at := now();
      elsif new.marks[i] = new.o_user_id then
        new.o_last_claim_at := now();
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create trigger tictacgo_track_last_claim
  before update on public.tictacgo_games
  for each row execute procedure public.tictacgo_track_last_claim();

-- Games already in progress: the player who's waiting most likely made
-- the last move when the current turn began (unless that turn passed on
-- a timeout, which only makes their next window a little shorter).
update public.tictacgo_games
  set x_last_claim_at = case when turn_user_id = o_user_id then turn_started_at else x_last_claim_at end,
      o_last_claim_at = case when turn_user_id = x_user_id then turn_started_at else o_last_claim_at end
  where status = 'active' and turn_started_at is not null;
