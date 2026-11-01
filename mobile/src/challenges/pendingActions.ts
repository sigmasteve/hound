import { usesDeviceSteps, usesWorkoutDistance } from './scoring';
import type { Challenge, TagRound } from './types';
import type { TicTacGoGame } from './tictacgoApi';
import type { MyRallyShot } from './rallyApi';
import { formatRallyDue, formatSteps } from './rally';

export type PendingActionKind =
  | 'tagPickTarget'
  | 'tictacgoYourMove'
  | 'rallyYourShot'
  | 'seventyfiveChecklist'
  | 'checklistToday'
  | 'houndopolyDecide'
  | 'logProgress';

export interface PendingAction {
  challengeId: string;
  challengeName: string;
  kind: PendingActionKind;
  label: string;
}

// Same exclusion list ChallengeDetailScreen's own "Log your progress"
// card uses (see that screen's own comment) — a challenge only needs a
// manual entry today if nothing already auto-syncs it from the device
// and it isn't one of the three kinds with their own dedicated
// mechanic (Tic-Tac-Go's board, Bingo's card, 75 Day's checklist).
export function needsManualEntry(challenge: Challenge): boolean {
  return (
    !usesDeviceSteps(challenge) &&
    !usesWorkoutDistance(challenge) &&
    challenge.kind !== 'tictacgo' &&
    challenge.kind !== 'bingo' &&
    challenge.kind !== 'seventyfive' &&
    challenge.kind !== 'checklist' &&
    challenge.kind !== 'houndopoly'
  );
}

export interface PendingActionsInput {
  myUserId: string;
  now: Date;
  // Active (not-yet-finished) challenges only — a finished challenge
  // never has anything left for anyone to act on, so callers should
  // filter before building this input rather than this function
  // re-deriving "finished" itself (it would need each kind's own board
  // state to do that correctly, which this module deliberately doesn't
  // touch).
  challenges: Challenge[];
  // Keyed by challengeId — only ever populated for kind 'tag' entries in
  // `challenges`; a missing entry (round not fetched, or none exists
  // yet) is treated as "nothing to act on" rather than an error, same
  // "fail toward showing nothing, not a false action" reasoning as every
  // other map below.
  tagRounds: Map<string, TagRound>;
  tictacgoGames: Map<string, TicTacGoGame>;
  // Rallies where the shuttle is on the caller's side right now, keyed by
  // challengeId (my_rally_shots) — kind 'rally' entries only.
  rallyShots: Map<string, MyRallyShot>;
  // Whether the caller has finished today's 75 Day checklist — only
  // meaningful for kind 'seventyfive' entries.
  seventyfiveTodayComplete: Map<string, boolean>;
  // The same for an Accountability challenge's list — kind 'checklist'.
  checklistTodayComplete: Map<string, boolean>;
  // Hound'opoly games where a square is waiting on the caller to buy or
  // pass (houndopoly_players.pending_idx).
  houndopolyPending: Set<string>;
  // Whether the caller has logged anything today — only meaningful for
  // challenges needsManualEntry() considers manual-entry kinds.
  loggedProgressToday: Map<string, boolean>;
}

// Pure reduction over already-fetched per-kind state into a flat list of
// "you need to do something here" items — no fetching of its own, so it
// stays as easy to reason about (and test) as computeStreakStatus/
// computeSeventyFiveStatus. Order follows `challenges`' own order (Home's
// existing sort), not urgency — there's no cross-kind way to rank "your
// move" against "today's checklist" that wouldn't be arbitrary.
export function computePendingActions({
  myUserId,
  now,
  challenges,
  tagRounds,
  tictacgoGames,
  rallyShots,
  seventyfiveTodayComplete,
  checklistTodayComplete,
  houndopolyPending,
  loggedProgressToday,
}: PendingActionsInput): PendingAction[] {
  const actions: PendingAction[] = [];

  for (const c of challenges) {
    if (c.kind === 'tag') {
      const round = tagRounds.get(c.id);
      // Mirrors ChallengeDetailScreen.tsx's own iAmTagIt/target-picker
      // gate exactly: It, with nobody picked yet.
      if (round && round.itUserId === myUserId && !round.targetUserId) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'tagPickTarget',
          label: `You're It in ${c.name} — pick a target`,
        });
      }
    } else if (c.kind === 'tictacgo') {
      const game = tictacgoGames.get(c.id);
      // Mirrors TicTacGoCard's own myTurn: active game, my turn, and the
      // turn has actually begun (turnStartedAt can be in the future for
      // a freshly-claimed square's opponent, same "not yet your move"
      // window that card already accounts for).
      const turnBegun = !!game?.turnStartedAt && new Date(game.turnStartedAt).getTime() <= now.getTime();
      if (game && game.status === 'active' && game.turnUserId === myUserId && turnBegun) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'tictacgoYourMove',
          label: `Your move in ${c.name}`,
        });
      }
    } else if (c.kind === 'rally') {
      const shot = rallyShots.get(c.id);
      if (shot) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'rallyYourShot',
          label: `Shuttle's on your side in ${c.name} — ${formatSteps(shot.targetSteps * (shot.smashArmed ? 2 : 1))} ${formatRallyDue(shot.dueAt, now)}`,
        });
      }
    } else if (c.kind === 'seventyfive') {
      if (seventyfiveTodayComplete.get(c.id) === false) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'seventyfiveChecklist',
          label: `Finish today's checklist in ${c.name}`,
        });
      }
    } else if (c.kind === 'checklist') {
      if (checklistTodayComplete.get(c.id) === false) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'checklistToday',
          label: `Tick off today's list in ${c.name}`,
        });
      }
    } else if (c.kind === 'houndopoly') {
      if (houndopolyPending.has(c.id)) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'houndopolyDecide',
          label: `Buy or pass on the square you landed on in ${c.name}`,
        });
      }
    } else if (needsManualEntry(c) && loggedProgressToday.get(c.id) === false) {
      actions.push({
        challengeId: c.id,
        challengeName: c.name,
        kind: 'logProgress',
        label: `Log today's progress in ${c.name}`,
      });
    }
  }

  return actions;
}
