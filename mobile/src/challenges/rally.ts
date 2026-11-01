// Pure game rules for Rally — no Supabase/RN imports, same as tictacgo.ts
// and streak.ts. The server (0139_rally.sql) owns the score, whose side
// the shuttle is on, the deadline and the smash; this file owns the
// numbers Create offers and how the game's state reads on a screen.

// The serve: what the first return of every rally needs.
export const RALLY_SERVE_OPTIONS = [500, 1000, 1500, 2000, 3000] as const;
export const DEFAULT_RALLY_SERVE_STEPS = 1000;

// How long a return can take, in waking hours (07:00 to 21:00 in the
// returning player's own time zone); 24 means the rest of the day, to
// 21:00. Mirrors rally_due's own rules.
export const RALLY_WINDOW_OPTIONS = [2, 4, 8, 24] as const;
export const DEFAULT_RALLY_WINDOW_HOURS = 24;
export const RALLY_DAY_START_HOUR = 7;
export const RALLY_DAY_END_HOUR = 21;

export const RALLY_GAME_POINTS = 21;
export const RALLY_GAME_CAP = 30;
export const RALLY_GAMES_TO_WIN = 2;
export const RALLY_GROWTH = 1.15;
export const DEFAULT_RALLY_DAYS = 14;

export function rallyWindowLabel(hours: number): string {
  return hours >= 24 ? 'Rest of the day' : `${hours} hours`;
}

export function rallyWindowNote(hours: number): string {
  return hours >= 24
    ? 'A return is due by 9pm your time. A shuttle that lands after 7pm is due by 9pm the next day.'
    : `${hours} waking hours to return, counted between 7am and 9pm your time. Nights never count against you.`;
}

// The next rally's first target after a return: 15% more, rounded up to
// a round 50 — the same as rally_next_target on the server.
export function nextRallyTarget(target: number): number {
  return Math.ceil((target * RALLY_GROWTH) / 50) * 50;
}

// What a game needs to end, from both scores: 21 with a two-point lead,
// or 30.
export function rallyGameOver(a: number, b: number): boolean {
  const high = Math.max(a, b);
  return high >= RALLY_GAME_CAP || (high >= RALLY_GAME_POINTS && Math.abs(a - b) >= 2);
}

// "2h 15m", "40m", "due now".
export function formatRallyTimeLeft(dueAt: string | null, now: number = Date.now()): string {
  if (!dueAt) return '';
  const ms = new Date(dueAt).getTime() - now;
  if (ms <= 0) return 'due now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

// "by 4:30 PM", or "by 4:30 PM tomorrow", in the phone's own time zone.
export function formatRallyDue(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return '';
  const due = new Date(dueAt);
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (due.toDateString() === now.toDateString()) return `by ${time}`;
  if (due.toDateString() === new Date(now.getTime() + 86_400_000).toDateString()) return `by ${time} tomorrow`;
  return `by ${time} ${due.toLocaleDateString([], { weekday: 'short' })}`;
}

export function formatSteps(n: number): string {
  return `${Math.round(n).toLocaleString()} steps`;
}
