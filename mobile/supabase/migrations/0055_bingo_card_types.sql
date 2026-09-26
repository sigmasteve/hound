-- Hound: three bingo card types instead of just one — see
-- src/challenges/bingo.ts for the actual category lists/classifier this
-- backs. A bingo challenge now picks a "card type" at creation
-- (CreateScreen's own picker), which decides which 9 categories its card
-- has — everything else about the game (personal card, auto/manual fill,
-- leaderboard by squares filled, no bots) stays exactly the same
-- regardless of type, so this is one more field on the existing 'bingo'
-- kind, not three new kinds.
--
-- Null means 'variety' — the only type that existed before this
-- migration, same "null is the old-only meaning" convention
-- distance_goal_unit already uses (null there means "miles", the only
-- unit that existed before its own picker did). Every bingo challenge
-- created before this migration reads as Variety, unchanged.
alter table public.challenges
  add column bingo_card_type text check (bingo_card_type in ('variety', 'strength', 'sports'));

-- bingo_progress.category is one shared column across all three types —
-- a given row is only ever written using its own challenge's card type's
-- own category list (the app never mixes them), so this just needs to
-- allow the full vocabulary across all three; nothing here needs to know
-- which type a given category slug actually belongs to. 'other' is
-- shared by all three types rather than repeated per type (it means the
-- same thing everywhere: doesn't fit any of this card's other 8
-- squares), so the full list is 9 + 8 + 8 = 25, not 27.
alter table public.bingo_progress drop constraint bingo_progress_category_check;
alter table public.bingo_progress add constraint bingo_progress_category_check check (
  category in (
    -- Variety
    'run', 'walk_hike', 'cycling', 'swim', 'strength', 'yoga_pilates', 'hiit_cardio', 'sports', 'other',
    -- Strength (push/pull/legs split, not muscle groups — see bingo.ts)
    'push', 'pull', 'legs', 'core', 'upper', 'lower', 'full_body', 'cardio_strength',
    -- Sports
    'basketball', 'soccer', 'tennis', 'golf', 'baseball_softball', 'volleyball', 'hockey', 'combat_sports'
  )
);
