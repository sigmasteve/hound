import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { supabase } from '../lib/supabase';

// Which build and OTA update each person runs — see
// 0076_app_version_tracking.sql. Reported on every app open; read back
// on the Admin screen.

// expo-application is a native module, so it only exists in builds made
// after it was added. An OTA update also reaches older builds, where
// loading it throws — those just report no build number.
let nativeApp: {
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
  getInstallReferrerAsync?: () => Promise<string>;
} | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nativeApp = require('expo-application');
} catch {
  nativeApp = null;
}

export interface RunningApp {
  platform: string;
  osVersion: string;
  appVersion: string | null;
  appBuild: string | null;
  // Null when running the code the build shipped with.
  otaUpdateId: string | null;
  // When the running code was published: the update's publish time, or
  // the build's own bundle time for code it shipped with.
  codePublishedAt: string | null;
}

export function currentApp(): RunningApp {
  const ota = Updates.isEnabled && !Updates.isEmbeddedLaunch;
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    appVersion:
      nativeApp?.nativeApplicationVersion ?? Updates.runtimeVersion ?? Constants.expoConfig?.version ?? null,
    appBuild: nativeApp?.nativeBuildVersion ?? null,
    otaUpdateId: ota ? Updates.updateId : null,
    codePublishedAt: Updates.isEnabled && Updates.createdAt ? Updates.createdAt.toISOString() : null,
  };
}

// Never throws — a failed report (offline, or before 0076 has run) just
// leaves the last one in place.
export async function reportAppVersion(userId: string): Promise<void> {
  if (!supabase || Platform.OS === 'web') return;
  const app = currentApp();
  try {
    await supabase
      .from('profiles')
      .update({
        app_platform: app.platform,
        os_version: app.osVersion,
        app_version: app.appVersion,
        app_build: app.appBuild,
        ota_update_id: app.otaUpdateId,
        code_published_at: app.codePublishedAt,
        app_reported_at: new Date().toISOString(),
      })
      .eq('id', userId);
  } catch {
    // See above.
  }
}

// ── Where an Android app came from (0163) ───────────────────────────

// Google Play, or the APK from the website (houndchallenge.net/get).
export type InstallSource = 'play' | 'website';

const SOURCE_KEY = 'hound:install-source';

// Asks Play's install referrer service once, then remembers the answer
// (it doesn't change unless the app is reinstalled). Play installs come
// back as "utm_source=google-play…". Anything else, or no Play Store on
// the phone, is the website APK. A failed connection is "not known":
// it's asked again next time.
async function androidInstallSource(): Promise<{ source: InstallSource; referrer: string } | null> {
  if (Platform.OS !== 'android' || !nativeApp?.getInstallReferrerAsync) return null;
  try {
    const saved = await AsyncStorage.getItem(SOURCE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Ask again below.
  }
  let found: { source: InstallSource; referrer: string } | null = null;
  try {
    const referrer = (await nativeApp.getInstallReferrerAsync()) ?? '';
    found = { source: /utm_source=google-play/i.test(referrer) ? 'play' : 'website', referrer: referrer.slice(0, 300) };
  } catch (e: any) {
    if (e?.code === 'ERR_APPLICATION_INSTALL_REFERRER_UNAVAILABLE') found = { source: 'website', referrer: '(no Play Store)' };
  }
  if (found) AsyncStorage.setItem(SOURCE_KEY, JSON.stringify(found)).catch(() => {});
  return found;
}

// Its own write, so it can't break the version report before 0163 has
// run. Never throws.
export async function reportInstallSource(userId: string): Promise<void> {
  if (!supabase) return;
  try {
    const found = await androidInstallSource();
    if (!found) return;
    await supabase
      .from('profiles')
      .update({ app_install_source: found.source, app_install_referrer: found.referrer })
      .eq('id', userId);
  } catch {
    // Next open.
  }
}

export const SOURCE_NAME: Record<InstallSource, string> = { play: 'from Play', website: 'from the website' };

export interface ReportedApp extends RunningApp {
  userId: string;
  name: string;
  reportedAt: string | null;
  // Android only, from 0163; null when not known.
  installSource: InstallSource | null;
}

const BASE_COLUMNS = 'id, name, app_platform, os_version, app_version, app_build, ota_update_id, code_published_at, app_reported_at';
// With 0163's install source. Before it's run, the base columns alone.
const COLUMNS = `${BASE_COLUMNS}, app_install_source`;

function rowToReported(r: any): ReportedApp {
  return {
    userId: r.id,
    name: r.name,
    platform: r.app_platform,
    osVersion: r.os_version,
    appVersion: r.app_version,
    appBuild: r.app_build,
    otaUpdateId: r.ota_update_id,
    codePublishedAt: r.code_published_at,
    reportedAt: r.app_reported_at,
    installSource: r.app_install_source ?? null,
  };
}

// Everyone who's opened the app in the last `days` days.
export async function listActiveApps(days = 14): Promise<ReportedApp[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const read = (columns: string) =>
    supabase!
      .from('profiles')
      .select(columns)
      .gte('last_active_at', since)
      .order('last_active_at', { ascending: false })
      .limit(1000);
  let { data, error } = await read(COLUMNS);
  // Before 0163, or before 0164's read grant: the columns everyone has.
  if (error && /app_install_source|permission denied/i.test(error.message)) ({ data, error } = await read(BASE_COLUMNS));
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(rowToReported);
}

export async function getUserApp(userId: string): Promise<ReportedApp | null> {
  if (!supabase) return null;
  let { data, error } = await supabase.from('profiles').select(COLUMNS).eq('id', userId).maybeSingle();
  if (error && /app_install_source|permission denied/i.test(error.message)) {
    ({ data, error } = await supabase.from('profiles').select(BASE_COLUMNS).eq('id', userId).maybeSingle());
  }
  if (error || !data) return null;
  return rowToReported(data);
}

// ── Who's up to date ────────────────────────────────────────────────

// "Latest" is the newest thing anyone has reported — Hound has no feed
// of what's been published, and the startup update check (src/updates/
// startupUpdate.ts) puts nearly everyone on the newest update the first
// time they open the app after it's published.
export interface Latest {
  // Per platform: the highest build number reported.
  build: Record<string, number>;
  // Per app version (an OTA update only reaches builds of the version it
  // was published for): the newest OTA update's publish time. A build's
  // own code doesn't raise this bar — a build made after the last update
  // already contains it, so people on that update aren't behind.
  updateAt: Record<string, number>;
}

// Play and the website APK are separate builds with their own numbers,
// so once the source is known each is compared only with its own kind:
// a Play phone isn't "behind" because the APK got a higher number.
function buildKey(a: RunningApp & { installSource?: InstallSource | null }): string {
  return a.installSource ? `${a.platform}:${a.installSource}` : a.platform;
}

export function findLatest(apps: (RunningApp & { installSource?: InstallSource | null })[]): Latest {
  const latest: Latest = { build: {}, updateAt: {} };
  for (const a of apps) {
    const build = Number(a.appBuild);
    if (a.appBuild && Number.isFinite(build)) {
      latest.build[a.platform] = Math.max(latest.build[a.platform] ?? 0, build);
      if (a.installSource) latest.build[buildKey(a)] = Math.max(latest.build[buildKey(a)] ?? 0, build);
    }
    if (a.appVersion && a.otaUpdateId && a.codePublishedAt) {
      const at = new Date(a.codePublishedAt).getTime();
      latest.updateAt[a.appVersion] = Math.max(latest.updateAt[a.appVersion] ?? 0, at);
    }
  }
  return latest;
}

// old_build: a newer TestFlight/store build exists — only reinstalling
// fixes it. old_update: on the newest build, but running older code —
// fully closing and reopening the app picks up the latest update.
export type AppStatus = 'latest' | 'old_build' | 'old_update' | 'unknown';

export function appStatus(app: RunningApp & { installSource?: InstallSource | null }, latest: Latest): AppStatus {
  if (!app.appVersion) return 'unknown';
  const newestBuild = latest.build[buildKey(app)] ?? latest.build[app.platform];
  // Every build that reports a number is newer than every build that
  // can't (expo-application arrived with build numbers), so no number
  // at all means an older build too.
  if (newestBuild !== undefined && (!app.appBuild || Number(app.appBuild) < newestBuild)) return 'old_build';
  const newestUpdate = latest.updateAt[app.appVersion];
  if (newestUpdate === undefined || !app.codePublishedAt) return 'latest';
  return new Date(app.codePublishedAt).getTime() >= newestUpdate ? 'latest' : 'old_update';
}

export const STATUS_LABEL: Record<AppStatus, string> = {
  latest: 'Latest',
  old_build: 'Older build',
  old_update: 'Older update',
  unknown: 'Unknown',
};

const PLATFORM_NAME: Record<string, string> = { ios: 'iOS', android: 'Android' };

export function platformName(platform: string | null): string {
  return (platform && PLATFORM_NAME[platform]) || platform || 'Unknown';
}

export function updateLabel(app: Pick<RunningApp, 'otaUpdateId' | 'codePublishedAt'>): string {
  const when = app.codePublishedAt
    ? new Date(app.codePublishedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  if (!app.otaUpdateId) return when ? `Build’s own code (${when})` : 'Build’s own code';
  return when ? `Update of ${when}` : 'OTA update';
}

// "iOS 26.5 · 0.10.0 (42)"
export function buildLabel(app: RunningApp): string {
  const os = app.osVersion ? `${platformName(app.platform)} ${app.osVersion}` : platformName(app.platform);
  if (!app.appVersion) return os;
  return `${os} · ${app.appVersion}${app.appBuild ? ` (${app.appBuild})` : ''}`;
}

export interface VersionGroup {
  key: string;
  // "iOS · 0.10.0 (42)"
  build: string;
  update: string;
  status: AppStatus;
  people: string[];
  // Android: how many came from Play, the website, or not known yet.
  sources: { play: number; website: number; unknown: number };
}

// Android phones by where the app came from (0163).
export function sourceCounts(apps: ReportedApp[]): { play: number; website: number; unknown: number } {
  const out = { play: 0, website: 0, unknown: 0 };
  for (const a of apps) {
    if (a.platform !== 'android') continue;
    out[a.installSource ?? 'unknown'] += 1;
  }
  return out;
}

// Everyone grouped by exactly what they run, newest first, plus the
// "not reported yet" bucket for people whose app predates reporting.
export function groupApps(apps: ReportedApp[]): { groups: VersionGroup[]; unreported: string[]; latestCount: number } {
  const latest = findLatest(apps);
  const byKey = new Map<string, VersionGroup & { platform: string; sortAt: number; sortBuild: number }>();
  const unreported: string[] = [];
  let latestCount = 0;
  for (const a of apps) {
    if (!a.appVersion) {
      unreported.push(a.name);
      continue;
    }
    const status = appStatus(a, latest);
    if (status === 'latest') latestCount += 1;
    const key = [a.platform, a.appVersion, a.appBuild ?? '', a.otaUpdateId ?? 'embedded'].join('|');
    const existing = byKey.get(key);
    const source = a.platform === 'android' ? (a.installSource ?? 'unknown') : null;
    if (existing) {
      existing.people.push(a.name);
      if (source) existing.sources[source] += 1;
      continue;
    }
    byKey.set(key, {
      key,
      build: `${platformName(a.platform)} · ${a.appVersion}${a.appBuild ? ` (${a.appBuild})` : ''}`,
      update: updateLabel(a),
      status,
      people: [a.name],
      sources: {
        play: source === 'play' ? 1 : 0,
        website: source === 'website' ? 1 : 0,
        unknown: source === 'unknown' ? 1 : 0,
      },
      platform: a.platform ?? '',
      sortAt: a.codePublishedAt ? new Date(a.codePublishedAt).getTime() : 0,
      sortBuild: Number(a.appBuild) || 0,
    });
  }
  const groups = [...byKey.values()]
    // iOS first, then newest build, then newest code.
    .sort((x, y) => y.platform.localeCompare(x.platform) || y.sortBuild - x.sortBuild || y.sortAt - x.sortAt)
    .map(({ platform: _p, sortAt: _a, sortBuild: _b, ...g }) => g);
  return { groups, unreported, latestCount };
}
