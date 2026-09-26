-- Hound: Variety Bingo's actual game state — see
-- 0051_bingo_challenge_kind.sql for the enum value this depends on
-- (must already be committed).
--
-- Each participant gets their own personal 3x3 card: one square per
-- fixed workout category (see src/challenges/bingo.ts's BINGO_CATEGORIES
-- — kept in sync with this file's own check constraint by hand, the same
-- way distance_goal_unit's check constraint and its TypeScript
-- DistanceGoalUnit union are already kept in sync by hand, nothing here
-- generates one from the other). A square fills the first time that
-- participant logs a workout the client classifies into that category
-- (src/challenges/bingo.ts's classifyWorkout, run against
-- WorkoutSample.name — see src/challenges/deviceSync.ts's
-- syncBingoProgressFromDevice for the actual sync path). One row per
-- (challenge, participant, category) that's ever been filled — never
-- updated or deleted once inserted, since a square that's filled stays
-- filled for the rest of the challenge; there's nothing to correct the
-- way a mis-logged steps/distance day can be re-synced over in
-- progress_snapshots.
--
-- Unlike Tag (0045_tag_game_state.sql), there's no shared/rotating state
-- here at all — every row is purely "this one participant has logged
-- this one category," so plain participant-writes-their-own-row RLS
-- (the same shape progress_snapshots' own policies already use) is
-- enough; no security-definer functions needed.
--
-- No bot support, same reasoning as Tag: a bot's steps/distance are
-- simulated numbers (src/challenges/botSimulation.ts), never a real,
-- classifiable WorkoutSample — there's no workout for a bot to log into
-- a category.
--
-- Run this once, after 0051 (as its own, separately committed
-- transaction), in the SQL Editor.

create table public.bingo_progress (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (
    category in ('run', 'walk_hike', 'cycling', 'swim', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports', 'other')
  ),
  first_logged_at timestamptz not null default now(),
  primary key (challenge_id, user_id, category)
);

alter table public.bingo_progress enable row level security;

-- Same "any participant can see everyone's shared game state" shape as
-- progress_snapshots' own "Participants can view challenge progress"
-- policy (0001) — a bingo leaderboard (who's filled the most squares)
-- needs every participant's rows, not just the caller's own.
create policy "Participants can view bingo progress"
  on public.bingo_progress for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = bingo_progress.challenge_id and cp.user_id = auth.uid()
    )
  );

-- No update/delete policy at all — a filled square is filled for good,
-- same as tag_events' own append-only shape (0045).
create policy "Users can record their own bingo progress"
  on public.bingo_progress for insert
  to authenticated
  with check (user_id = auth.uid());
