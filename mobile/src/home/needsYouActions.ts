import type { PendingAction, PendingActionKind } from '../challenges/pendingActions';
import type { RootStackParamList } from '../navigation/types';

// Today's Needs you tile, full width while anything's waiting (Steve's
// pick, Nov 2026): the top two game actions, each with its own button
// that opens the game's own screen (the ring, the court, the plate);
// everything else is in the sheet.

// The button's word.
export const ACTION_VERB: Record<PendingActionKind, string> = {
  tagPickTarget: 'Pick',
  tictacgoYourMove: 'Move',
  rallyYourShot: 'Hit',
  seventyfiveChecklist: 'Tick',
  checklistToday: 'Tick',
  houndopolyDecide: 'Decide',
  doorsKnock: 'Open',
  packsVote: 'Vote',
  hoopsPick: 'Pick',
  hoopsShoot: 'Shoot',
  baseballBat: 'Bat',
  cricketPlay: 'Play',
  rouletteSpin: 'Spin',
  slotsSpin: 'Play',
  longshotFire: 'Shoot',
  bullseyeShoot: 'Shoot',
  chessMove: 'Move',
  rouletteDuel: 'Answer',
  derbySwing: 'Swing',
  shootoutKick: 'Kick',
  boutIncoming: 'Slip',
  boutPunches: 'Punch',
  horseSetShot: 'Set',
  horseTurn: 'Shoot',
  golfPlay: 'Play',
  logProgress: 'Log',
};

// Up next's order (the streamlining, Steve Nov 2026: "play your turns
// should include the live-clock games, with higher priority"): first the
// games where a clock is running on you (your Chess move, a H-O-R-S-E
// turn, a Rally shot, a Roulette duel, Tic-Tac-Go, punches to slip before
// tonight), then what goes away tonight, then the rest; the pinned
// challenge first among equals.
const LIVE_CLOCK: PendingActionKind[] = ['chessMove', 'horseTurn', 'rallyYourShot', 'rouletteDuel', 'tictacgoYourMove', 'boutIncoming'];

export function isLiveClock(kind: PendingActionKind): boolean {
  return LIVE_CLOCK.includes(kind);
}

const URGENCY: Partial<Record<PendingActionKind, number>> = {
  chessMove: 0,
  horseTurn: 0,
  rallyYourShot: 0,
  rouletteDuel: 0,
  tictacgoYourMove: 0,
  boutIncoming: 0,
  // A day without a spin loses the ride.
  rouletteSpin: 1,
  tagPickTarget: 1,
  horseSetShot: 1,
  houndopolyDecide: 1,
};

export function rankActions(actions: PendingAction[], pinnedId: string | null): PendingAction[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        (URGENCY[x.a.kind] ?? 2) - (URGENCY[y.a.kind] ?? 2) ||
        Number(y.a.challengeId === pinnedId) - Number(x.a.challengeId === pinnedId) ||
        x.i - y.i,
    )
    .map((x) => x.a);
}

// The sheet's rows: one per challenge, its actions in Up next's order.
export interface ChallengeTurns {
  challengeId: string;
  challengeName: string;
  challengeKind?: PendingAction['challengeKind'];
  actions: PendingAction[];
  live: boolean;
}

export function groupByChallenge(ranked: PendingAction[]): ChallengeTurns[] {
  const out: ChallengeTurns[] = [];
  for (const a of ranked) {
    let g = out.find((x) => x.challengeId === a.challengeId);
    if (!g) {
      g = { challengeId: a.challengeId, challengeName: a.challengeName, challengeKind: a.challengeKind, actions: [], live: false };
      out.push(g);
    }
    g.actions.push(a);
    if (isLiveClock(a.kind)) g.live = true;
  }
  return out;
}

// What's left of the label once the challenge's name is its title:
// "2 incoming to slip in Title Bout" → "2 incoming to slip".
export function actionLine(a: PendingAction): string {
  const s = a.label
    .replace(` in ${a.challengeName}`, '')
    .replace(/ in the [A-Z][\w’' -]+$/, '')
    .replace(/^Your turn in [^:]+: /, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type ActionRoute = { [K in keyof RootStackParamList]: [K, RootStackParamList[K]] }[keyof RootStackParamList];

// The game's own screen for an action, else its challenge page (which
// pins the action to the bottom).
export function actionRoute(a: PendingAction): ActionRoute {
  const c = a.challengeId;
  switch (a.kind) {
    case 'hoopsShoot':
      return ['HoopsShoot', { challengeId: c }];
    case 'baseballBat':
      return ['BaseballBat', { challengeId: c }];
    case 'cricketPlay':
      return ['CricketPlay', { challengeId: c }];
    case 'rouletteSpin':
      return ['Roulette', { challengeId: c }];
    case 'slotsSpin':
      return ['Slots', { challengeId: c }];
    case 'longshotFire':
      return ['LongShot', { challengeId: c }];
    case 'bullseyeShoot':
      return ['Bullseye', { challengeId: c }];
    case 'chessMove':
      return ['Chess', { challengeId: c, mode: 'game' }];
    case 'derbySwing':
      return ['DerbyBat', { challengeId: c }];
    case 'shootoutKick':
      return ['ShootoutKick', { challengeId: c }];
    case 'horseTurn':
      return ['HorseShoot', { challengeId: c }];
    case 'golfPlay':
      return ['GolfPlay', { challengeId: c }];
    case 'boutIncoming':
    case 'boutPunches':
      return ['BoutRing', { challengeId: c, mode: a.kind === 'boutIncoming' ? 'slip' : 'throw', kind: a.challengeKind === 'titlebout' ? 'titlebout' : 'bout' }];
    default:
      return ['ChallengeDetail', { challengeId: c }];
  }
}
