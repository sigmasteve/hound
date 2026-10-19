import { supabase } from '../lib/supabase';
import { localDayKey } from '../goals/goals';

// Rewarded ads (0114_rewarded_ads.sql): watch a short ad for Bones, a few
// times a day, only when you choose to.

export interface AdOffer {
  available: boolean;
  bones: number;
  remaining: number;
  // On: only Google's signed callback pays (admob-reward); the app just
  // waits to see the Bones arrive. Off: the app claims after the ad.
  verifyByServer: boolean;
  // Null: Google's test ads.
  iosUnitId: string | null;
  androidUnitId: string | null;
}

function client() {
  if (!supabase) throw new Error('Ads need a connection to Hound.');
  return supabase;
}

export async function getAdOffer(): Promise<AdOffer> {
  const { data, error } = await client().rpc('my_ad_offer', { p_local_date: localDayKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    available: r.available,
    bones: r.bones,
    remaining: r.remaining,
    verifyByServer: r.verify_by_server,
    iosUnitId: r.ios_unit_id,
    androidUnitId: r.android_unit_id,
  };
}

export async function claimAdReward(): Promise<{ awarded: boolean; bones: number; remaining: number }> {
  const { data, error } = await client().rpc('claim_ad_reward', { p_local_date: localDayKey(new Date()) }).single();
  if (error) throw new Error(error.message);
  return data as { awarded: boolean; bones: number; remaining: number };
}

export interface AdSettings {
  enabled: boolean;
  bonesPerAd: number;
  dailyCap: number;
  showToOrgMembers: boolean;
  verifyByServer: boolean;
  iosUnitId: string | null;
  androidUnitId: string | null;
}

export interface AdStats {
  todayAds: number;
  weekAds: number;
  weekPeople: number;
  weekBones: number;
}

export async function getAdSettings(): Promise<{ settings: AdSettings; stats: AdStats }> {
  const { data, error } = await client().rpc('admin_ad_settings');
  if (error) throw new Error(error.message);
  const r = data as any;
  return {
    settings: {
      enabled: r.enabled,
      bonesPerAd: r.bones_per_ad,
      dailyCap: r.daily_cap,
      showToOrgMembers: r.show_to_org_members,
      verifyByServer: r.verify_by_server,
      iosUnitId: r.ios_unit_id,
      androidUnitId: r.android_unit_id,
    },
    stats: { todayAds: r.today_ads, weekAds: r.week_ads, weekPeople: r.week_people, weekBones: r.week_bones },
  };
}

export async function setAdSettings(s: AdSettings): Promise<void> {
  const { error } = await client().rpc('set_ad_settings', {
    p_enabled: s.enabled,
    p_bones_per_ad: s.bonesPerAd,
    p_daily_cap: s.dailyCap,
    p_show_to_org_members: s.showToOrgMembers,
    p_verify_by_server: s.verifyByServer,
    p_ios_unit_id: s.iosUnitId ?? '',
    p_android_unit_id: s.androidUnitId ?? '',
  });
  if (error) throw new Error(error.message);
}
