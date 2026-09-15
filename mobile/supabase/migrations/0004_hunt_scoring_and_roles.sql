-- Hound: real scoring + real Hunter/Hunted roles for Hunter & Hunted
-- challenges, replacing what was previously decorative UI in CreateScreen
-- (a "What counts" picker that never persisted, and hardcoded "You are
-- Hunted / Marcus is Hunter" labels).
--
-- Run this once, after 0001-0003, in the SQL Editor.

create type public.scoring_method as enum ('gps_distance', 'any_workout', 'device_steps');

-- Only meaningful for kind = 'hunt'; every other kind leaves this null,
-- same convention challenges.daily_goal_steps already uses.
alter table public.challenges
  add column scoring_method public.scoring_method;

-- challenge_participants.role already exists (0001) but nothing ever set
-- it. A bot can now be assigned the Hunter or Hunted role too, so it
-- needs the same free-text column challenge_participants has — a hunt
-- has exactly one Hunter and one or more Hunted, and either can be a real
-- participant or a bot.
alter table public.challenge_bots
  add column role text;
