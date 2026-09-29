import { supabase } from '../lib/supabase';

// Today's "Get started" checklist — see 0074_onboarding_checklist.sql.
// The server checks every step itself; the client only reads the result
// and asks to claim the reward once all three are done.

export interface OnboardingStatus {
  healthConnected: boolean;
  hasFriend: boolean;
  joinedChallenge: boolean;
  rewardClaimed: boolean;
  rewardBones: number;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus | null> {
  const { data, error } = await requireClient().rpc('onboarding_status');
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { health_connected: boolean; has_friend: boolean; joined_challenge: boolean; reward_claimed: boolean; reward_bones: number }
    | undefined;
  if (!row) return null;
  return {
    healthConnected: row.health_connected,
    hasFriend: row.has_friend,
    joinedChallenge: row.joined_challenge,
    rewardClaimed: row.reward_claimed,
    rewardBones: row.reward_bones,
  };
}

// Returns the Bones awarded; throws if a step is still open or it was
// already claimed.
export async function claimOnboardingReward(): Promise<number> {
  const { data, error } = await requireClient().rpc('claim_onboarding_reward');
  if (error) throw new Error(error.message);
  return data as number;
}

export function onboardingDoneCount(s: OnboardingStatus): number {
  return [s.healthConnected, s.hasFriend, s.joinedChallenge].filter(Boolean).length;
}
