-- Hound: let a challenge invite carry the Hunter/Hunted role the
-- inviter picked for that friend in CreateScreen's "Who's the Hunter?"
-- step, the same way challenge_bots.role (0004) already does for bots
-- picked in the same step.
--
-- Until now, a real friend invited via inviteFriendToChallenge had
-- nowhere to have a role recorded: challenge_invites had no role column,
-- and acceptChallengeInvite's challenge_participants insert never wrote
-- one either, so CreateScreen's Hunter picker only ever offered "You" or
-- a selected bot as candidates (see its own footnote: "real friend
-- invites above aren't wired to a role yet"). This migration is step one
-- of wiring that up — see supabaseChallenges.ts's
-- inviteFriendToChallenge/acceptChallengeInvite for the rest.
--
-- Run this once, after 0001-0013, in the SQL Editor.

alter table public.challenge_invites
  add column role text;
