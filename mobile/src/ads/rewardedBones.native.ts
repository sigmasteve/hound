import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import mobileAds, {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  MaxAdContentRating,
  TestIds,
  useRewardedAd,
} from 'react-native-google-mobile-ads';
import { localDayKey } from '../goals/goals';
import { claimAdReward, getAdOffer, type AdOffer } from './adsApi';
import type { RewardedBones, RewardedBonesState } from './rewardedBones';

export type { RewardedBones, RewardedBonesState } from './rewardedBones';

// "Watch an ad for Bones" (from 0.11.0; the Google Mobile Ads SDK is
// native). Nothing about ads starts until Admin has them on for you:
// then Google's consent form (EU and UK only), then the ad loads.
// Non-personalized ads only, so iPhone never asks "Allow tracking?", and
// rated PG at most.

let prepared: Promise<boolean> | null = null;

function prepareAds(): Promise<boolean> {
  prepared ??= (async () => {
    try {
      const consent = await AdsConsent.gatherConsent();
      if (!consent.canRequestAds) return false;
      await mobileAds().setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG });
      await mobileAds().initialize();
      return true;
    } catch {
      prepared = null;
      return false;
    }
  })();
  return prepared;
}

// Settings shows "Ad privacy choices" when Google says the member must be
// able to change their consent (EU and UK).
export async function adPrivacyOptionsRequired(): Promise<boolean> {
  try {
    const info = await AdsConsent.getConsentInfo();
    return info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
  } catch {
    return false;
  }
}

export async function showAdPrivacyOptions(): Promise<void> {
  await AdsConsent.showPrivacyOptionsForm();
}

// With verifyByServer on, Google tells our server, not the app, so the app
// watches for the remaining count to drop.
const SERVER_CHECKS = 5;
const SERVER_CHECK_MS = 2000;

export function useRewardedBones(userId: string | null | undefined, onPaid: (bones: number) => void): RewardedBones {
  const [offer, setOffer] = useState<AdOffer | null>(null);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve(null);
    return getAdOffer()
      .then((o) => {
        setOffer(o);
        return o;
      })
      .catch(() => null);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (offer?.available && !ready) prepareAds().then(setReady);
  }, [offer?.available, ready]);

  const unitId = (Platform.OS === 'ios' ? offer?.iosUnitId : offer?.androidUnitId) ?? TestIds.REWARDED;
  const day = localDayKey(new Date());
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: true,
      // Signed by Google with the reward, so admob-reward knows who to pay
      // and for which day.
      serverSideVerificationOptions: { userId: userId ?? undefined, customData: day },
    }),
    [userId, day],
  );
  const ad = useRewardedAd({
    adUnitId: offer?.available && userId ? unitId : null,
    autoLoad: ready,
    requestOptions,
  });

  // Pays once each time an ad's reward is earned.
  const earned = ad.earnedReward;
  const wasEarned = useRef(false);
  useEffect(() => {
    if (!earned || wasEarned.current || !offer) {
      wasEarned.current = earned;
      return;
    }
    wasEarned.current = true;
    setPaying(true);
    (async () => {
      try {
        if (!offer.verifyByServer) {
          const r = await claimAdReward();
          if (r.awarded) onPaidRef.current(r.bones);
        } else {
          for (let i = 0; i < SERVER_CHECKS; i++) {
            await new Promise((done) => setTimeout(done, SERVER_CHECK_MS));
            const after = await getAdOffer().catch(() => null);
            if (after && after.remaining < offer.remaining) {
              onPaidRef.current(offer.bones);
              break;
            }
          }
        }
      } catch {
        // The ad was watched but the Bones didn't land; the cap only counts
        // paid ads, so nothing is lost but this one.
      } finally {
        setPaying(false);
        refresh();
      }
    })();
  }, [earned, offer, refresh]);

  // The next ad loads once this one closes.
  const { status, load } = ad;
  useEffect(() => {
    if (status === 'closed' && ready) load();
  }, [status, ready, load]);

  let state: RewardedBonesState;
  if (!offer || (!offer.available && offer.remaining > 0)) state = 'hidden';
  else if (paying) state = 'paying';
  else if (!offer.available) state = 'done-for-today';
  else if (status === 'showing') state = 'showing';
  else if (status === 'loaded') state = 'ready';
  else if (status === 'no-fill' || status === 'error') state = 'unavailable';
  else state = 'loading';

  return {
    state,
    bones: offer?.bones ?? 0,
    remaining: offer?.remaining ?? 0,
    watch: () => {
      if (status === 'loaded') ad.show();
      else if (status === 'no-fill' || status === 'error') ad.retry();
    },
  };
}
