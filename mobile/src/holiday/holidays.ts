// The holiday themes on Today (0184): what each is called, its day, and
// what its countdown pill and tap note say. The drawings are in
// HolidayDecor.tsx; which one is on, and when, is scheduled on Admin.

export type HolidayThemeId = 'diwali' | 'thanksgiving' | 'christmas' | 'newyear' | 'lunarnewyear';

export const HOLIDAY_THEME_IDS: HolidayThemeId[] = ['diwali', 'thanksgiving', 'christmas', 'newyear', 'lunarnewyear'];

export interface HolidayTheme {
  id: HolidayThemeId;
  name: string;
  emoji: string;
  // What falls (or drifts) over Today, for Settings and Admin.
  effectsName: string;
  // The note when the countdown is tapped.
  note: string;
}

export const HOLIDAY_THEMES: Record<HolidayThemeId, HolidayTheme> = {
  diwali: {
    id: 'diwali',
    name: 'Diwali',
    emoji: '🪔',
    effectsName: 'Golden sparkles',
    note: 'May the festival of lights bring you joy, good health and plenty of evening walks under the lanterns.',
  },
  thanksgiving: {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    emoji: '🦃',
    effectsName: 'Falling leaves',
    note: 'Thankful for you and every step you take with us. A walk after the big meal counts toward your goals too.',
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas',
    emoji: '🎄',
    effectsName: 'Falling snow',
    note: 'Merry Christmas from all of us at Hound. Wrap up warm for a walk: your hound would love one.',
  },
  newyear: {
    id: 'newyear',
    name: 'New Year',
    emoji: '🎆',
    effectsName: 'Confetti',
    note: 'Here’s to a new year of streaks, walks and challenges with your friends. Happy New Year!',
  },
  lunarnewyear: {
    id: 'lunarnewyear',
    name: 'Chinese New Year',
    emoji: '🧧',
    effectsName: 'Plum blossoms',
    note: 'Wishing you luck, health and happiness in the new year. 新年快乐!',
  },
};

// Diwali and Chinese New Year move with the moon; these are their days
// for the next few years.
const DIWALI: Record<number, string> = { 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17', 2029: '2029-11-05', 2030: '2030-10-26' };
const LUNAR: Record<number, { day: string; animal: string }> = {
  2027: { day: '2027-02-06', animal: 'Goat' },
  2028: { day: '2028-01-26', animal: 'Monkey' },
  2029: { day: '2029-02-13', animal: 'Rooster' },
  2030: { day: '2030-02-03', animal: 'Dog' },
  2031: { day: '2031-01-23', animal: 'Pig' },
};

const key = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// The fourth Thursday of November.
function thanksgiving(y: number): string {
  const first = new Date(y, 10, 1).getDay();
  return key(y, 11, 1 + ((4 - first + 7) % 7) + 21);
}

// The holiday's day in a year, or null when it isn't known.
export function holidayDay(id: HolidayThemeId, year: number): string | null {
  if (id === 'christmas') return key(year, 12, 25);
  if (id === 'newyear') return key(year, 1, 1);
  if (id === 'thanksgiving') return thanksgiving(year);
  if (id === 'diwali') return DIWALI[year] ?? null;
  return LUNAR[year]?.day ?? null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

// The holiday's next day on or after `today` (within a year), or the one
// just past when it was in the last few weeks (so a run that carries on
// after the day keeps its greeting).
function nearestDay(id: HolidayThemeId, today: string): string | null {
  const y = Number(today.slice(0, 4));
  for (const yy of [y - 1, y, y + 1]) {
    const d = holidayDay(id, yy);
    if (d && daysBetween(today, d) >= -21 && daysBetween(today, d) <= 366) return d;
  }
  return null;
}

// The pill: a countdown before the day, a greeting from the day on.
export function holidayPill(id: HolidayThemeId, today: string): string {
  const t = HOLIDAY_THEMES[id];
  const day = nearestDay(id, today);
  const n = day ? daysBetween(today, day) : null;
  if (id === 'christmas') {
    if (n !== null && n > 0) return `${n} ${n === 1 ? 'sleep' : 'sleeps'} to Christmas`;
    return 'Merry Christmas!';
  }
  if (id === 'newyear') {
    const next = day ? day.slice(0, 4) : String(Number(today.slice(0, 4)) + 1);
    if (n !== null && n > 0) return `${n} ${n === 1 ? 'day' : 'days'} to ${next}`;
    return `Happy New Year!`;
  }
  if (id === 'lunarnewyear') {
    const animal = day ? LUNAR[Number(day.slice(0, 4))]?.animal : undefined;
    const year = animal ? `the Year of the ${animal}` : 'the new year';
    if (n !== null && n > 0) return `${n} ${n === 1 ? 'day' : 'days'} to ${year}`;
    return animal ? `Happy Year of the ${animal}!` : 'Happy New Year!';
  }
  if (n !== null && n > 0) return `${n} ${n === 1 ? 'day' : 'days'} to ${t.name}`;
  return `Happy ${t.name}!`;
}

// What Admin suggests for a new run: from `from`, to when the holiday's
// usually over (the day after Christmas, the day after Thanksgiving, Jan
// 2, the Lantern Festival, three days for Diwali).
export function suggestedEnd(id: HolidayThemeId, from: string): string {
  const day = nearestDay(id, from) ?? from;
  const plus = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00`);
    x.setDate(x.getDate() + n);
    return key(x.getFullYear(), x.getMonth() + 1, x.getDate());
  };
  const end =
    id === 'christmas'
      ? plus(day, 1)
      : id === 'thanksgiving'
        ? plus(day, 1)
        : id === 'newyear'
          ? plus(day, 1)
          : id === 'lunarnewyear'
            ? plus(day, 14)
            : daysBetween(from, day) < 0
              ? plus(from, 2)
              : plus(day, 2);
  return daysBetween(from, end) < 0 ? plus(from, 2) : end;
}

// A day key as "Nov 12".
export function shortDay(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
