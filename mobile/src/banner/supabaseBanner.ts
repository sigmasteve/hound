import { supabase } from '../lib/supabase';

// The app-wide Home screen announcement — see 0050_app_banner.sql for
// the backend half (a single shared row, same "one signed-in-readable
// row, admin-only write" shape as app_labels). Deliberately no
// starts_at: this isn't a scheduling tool, just "show this now, until
// this time (or dismissed)."
export interface AppBanner {
  message: string;
  enabled: boolean;
  // null = no expiry — stays up until an admin disables it or a viewer
  // dismisses it locally (see HomeScreen's own dismiss handling).
  expiresAt: string | null;
  // Used as the dismiss-tracking key (see HomeScreen) — an admin
  // editing the message/timeframe bumps this, so a banner someone
  // already dismissed comes back if it's meaningfully changed.
  updatedAt: string;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getAppBanner(): Promise<AppBanner> {
  const client = requireClient();
  const { data, error } = await client
    .from('app_banner')
    .select('message, enabled, expires_at, updated_at')
    .eq('id', true)
    .single();
  if (error) throw new Error(error.message);
  return { message: data.message, enabled: data.enabled, expiresAt: data.expires_at, updatedAt: data.updated_at };
}

export async function setAppBanner(input: { message: string; enabled: boolean; expiresAt: string | null }): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('app_banner')
    .update({
      message: input.message,
      enabled: input.enabled,
      expires_at: input.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw new Error(error.message);
}

// Whether this banner should actually be shown right now — enabled,
// has real text, and (if it has an expiry) hasn't passed it yet.
export function isBannerActive(banner: AppBanner): boolean {
  if (!banner.enabled || !banner.message.trim()) return false;
  if (!banner.expiresAt) return true;
  return new Date(banner.expiresAt).getTime() > Date.now();
}
