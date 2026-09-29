import * as Updates from 'expo-updates';

// Makes a published OTA update take effect on the launch that finds it,
// instead of the one after. Out of the box, expo-updates checks on launch
// but only *downloads* in the background — the new bundle runs on the
// next cold start, so a fresh install (or anyone a release behind) sees
// old code once before getting the new one.
//
// Runs while the splash screen is still up, and is bounded on both
// steps: a slow or offline network just falls through to launching
// normally, and the built-in background download still applies the
// update next time — the same behavior as before this existed, never
// worse.
const CHECK_TIMEOUT_MS = 3_000;
// Only ever waited on when there really is a newer update to fetch (at
// most once per release), so it can afford to be longer than the check.
const FETCH_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// Resolves once the app should carry on launching; if a newer update was
// downloaded in time, the app reloads into it instead and this never
// meaningfully resolves.
export async function applyLatestUpdateOnLaunch(): Promise<void> {
  // Not available in development or on web (isEnabled is false there).
  // An emergency launch means the last update failed to start and
  // expo-updates fell back to the built-in bundle — reloading straight
  // back into an update then risks a crash loop, so leave that launch
  // alone.
  if (__DEV__ || !Updates.isEnabled || Updates.isEmergencyLaunch) return;
  const check = await withTimeout(Updates.checkForUpdateAsync(), CHECK_TIMEOUT_MS);
  if (!check?.isAvailable) return;
  const fetched = await withTimeout(Updates.fetchUpdateAsync(), FETCH_TIMEOUT_MS);
  if (!fetched?.isNew) return;
  try {
    await Updates.reloadAsync();
  } catch {
    // Couldn't reload — the downloaded update still applies on the next
    // cold start, so just keep launching this one.
  }
}
