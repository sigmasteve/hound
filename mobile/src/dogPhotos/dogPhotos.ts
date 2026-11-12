import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { APP_VERSION } from '../lib/appVersion';
import { compareVersions } from '../updates/versionGate';
import { KENNEL_ITEMS } from '../kennel/kennelItems';
import type { HoundEars, HoundMarkings, HoundTail } from '../kennel/kennelItems';

// Your dog as your avatar (0191_dog_photos.sql, supabase/functions/dog-photo).
//
// A photo in use puts its token on the end of the hound avatar code:
//   hound:<coat>.<ears>.<tail>.<markings>.<neck>.<head>.<face>.<breed>.~<token>
// Avatar shows the photo when this phone has it (yours and your
// friends': DogPhotoContext), and the hound for everyone else.

export const BUCKET = 'dog-photos';

export function photoTokenFromIcon(iconId: string | null | undefined): string | null {
  if (!iconId || !iconId.startsWith('hound:')) return null;
  const last = iconId.slice(iconId.lastIndexOf('.') + 1);
  return last.startsWith('~') && last.length > 1 ? last.slice(1) : null;
}

// Picking and resizing need 1.2.0's native modules; older builds can
// still see photos, just not add one.
type Modules = { picker: typeof import('expo-image-picker'); manipulator: typeof import('expo-image-manipulator') };
let modules: Modules | null | undefined;
export function photoModules(): Modules | null {
  if (modules !== undefined) return modules;
  modules = null;
  if (Platform.OS === 'web') return modules;
  if (APP_VERSION !== 'unknown' && compareVersions(APP_VERSION, '1.2.0') < 0) return modules;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const picker = require('expo-image-picker');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manipulator = require('expo-image-manipulator');
    modules = { picker, manipulator };
  } catch {
    modules = null;
  }
  return modules;
}

export function canAddPhoto(): boolean {
  return photoModules() !== null;
}

// A square photo from the library or camera, 384 px, as base64 JPEG.
// Null when cancelled.
export async function pickPhoto(from: 'library' | 'camera'): Promise<{ uri: string; base64: string } | null> {
  const m = photoModules();
  if (!m) throw new Error('Update Hound to add a photo.');
  const options = { mediaTypes: ['images'] as any, allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.9 };
  let result;
  if (from === 'camera') {
    const perm = await m.picker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Hound needs the camera to take a photo. You can allow it in Settings.');
    result = await m.picker.launchCameraAsync(options);
  } else {
    result = await m.picker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.[0]) return null;
  const small = await m.manipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 384, height: 384 } }], {
    compress: 0.8,
    format: m.manipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!small.base64) throw new Error('Couldn’t read that photo. Try another.');
  return { uri: small.uri, base64: small.base64 };
}

export interface DogLook {
  coat: string | null;
  ears: HoundEars;
  tail: HoundTail;
  markings: HoundMarkings;
  breed: string | null;
}

export type CheckResult =
  | { ok: true; photoId: string; breed: string; look: DogLook }
  | { ok: false; reason: string; limit?: boolean };

// The coats and breeds Claude picks from: everything in the Kennel's
// catalog, so a new one needs no server change.
function lookOptions() {
  const pick = (slot: 'coat' | 'breed') => KENNEL_ITEMS.filter((i) => i.slot === slot).map((i) => ({ id: i.id, name: i.name }));
  return { coats: pick('coat'), breeds: pick('breed') };
}

export async function checkPhoto(base64: string): Promise<CheckResult> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.functions.invoke('dog-photo', { body: { action: 'check', image: base64, ...lookOptions() } });
  if (error) throw new Error('We couldn’t check that photo just now. Try again in a minute.');
  return data as CheckResult;
}

// Deletes this person's files they no longer use (or, for an admin,
// someone else's after removing their photo). Best effort.
export function purgePhotos(userId?: string): void {
  supabase?.functions.invoke('dog-photo', { body: { action: 'purge', userId } }).catch(() => {});
}

export interface MyDogPhoto {
  photoId: string | null;
  status: 'pending' | 'active' | 'hidden' | null;
  path: string | null;
  token: string | null;
  breed: string | null;
  look: DogLook | null;
  blockedUntil: string | null;
  triesLeft: number;
}

export async function getMyDogPhoto(): Promise<MyDogPhoto> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('my_dog_photo');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    photoId: d.photo_id ?? null,
    status: d.status ?? null,
    path: d.path ?? null,
    token: d.token ?? null,
    breed: d.checked?.breed_guess ?? null,
    look: d.checked?.look ?? null,
    blockedUntil: d.blocked_until ?? null,
    triesLeft: Number(d.tries_left ?? 0),
  };
}

export async function chooseDogPhoto(photoId: string): Promise<string> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('dog_photo_use', { p_photo: photoId });
  if (error) throw new Error(error.message);
  purgePhotos();
  return data as string;
}

export async function stopDogPhoto(): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('dog_photo_stop');
  if (error) throw new Error(error.message);
  purgePhotos();
}

export async function reportDogPhoto(userId: string, reason: string | null): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('report_dog_photo', { p_user: userId, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function lookWasApplied(): Promise<void> {
  await supabase?.rpc('dog_look_was_applied');
}

export async function friendDogPhotos(): Promise<{ userId: string; token: string; path: string }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('friend_dog_photos');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({ userId: r.user_id, token: r.token, path: r.path }));
}

// Links that work for a day; Storage checks who's asking.
export async function signedPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supabase || paths.length === 0) return out;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 24 * 3600);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}

// ── Admin ──

export interface ReportedPhoto {
  photoId: string;
  userId: string;
  name: string;
  path: string;
  hidden: boolean;
  reports: number;
  reasons: string[];
  breed: string | null;
}

export interface DogPhotosOverview {
  usingNow: number;
  tried: number;
  checks7d: number;
  turnedDown7d: number;
  looksApplied: number;
  looksPeople: number;
  blocked: number;
  toReview: number;
  reported: ReportedPhoto[];
}

export async function getDogPhotosOverview(): Promise<DogPhotosOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_dog_photos_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    usingNow: n(d.using_now),
    tried: n(d.tried),
    checks7d: n(d.checks_7d),
    turnedDown7d: n(d.turned_down_7d),
    looksApplied: n(d.looks_applied),
    looksPeople: n(d.looks_people),
    blocked: n(d.blocked),
    toReview: n(d.to_review),
    reported: ((d.reported ?? []) as any[]).map((r) => ({
      photoId: r.photo_id,
      userId: r.user_id,
      name: r.name ?? 'Someone',
      path: r.path,
      hidden: !!r.hidden,
      reports: n(r.reports),
      reasons: (r.reasons ?? []) as string[],
      breed: r.checked?.breed_guess ?? null,
    })),
  };
}

export function dogPhotosSummary(o: DogPhotosOverview): string {
  return `${o.usingNow} using a dog photo${o.toReview > 0 ? ` · ${o.toReview} to review` : ''}`;
}

// keep, or remove (blockDays: null none, -1 for good, else days).
export async function reviewDogPhoto(photo: ReportedPhoto, keep: boolean, blockDays: number | null): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_review_dog_photo', { p_photo: photo.photoId, p_keep: keep, p_block_days: blockDays });
  if (error) throw new Error(error.message);
  if (!keep) purgePhotos(photo.userId);
}

// days: -1 for good, 0 to unblock, else days.
export async function blockDogUploads(userId: string, days: number): Promise<void> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { error } = await supabase.rpc('admin_block_dog_uploads', { p_user: userId, p_days: days });
  if (error) throw new Error(error.message);
  if (days !== 0) purgePhotos(userId);
}

export interface UserDogPhoto {
  status: 'active' | 'hidden' | null;
  path: string | null;
  blockedUntil: string | null;
  turnedDown: number;
  removed: number;
}

export async function getUserDogPhoto(userId: string): Promise<UserDogPhoto> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_user_dog_photo', { p_user: userId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  return {
    status: d.status ?? null,
    path: d.path ?? null,
    blockedUntil: d.blocked_until ?? null,
    turnedDown: Number(d.turned_down ?? 0),
    removed: Number(d.removed ?? 0),
  };
}
