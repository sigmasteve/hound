// Hound Roulette (0236): the wheel, the stakes and the wording. Pure, no
// Supabase or React Native imports; rouletteApi.ts is the client.

export type RouletteStake = 'safe' | 'bold' | 'allin';
export type RouletteSegment = 'steps' | 'workout' | 'water' | 'free' | 'goals' | 'walk' | 'double' | 'cheer' | 'steps2' | 'pick';
export type RouletteTask = 'steps' | 'workout' | 'water' | 'goals' | 'walk' | 'cheer' | 'free';

// In wheel order: the server's roulette_segment uses the same order.
export const SEGMENTS: { id: RouletteSegment; label: string; fill: string; ink: string }[] = [
  { id: 'steps', label: 'STEPS', fill: '#4f7be0', ink: '#ffffff' },
  { id: 'workout', label: 'WORKOUT', fill: '#f08a24', ink: '#161826' },
  { id: 'water', label: 'WATER', fill: '#5fb0d9', ink: '#161826' },
  { id: 'free', label: 'FREE DAY', fill: '#f0c24a', ink: '#161826' },
  { id: 'goals', label: 'ALL GOALS', fill: '#7fd39b', ink: '#161826' },
  { id: 'walk', label: 'HOUND WALK', fill: '#c08a52', ink: '#161826' },
  { id: 'double', label: 'DOUBLE', fill: '#e05b5b', ink: '#161826' },
  { id: 'cheer', label: 'CHEER', fill: '#9184d9', ink: '#161826' },
  { id: 'steps2', label: 'STEPS', fill: '#3a4a8a', ink: '#ffffff' },
  { id: 'pick', label: 'PICK YOURS', fill: '#d97fb8', ink: '#161826' },
];

export const STAKES: { id: RouletteStake; name: string; sub: (s: { safe: number; bold: number }) => string }[] = [
  { id: 'safe', name: 'Safe', sub: (s) => `easy · +${s.safe}` },
  { id: 'bold', name: 'Bold', sub: (s) => `harder · +${s.bold}` },
  { id: 'allin', name: 'All in', sub: () => 'hardest · ride ×2' },
];

export const PICKABLE: Exclude<RouletteTask, 'goals' | 'free'>[] = ['steps', 'workout', 'water', 'walk', 'cheer'];

export function mult(rideDays: number): number {
  return Math.min(3, 1 + 0.5 * Math.max(0, rideDays - 1));
}

export function segmentIndex(id: RouletteSegment): number {
  return Math.max(0, SEGMENTS.findIndex((s) => s.id === id));
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function cups(ml: number): string {
  const c = Math.round((ml / 237) * 2) / 2;
  return `${c} ${c === 1 ? 'cup' : 'cups'}`;
}

// "9,000 steps", "A 20-minute workout"...
export function taskTitle(task: RouletteTask | null, target: number | null, double = false): string {
  const t = target ?? 0;
  const base =
    task === 'steps'
      ? `${fmt(t)} steps`
      : task === 'workout'
        ? `A ${t}-minute workout`
        : task === 'water'
          ? `${cups(t)} of water`
          : task === 'walk'
            ? `${t} minutes walking your hound`
            : task === 'cheer'
              ? `Cheer ${t} ${t === 1 ? 'friend' : 'friends'}`
              : task === 'goals'
                ? 'Close all your goals'
                : task === 'free'
                  ? 'Free day!'
                  : 'Pick yours';
  return double ? `${base}, worth double` : base;
}

export function taskHow(task: RouletteTask | null): string {
  switch (task) {
    case 'steps':
      return 'Counted from your steps today.';
    case 'workout':
      return 'Any workout your watch logs, or Log a workout on Today.';
    case 'water':
      return 'Logged in Hound or from Health.';
    case 'walk':
      return 'In the Kennel: Walk. Your steps take your hound along.';
    case 'cheer':
      return 'A cheer or a nudge on a friend’s challenge.';
    case 'goals':
      return 'Every daily goal closed on Today.';
    case 'free':
      return 'No task today: the points are already in.';
    default:
      return '';
  }
}

// "5,230 of 9,000 · 3,770 to go"
export function progressLine(task: RouletteTask | null, target: number | null, progress: number | null): string | null {
  if (!task || task === 'free' || task === 'goals' || target == null || progress == null) return null;
  const left = Math.max(0, target - progress);
  if (task === 'water') return `${cups(progress)} of ${cups(target)}${left > 0 ? ` · ${cups(left)} to go` : ''}`;
  const unit = task === 'steps' ? '' : task === 'cheer' ? '' : ' min';
  return `${fmt(progress)}${unit} of ${fmt(target)}${unit}${left > 0 ? ` · ${fmt(left)}${unit} to go` : ''}`;
}

export function stakeName(s: RouletteStake): string {
  return s === 'safe' ? 'Safe' : s === 'bold' ? 'Bold' : 'All in';
}

// What a stake is worth on a task, as words.
export function worthLine(stake: RouletteStake, ride: number, double: boolean, pts: { safe: number; bold: number }): string {
  if (stake === 'allin') return `All in · doubles the ride (${ride} → ${Math.max(ride, 2) * (double ? 3 : 2)})`;
  const p = (stake === 'safe' ? pts.safe : pts.bold) * (double ? 2 : 1);
  return `${stakeName(stake)} · +${p} to the ride`;
}

export interface RouletteFeedItem {
  kind: string;
  userId: string;
  name: string;
  otherId: string | null;
  other: string | null;
  points: number;
  detail: string | null;
  at: string;
}

// One line of "On the wheel": first names, the viewer as "You".
export function feedLine(e: RouletteFeedItem, me: string | null): string | null {
  const who = e.userId === me ? 'You' : e.name.split(' ')[0];
  const them = e.otherId === me ? 'you' : (e.other ?? 'someone').split(' ')[0];
  const pts = `${e.points} ${e.points === 1 ? 'point' : 'points'}`;
  switch (e.kind) {
    case 'allin':
      return `${who} went All in${e.detail ? ` on ${e.detail === 'steps' ? 'steps' : e.detail === 'goals' ? 'all their goals' : `a ${e.detail}`}` : ''}.`;
    case 'done':
      return `${who} made it: +${pts} to the ride.`;
    case 'free':
      return `${who} landed on Free Day: +${pts}.`;
    case 'lost':
      return `${who} lost a ride of ${pts}.`;
    case 'bank':
      return `${who} banked ${pts}.`;
    case 'raid':
      return `${who} raided ${them}.`;
    case 'raid_won':
      return `${who} took ${pts} off ${them} in a Raid.`;
    case 'raid_held':
      return `${who} held off ${them}’s Raid: +${pts}.`;
    case 'raid_void':
      return null;
    case 'duel_call':
      return `${who} called ${them} out for ${pts}.`;
    case 'duel_on':
      return `${who} accepted ${them}’s Duel: ${pts} each.`;
    case 'duel_declined':
      return `${who} turned down ${them}’s Duel.`;
    case 'duel_won':
      return `${who} beat ${them} in a Duel: +${pts}.`;
    case 'duel_push':
      return `${who} and ${them} were dead level in a Duel.`;
    default:
      return null;
  }
}
