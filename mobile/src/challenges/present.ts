import { botToLeaderboardEntry, botToParticipant, daysElapsedFraction } from './botSimulation';
import { buildBoard, headStartDaysLeft, isChallengeFinished, withHuntCatches } from './board';
import { BINGO_SQUARE_COUNT } from './bingo';
import { boardSortFor } from './scoring';
import { CHALLENGE_TYPES, type ChallengeCard } from '../data/sampleData';
import { TINT_A, TINT_N } from '../theme/tokens';
import { DEFAULT_HUNT_LABELS, type HuntLabels } from '../labels/types';
import type { Challenge, ChallengeBot, HuntRole, LeaderboardEntry, Participant } from './types';

// What a role's <Tag> actually reads — HuntRole's own values ('hunter',
// 'hunted', 'zombie') are internal identifiers that never change; this is
// the customizable word for it (see SettingsScreen's "Chase labels" card
// and src/labels/). `labels` defaults to the app's original wording so a
// caller that hasn't loaded useLabels() yet (or Supabase isn't
// configured) still renders something correct.
export function huntRoleLabel(role: HuntRole, labels: HuntLabels = DEFAULT_HUNT_LABELS): string {
  return labels[role];
}

export const HUNT_ROLE_TAG_VARIANT: Record<HuntRole, 'accent' | 'neutral' | 'outline'> = {
  hunter: 'accent',
  hunted: 'neutral',
  zombie: 'outline',
};

// The hunt challenge kind's own display name. Used to be built from the
// two customizable role words (the app's original "Hunter & Hunted"), but
// "Chase" reads as its own name rather than a composite of whatever the
// two roles are currently called, so it's a fixed word now, independent
// of src/labels/.
export function huntKindName(): string {
  return 'Chase';
}

// CreateScreen's 'tomorrow' start option (and a future starts_at set any
// other way) means a challenge can exist before it's actually begun —
// both toChallengeCard's "Day X of Y" and ChallengeDetailScreen's own
// header used to read Date.now() - startsAt and clamp the negative
// result up to "Day 1", which looked identical to a challenge that had
// genuinely just started. hasStarted() is the one check both places use
// to tell those two apart.
export function hasStarted(challenge: Pick<Challenge, 'startsAt'>, now: number = Date.now()): boolean {
  return new Date(challenge.startsAt).getTime() <= now;
}

// What to show in place of "Day X of Y" before a challenge has started —
// mirrors ChallengeDetailScreen's own formatEndsLabel (name a countdown
// under a day, otherwise a calendar date), with one addition: "tomorrow"
// specifically, since that's a real CreateScreen option people pick by
// name and deserve to see echoed back, not just "starts Sep 21".
export function formatStartsLabel(startsAt: string, now: number = Date.now()): string {
  const start = new Date(startsAt);
  const msUntil = start.getTime() - now;
  if (msUntil <= 0) return 'starts now';
  if (msUntil < 24 * 3_600_000) {
    const hours = Math.floor(msUntil / 3_600_000);
    const minutes = Math.floor((msUntil % 3_600_000) / 60_000);
    return hours > 0 ? `starts in ${hours}h ${minutes}m` : `starts in ${Math.max(1, minutes)}m`;
  }
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysUntil = Math.round((startDay.getTime() - todayStart.getTime()) / 86_400_000);
  if (daysUntil === 1) return 'starts tomorrow';
  return `starts ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// Turns a raw challenge + who's in it + what they've logged into the same
// display shape src/data/sampleData.ts hand-authors for the sample
// content — ChallengesScreen.tsx's <ChallengeRow> renders either without
// caring which one it got. Keeping this formatting out of
// supabaseChallenges.ts means the provider only ever returns plain rows.
export function toChallengeCard(
  challenge: Challenge,
  participants: Participant[],
  leaderboard: LeaderboardEntry[],
  bots: ChallengeBot[],
  currentUserId: string | null,
  // Only needed for a hunt with a head start — see buildBoard's own
  // param of the same name. Defaults to none, which is correct for
  // every other case (nothing to credit).
  headStartLeaderboard: LeaderboardEntry[] = [],
  // The caller's current useLabels().labels — defaults to the app's
  // original wording so a caller that never passes this (or hasn't
  // loaded it yet) still gets a correct, if not-yet-customized, name.
  labels: HuntLabels = DEFAULT_HUNT_LABELS,
): ChallengeCard {
  const typeDef = CHALLENGE_TYPES.find((t) => t.id === challenge.kind);
  const kindLabel = challenge.kind === 'hunt' ? huntKindName() : (typeDef?.name ?? challenge.kind);
  const tint = typeDef?.tint ?? TINT_N;
  const iconColor = typeDef?.iconColor ?? '#e9e9ed';

  const daysElapsed = Math.min(challenge.durationDays, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1);

  // Bots count as people for the summary card too — a bot always has
  // "logged" something (its steps are simulated, not recorded), so it
  // belongs in both the head-count and the leaderboard used for rank.
  const allParticipants = [...participants, ...bots.map(botToParticipant)];
  const allLeaderboard = [...leaderboard, ...bots.map((b) => botToLeaderboardEntry(b, daysElapsedFraction(challenge)))];

  const peopleCount = allParticipants.length;
  const peopleLabel = `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`;
  const sub = hasStarted(challenge)
    ? `Day ${daysElapsed} of ${challenge.durationDays} · ${peopleLabel}`
    : `${formatStartsLabel(challenge.startsAt)} · ${peopleLabel}`;

  // Nothing calls recordProgress() yet (see README "What's not
  // implemented"), so a freshly created challenge always has an empty
  // leaderboard even though it has participants — this is the honest
  // "no one's logged anything yet" state, not a bug to paper over.
  let stat = '—';
  let statLabel = 'no data yet';
  const distanceGoal =
    challenge.kind === 'distance' || challenge.kind === 'tag'
      ? challenge.distanceGoalUnit === 'steps'
        ? challenge.distanceGoalSteps
        : challenge.distanceGoalMi
      : null;
  if (challenge.kind === 'bingo') {
    // Never scored via progress_snapshots at all (see
    // src/challenges/bingoApi.ts) — allLeaderboard is always empty for
    // this kind, so the generic branches below would otherwise show a
    // permanent, misleading "no data yet." A live "X of 9 squares" here
    // would need this list's own caller to fetch bingo_progress per
    // bingo challenge shown, which isn't worth it just for this compact
    // card — the real per-square state lives on the detail screen.
    stat = String(BINGO_SQUARE_COUNT);
    statLabel = 'categories to fill';
  } else if (challenge.kind === 'tictacgo') {
    // Board state lives in tictacgo_games, not progress_snapshots — the
    // live board is on the detail screen.
    stat = '1v1';
    statLabel = 'three in a row wins';
  } else if (distanceGoal) {
    // A distance pool isn't a ranked leaderboard at all — everyone's
    // steps or miles (whichever unit its creator picked — see
    // CreateScreen.tsx) add up toward the one shared goal, so the
    // card's stat is the group's combined progress, not this user's own
    // rank.
    if (challenge.distanceGoalUnit === 'steps') {
      const groupTotalSteps = allLeaderboard.reduce((sum, p) => sum + p.totalSteps, 0);
      stat = groupTotalSteps.toLocaleString();
      statLabel = `of ${distanceGoal.toLocaleString()} steps goal`;
    } else {
      const groupTotalMi = allLeaderboard.reduce((sum, p) => sum + p.totalDistanceMi, 0);
      stat = groupTotalMi.toFixed(1);
      statLabel = `of ${distanceGoal} mi goal`;
    }
  } else if (allLeaderboard.length > 0) {
    const ranked = [...allLeaderboard].sort((a, b) => b.totalSteps - a.totalSteps);
    const myRank = currentUserId ? ranked.findIndex((p) => p.userId === currentUserId) : -1;
    if (myRank >= 0) {
      stat = ordinal(myRank + 1);
      statLabel = `of ${ranked.length} · ${ranked[myRank].totalSteps.toLocaleString()} steps`;
    } else {
      stat = String(ranked.length);
      statLabel = ranked.length === 1 ? 'person logging' : 'people logging';
    }
  }

  // See isChallengeFinished (src/challenges/board.ts) — a hunt finishes
  // the moment there's nobody left to chase, however many scheduled days
  // remain; anything else just runs out its clock.
  const sortBy = boardSortFor(challenge);
  const board = withHuntCatches(
    buildBoard(participants, leaderboard, bots, daysElapsedFraction(challenge), sortBy, challenge, headStartLeaderboard),
    sortBy,
    challenge,
  );
  const finished = isChallengeFinished(challenge, board);

  return {
    id: challenge.id,
    name: challenge.name,
    kind: challenge.kind,
    kindLabel,
    sub,
    stat,
    statLabel,
    tint,
    iconColor,
    people: allParticipants.slice(0, 4).map((p) => ({
      initials: p.initials,
      tint: p.userId === currentUserId ? TINT_A : TINT_N,
    })),
    finished,
    headStartDaysLeft: headStartDaysLeft(challenge),
    // Opens the generic ChallengeDetailScreen — HuntScreen is one
    // specific hardcoded storyline, not a template real challenges of
    // any kind can share, so this never points there.
    target: 'detail',
  };
}

export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
