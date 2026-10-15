import { Platform } from 'react-native';

// Background sync only exists on phones (see backgroundSync.ts), so the
// web preview never loads it.
export function defineBackgroundSync(): void {
  if (Platform.OS === 'web') return;
  require('./backgroundSync');
}

export function startBackgroundSync(): void {
  if (Platform.OS === 'web') return;
  (require('./backgroundSync') as typeof import('./backgroundSync')).registerBackgroundSync();
}
