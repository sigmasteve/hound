import { useEffect, useState } from 'react';
import { getWelcome, saveHoundUses, type HoundUse } from './welcomeApi';
import type { Interest } from './interests';

// What someone said they'll use Hound for (the wizard's checkboxes, 0272),
// kept in memory so Today, Settings and Discover share one read. Ticking
// Intermittent fasting puts Fasting in Your day before a first fast.

let cache: HoundUse[] | null = null;
let loading: Promise<HoundUse[]> | null = null;
const listeners = new Set<(u: HoundUse[]) => void>();

function publish(u: HoundUse[]) {
  cache = u;
  listeners.forEach((l) => l(u));
}

export function loadMyUses(force = false): Promise<HoundUse[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (!loading || force) {
    loading = getWelcome()
      .then((w) => {
        const u = w?.uses ?? cache ?? [];
        publish(u);
        return u;
      })
      .catch(() => cache ?? [])
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function saveMyUses(uses: HoundUse[]): Promise<void> {
  const before = cache;
  publish(uses);
  try {
    await saveHoundUses(uses);
  } catch (e) {
    if (before) publish(before);
    throw e;
  }
}

export function useMyUses(): HoundUse[] | null {
  const [uses, setUses] = useState<HoundUse[] | null>(cache);
  useEffect(() => {
    listeners.add(setUses);
    loadMyUses().catch(() => {});
    return () => {
      listeners.delete(setUses);
    };
  }, []);
  return uses;
}

// For Discover's "best fits" (it ranks by K-08's interests, folded in
// here by 0272).
export function interestsFromUses(uses: HoundUse[]): Interest[] {
  const out = new Set<Interest>();
  for (const u of uses) {
    if (u === 'steps' || u === 'water' || u === 'habits') out.add('general');
    if (u === 'workouts' || u === 'cardio') out.add('athlete');
    if (u === 'activities') {
      out.add('sports');
      out.add('general');
    }
    if (u === 'strength') out.add('gym');
    if (u === 'fasting') out.add('weight_loss');
    if (u === 'friends') out.add('sports');
  }
  return [...out];
}
