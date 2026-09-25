import { AMBER, GREEN, TINT_A, TINT_N } from '../theme/tokens';

// Static content that isn't sourced from HealthKit/Health Connect — the
// social layer (challenges, friends, invites) needs a real backend, which
// is out of scope here; this is the same sample data the original
// prototype shipped with, so the UI has something real-looking to render.

export type PlatformName = 'Apple Health' | 'Health Connect';

export interface Friend {
  name: string;
  initials: string;
  platform: PlatformName;
  tint: string;
  sync: string;
  syncColor: string;
  sub: string;
}

export const FRIENDS: Friend[] = [
  { name: 'Marcus R.', initials: 'MR', platform: 'Apple Health', tint: TINT_N, sync: 'Synced 22m ago', syncColor: GREEN, sub: 'Your hunter · 4 challenges together' },
  { name: 'Dana K.', initials: 'DK', platform: 'Health Connect', tint: TINT_A, sync: 'Synced 1h ago', syncColor: GREEN, sub: 'Joined in January' },
  { name: 'Priya S.', initials: 'PS', platform: 'Apple Health', tint: TINT_N, sync: 'Synced 8m ago', syncColor: GREEN, sub: 'Sent you an invite' },
  { name: 'Theo A.', initials: 'TA', platform: 'Health Connect', tint: TINT_A, sync: 'Stale · 2 days', syncColor: AMBER, sub: 'Pixel 8 · reconnect needed' },
  { name: 'Sam O.', initials: 'SO', platform: 'Apple Health', tint: TINT_N, sync: 'Synced 34m ago', syncColor: GREEN, sub: 'Longest streak: 41 days' },
];

export interface RaceRow {
  rank: number;
  name: string;
  initials: string;
  tint: string;
  platform: PlatformName;
  steps: string;
  pct: number;
  bar: string;
  highlight?: boolean;
}

export const RACE_BOARD: RaceRow[] = [
  { rank: 1, name: 'Priya S.', initials: 'PS', tint: TINT_N, platform: 'Apple Health', steps: '64,102', pct: 100, bar: '#b5abfc' },
  { rank: 2, name: 'You', initials: 'JL', tint: TINT_A, platform: 'Apple Health', steps: '58,910', pct: 92, bar: '#9184d9', highlight: true },
  { rank: 3, name: 'Dana K.', initials: 'DK', tint: TINT_A, platform: 'Health Connect', steps: '52,447', pct: 82, bar: '#796cbf' },
  { rank: 4, name: 'Theo A.', initials: 'TA', tint: TINT_A, platform: 'Health Connect', steps: '41,208', pct: 64, bar: AMBER },
];

export interface TallyRow {
  label: string;
  meta: string;
  dist: string;
  tint: string;
  iconKind: 'run' | 'walk' | 'blocked' | 'dog';
}

export const TALLY: TallyRow[] = [
  { label: 'Marcus · evening run', meta: 'Yesterday 6:40pm · Health Connect', dist: '6.1 mi', tint: TINT_N, iconKind: 'run' },
  { label: 'You · lunch walk', meta: 'Yesterday 12:20pm · Apple Health', dist: '2.4 mi', tint: TINT_A, iconKind: 'walk' },
  { label: 'Marcus · treadmill run', meta: 'Sunday 7:10am · not counted, no GPS', dist: '—', tint: '#3a2f1c', iconKind: 'blocked' },
  { label: 'You · trail run', meta: 'Sunday 8:02am · Apple Health', dist: '7.8 mi', tint: TINT_A, iconKind: 'run' },
  { label: 'Marcus · dog walk', meta: 'Saturday 6:15pm · Health Connect', dist: '3.2 mi', tint: TINT_N, iconKind: 'dog' },
];

export type ChallengeKind = 'hunt' | 'steps' | 'streak' | 'distance' | 'tag';

export interface ChallengeCard {
  id: string;
  name: string;
  kind: ChallengeKind;
  kindLabel: string;
  sub: string;
  stat: string;
  statLabel: string;
  tint: string;
  iconColor: string;
  people: { initials: string; tint: string }[];
  // 'hunt' opens the static Hunt screen (the one hardcoded demo
  // storyline); 'detail' opens the generic ChallengeDetailScreen for a
  // real, Supabase-backed challenge (see src/challenges/present.ts) —
  // only real cards ever use it, since sample cards have no matching row
  // to fetch; 'challenges' means "not tappable" (the other sample cards).
  target: 'hunt' | 'challenges' | 'detail';
  // Only ever set (by toChallengeCard) on a real card — true once a
  // challenge's scheduled end has passed, or, for a hunt, once its
  // Hunted has been caught early (see withHuntCatches). Sample cards
  // leave this unset; ChallengesScreen's hardcoded "Finished" row is
  // separate, static JSX, not one of these.
  finished?: boolean;
  // Only ever set (by toChallengeCard), and only nonzero, for a hunt
  // whose head start hasn't run out yet (src/challenges/board.ts's
  // headStartDaysLeft) — ChallengesScreen's active-row badge is the only
  // thing that reads this. Unset/0 for every other kind, a hunt with no
  // head start, or one whose head start has already elapsed.
  headStartDaysLeft?: number;
}

export const CHALLENGES: ChallengeCard[] = [
  {
    id: 'hunt-1',
    name: 'The Chase: Jordan vs Marcus',
    kind: 'hunt',
    kindLabel: 'Chase',
    sub: 'Day 9 of 21 · GPS distance from runs and walks',
    stat: '7.4 mi',
    statLabel: 'your lead',
    tint: TINT_A,
    iconColor: '#f5f4ff',
    people: [{ initials: 'JL', tint: TINT_A }, { initials: 'MR', tint: TINT_N }],
    target: 'hunt',
  },
  {
    id: 'steps-1',
    name: 'March Step Race',
    kind: 'steps',
    kindLabel: 'Step Race',
    sub: '4 days left · 5 friends across iPhone and Android',
    stat: '2nd',
    statLabel: 'of 5 · 58,910 steps',
    tint: TINT_N,
    iconColor: '#e9e9ed',
    people: [
      { initials: 'PS', tint: TINT_N },
      { initials: 'JL', tint: TINT_A },
      { initials: 'DK', tint: TINT_A },
      { initials: 'TA', tint: TINT_N },
    ],
    target: 'challenges',
  },
  {
    id: 'streak-1',
    name: '10k A Day',
    kind: 'streak',
    kindLabel: 'Daily Streak',
    sub: 'Alive · 3 of 6 still in',
    stat: '17 days',
    statLabel: 'current streak',
    tint: TINT_N,
    iconColor: AMBER,
    people: [
      { initials: 'JL', tint: TINT_A },
      { initials: 'SO', tint: TINT_N },
      { initials: 'DK', tint: TINT_A },
    ],
    target: 'challenges',
  },
];

export const CHALLENGE_TYPES: {
  id: ChallengeKind;
  name: string;
  desc: string;
  tint: string;
  iconColor: string;
}[] = [
  { id: 'hunt', name: 'Chase', desc: 'One runner gets a head start. The other has to catch them on logged miles before time runs out.', tint: TINT_A, iconColor: '#f5f4ff' },
  { id: 'tag', name: 'Game of Tag', desc: 'One person is "IT" and has to catch someone before time runs out. No ranking — just don’t get caught.', tint: '#6b4f1f', iconColor: '#fbe8c9' },
  { id: 'steps', name: 'Step Race', desc: 'Most steps over the window. Everyone against everyone.', tint: TINT_N, iconColor: '#e9e9ed' },
  { id: 'distance', name: 'Group Distance Target', desc: 'Add every mile the group covers toward one shared target.', tint: TINT_N, iconColor: '#e9e9ed' },
  { id: 'streak', name: 'Daily Streak', desc: 'Hit a daily goal every day. One miss and you are out.', tint: TINT_N, iconColor: '#e9e9ed' },
];

export interface DataSource {
  name: string;
  tint: string;
  status: string;
  statusColor: string;
  scope: string;
  action: string;
}

export const SOURCES: DataSource[] = [
  { name: 'Apple Health', tint: TINT_N, status: 'Synced 4 minutes ago', statusColor: GREEN, scope: 'Steps, workouts, HR, weight', action: 'Manage' },
  { name: 'Health Connect', tint: TINT_A, status: 'Last sync 2 days ago — background access paused', statusColor: AMBER, scope: 'Steps, workouts, distance', action: 'Reconnect' },
];
