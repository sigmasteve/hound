// Web has no ads (rewardedBones.native.ts is the real one). The same
// shape, always unavailable, so the Locker's card just doesn't show.

export type RewardedBonesState = 'hidden' | 'loading' | 'ready' | 'showing' | 'paying' | 'done-for-today' | 'unavailable';

export interface RewardedBones {
  state: RewardedBonesState;
  bones: number;
  remaining: number;
  watch: () => void;
}

export function useRewardedBones(
  _userId: string | null | undefined,
  _onPaid: (bones: number) => void,
): RewardedBones {
  return { state: 'hidden', bones: 0, remaining: 0, watch: () => {} };
}

export async function adPrivacyOptionsRequired(): Promise<boolean> {
  return false;
}

export async function showAdPrivacyOptions(): Promise<void> {}
