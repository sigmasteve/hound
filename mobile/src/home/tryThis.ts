import { supabase } from '../lib/supabase';
import type { ChallengeKind } from '../challenges/types';
import type { GlobalChallenge } from '../challenges/globalChallenges';
import { localDayKey } from '../fasting/fasting';

// Try this (0281, the streamlining's third part): Global challenges are
// there to show what Hound can do, so Today shows one at a time as an
// invitation, kinds you've never played first, rotating each day. Not now
// three times and it steps aside for a week; in two Globals already, it
// steps aside too. The full list is on Challenges → Join, grouped.

export type GlobalGroup = 'races' | 'sports' | 'games' | 'habits';

export const GLOBAL_GROUPS: { id: GlobalGroup; title: string }[] = [
  { id: 'races', title: 'Step races' },
  { id: 'sports', title: 'Sports' },
  { id: 'games', title: 'Board & casino games' },
  { id: 'habits', title: 'Fitness habits' },
];

const GROUP_OF: Record<ChallengeKind, GlobalGroup> = {
  steps: 'races',
  distance: 'races',
  journey: 'races',
  hunt: 'races',
  tag: 'races',
  golf: 'sports',
  derby: 'sports',
  shootout: 'sports',
  bout: 'sports',
  titlebout: 'sports',
  soccer: 'sports',
  cricket: 'sports',
  baseball: 'sports',
  hoops: 'sports',
  horse: 'sports',
  rally: 'sports',
  bullseye: 'sports',
  longshot: 'sports',
  bingo: 'games',
  houndopoly: 'games',
  slots: 'games',
  roulette: 'games',
  chess: 'games',
  tictacgo: 'games',
  packs: 'games',
  doors: 'games',
  streak: 'habits',
  seventyfive: 'habits',
  checklist: 'habits',
};

export function globalGroup(kind: ChallengeKind): GlobalGroup {
  return GROUP_OF[kind] ?? 'games';
}

export interface TryThisState {
  hiddenUntil: string | null;
  playedKinds: string[];
}

export async function getTryThis(): Promise<TryThisState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_try_this');
  if (error || !data) return null;
  const d = data as { hidden_until: string | null; played_kinds: string[] | null };
  return { hiddenUntil: d.hidden_until ?? null, playedKinds: d.played_kinds ?? [] };
}

export async function tryThisNotNow(): Promise<{ hiddenUntil: string | null }> {
  if (!supabase) return { hiddenUntil: null };
  const { data, error } = await supabase.rpc('try_this_not_now');
  if (error) throw new Error(error.message);
  return { hiddenUntil: (data as { hidden_until: string | null } | null)?.hidden_until ?? null };
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

// What to show, in order: kinds you've never played first (then the
// rest), and within those, a different one first each day.
export function tryThisOrder(open: GlobalChallenge[], playedKinds: string[], day = localDayKey()): GlobalChallenge[] {
  const fresh = open.filter((c) => !playedKinds.includes(c.kind));
  const seen = open.filter((c) => playedKinds.includes(c.kind));
  const turn = (list: GlobalChallenge[]) => {
    if (list.length < 2) return list;
    const k = dayNumber(day) % list.length;
    return [...list.slice(k), ...list.slice(0, k)];
  };
  return [...turn(fresh), ...turn(seen)];
}
