import AsyncStorage from '@react-native-async-storage/async-storage';

// The challenge section of Today as it was last time, kept on the phone
// so the next open can show it straight away while fresh data loads
// (about two seconds for someone with several running challenges).
// One copy per account. Bump VERSION when the saved shape changes, so an
// old copy is ignored rather than misread.
const VERSION = 1;
const key = (userId: string) => `hound:today-challenges:${userId}`;

export async function readTodayCache<T>(userId: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { v: number; data: T };
    return saved.v === VERSION ? saved.data : null;
  } catch {
    return null;
  }
}

export function writeTodayCache<T>(userId: string, data: T): void {
  AsyncStorage.setItem(key(userId), JSON.stringify({ v: VERSION, data })).catch(() => {});
}
