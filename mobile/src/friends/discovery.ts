import { supabase } from '../lib/supabase';
import { friendCodeUrl } from './types';

// Finding friends in the beta — see 0080_friend_discovery.sql. Search and
// suggestions are switched on or off for everyone from Admin → Find
// people, which also holds the beta download links.

export interface DiscoveryConfig {
  searchEnabled: boolean;
  suggestionsEnabled: boolean;
  iosBetaUrl: string | null;
  androidBetaUrl: string | null;
}

export type PersonRelation = 'none' | 'requested' | 'incoming' | 'friends';

export interface FoundPerson {
  userId: string;
  name: string;
  initials: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  // Search results only.
  relation: PersonRelation;
  // Suggestions only: "In a challenge with you", "2 mutual friends"…
  reason: string | null;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

// Null before 0080 has run — the app then just hides everything here.
export async function getDiscoveryConfig(): Promise<DiscoveryConfig | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('friend_discovery_config')
    .select('search_enabled, suggestions_enabled, ios_beta_url, android_beta_url')
    .maybeSingle();
  if (error || !data) return null;
  return {
    searchEnabled: !!data.search_enabled,
    suggestionsEnabled: !!data.suggestions_enabled,
    iosBetaUrl: data.ios_beta_url || null,
    androidBetaUrl: data.android_beta_url || null,
  };
}

export async function setDiscoveryConfig(config: DiscoveryConfig): Promise<void> {
  const { error } = await requireClient()
    .from('friend_discovery_config')
    .update({
      search_enabled: config.searchEnabled,
      suggestions_enabled: config.suggestionsEnabled,
      ios_beta_url: config.iosBetaUrl?.trim() || null,
      android_beta_url: config.androidBetaUrl?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw new Error(error.message);
}

function rowToPerson(r: any): FoundPerson {
  return {
    userId: r.user_id,
    name: r.name,
    initials: r.initials,
    frameId: r.frame_id,
    backgroundId: r.background_id,
    iconId: r.icon_id,
    relation: (r.relation as PersonRelation) ?? 'none',
    reason: r.reason ?? null,
  };
}

export const MIN_SEARCH_LENGTH = 2;

export async function findPeople(query: string): Promise<FoundPerson[]> {
  if (query.trim().length < MIN_SEARCH_LENGTH) return [];
  const { data, error } = await requireClient().rpc('find_people', { p_query: query.trim() });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(rowToPerson);
}

export async function peopleYouMayKnow(): Promise<FoundPerson[]> {
  const { data, error } = await requireClient().rpc('people_you_may_know');
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(rowToPerson);
}

// Null before 0080 has run.
export async function getDiscoverable(userId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('discoverable').eq('id', userId).maybeSingle();
  if (error || !data) return null;
  return (data as { discoverable?: boolean }).discoverable ?? null;
}

export async function setDiscoverable(userId: string, discoverable: boolean): Promise<void> {
  const { error } = await requireClient().from('profiles').update({ discoverable }).eq('id', userId);
  if (error) throw new Error(error.message);
}

// What "Share" sends: the invite link (which walks someone without the
// app through getting the beta — site/f.js), plus the code on its own
// for anyone who already has Hound.
export function inviteMessage(code: string): string {
  return `Join me on Hound — it's in beta! Get the app and add me: ${friendCodeUrl(code)}\nAlready have Hound? Friends → Enter a code: ${code}`;
}
