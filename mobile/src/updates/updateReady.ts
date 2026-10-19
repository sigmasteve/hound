import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

// The other half of startupUpdate.ts. That one only runs on a cold start,
// but phones keep Hound in the background for days, and coming back to it
// isn't a cold start — so someone could stay a release or two behind
// until the phone happened to close the app. Coming back to the app checks
// for (and quietly downloads) a newer update, and Today's banner
// (UpdateReadyBanner) offers a restart into it. Ignored, it still applies
// on the next cold start.

// Coming back more often than this doesn't check again; the check is one
// small request, but there's no need to send it on every app switch.
const CHECK_EVERY_MS = 15 * 60 * 1000;
const DISMISSED_KEY = 'updateReadyDismissedId';

// Checks and fetches can't overlap: expo-updates rejects a second one
// while the first is running.
let busy = false;

function canUpdate() {
  // Not in development or on web (isEnabled is false there). An emergency
  // launch is the built-in code after an update failed to start, and
  // restarting into an update from there risks a crash loop — see
  // startupUpdate.ts.
  return !__DEV__ && Updates.isEnabled && !Updates.isEmergencyLaunch;
}

async function checkAndFetch() {
  if (busy || !canUpdate()) return;
  busy = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or the server didn't answer; the next return tries again.
  } finally {
    busy = false;
  }
}

// Mounted once, for the whole app (App.tsx). The launch itself already
// checked, so the clock starts now.
export function useForegroundUpdateCheck() {
  useEffect(() => {
    let lastCheck = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck < CHECK_EVERY_MS) return;
      lastCheck = Date.now();
      checkAndFetch();
    });
    return () => sub.remove();
  }, []);
}

// For Today's banner: whether a downloaded update is waiting for a
// restart, and the two things to do about it. "Not now" hides it until a
// different update is downloaded.
export function useUpdateReady() {
  const { isUpdatePending, downloadedUpdate, isRestarting } = Updates.useUpdates();
  // A rollback to the built-in code has no id of its own.
  const id = isUpdatePending ? (downloadedUpdate?.updateId ?? 'rollback') : null;
  const [dismissedId, setDismissedId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then(setDismissedId)
      .catch(() => setDismissedId(null));
  }, []);

  const [restarting, setRestarting] = useState(false);
  const restart = async () => {
    setRestarting(true);
    try {
      await Updates.reloadAsync();
    } catch {
      // Couldn't restart; the update still applies on the next cold start.
      setRestarting(false);
    }
  };

  const dismiss = () => {
    if (!id) return;
    setDismissedId(id);
    AsyncStorage.setItem(DISMISSED_KEY, id).catch(() => {});
  };

  return {
    // Hidden until "Not now" has been read back, so it can't flash up.
    ready: !!id && canUpdate() && dismissedId !== undefined && dismissedId !== id,
    restarting: restarting || isRestarting,
    restart,
    dismiss,
  };
}
