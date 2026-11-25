import { AppState } from 'react-native';
import { useEffect, useState } from 'react';

// Offline mode (0271): whether Hound's server can be reached. A blip must
// not flip the app offline (Steve, Nov 2026), so one failed request only
// starts a check: the server is asked three times over about 10 seconds
// (now, at 4 s and at 10 s), and only if all three fail is the app
// offline. Any answer at all (even an error from the server) means the
// network is fine. While offline it asks again every 15 seconds and when
// the app comes back to the front; the first answer brings it back online.

export type NetState = 'online' | 'offline';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const CHECKS_MS = [0, 4000, 10000];
const OFFLINE_RETRY_MS = 15000;

let state: NetState = 'online';
let checking = false;
let retry: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(s: NetState) => void>();

// The message a fetch that never reached the server fails with, on iOS,
// Android and the web.
export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : (e as any)?.message;
  return (
    typeof m === 'string' &&
    /network request failed|failed to fetch|fetch failed|networkerror|load failed|internet connection appears to be offline|timed out|timeout|ECONNREFUSED|ENOTFOUND|ENETUNREACH|aborted/i.test(m)
  );
}

// One request to the server, 5 seconds at most. True if anything answered.
async function reachable(): Promise<boolean> {
  if (!url) return true;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    await fetch(`${url}/auth/v1/health`, { headers: key ? { apikey: key } : undefined, signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function set(next: NetState) {
  if (next === state) return;
  state = next;
  if (next === 'offline' && !retry) {
    retry = setInterval(() => {
      reachable().then((ok) => ok && set('online'));
    }, OFFLINE_RETRY_MS);
  }
  if (next === 'online' && retry) {
    clearInterval(retry);
    retry = null;
  }
  listeners.forEach((l) => l(next));
}

export function getNetState(): NetState {
  return state;
}

export function onNetState(l: (s: NetState) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// A request failed without reaching the server: check properly before
// calling it offline.
export function reportNetworkFailure(): void {
  if (state === 'offline' || checking) return;
  checking = true;
  (async () => {
    const start = Date.now();
    for (const at of CHECKS_MS) {
      const wait = at - (Date.now() - start);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (await reachable()) {
        checking = false;
        return;
      }
    }
    checking = false;
    set('offline');
  })();
}

// A request got an answer: the network's fine.
export function reportReachable(): void {
  set('online');
}

AppState.addEventListener('change', (s) => {
  if (s === 'active' && state === 'offline') reachable().then((ok) => ok && set('online'));
});

export function useNetState(): NetState {
  const [s, setS] = useState(state);
  useEffect(() => onNetState(setS), []);
  return s;
}
