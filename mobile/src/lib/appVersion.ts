import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

// app.json's own "version" — bump that alongside every APK cut on the
// download page (see site/download.html) to keep the two in sync;
// nothing enforces that automatically. Never null in a real build (only
// Constants.expoConfig itself can be, e.g. some bare/dev-client setups),
// but falls back rather than showing "undefined" anywhere this is shown.
export const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';

// What this copy of the app is running, for the bottom of Settings:
// which database (PR = production, STG = staging), which update channel,
// and which update. Added after a production update went out with
// staging's database address (17 Oct 2026), so a mix-up shows at a glance.
const DATABASES: Record<string, string> = {
  vaypjksgpuuopqvurcus: 'PR',
  quglaamzzhebqrlhvfuc: 'STG',
};

export function runningOnLabel(): string {
  const ref = process.env.EXPO_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const parts = [ref ? (DATABASES[ref] ?? ref) : 'no database'];
  // Not in development or on web.
  if (Updates.isEnabled) {
    if (Updates.channel) parts.push(Updates.channel);
    parts.push(Updates.isEmbeddedLaunch || !Updates.updateId ? 'built-in code' : `update ${Updates.updateId.slice(0, 8)}`);
  }
  return parts.join(' · ');
}
