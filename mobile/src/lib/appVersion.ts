import Constants from 'expo-constants';

// app.json's own "version" — bump that alongside every APK cut on the
// download page (see site/download.html) to keep the two in sync;
// nothing enforces that automatically. Never null in a real build (only
// Constants.expoConfig itself can be, e.g. some bare/dev-client setups),
// but falls back rather than showing "undefined" anywhere this is shown.
export const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';
