-- Hound: a real "invite a friend to this challenge" flow, replacing
-- ChallengesScreen's hardcoded "Priya invited you to Sunrise Streak"
-- card — that card was never wired to any data at all, real or sample;
-- its Join/Decline buttons had no onPress.
--
-- Deliberately separate from friendships (0007) — a challenge invite
-- doesn't need a durable "we're now connected" state the way a
-- friendship does. Accepting just inserts a real challenge_participants
-- row (already-existing, from 0001) and the invite row is gone; there's
-- nothing left to represent once you're a participant.
--
-- Run this once, after 0001-0008, in the SQL Editor.

create table public.challenge_invites (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (inviter_id <> invitee_id),
  -- One pending invite per (challenge, invitee) regardless of who sent
  -- it — someone already invited to a challenge doesn't need a second
  -- card from a different friend.
  unique (challenge_id, invitee_id)
);

alter table public.challenge_invites enable row level security;

create policy "Users can view invites they sent or received"
  on public.challenge_invites for select
  to authenticated
  using (inviter_id = auth.uid() or invitee_id = auth.uid());

-- Only a current participant of the challenge can invite someone else
-- to it — same "have to be in it to grow it" rule Create's own
-- "Bring friends" step follows implicitly (only the creator picks who
-- joins at creation time).
create policy "Participants can invite someone to their challenge"
  on public.challenge_invites for insert
  to authenticated
  with check (
    inviter_id = auth.uid()
    and exists (
      select 1 from public.challenge_participants cp
      where cp.challenge_id = challenge_invites.challenge_id and cp.user_id = auth.uid()
    )
  );

-- Covers both "decline" (the invitee deletes it) and "cancel" (the
-- inviter withdraws it) — same one-row-both-directions shape
-- friendships already uses.
create policy "Either side can remove an invite"
  on public.challenge_invites for delete
  to authenticated
  using (inviter_id = auth.uid() or invitee_id = auth.uid());

-- 0001's "Participants can view their challenges" policy only covers
-- the creator and existing participants — an invitee isn't either yet,
-- but still needs to read the challenge's name/kind/duration to render
-- "so-and-so invited you to '<name>'". Adds a second, independent
-- permissive SELECT policy rather than editing the existing one
-- (Postgres ORs multiple permissive policies for the same command
-- together). References challenge_invites, not challenges itself, so
-- this doesn't reintroduce the self-referential recursion
-- 0002_fix_challenge_participants_recursion.sql had to fix.
create policy "Invitees can view challenges they're invited to"
  on public.challenges for select
  to authenticated
  using (
    exists (
      select 1 from public.challenge_invites ci
      where ci.challenge_id = challenges.id and ci.invitee_id = auth.uid()
    )
  );
