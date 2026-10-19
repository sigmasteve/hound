import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Settings → Celebrations, kept on this phone: whether celebrations make
// a sound (on by default; a phone on silent stays silent either way), and
// how cheeky the "missed a day" message is.
export type CelebrateTone = 'playful' | 'roast';

const SOUNDS_KEY = 'celebrate:sounds';
const TONE_KEY = 'celebrate:tone';

let cache: { sounds: boolean; tone: CelebrateTone } | null = null;
const listeners = new Set<() => void>();

export async function getCelebratePrefs(): Promise<{ sounds: boolean; tone: CelebrateTone }> {
  if (cache) return cache;
  const [sounds, tone] = await Promise.all([
    AsyncStorage.getItem(SOUNDS_KEY).catch(() => null),
    AsyncStorage.getItem(TONE_KEY).catch(() => null),
  ]);
  cache = { sounds: sounds !== 'off', tone: tone === 'roast' ? 'roast' : 'playful' };
  return cache;
}

export async function setCelebratePrefs(change: Partial<{ sounds: boolean; tone: CelebrateTone }>): Promise<void> {
  const next = { ...(await getCelebratePrefs()), ...change };
  cache = next;
  listeners.forEach((l) => l());
  await Promise.all([
    AsyncStorage.setItem(SOUNDS_KEY, next.sounds ? 'on' : 'off'),
    AsyncStorage.setItem(TONE_KEY, next.tone),
  ]).catch(() => {});
}

export function useCelebratePrefs() {
  const [prefs, setPrefs] = useState(cache);
  useEffect(() => {
    const update = () => getCelebratePrefs().then(setPrefs);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return prefs;
}
