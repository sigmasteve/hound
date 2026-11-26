import AsyncStorage from '@react-native-async-storage/async-storage';
import { isNetworkError, reportNetworkFailure, reportReachable } from './network';
import { offlineEnabled } from './offlineConfig';

// Last-known copies (0271): a read that works is kept on the phone; a read
// that can't reach the server gets the kept copy instead (when offline mode
// is on), and the screen says when it's from ("Offline · last updated …").

const PREFIX = 'cache:';
const savedAt = new Map<string, number>();

export function lastSaved(key: string): number | null {
  return savedAt.get(key) ?? null;
}

export async function cachedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  try {
    const v = await read();
    reportReachable();
    const at = Date.now();
    savedAt.set(key, at);
    AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at, v })).catch(() => {});
    return v;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    reportNetworkFailure();
    if (!offlineEnabled()) throw e;
    const raw = await AsyncStorage.getItem(PREFIX + key).catch(() => null);
    if (!raw) throw e;
    const { at, v } = JSON.parse(raw);
    savedAt.set(key, at);
    return v as T;
  }
}

// The newest "last updated" among the kept copies a screen uses.
export function newestSaved(keys: string[]): number | null {
  const ts = keys.map((k) => savedAt.get(k)).filter((x): x is number => typeof x === 'number');
  return ts.length ? Math.max(...ts) : null;
}

// A read a screen can do without offline: with offline mode on and no
// connection, the fallback instead of failing the whole screen (a game's
// extras on a challenge page, say). Online, errors are as before.
export function offlineOr<T>(read: Promise<T>, fallback: T): Promise<T> {
  return read.catch((e) => {
    if (offlineEnabled() && isNetworkError(e)) return fallback;
    throw e;
  });
}
