// Fasting (0261_fasting.sql): the pure part. Plans, the stages a fast
// passes through, what's fine to drink, and how the numbers read.
// Research and mockups: claude.ai/artifact/3abHwCtUmzhQ9hzkfexR1s.

export interface FastingPlan {
  hours: number;
  label: string;
  note: string;
}

// A plan is hours fasting; the rest of the day is the eating window.
export const PLANS: FastingPlan[] = [
  { hours: 12, label: '12:12', note: 'Fast 12 h, eat in 12 h. A gentle start.' },
  { hours: 13, label: '13:11', note: 'Fast 13 h, eat in 11 h.' },
  { hours: 14, label: '14:10', note: 'Fast 14 h, eat in 10 h.' },
  { hours: 16, label: '16:8', note: 'Fast 16 h, eat in 8 h. The most popular.' },
  { hours: 18, label: '18:6', note: 'Fast 18 h, eat in 6 h.' },
  { hours: 20, label: '20:4', note: 'Fast 20 h, eat in 4 h.' },
  { hours: 23, label: 'One meal', note: 'One meal a day: fast about 23 h.' },
];

export function planLabel(hours: number): string {
  return PLANS.find((p) => p.hours === hours)?.label ?? `${hours} h`;
}

// Evidence: 'known' (well established), 'measured' (measured in people),
// 'animal' (mostly cells and animals), 'supervised' (needs a doctor).
export type Evidence = 'known' | 'measured' | 'animal' | 'supervised';

export interface FastingStage {
  key: string;
  from: number;
  to: number;
  name: string;
  short: string;
  about: string;
  evidence: Evidence;
}

export const STAGES: FastingStage[] = [
  {
    key: 'fed',
    from: 0,
    to: 4,
    name: 'Fed',
    short: 'Fed',
    about: 'Digesting your last meal. Blood sugar and insulin are up and your body runs on what you just ate.',
    evidence: 'known',
  },
  {
    key: 'settling',
    from: 4,
    to: 12,
    name: 'Settling',
    short: 'Settling',
    about: 'Insulin falls back and your liver starts handing out its stored sugar (glycogen).',
    evidence: 'known',
  },
  {
    key: 'fatburn',
    from: 12,
    to: 16,
    name: 'Fat burning',
    short: 'Fat burn',
    about: 'More of your energy comes from fat now, and ketones start to rise from a trace.',
    evidence: 'measured',
  },
  {
    key: 'ketosis',
    from: 16,
    to: 24,
    name: 'Into ketosis',
    short: 'Ketosis',
    about: 'Your liver’s stored sugar runs low around 18 to 24 hours, and many people are in light ketosis by 24 hours.',
    evidence: 'measured',
  },
  {
    key: 'deep',
    from: 24,
    to: 36,
    name: 'Deeper ketosis',
    short: '24 h+',
    about:
      'The cell clean-up people call autophagy. Most of what’s known about it comes from animals; nobody knows the hour it matters in people. Hound stops adding Bones past here.',
    evidence: 'animal',
  },
  {
    key: 'prolonged',
    from: 36,
    to: Infinity,
    name: 'Prolonged fast',
    short: '36 h+',
    about:
      'Your body is under strain: muscle breakdown, electrolyte swings, dizziness when you stand. Fasts this long are for a doctor’s care. If you feel unwell, eat.',
    evidence: 'supervised',
  },
];

// Each stage's colour on the dial.
export const STAGE_COLOR: Record<string, string> = {
  fed: '#8a8fa3',
  settling: '#4f9fe0',
  fatburn: '#f08a24',
  ketosis: '#9b7cf0',
  deep: '#e0b84f',
  prolonged: '#e06c6c',
};

// What comes next after `hours`: the next stage and when it starts.
export function nextStage(hours: number): FastingStage | null {
  return STAGES.find((s) => s.from > hours) ?? null;
}

export const EVIDENCE_WORD: Record<Evidence, string> = {
  known: 'Well known',
  measured: 'Measured in people',
  animal: 'Mostly from animals',
  supervised: 'With a doctor only',
};

export function stageAt(hours: number): FastingStage {
  return STAGES.find((s) => hours >= s.from && hours < s.to) ?? STAGES[STAGES.length - 1];
}

// The stages up to (and just past) the goal, for the strip under the ring.
export function stripStages(goal: number): FastingStage[] {
  return STAGES.filter((s) => s.from < Math.max(goal, 16));
}

export interface Drink {
  name: string;
  note: string;
}

export const DRINKS: { yes: Drink[]; maybe: Drink[]; no: Drink[] } = {
  yes: [
    { name: 'Water, still or sparkling', note: 'Plenty of it. A slice of lemon is fine for most people.' },
    { name: 'Black coffee', note: 'A cup or two has only a few calories, and can take the edge off hunger.' },
    { name: 'Plain tea', note: 'Black, green or herbal, nothing added.' },
    { name: 'Unsweetened electrolytes', note: 'Or a pinch of salt in water. Helps with headaches on longer fasts.' },
  ],
  maybe: [
    { name: 'Diet soda, zero-sugar drinks', note: 'No calories, but people disagree on whether sweeteners keep cravings going.' },
    { name: 'A splash of milk in coffee', note: 'Technically ends a strict fast. Some people allow a little.' },
    { name: 'Bone broth', note: 'Part of some longer, modified fasts. It has calories.' },
  ],
  no: [
    { name: 'Milk, cream, sugar or honey', note: 'In coffee or tea.' },
    { name: 'Juice, smoothies, regular soda', note: '' },
    { name: 'Butter or MCT oil coffee', note: 'Hundreds of calories, even when it’s sold as “keto”.' },
    { name: 'Protein shakes, alcohol', note: '' },
  ],
};

export const BREAK_FAST_TIP =
  'Start with something easy: eggs, yogurt, soup or fruit, and water. A big meal right away can feel rough.';

// "13:32" for 13.53 hours: hours and minutes, like a stopwatch.
export function clockText(hours: number): string {
  const totalMin = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// "2 h 28 m" for what's left.
export function leftText(hours: number): string {
  const totalMin = Math.max(0, Math.ceil(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

// Longest fasts from 24 h show as "24 h+" until tapped (Steve: not obvious
// in a quick look, so nobody's pushed into longer fasts).
export const LONG_HOURS = 24;

export function longestShort(hours: number): string {
  if (hours <= 0) return '—';
  return hours >= LONG_HOURS ? '24 h+' : clockText(hours);
}

export function isLong(hours: number): boolean {
  return hours >= LONG_HOURS;
}

export interface FastingConfig {
  bones12: number;
  bones14: number;
  bones16: number;
  bones18: number;
  bones20: number;
  streak3: number;
  streak7: number;
  streak14: number;
  streak30: number;
  streak100: number;
  packBonus: number;
}

export const DEFAULT_CONFIG: FastingConfig = {
  bones12: 5,
  bones14: 10,
  bones16: 15,
  bones18: 20,
  bones20: 25,
  streak3: 25,
  streak7: 100,
  streak14: 200,
  streak30: 500,
  streak100: 2500,
  packBonus: 10,
};

// Mirrors fasting_hours_bones.
export function bonesForHours(h: number, c: FastingConfig): number {
  if (h >= 20) return c.bones20;
  if (h >= 18) return c.bones18;
  if (h >= 16) return c.bones16;
  if (h >= 14) return c.bones14;
  if (h >= 12) return c.bones12;
  return 0;
}

export const STREAK_STEPS = [3, 7, 14, 30, 100] as const;

export function streakBones(s: number, c: FastingConfig): number {
  switch (s) {
    case 3:
      return c.streak3;
    case 7:
      return c.streak7;
    case 14:
      return c.streak14;
    case 30:
      return c.streak30;
    case 100:
      return c.streak100;
    default:
      return 0;
  }
}

// The next streak bonus after `streak`: days to go and what it pays.
export function nextStreakBonus(streak: number, c: FastingConfig): { at: number; bones: number } | null {
  const at = STREAK_STEPS.find((s) => s > streak);
  return at ? { at, bones: streakBones(at, c) } : null;
}

// Your usual start time, in this phone's time zone: the middle of your
// last few starts (minutes after midnight), or null with fewer than 3.
export function usualStartMinutes(starts: string[]): number | null {
  const mins = starts
    .map((s) => new Date(s))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.getHours() * 60 + d.getMinutes())
    // Past midnight counts as late evening, so 11:50 pm and 12:10 am sit together.
    .map((m) => (m < 4 * 60 ? m + 24 * 60 : m))
    .sort((a, b) => a - b);
  if (mins.length < 3) return null;
  return mins[Math.floor(mins.length / 2)] % (24 * 60);
}

export function timeOfDay(minutes: number): string {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const WEEKDAYS = [
  { iso: 1, short: 'M', name: 'Monday' },
  { iso: 2, short: 'T', name: 'Tuesday' },
  { iso: 3, short: 'W', name: 'Wednesday' },
  { iso: 4, short: 'T', name: 'Thursday' },
  { iso: 5, short: 'F', name: 'Friday' },
  { iso: 6, short: 'S', name: 'Saturday' },
  { iso: 7, short: 'S', name: 'Sunday' },
];

export function isoWeekday(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

export function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const NOTES: { key: 'water' | 'gotthis' | 'coffee' | 'hungry' | 'done'; label: string }[] = [
  { key: 'water', label: '💧 Water break' },
  { key: 'gotthis', label: '💪 You got this' },
  { key: 'coffee', label: '☕ Coffee time' },
  { key: 'hungry', label: '😮‍💨 Hungry, hanging in' },
  { key: 'done', label: '✅ Done!' },
];

export function noteLabel(key: string): string {
  return NOTES.find((n) => n.key === key)?.label ?? key;
}

export const FEELS: { key: 'easy' | 'ok' | 'tough' | 'unwell'; label: string }[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'ok', label: 'OK' },
  { key: 'tough', label: 'Tough' },
  { key: 'unwell', label: 'Not well' },
];
