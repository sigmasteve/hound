import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

// The installed build's version (expo-application), falling back to
// app.json's "version" as the running code was published with it. The
// installed one comes first: while an update goes out to two versions at
// once (scripts/publish-update.sh), the code a 0.11 phone runs may have
// been published from a newer app.json, and the Home banner's
// {if version=...} has to see 0.11. Bump app.json's version alongside
// every APK cut on the download page (see site/download.html).
let nativeVersion: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeVersion = require('expo-application').nativeApplicationVersion ?? null;
} catch {
  nativeVersion = null;
}
export const APP_VERSION = nativeVersion ?? Constants.expoConfig?.version ?? 'unknown';

// What this copy of the app is running, for the bottom of Settings:
// which database (PR = production, STG = staging), which update channel,
// and which update. Added after a production update went out with
// staging's database address (17 Oct 2026), so a mix-up shows at a glance.
// Bare project ids and hosts only: scripts/publish-update.sh checks the
// code for the full https:// addresses, so never write one out here.
const DATABASES: Record<string, string> = {
  vaypjksgpuuopqvurcus: 'PR',
  quglaamzzhebqrlhvfuc: 'STG',
  // Production's own domain (Supabase custom domain).
  'auth.houndchallenge.net': 'PR',
};

export function runningOnLabel(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? url.match(/^https:\/\/([^/]+)/)?.[1];
  const parts = [ref ? (DATABASES[ref] ?? ref) : 'no database'];
  // Not in development or on web.
  if (Updates.isEnabled) {
    if (Updates.channel) parts.push(Updates.channel);
    parts.push(Updates.isEmbeddedLaunch || !Updates.updateId ? 'built-in code' : `update ${Updates.updateId.slice(0, 8)}`);
  }
  return parts.join(' · ');
}
