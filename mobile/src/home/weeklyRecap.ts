import { supabase } from '../lib/supabase';
import type { HealthProvider } from '../health/types';

// Home's start-of-week recap: how last week (Mon–Sun, local time) went,
// next to the week before it. Steps come straight from the device;
// everything else is the viewer's own activity_events ledger, which RLS
// already limits to their own rows (0058_hound_score.sql) — no migration.

export interface WeeklyRecap {
  // Monday of the week being recapped, as YYYY-MM-DD — also the card's
  // dismissal key, so dismissing it hides exactly this one recap.
  weekKey: string;
  stepsLastWeek: number | null;
  stepsWeekBefore: number | null;
  // Challenges that wrapped up (were settled) for the viewer last week.
  challengesFinished: number;
  scoreGained: number;
  bonesEarned: number;
}

// Shown Monday through Wednesday — long enough that opening the app a
// day or two late still catches it.
export const RECAP_LAST_WEEKDAY = 3;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekBounds(now: Date = new Date()) {
  const thisWeekStart = new Date(now);
  thisWeekStart.setHours(0, 0, 0, 0);
  // getDay(): Sunday = 0 … Saturday = 6; weeks here start on Monday.
  thisWeekStart.setDate(thisWeekStart.getDate() - ((thisWeekStart.getDay() + 6) % 7));
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const weekBeforeStart = new Date(lastWeekStart);
  weekBeforeStart.setDate(weekBeforeStart.getDate() - 7);
  return { thisWeekStart, lastWeekStart, weekBeforeStart };
}

export function isRecapWindow(now: Date = new Date()): boolean {
  const day = now.getDay();
  return day >= 1 && day <= RECAP_LAST_WEEKDAY;
}

export function recapWeekKey(now: Date = new Date()): string {
  return dateKey(weekBounds(now).lastWeekStart);
}

export async function fetchWeeklyRecap(
  health: HealthProvider,
  userId: string | null,
  now: Date = new Date(),
): Promise<WeeklyRecap> {
  const { thisWeekStart, lastWeekStart, weekBeforeStart } = weekBounds(now);
  const lastKey = dateKey(lastWeekStart);
  const thisKey = dateKey(thisWeekStart);

  const stepsPromise = health
    .getDailyStepsSince(weekBeforeStart)
    .then((days) => {
      let last = 0;
      let before = 0;
      for (const d of days) {
        if (d.date >= lastKey && d.date < thisKey) last += d.steps;
        else if (d.date < lastKey) before += d.steps;
      }
      return { last, before };
    })
    .catch(() => null);

  const ledgerPromise =
    supabase && userId
      ? supabase
          .from('activity_events')
          .select('kind, challenge_id, score_points, bones_points')
          .eq('user_id', userId)
          .gte('created_at', lastWeekStart.toISOString())
          .lt('created_at', thisWeekStart.toISOString())
          .then(({ data, error }: { data: any[] | null; error: unknown }) => (error ? [] : data ?? []))
      : Promise.resolve([] as any[]);

  const [steps, rows] = await Promise.all([stepsPromise, ledgerPromise]);
  const finished = new Set<string>();
  let scoreGained = 0;
  let bonesEarned = 0;
  for (const r of rows as { kind: string; challenge_id: string | null; score_points: number; bones_points: number }[]) {
    scoreGained += r.score_points ?? 0;
    bonesEarned += r.bones_points ?? 0;
    // Settling a challenge writes one row per participant — a per-kind
    // '*_result', or 'participation' for a kind with no result formula
    // (0066's settle_challenge_score). Counted by challenge, not by row.
    if (r.challenge_id && (r.kind.endsWith('_result') || r.kind === 'participation')) finished.add(r.challenge_id);
  }

  return {
    weekKey: lastKey,
    stepsLastWeek: steps ? steps.last : null,
    stepsWeekBefore: steps ? steps.before : null,
    challengesFinished: finished.size,
    scoreGained,
    bonesEarned,
  };
}

// "+12% vs the week before" style change, or null when there's nothing
// meaningful to compare against.
export function stepsChangePct(recap: WeeklyRecap): number | null {
  if (recap.stepsLastWeek === null || !recap.stepsWeekBefore) return null;
  return Math.round(((recap.stepsLastWeek - recap.stepsWeekBefore) / recap.stepsWeekBefore) * 100);
}
