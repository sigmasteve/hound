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
  | 'doorsKnock'
  | 'packsVote'
  | 'hoopsPick'
  | 'hoopsShoot'
  | 'baseballBat'
  | 'cricketPlay'
  | 'rouletteSpin'
  | 'slotsSpin'
  | 'longshotFire'
  | 'chessMove'
  | 'rouletteDuel'
  | 'derbySwing'
  | 'shootoutKick'
  | 'boutIncoming'
  | 'boutPunches'
  | 'horseSetShot'
  | 'horseTurn'
  | 'golfPlay'
  | 'logProgress';

export interface PendingAction {
  challengeId: string;
  challengeName: string;
  kind: PendingActionKind;
  label: string;
  // The challenge's kind, so Today's Needs you can open the game's own
  // screen (a Hound Bout's ring or a Title Bout's) straight from the tile.
  challengeKind?: Challenge['kind'];
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
    challenge.kind !== 'houndopoly' &&
    challenge.kind !== 'doors' &&
    challenge.kind !== 'packs' &&
    challenge.kind !== 'soccer' &&
    challenge.kind !== 'cricket' &&
    challenge.kind !== 'baseball' &&
    challenge.kind !== 'hoops' &&
    challenge.kind !== 'horse' &&
    challenge.kind !== 'golf' &&
    challenge.kind !== 'derby' &&
    challenge.kind !== 'shootout' &&
    challenge.kind !== 'bout' &&
    challenge.kind !== 'titlebout' &&
    challenge.kind !== 'roulette' &&
    challenge.kind !== 'slots' &&
    challenge.kind !== 'longshot' &&
    challenge.kind !== 'chess'
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
  // Daily Doors where today's door is still shut (0172).
  doorsShut?: Set<string>;
  // Pack Wars where the caller hasn't voted today (0174).
  packsUnvoted?: Set<string>;
  // Hoops where the caller hasn't voted on today's defense (0195), and
  // H-O-R-S-E where they're setting and haven't picked today's shot (0196).
  hoopsUnpicked?: Set<string>;
  // Hoops where the caller takes their own shots and has some ready
  // (0206): how many.
  hoopsShotsReady?: Map<string, number>;
  // Baseball (0207): at-bats ready to take in a hands-on game.
  baseballAtBatsReady?: Map<string, number>;
  // Cricket (0234): balls ready to bat or bowl by hand.
  cricketBallsReady?: Map<string, { n: number; role: 'bat' | 'bowl' }>;
  // Hound Roulette (0236): today's spin not taken, and a Duel call to
  // answer (from whom, for how much).
  rouletteWaiting?: Map<string, { spin: boolean; duel: { from: string; stake: number } | null; ride: number }>;
  // Paw Slots (0242): spins ready to play today.
  slotsReady?: Map<string, number>;
  // Long Shot (0247): rounds ready to fire today.
  longshotReady?: Map<string, number>;
  // Hound Chess (0238): games where it's the caller's move: against whom,
  // and whether they're in check.
  chessYourMove?: Map<string, { them: string; check: boolean }>;
  // The Home Run Derby (0211): swings ready to take, for a derby you've
  // joined.
  derbySwingsReady?: Map<string, number>;
  // The Hound Shootout (0221): kicks ready to take, for one you've joined.
  shootoutKicksReady?: Map<string, number>;
  // Hound Bout (0225): punches waiting to be slipped, and actions left.
  boutReady?: Map<string, { incoming: number; actions: number }>;
  horseToSet?: Set<string>;
  // H-O-R-S-E, call your shot (0209): games where it's the caller's turn,
  // what it's for (setting or matching), the other player's first name,
  // and the time left ("21h 14m").
  horseTurns?: Map<string, { kind: 'set' | 'match'; them: string; left: string }>;
  // Golf where the caller takes their own shots and has yards banked
  // (0200): what's banked and the hole they're on.
  golfToPlay?: Map<string, { yards: number; hole: number }>;
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
  doorsShut = new Set(),
  packsUnvoted = new Set(),
  hoopsUnpicked = new Set(),
  hoopsShotsReady = new Map(),
  baseballAtBatsReady = new Map(),
  cricketBallsReady = new Map(),
  rouletteWaiting = new Map(),
  slotsReady = new Map(),
  longshotReady = new Map(),
  chessYourMove = new Map(),
  derbySwingsReady = new Map(),
  shootoutKicksReady = new Map(),
  boutReady = new Map(),
  horseToSet = new Set(),
  horseTurns = new Map(),
  golfToPlay = new Map(),
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
    } else if (c.kind === 'packs') {
      if (packsUnvoted.has(c.id)) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'packsVote',
          label: `Vote your pack's march in ${c.name}`,
        });
      }
    } else if (c.kind === 'hoops') {
      const ready = hoopsShotsReady.get(c.id) ?? 0;
      if (ready > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'hoopsShoot',
          label: `${ready} Hoops ${ready === 1 ? 'shot' : 'shots'} ready in ${c.name}`,
        });
      }
      if (hoopsUnpicked.has(c.id)) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'hoopsPick',
          label: `Pick your shot and your defense in ${c.name}`,
        });
      }
    } else if (c.kind === 'baseball') {
      const ready = baseballAtBatsReady.get(c.id) ?? 0;
      if (ready > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'baseballBat',
          label: `${ready} ${ready === 1 ? 'at-bat' : 'at-bats'} ready in ${c.name}`,
        });
      }
    } else if (c.kind === 'cricket') {
      const r = cricketBallsReady.get(c.id);
      if (r && r.n > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'cricketPlay',
          label: r.role === 'bowl' ? `Your over to bowl in ${c.name}` : `${r.n} ${r.n === 1 ? 'ball' : 'balls'} to bat in ${c.name}`,
        });
      }
    } else if (c.kind === 'chess') {
      const m = chessYourMove.get(c.id);
      if (m) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'chessMove',
          label: m.check ? `You’re in check against ${m.them} in ${c.name}` : `Your move against ${m.them} in ${c.name}`,
        });
      }
    } else if (c.kind === 'longshot') {
      const n = longshotReady.get(c.id) ?? 0;
      if (n > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'longshotFire',
          label: `${n} ${n === 1 ? 'round' : 'rounds'} ready in ${c.name}`,
        });
      }
    } else if (c.kind === 'slots') {
      const n = slotsReady.get(c.id) ?? 0;
      if (n > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'slotsSpin',
          label: `${n} ${n === 1 ? 'spin' : 'spins'} ready in ${c.name}`,
        });
      }
    } else if (c.kind === 'roulette') {
      const w = rouletteWaiting.get(c.id);
      if (w?.duel) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'rouletteDuel',
          label: `${w.duel.from} called you out for ${w.duel.stake} in ${c.name}`,
        });
      }
      if (w?.spin) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'rouletteSpin',
          label: w.ride > 0 ? `Spin today’s wheel in ${c.name} · ${w.ride} riding` : `Spin today’s wheel in ${c.name}`,
        });
      }
    } else if (c.kind === 'derby') {
      const ready = derbySwingsReady.get(c.id) ?? 0;
      if (ready > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'derbySwing',
          label: `${ready} ${ready === 1 ? 'swing' : 'swings'} ready in the Home Run Derby`,
        });
      }
    } else if (c.kind === 'bout' || c.kind === 'titlebout') {
      const b = boutReady.get(c.id);
      if (b && b.incoming > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'boutIncoming',
          label: `${b.incoming} ${b.incoming === 1 ? 'combination' : 'combinations'} to face in ${c.name}`,
        });
      } else if (b && b.actions > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'boutPunches',
          label: `${b.actions} ${b.actions === 1 ? 'exchange' : 'exchanges'} ready in ${c.name}`,
        });
      }
    } else if (c.kind === 'shootout') {
      const ready = shootoutKicksReady.get(c.id) ?? 0;
      if (ready > 0) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'shootoutKick',
          label: `${ready} ${ready === 1 ? 'kick' : 'kicks'} ready in the Hound Shootout`,
        });
      }
    } else if (c.kind === 'horse') {
      const turn = horseTurns.get(c.id);
      if (turn) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'horseTurn',
          label: `Your turn in ${c.name}: ${turn.kind === 'match' ? `match ${turn.them}'s shot` : 'set a shot'}${turn.left ? ` (${turn.left} left)` : ''}`,
        });
      }
      if (horseToSet.has(c.id)) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'horseSetShot',
          label: `Set today's shot in ${c.name}`,
        });
      }
    } else if (c.kind === 'golf') {
      const g = golfToPlay.get(c.id);
      if (g) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'golfPlay',
          label: `${g.yards.toLocaleString()} yards banked: play hole ${g.hole}`,
        });
      }
    } else if (c.kind === 'doors') {
      if (doorsShut.has(c.id)) {
        actions.push({
          challengeId: c.id,
          challengeName: c.name,
          kind: 'doorsKnock',
          label: `Knock knock: today's door is waiting in ${c.name}`,
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

  const kinds = new Map(challenges.map((c) => [c.id, c.kind]));
  return actions.map((a) => ({ ...a, challengeKind: kinds.get(a.challengeId) }));
}
