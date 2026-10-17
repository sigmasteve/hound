import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { claimable, claimBounty, listBounties, type Bounty } from './bountiesApi';

// Today's bounties, and the claims that win them: as soon as today's
// steps reach a friend's target, Today asks the server for it. Each
// bounty is tried once per step count while Today is open; the server
// pays only the first claim.
export function useBounties(
  userId: string | null | undefined,
  stepsToday: number | null,
  refreshKey: number,
  onWon: (bounty: Bounty) => void,
): { bounties: Bounty[] | null; refresh: () => void } {
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const tried = useRef(new Set<string>());
  const onWonRef = useRef(onWon);
  onWonRef.current = onWon;
  const enabled = isSupabaseConfigured && !!userId;

  const refresh = useCallback(() => {
    if (!enabled) return;
    listBounties()
      .then(setBounties)
      .catch(() => {
        // The card just doesn't show.
      });
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    if (!enabled || !bounties || stepsToday == null) return;
    const ready = claimable(bounties, stepsToday).filter((b) => !tried.current.has(`${b.id}:${stepsToday}`));
    if (ready.length === 0) return;
    ready.forEach((b) => tried.current.add(`${b.id}:${stepsToday}`));
    (async () => {
      for (const b of ready) {
        try {
          const r = await claimBounty(b.id, stepsToday);
          if (r.claimed) onWonRef.current(b);
        } catch {
          // Unfriended or gone: the next refresh drops it.
        }
      }
      refresh();
    })();
  }, [enabled, bounties, stepsToday, refresh]);

  return { bounties, refresh };
}
