// Hound'opoly (0136_houndopoly.sql): a property board game played with
// your steps. The server rolls and settles everything overnight; the app
// draws the board, says what tonight's dice are, shows the overnight
// feed and takes the one decision a player makes: buy the square they
// landed on, or let it go.

export type HoundopolySquareKind = 'start' | 'property' | 'fetch' | 'dog_house' | 'dog_park' | 'vet' | 'water_bowl';

export interface HoundopolySquare {
  idx: number;
  name: string;
  kind: HoundopolySquareKind;
  // Properties only.
  group: string | null;
  price: number | null;
}

// Mirrors houndopoly_squares by hand (the server's copy is the one rent
// is worked out from). Clockwise from Start.
export const HOUNDOPOLY_BOARD: HoundopolySquare[] = [
  { idx: 0, name: 'Start', kind: 'start', group: null, price: null },
  { idx: 1, name: 'Elm Street Walk', kind: 'property', group: 'a', price: 60 },
  { idx: 2, name: 'Birch Lane', kind: 'property', group: 'a', price: 60 },
  { idx: 3, name: 'Fetch!', kind: 'fetch', group: null, price: null },
  { idx: 4, name: 'Riverside Trail', kind: 'property', group: 'b', price: 100 },
  { idx: 5, name: 'Creekside Loop', kind: 'property', group: 'b', price: 120 },
  { idx: 6, name: 'Dog House', kind: 'dog_house', group: null, price: null },
  { idx: 7, name: 'Oak Hollow', kind: 'property', group: 'c', price: 140 },
  { idx: 8, name: 'Lakeshore Path', kind: 'property', group: 'c', price: 160 },
  { idx: 9, name: 'Harbor Walk', kind: 'property', group: 'c', price: 180 },
  { idx: 10, name: 'Fetch!', kind: 'fetch', group: null, price: null },
  { idx: 11, name: 'Meadow Run', kind: 'property', group: 'd', price: 200 },
  { idx: 12, name: 'Dog Park', kind: 'dog_park', group: null, price: null },
  { idx: 13, name: 'Orchard Way', kind: 'property', group: 'd', price: 220 },
  { idx: 14, name: 'Summit Ridge', kind: 'property', group: 'e', price: 240 },
  { idx: 15, name: 'Canyon Trail', kind: 'property', group: 'e', price: 260 },
  { idx: 16, name: 'Fetch!', kind: 'fetch', group: null, price: null },
  { idx: 17, name: 'Skyline Drive', kind: 'property', group: 'e', price: 280 },
  { idx: 18, name: 'Vet Visit', kind: 'vet', group: null, price: null },
  { idx: 19, name: 'Boardwalk Pier', kind: 'property', group: 'f', price: 300 },
  { idx: 20, name: 'Water Bowl', kind: 'water_bowl', group: null, price: null },
  { idx: 21, name: 'Lighthouse Point', kind: 'property', group: 'f', price: 320 },
  { idx: 22, name: 'Sunset Bluff', kind: 'property', group: 'f', price: 350 },
  { idx: 23, name: 'Grand Avenue', kind: 'property', group: 'f', price: 400 },
];

export const HOUNDOPOLY_SQUARES = HOUNDOPOLY_BOARD.length;
export const DEFAULT_HOUNDOPOLY_DAYS = 21;

export const GROUP_COLORS: Record<string, string> = {
  a: '#8b6fd6',
  b: '#4fbf7a',
  c: '#4f8fe0',
  d: '#e0a94f',
  e: '#d94a4a',
  f: '#e07b2a',
};

export const GROUP_NAMES: Record<string, string> = {
  a: 'Elm',
  b: 'Riverside',
  c: 'Lakeshore',
  d: 'Meadow',
  e: 'Summit',
  f: 'Boardwalk',
};

export function squareAt(idx: number): HoundopolySquare {
  return HOUNDOPOLY_BOARD[((idx % HOUNDOPOLY_SQUARES) + HOUNDOPOLY_SQUARES) % HOUNDOPOLY_SQUARES];
}

// The admin knobs (houndopoly_settings).
export interface HoundopolySettings {
  startCash: number;
  passStartCash: number;
  vetCost: number;
  dogHouseSteps: number;
  twoDiceSteps: number;
  threeDiceSteps: number;
  // The overnight roll (UTC hour, the day after) and the midday one.
  rollHourUtc: number;
  middayHourUtc: number;
}

// Two turns a day (0137): midday on the steps synced so far, overnight
// on the rest.
export const TURNS_PER_DAY = 2;
export type HoundopolySlot = 'noon' | 'night';

export const DEFAULT_HOUNDOPOLY_SETTINGS: HoundopolySettings = {
  startCash: 1500,
  passStartCash: 200,
  vetCost: 100,
  dogHouseSteps: 2000,
  twoDiceSteps: 6000,
  threeDiceSteps: 12000,
  rollHourUtc: 11,
  middayHourUtc: 18,
};

export interface HoundopolyPlayer {
  userId: string;
  position: number;
  cash: number;
  // A square landed on, held until the next roll.
  pendingIdx: number | null;
  bankrupt: boolean;
  joinedDay: string;
}

export interface HoundopolyDeed {
  idx: number;
  ownerId: string;
  boughtOn: string;
}

export type HoundopolyCard = 'workout_bonus' | 'streak_advance' | 'fewest_steps' | 'big_day_again' | 'go_to_dog_house';

export interface HoundopolyEvent {
  id: number;
  day: string; // YYYY-MM-DD
  slot: HoundopolySlot;
  seq: number;
  userId: string;
  kind: string;
  idx: number | null;
  amount: number | null;
  otherUserId: string | null;
  detail: { steps?: number; dice?: number; card?: HoundopolyCard; hit?: boolean; to?: number; owed?: number; slot?: HoundopolySlot };
}

// One roll for one player (houndopoly_turns).
export interface HoundopolyTurn {
  userId: string;
  day: string;
  slot: HoundopolySlot;
  steps: number;
  dice: number;
  roll: number;
}

export interface HoundopolyGame {
  players: HoundopolyPlayer[];
  deeds: HoundopolyDeed[];
  // Newest first, the last few rolled days.
  events: HoundopolyEvent[];
  // Turns rolled so far, newest first.
  rolledTurns: { day: string; slot: HoundopolySlot }[];
  // The viewer's own turns today (to know what midday already counted).
  myTurnsToday: HoundopolyTurn[];
  settings: HoundopolySettings;
}

// How many dice a turn's steps earn: the day's tiers, shared across the
// day's turns (the server's houndopoly_dice).
export function diceFor(steps: number, s: HoundopolySettings, turns: number = TURNS_PER_DAY): number {
  if (steps * turns < s.dogHouseSteps) return 0;
  if (steps * turns < s.twoDiceSteps) return 1;
  if (steps * turns < s.threeDiceSteps) return 2;
  return 3;
}

// A turn's tiers: the day's, divided among the day's turns.
export function turnTiers(s: HoundopolySettings, turns: number = TURNS_PER_DAY): [number, number, number] {
  return [Math.ceil(s.dogHouseSteps / turns), Math.ceil(s.twoDiceSteps / turns), Math.ceil(s.threeDiceSteps / turns)];
}

// Steps still needed for one more die this turn, or null at the top tier.
export function stepsToNextDie(steps: number, s: HoundopolySettings, turns: number = TURNS_PER_DAY): { steps: number; dice: number } | null {
  const tiers = turnTiers(s, turns);
  for (let i = 0; i < tiers.length; i++) {
    if (steps < tiers[i]) return { steps: tiers[i] - steps, dice: i + 1 };
  }
  return null;
}

// Which turn is next for the viewer today, and when it rolls, from the
// settings' UTC hours. The overnight turn for today rolls tomorrow.
export function nextTurn(
  s: HoundopolySettings,
  myTurnsToday: HoundopolyTurn[],
  now: Date = new Date(),
): { slot: HoundopolySlot; at: Date } {
  const noonDone = myTurnsToday.some((t) => t.slot === 'noon');
  const midday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.middayHourUtc));
  if (!noonDone && now < midday) return { slot: 'noon', at: midday };
  const overnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, s.rollHourUtc));
  return { slot: 'night', at: overnight };
}

export function describeSlot(slot: HoundopolySlot): string {
  return slot === 'noon' ? 'Midday' : 'Overnight';
}

// Where n dice can take you from here: the squares min..max ahead.
export function reachableFrom(position: number, dice: number): number[] {
  if (dice === 0) return [];
  const out: number[] = [];
  for (let n = dice; n <= dice * 6; n++) out.push((position + n) % HOUNDOPOLY_SQUARES);
  return out;
}

export function ownerOf(idx: number, deeds: HoundopolyDeed[]): string | null {
  return deeds.find((d) => d.idx === idx)?.ownerId ?? null;
}

export function ownsWholeGroup(owner: string, group: string, deeds: HoundopolyDeed[]): boolean {
  const squares = HOUNDOPOLY_BOARD.filter((q) => q.group === group);
  return squares.every((q) => ownerOf(q.idx, deeds) === owner);
}

// A tenth of the price, doubled when the owner has the whole group.
export function rentFor(idx: number, deeds: HoundopolyDeed[]): number {
  const sq = squareAt(idx);
  if (sq.kind !== 'property' || !sq.price || !sq.group) return 0;
  const owner = ownerOf(idx, deeds);
  const whole = owner ? ownsWholeGroup(owner, sq.group, deeds) : false;
  return Math.floor(sq.price / (whole ? 5 : 10));
}

export function netWorth(player: HoundopolyPlayer, deeds: HoundopolyDeed[]): number {
  return player.cash + deeds.filter((d) => d.ownerId === player.userId).reduce((s, d) => s + (squareAt(d.idx).price ?? 0), 0);
}

export const CARD_TEXT: Record<HoundopolyCard, string> = {
  workout_bonus: 'Logged a workout today? Collect 100.',
  streak_advance: 'Goal streak alive? Move on to the next square for sale.',
  fewest_steps: 'Fewest steps in the game today: pay 50 to the most.',
  big_day_again: '12,000 steps or more today: roll one more die.',
  go_to_dog_house: 'Straight to the Dog House. No Start payout.',
};

export const CARD_ORDER: HoundopolyCard[] = ['workout_bonus', 'streak_advance', 'fewest_steps', 'big_day_again', 'go_to_dog_house'];

// One feed line. `you` is the viewer, so their own rows read "You".
export function eventLine(
  e: HoundopolyEvent,
  nameOf: (userId: string) => string,
  you: string | null,
): { text: string; amount: string | null; tone: 'plus' | 'minus' | null } {
  const who = e.userId === you ? 'You' : nameOf(e.userId);
  const yours = e.userId === you;
  const sq = e.idx !== null ? squareAt(e.idx) : null;
  const other = e.otherUserId ? (e.otherUserId === you ? 'you' : nameOf(e.otherUserId)) : null;
  const verb = (s: string, p: string) => (yours ? s : p);
  switch (e.kind) {
    case 'moved': {
      const d = e.detail;
      const how = d.card ? '' : d.dice ? ` on ${d.dice} ${d.dice === 1 ? 'die' : 'dice'}` : '';
      return { text: `${who} walked ${e.amount} to ${sq?.name ?? 'a square'}${how}.`, amount: null, tone: null };
    }
    case 'stayed_in':
      return {
        text: `${who} had ${e.detail.steps?.toLocaleString() ?? 'too few'} steps ${e.slot === 'noon' ? 'by midday' : 'the rest of the day'} and stayed put.`,
        amount: null,
        tone: null,
      };
    case 'passed_start':
      return { text: `${who} passed Start.`, amount: `+${e.amount}`, tone: 'plus' };
    case 'landed_for_sale':
      return { text: `${who} landed on ${sq?.name}, for sale at ${e.amount}.`, amount: null, tone: null };
    case 'landed_own':
      return { text: `${who} landed on ${verb('your', 'their')} own ${sq?.name}.`, amount: null, tone: null };
    case 'rent':
      if (e.otherUserId === you) return { text: `${who} landed on your ${sq?.name}.`, amount: `+${e.amount} rent`, tone: 'plus' };
      return { text: `${who} paid ${other} rent on ${sq?.name}.`, amount: `−${e.amount}`, tone: yours ? 'minus' : null };
    case 'bought':
      return { text: `${who} bought ${sq?.name}.`, amount: `−${e.amount}`, tone: yours ? 'minus' : null };
    case 'passed':
      return { text: `${who} let ${sq?.name} go.`, amount: null, tone: null };
    case 'vet':
      return { text: `${who} landed at the Vet.`, amount: `−${e.amount}`, tone: yours ? 'minus' : null };
    case 'dog_park':
      return { text: `${who} rested at the Dog Park.`, amount: null, tone: null };
    case 'water_bowl':
      return { text: `${who} stopped at the Water Bowl.`, amount: null, tone: null };
    case 'start':
      return { text: `${who} landed right on Start.`, amount: null, tone: null };
    case 'visiting':
      return { text: `${who} ${verb('are', 'is')} just visiting the Dog House.`, amount: null, tone: null };
    case 'card': {
      const card = e.detail.card;
      const hit = e.detail.hit;
      const drew = `${who} drew Fetch!: "${card ? CARD_TEXT[card] : '…'}"`;
      if (card === 'workout_bonus') return { text: `${drew} ${hit ? verb('You had.', 'They had.') : 'No workout.'}`, amount: hit ? '+100' : null, tone: hit ? 'plus' : null };
      if (card === 'streak_advance') return { text: `${drew} ${hit ? 'Streak alive!' : 'No streak today.'}`, amount: null, tone: null };
      if (card === 'fewest_steps') return { text: `${drew} ${hit ? `Paid ${other}.` : 'Not the fewest.'}`, amount: hit ? '−50' : null, tone: hit && yours ? 'minus' : null };
      if (card === 'big_day_again') return { text: `${drew} ${hit ? 'Rolled again!' : 'Not today.'}`, amount: null, tone: null };
      return { text: `${drew}`, amount: null, tone: null };
    }
    case 'card_pay':
      return { text: `${who} paid ${other} on a Fetch! card.`, amount: `−${e.amount}`, tone: yours ? 'minus' : null };
    case 'bankrupt':
      return { text: `${who} ${verb('are', 'is')} bankrupt: ${verb('you', 'they')} keep walking and collecting rent, but can't buy.`, amount: null, tone: 'minus' };
    default:
      return { text: `${who}: ${e.kind}.`, amount: null, tone: null };
  }
}

// "Day 6 of 21", from the challenge's first day (YYYY-MM-DD) and today.
export function dayNumber(firstDay: string, todayKey: string, totalDays: number): number {
  const [y1, m1, d1] = firstDay.split('-').map(Number);
  const [y2, m2, d2] = todayKey.split('-').map(Number);
  const diff = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
  return Math.max(1, Math.min(totalDays, diff + 1));
}

// "Saturday, Oct 25" for a feed day.
export function describeFeedDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
