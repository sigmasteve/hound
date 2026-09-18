export type ChallengeKind = 'hunt' | 'steps' | 'streak' | 'distance';

// A hunt has exactly one Hunter and one or more Hunted — never set for
// any other challenge kind. 'zombie' is a one-way transition a Hunted
// participant makes once the Hunter catches them (see
// src/challenges/board.ts's withHuntCatches) — there's no path back to
// 'hunted' once caught.
export type HuntRole = 'hunter' | 'hunted' | 'zombie';

// Only meaningful for kind 'hunt': which real-world signal decides who's
// ahead. 'device_steps' auto-syncs from useHealthProvider() the same way
// a 'steps'-kind challenge does; 'gps_distance' and 'any_workout'
// auto-sync from today's logged workouts (see
// ChallengeDetailScreen.tsx's syncFromDevice for exactly what
// distinguishes the two — the health abstraction has no true GPS-verified
// flag, so 'gps_distance' approximates it as workouts named like a run or
// walk).
export type ScoringMethod = 'gps_distance' | 'any_workout' | 'device_steps';

// Only meaningful for kind 'distance': which number the group's shared
// target is measured in — see Challenge.distanceGoalMi/distanceGoalSteps
// and CreateScreen.tsx's unit picker.
export type DistanceGoalUnit = 'miles' | 'steps';

export interface Challenge {
  id: string;
  name: string;
  kind: ChallengeKind;
  createdBy: string;
  durationDays: number;
  startsAt: string;
  endsAt: string;
  dailyGoalSteps: number | null;
  scoringMethod: ScoringMethod | null;
  // Only meaningful for kind 'hunt': how many days the Hunted gets to log
  // alone before the Hunter's own total starts counting toward a catch
  // (see src/challenges/board.ts's withHuntCatches) — null for every
  // other kind, and for a hunt created before this existed.
  headStartDays: number | null;
  // Only meaningful for kind 'distance': the shared target the whole
  // group is trying to cover together, and which unit it's measured in
  // — see toChallengeCard's group-progress stat and
  // ChallengeDetailScreen's "Group progress" card. `distanceGoalUnit`
  // null means "miles" (every pool created before the unit picker
  // existed only ever set distanceGoalMi, in miles); exactly one of
  // distanceGoalMi/distanceGoalSteps is ever set for a given pool.
  distanceGoalMi: number | null;
  distanceGoalSteps: number | null;
  distanceGoalUnit: DistanceGoalUnit | null;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  initials: string;
  totalSteps: number;
  totalDistanceMi: number;
}

export interface Participant {
  userId: string;
  name: string;
  initials: string;
  role: HuntRole | null;
  // Whether *this* participant has picked this challenge to headline
  // their own Home screen — per-participant, not per-challenge, so two
  // people in the same challenge can highlight different ones.
  highlighted: boolean;
}

// A bot never signs in and never calls recordProgress() — its steps are
// simulated on read from its id and level (see
// src/challenges/botSimulation.ts), not stored day by day.
export type BotFitnessLevel = 'casual' | 'active' | 'athletic' | 'elite';

export interface ChallengeBot {
  id: string;
  challengeId: string;
  name: string;
  fitnessLevel: BotFitnessLevel;
  role: HuntRole | null;
}

// An invite to join an existing challenge — separate from friendships:
// there's no durable "connected" state to keep once you're a
// challenge_participants row, unlike a friendship. See
// 0009_challenge_invites.sql.
export interface ChallengeInvite {
  id: string;
  challengeId: string;
  challengeName: string;
  challengeKind: ChallengeKind;
  durationDays: number;
  inviterName: string;
  // Only meaningful for challengeKind 'hunt' — the role the inviter
  // picked for this friend in CreateScreen's "Who's the Hunter?" step
  // (or ChallengeDetailScreen's own "Invite a friend" card, which never
  // offers a role and always leaves this null). Copied onto the new
  // challenge_participants row when accepted — see
  // acceptChallengeInvite.
  role: HuntRole | null;
}

export interface CreateChallengeInput {
  name: string;
  kind: ChallengeKind;
  durationDays: number;
  dailyGoalSteps?: number;
  scoringMethod?: ScoringMethod;
  // Only meaningful for kind 'hunt' — the creator's own role. Exactly one
  // participant across creator + bots should be 'hunter'; the rest that
  // are assigned a role at all should be 'hunted'.
  creatorRole?: HuntRole;
  bots?: { name: string; fitnessLevel: BotFitnessLevel; role?: HuntRole }[];
  // Only meaningful for kind 'hunt' — see Challenge.headStartDays.
  headStartDays?: number;
  // Only meaningful for kind 'distance' — see Challenge.distanceGoalMi /
  // distanceGoalSteps / distanceGoalUnit. Set exactly one of
  // distanceGoalMi/distanceGoalSteps, matching distanceGoalUnit.
  distanceGoalMi?: number;
  distanceGoalSteps?: number;
  distanceGoalUnit?: DistanceGoalUnit;
}

export interface ChallengesProvider {
  // Raw rows only — screens that need display strings (colors, "day 9 of
  // 21", tint per person) compute them from these via
  // src/challenges/present.ts rather than the provider doing it, so a
  // real backend and the sample-data fallback can share one formatter.
  listMyChallenges(): Promise<Challenge[]>;
  getChallenge(challengeId: string): Promise<Challenge>;
  // Every participant, regardless of whether they've recorded any
  // progress yet — a freshly created challenge has participants (at
  // least its creator) but an empty leaderboard, since nothing calls
  // recordProgress() yet (see README "What's not implemented").
  listParticipants(challengeId: string): Promise<Participant[]>;
  listBots(challengeId: string): Promise<ChallengeBot[]>;
  // `asOfDay` ('YYYY-MM-DD'), when given, sums only progress_snapshots
  // rows on or before that day instead of every row — used to find a
  // Hunter's own total at the exact moment a head start ended (see
  // src/challenges/board.ts's headStartBaselineDayKey/buildBoard), not just
  // their current running total.
  getLeaderboard(challengeId: string, asOfDay?: string): Promise<LeaderboardEntry[]>;
  createChallenge(input: CreateChallengeInput): Promise<Challenge>;
  // `day` ('YYYY-MM-DD') defaults to today when omitted — pass it
  // explicitly to backfill a past day (see ChallengeDetailScreen's
  // syncFromDevice, which backfills every day since the challenge
  // started using real device history instead of only ever writing
  // today's row).
  recordProgress(challengeId: string, steps: number, distanceMi: number, day?: string): Promise<void>;
  // Only the creator can do this — see 0005_challenges_delete_policy.sql.
  // Cascades to that challenge's participants, bots, and progress.
  deleteChallenge(challengeId: string): Promise<void>;
  // The current user's own highlighted challenge (see
  // 0006_challenge_highlight.sql), or null if they haven't highlighted
  // one. HomeScreen uses this instead of always defaulting to whichever
  // challenge was created most recently.
  getHighlightedChallenge(): Promise<Challenge | null>;
  // Only one challenge can be highlighted per user at a time — setting
  // `true` clears any other challenge the current user had highlighted.
  setHighlighted(challengeId: string, highlighted: boolean): Promise<void>;
  // Pending invites addressed to the current user, across every
  // challenge — ChallengesScreen renders one card per invite.
  listMyChallengeInvites(): Promise<ChallengeInvite[]>;
  // Only a current participant of challengeId can call this (see
  // 0009_challenge_invites.sql's insert policy) — inviting someone
  // who isn't your friend still works, this doesn't check friendships.
  // `role` is only meaningful for a 'hunt' challenge — see
  // CreateScreen's "Who's the Hunter?" step, which is the only caller
  // that ever passes one; ChallengeDetailScreen's own "Invite a friend"
  // card omits it, leaving the invite (and the participant row it
  // becomes) roleless, same as before this existed.
  inviteFriendToChallenge(challengeId: string, friendUserId: string, role?: HuntRole): Promise<void>;
  // Every friend the caller has already invited to challengeId who
  // hasn't accepted or declined yet — used to hydrate
  // ChallengeDetailScreen's "Invite a friend" card on load, so a friend
  // invited at creation time (via CreateScreen's "Bring friends" step)
  // or on an earlier visit reads "Remind" from the very first render,
  // not just after tapping "Invite" in this same session.
  listSentChallengeInvites(challengeId: string): Promise<string[]>;
  // Re-sends the invite email for a friend who already has a pending
  // invite — same underlying send-challenge-invite-email call
  // inviteFriendToChallenge's own insert triggers, just fired explicitly
  // instead of right after creating the invite. Unlike that best-effort
  // send, this throws on failure (no pending invite found, or the send
  // itself fails): it's a deliberate "remind them" tap, so silently
  // doing nothing would read as "it worked" when it didn't.
  remindChallengeInvite(challengeId: string, friendUserId: string): Promise<void>;
  // Joins as a real challenge_participants row and removes the invite —
  // there's nothing left to represent once you're a participant.
  acceptChallengeInvite(inviteId: string): Promise<void>;
  declineChallengeInvite(inviteId: string): Promise<void>;
  // Flips the caller's own participant row from 'hunted' to 'zombie' —
  // called automatically once the board shows they've been caught (see
  // withHuntCatches), not something a screen exposes as a button. Only
  // ever touches the caller's own row (see the RLS policy this relies on
  // in 0006_challenge_highlight.sql), so there's no way for the Hunter to
  // catch anyone but themselves through this call — the client only ever
  // calls it for its own signed-in user.
  markCaught(challengeId: string): Promise<void>;
}
