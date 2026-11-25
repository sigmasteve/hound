import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthUser } from './types';

// The signed-in profile, kept on the phone (0271, offline mode): with no
// connection the profile can't be read, so Hound uses the last one rather
// than an account with no name (or, if the session can't be refreshed,
// none at all).
const KEY = 'auth:last-user';

export function saveUser(u: AuthUser): void {
  AsyncStorage.setItem(KEY, JSON.stringify(u)).catch(() => {});
}

export async function lastUser(id?: string): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    return !id || u.id === id ? u : null;
  } catch {
    return null;
  }
}

export function forgetUser(): void {
  AsyncStorage.removeItem(KEY).catch(() => {});
}
