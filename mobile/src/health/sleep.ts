// Sleep (issue #494, item 5): each night's asleep time, read from Apple
// Health or Health Connect, for the Hound's bedtime later. Read only;
// nothing asks for it until that feature ships.
//
// Both platforms hand over pieces of sleep (Apple's asleep samples, or
// Health Connect's sleep stages), often from more than one app or device
// for the same night. They're merged here into nights: overlaps count
// once, and pieces less than three hours apart are the same night.

export interface SleepNight {
  // The local day the night ended on ('YYYY-MM-DD'): Tuesday morning's
  // wake-up is Tuesday's night.
  date: string;
  start: Date; // fell asleep
  end: Date; // woke up
  asleepMinutes: number; // asleep time only, not time in bed or awake
}

export interface SleepPiece {
  start: Date;
  end: Date;
}

const SAME_NIGHT_GAP_MS = 3 * 60 * 60 * 1000;
// Shorter than this counts as a nap, not a night.
const MIN_NIGHT_MINUTES = 60;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nightsFromPieces(pieces: SleepPiece[]): SleepNight[] {
  const sorted = pieces
    .filter((p) => p.end.getTime() > p.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Overlapping pieces become one, so two sources for the same sleep
  // don't double it.
  const merged: SleepPiece[] = [];
  for (const p of sorted) {
    const last = merged[merged.length - 1];
    if (last && p.start.getTime() <= last.end.getTime()) {
      if (p.end.getTime() > last.end.getTime()) last.end = new Date(p.end);
    } else {
      merged.push({ start: new Date(p.start), end: new Date(p.end) });
    }
  }

  const nights: SleepNight[] = [];
  let current: { start: Date; end: Date; ms: number } | null = null;
  const close = () => {
    if (!current) return;
    const minutes = Math.round(current.ms / 60000);
    if (minutes >= MIN_NIGHT_MINUTES) {
      nights.push({ date: dayKey(current.end), start: current.start, end: current.end, asleepMinutes: minutes });
    }
  };
  for (const p of merged) {
    const ms = p.end.getTime() - p.start.getTime();
    if (current && p.start.getTime() - current.end.getTime() < SAME_NIGHT_GAP_MS) {
      current.end = p.end;
      current.ms += ms;
    } else {
      close();
      current = { start: p.start, end: p.end, ms };
    }
  }
  close();

  // Two nights ending on the same day (a long break in the middle): keep
  // the longer.
  const byDay = new Map<string, SleepNight>();
  for (const n of nights) {
    const had = byDay.get(n.date);
    if (!had || n.asleepMinutes > had.asleepMinutes) byDay.set(n.date, n);
  }
  return [...byDay.values()].sort((a, b) => a.end.getTime() - b.end.getTime());
}
