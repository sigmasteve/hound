// Pure daily-bonus math — no Supabase/RN imports. Must match
// claim_daily_bonus's own reward schedule in 0070_daily_bonus.sql by
// hand; the server is the real authority (it's what actually credits
// Bones), this copy only exists so the popup can preview tomorrow's
// reward and draw the week's progress without another round-trip.

export const DAILY_BONUS_BASE = 5;
export const DAILY_BONUS_WEEKLY = 25;
export const DAILY_BONUS_CYCLE = 7;

export function dailyBonusForStreak(streak: number): number {
  return streak > 0 && streak % DAILY_BONUS_CYCLE === 0 ? DAILY_BONUS_WEEKLY : DAILY_BONUS_BASE;
}

// 1..7 — which dot of the current week this streak day lands on.
export function dayInCycle(streak: number): number {
  return ((Math.max(1, streak) - 1) % DAILY_BONUS_CYCLE) + 1;
}
