import { Platform } from 'react-native';

// Background sync only exists on phones (see backgroundSync.ts), so the
// web preview never loads it.
export function defineBackgroundSync(): void {
  if (Platform.OS === 'web') return;
  require('./backgroundSync');
  // Pack Fun's background location (0192). Builds before 1.2.0 have no
  // location module; the task is never started there.
  try {
    require('../packFun/packFunTask');
  } catch {
    // Nothing to define.
  }
}

export function startBackgroundSync(): void {
  if (Platform.OS === 'web') return;
  (require('./backgroundSync') as typeof import('./backgroundSync')).registerBackgroundSync();
}
