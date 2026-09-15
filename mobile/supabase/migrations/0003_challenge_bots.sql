-- Hound: bot opponents — for a challenge with too few real friends to be
-- interesting, the creator can add named bots that simulate a plausible
-- number of steps per day at one of 4 fitness levels, instead of needing
-- another signed-up user.
--
-- Bots are not auth.users / profiles rows — nothing ever signs in as one —
-- so they get their own table rather than a nullable user_id on
-- challenge_participants. Their daily steps are never written to
-- progress_snapshots either: there's no job simulating and persisting a
-- day at a time, so the app recomputes a bot's whole trajectory on read,
-- deterministically, from this row's id (see
-- mobile/src/challenges/botSimulation.ts). This table only records that
-- the bot exists in this challenge and at what level.
--
-- Run this once, after 0001 and 0002, in the SQL Editor.

create type public.bot_fitness_level as enum ('casual', 'active', 'athletic', 'elite');

create table public.challenge_bots (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  name text not null,
  fitness_level public.bot_fitness_level not null,
  joined_at timestamptz not null default now()
);

alter table public.challenge_bots enable row level security;

create policy "Participants can view a challenge's bots"
  on public.challenge_bots for select
  to authenticated
  using (public.is_challenge_participant(challenge_id, auth.uid()));

-- Scoped to the challenge's creator rather than "any participant" so this
-- doesn't depend on the creator's own challenge_participants row having
-- landed first (createChallenge() inserts that row, then bots, in the same
-- call) — checking challenges.created_by directly has no such ordering
-- dependency.
create policy "Creators can add bots to their own challenge"
  on public.challenge_bots for insert
  to authenticated
  with check (
    exists (
      select 1 from public.challenges c
      where c.id = challenge_id and c.created_by = auth.uid()
    )
  );
