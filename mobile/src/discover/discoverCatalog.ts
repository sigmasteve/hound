import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import type { GlobalChallenge } from '../challenges/globalChallenges';
import type { Interest } from '../onboarding/interests';

// Discover (K-01, "How can I find the one I want?"): what each kind of
// challenge is, in the terms people filter by. Pure data and functions,
// so the screen only lays things out.

export type Format = 'race' | 'game' | 'habit';
export type Counts = 'steps' | 'miles' | 'workouts' | 'habits';
export type Players = 'solo' | 'one_on_one' | 'teams' | 'group';
export type Level = 'easy' | 'medium' | 'hard';

export interface KindInfo {
  kind: ChallengeKind;
  format: Format;
  counts: Counts[];
  players: Players[];
  level: Level;
  // Whether bots can fill in when friends can't.
  bots: boolean;
  // A line under the name, and the detail sheet's rules.
  summary: string;
  howToWin: string;
  who: string;
  length: string;
  // Extra words people search for ("badminton", "football", "Route 66").
  words: string[];
  // Interests (K-08) it suits, for "Suggested for you".
  suits: Interest[];
}

export const KIND_INFO: KindInfo[] = [
  {
    kind: 'steps', format: 'race', counts: ['steps'], players: ['solo', 'group'], level: 'easy', bots: true,
    summary: 'Most steps wins. The simplest race there is.',
    howToWin: 'Walk the most steps before it ends.', who: 'Anyone, from two people to a crowd. Bots can race too.',
    length: 'A day to a few weeks', words: ['walking', 'leaderboard', 'step count'], suits: ['general', 'weight_loss'],
  },
  {
    kind: 'distance', format: 'race', counts: ['miles', 'steps'], players: ['group'], level: 'easy', bots: true,
    summary: 'Everyone adds to one shared target.',
    howToWin: 'Reach the group target together before time runs out.', who: 'A group working together, not against each other.',
    length: 'A week to a month', words: ['team goal', 'together', 'running', 'cycling', 'walking', 'co-op'], suits: ['athlete', 'general'],
  },
  {
    kind: 'journey', format: 'race', counts: ['miles'], players: ['solo', 'group'], level: 'medium', bots: true,
    summary: 'Walk a famous course on a map, with postcards along the way.',
    howToWin: 'First to the end of the course wins; if nobody gets there, the furthest along.',
    who: 'Anyone. Walks, runs and hikes all move you along.', length: 'Weeks, depending on the course',
    words: ['marathon', 'route 66', 'appalachian trail', 'windy city', 'hike', 'map', 'postcards', 'course'], suits: ['athlete', 'general'],
  },
  {
    kind: 'hunt', format: 'game', counts: ['miles'], players: ['one_on_one', 'group'], level: 'medium', bots: true,
    summary: 'One runner gets a head start; the others try to catch them.',
    howToWin: 'Catch the runner on logged miles, or stay ahead until time runs out.', who: 'Two or more. A bot can chase or be chased.',
    length: 'About a week', words: ['chase', 'running', 'head start', 'catch'], suits: ['athlete'],
  },
  {
    kind: 'tag', format: 'game', counts: ['steps'], players: ['group'], level: 'easy', bots: true,
    summary: 'Someone is "it" and has to catch someone else.',
    howToWin: 'Don’t be "it" when time runs out.', who: 'A group of friends.',
    length: 'About a week', words: ['it', 'catch', 'playground'], suits: ['general'],
  },
  {
    kind: 'tictacgo', format: 'game', counts: ['steps', 'workouts'], players: ['one_on_one'], level: 'medium', bots: false,
    summary: 'Hit a square’s goal to claim it. Three in a row wins.',
    howToWin: 'Get three squares in a row before your opponent.', who: 'Two players, head to head.',
    length: 'Until someone wins, up to a few weeks', words: ['tic tac toe', 'noughts and crosses', 'head to head', 'board'], suits: ['general'],
  },
  {
    kind: 'rally', format: 'game', counts: ['steps'], players: ['one_on_one', 'teams'], level: 'medium', bots: true,
    summary: 'Badminton on your steps: walk the target to return the shuttle.',
    howToWin: 'Games to 21, best of three.', who: 'One on one, or doubles. Bots can play.',
    length: 'Days to a couple of weeks', words: ['badminton', 'tennis', 'shuttle', 'racquet', 'doubles', 'sport'], suits: ['sports'],
  },
  {
    kind: 'soccer', format: 'game', counts: ['steps'], players: ['teams'], level: 'medium', bots: true,
    summary: 'A match on everyone’s steps: forwards shoot, defenders and keepers stop them.',
    howToWin: 'Most goals after the last day.', who: 'Teams of one to nine, friends or bots.',
    length: 'About a week', words: ['football', 'futbol', 'goal', 'team', 'sport', 'striker', 'keeper'], suits: ['sports'],
  },
  {
    kind: 'cricket', format: 'game', counts: ['steps'], players: ['teams'], level: 'medium', bots: true,
    summary: 'Limited overs, one over a day: out-walk the bowler for boundaries.',
    howToWin: 'Score more runs than the other side.', who: 'Teams of one to nine, friends or bots.',
    length: 'About two weeks', words: ['overs', 'wickets', 'batting', 'bowling', 'team', 'sport', 'ipl'], suits: ['sports'],
  },
  {
    kind: 'baseball', format: 'game', counts: ['steps'], players: ['teams'], level: 'medium', bots: true,
    summary: 'One inning a day: your steps at bat, on the mound and in the field.',
    howToWin: 'Score more runs than the other side.', who: 'Teams of one to nine, friends or bots.',
    length: '3 to 9 days', words: ['innings', 'home run', 'pitcher', 'batting', 'team', 'sport', 'mlb', 'softball'], suits: ['sports'],
  },
  {
    kind: 'hoops', format: 'game', counts: ['steps'], players: ['teams'], level: 'medium', bots: true,
    summary: 'Basketball, a quarter a day: your steps take the shots.',
    howToWin: 'Most points after four quarters.', who: 'Teams of one to nine, friends or bots.',
    length: '4 or 8 days', words: ['basketball', 'hoops', 'nba', 'dunk', 'three', 'team', 'sport', 'court'], suits: ['sports'],
  },
  {
    kind: 'horse', format: 'game', counts: ['steps'], players: ['one_on_one'], level: 'medium', bots: false,
    summary: 'One on one: match the shot or take a letter.',
    howToWin: 'Don’t be the one to spell H-O-R-S-E.', who: 'Just you and one friend.',
    length: 'Up to two weeks', words: ['horse', 'pig', 'basketball', 'hoops', 'one on one', 'shot', 'sport'], suits: ['sports'],
  },
  {
    kind: 'golf', format: 'game', counts: ['steps', 'workouts'], players: ['solo', 'one_on_one', 'group'], level: 'medium', bots: false,
    summary: 'Golf, a shot at a time: steps bank yards, workouts bank power.',
    howToWin: 'Fewest strokes, most skins, or win the match.', who: 'Just you, or friends.',
    length: '4 days (9 holes) or a week (18)', words: ['golf', 'putt', 'birdie', 'par', 'tee', 'skins', 'course', 'sport', 'pga'], suits: ['sports'],
  },
  {
    kind: 'bingo', format: 'game', counts: ['steps', 'workouts'], players: ['solo', 'group'], level: 'medium', bots: true,
    summary: 'A bingo card of steps, workouts and goals.',
    howToWin: 'First to finish a row, column or diagonal; play goes on for the full card.', who: 'Anyone. Bots can play.',
    length: 'One to four weeks', words: ['card', 'workouts', 'variety', 'blackout'], suits: ['gym', 'general'],
  },
  {
    kind: 'houndopoly', format: 'game', counts: ['steps'], players: ['group'], level: 'easy', bots: false,
    summary: 'A property board game: your steps pick the dice.',
    howToWin: 'Be the richest when time runs out.', who: 'A group of friends.',
    length: 'One to three weeks', words: ['monopoly', 'board game', 'dice', 'property'], suits: ['general'],
  },
  {
    kind: 'streak', format: 'habit', counts: ['steps'], players: ['solo', 'group'], level: 'hard', bots: true,
    summary: 'Hit a daily goal every day. One miss and you’re out.',
    howToWin: 'Make it to the end without missing a day.', who: 'Anyone, alone or with friends.',
    length: 'A week to a month', words: ['daily', 'every day', 'consistency', 'survival'], suits: ['weight_loss', 'general'],
  },
  {
    kind: 'seventyfive', format: 'habit', counts: ['workouts', 'habits'], players: ['solo', 'group'], level: 'hard', bots: false,
    summary: 'Two workouts, a diet, water, reading and a photo, every day.',
    howToWin: 'Keep the streak going all 75 days.', who: 'Anyone ready for a big commitment.',
    length: '75 days', words: ['75 hard', 'diet', 'water', 'reading', 'transformation'], suits: ['gym', 'weight_loss'],
  },
  {
    kind: 'checklist', format: 'habit', counts: ['habits', 'workouts', 'steps'], players: ['solo', 'group'], level: 'medium', bots: false,
    summary: 'A daily checklist kept with friends, with a line of your own.',
    howToWin: 'Tick every item each day and keep your streak.', who: 'Anyone, alone or with friends.',
    length: 'As long as you like', words: ['accountability', 'routine', 'habits', 'to do'], suits: ['weight_loss', 'general'],
  },
];

export const FORMAT_NAMES: Record<Format, string> = { race: 'Races', game: 'Games', habit: 'Habits' };
export const COUNTS_NAMES: Record<Counts, string> = { steps: 'Steps', miles: 'Miles', workouts: 'Workouts', habits: 'Daily habits' };
export const PLAYERS_NAMES: Record<Players, string> = { solo: 'On your own', one_on_one: 'One on one', teams: 'Teams', group: 'Groups' };
export const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export interface Filters {
  query: string;
  format: Format[];
  counts: Counts[];
  players: Players[];
  level: Level[];
}

export const NO_FILTERS: Filters = { query: '', format: [], counts: [], players: [], level: [] };

export function isFiltered(f: Filters): boolean {
  return !!f.query.trim() || f.format.length + f.counts.length + f.players.length + f.level.length > 0;
}

const INFO_BY_KIND = new Map(KIND_INFO.map((i) => [i.kind, i] as const));

export function kindInfo(kind: ChallengeKind): KindInfo | null {
  return INFO_BY_KIND.get(kind) ?? null;
}

export function kindName(kind: ChallengeKind): string {
  return CHALLENGE_TYPES.find((t) => t.id === kind)?.name ?? kind;
}

// Lower case, without accents or punctuation, for matching.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every word of the query has to appear somewhere in the text.
function matchesQuery(query: string, haystack: string[]): boolean {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const text = norm(haystack.join(' '));
  return words.every((w) => text.includes(w));
}

function anyOf<T>(picked: T[], have: T[]): boolean {
  return picked.length === 0 || picked.some((p) => have.includes(p));
}

export function kindMatches(info: KindInfo, f: Filters): boolean {
  const desc = CHALLENGE_TYPES.find((t) => t.id === info.kind)?.desc ?? '';
  return (
    anyOf(f.format, [info.format]) &&
    anyOf(f.counts, info.counts) &&
    anyOf(f.players, info.players) &&
    anyOf(f.level, [info.level]) &&
    matchesQuery(f.query, [kindName(info.kind), info.summary, desc, ...info.words, FORMAT_NAMES[info.format]])
  );
}

export function globalMatches(c: GlobalChallenge, f: Filters): boolean {
  const info = kindInfo(c.kind);
  if (!info) return !isFiltered(f) || matchesQuery(f.query, [c.name]);
  return (
    anyOf(f.format, [info.format]) &&
    anyOf(f.counts, info.counts) &&
    anyOf(f.players, info.players) &&
    anyOf(f.level, [info.level]) &&
    matchesQuery(f.query, [c.name, kindName(c.kind), ...info.words, c.sponsor?.name ?? ''])
  );
}

// How well a kind suits someone's interests: the number they share.
export function suitScore(info: KindInfo, interests: Interest[]): number {
  return info.suits.filter((s) => interests.includes(s)).length;
}

// Kinds that match, the best fits for their interests first, otherwise
// in the catalog's own order.
export function rankKinds(f: Filters, interests: Interest[]): KindInfo[] {
  return KIND_INFO.map((info, i) => ({ info, i, score: suitScore(info, interests) }))
    .filter(({ info }) => kindMatches(info, f))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ info }) => info);
}
