// Pure daily-bonus streak math — no Supabase/RN imports. The amounts
// themselves are admin-configurable (daily_bonus_config,
// 0070_daily_bonus.sql) and come back from claim_daily_bonus, so nothing
// here hardcodes them; only the fixed 7-day cycle lives in code, and must
// match that migration's own `% 7`.

export const DAILY_BONUS_CYCLE = 7;

// 1..7 — which dot of the current week this streak day lands on.
export function dayInCycle(streak: number): number {
  return ((Math.max(1, streak) - 1) % DAILY_BONUS_CYCLE) + 1;
}
