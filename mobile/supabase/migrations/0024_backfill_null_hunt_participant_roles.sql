-- Fixes existing data broken by a client bug: ChallengeDetailScreen's
-- inviteFriend() (inviting into an already-running challenge, not
-- CreateScreen's wizard) never passed a role to
-- inviteFriendToChallenge(), so every friend invited into a hunt after
-- it was created joined with role null instead of 'hunted' — no Runner
-- tag on the leaderboard, and (per huntEffectiveMetric/withHuntCatches
-- in src/challenges/board.ts) never actually catchable by the Hunter.
-- The client is fixed to always pass 'hunted' for this case going
-- forward; this is the one-time backfill for whoever it already
-- happened to.
--
-- Every hunt has exactly one Hunter, assigned at creation
-- (CreateScreen's own roleFor) and never left null itself, so a null
-- role on a hunt's participant is unambiguously a Hunted who just never
-- got tagged — safe to backfill without needing to know which hunt or
-- which participant.
update public.challenge_participants cp
set role = 'hunted'
from public.challenges c
where c.id = cp.challenge_id
  and c.kind = 'hunt'
  and cp.role is null;
