import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { getMyHoundProfile, setHoundBirthday, type HoundProfile } from './growth';

// Your hound's fitness, age, birthday and traits (0165), read each time
// the Kennel comes into view (which is also when new traits are awarded).

export interface HoundProfileState {
  profile: HoundProfile | null;
  busy: boolean;
  setBirthday(birthday: string): Promise<boolean>;
}

export function useHoundProfile(): HoundProfileState {
  const [profile, setProfile] = useState<HoundProfile | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const preview = (globalThis as any).__previewProfile as HoundProfile | undefined;
      if (preview) {
        setProfile(preview);
        return;
      }
      if (!isSupabaseConfigured) return;
      getMyHoundProfile(localDayKey())
        .then(setProfile)
        .catch(() => {});
    }, []),
  );

  const setBirthday = async (birthday: string): Promise<boolean> => {
    setBusy(true);
    try {
      setProfile(await setHoundBirthday(localDayKey(), birthday));
      return true;
    } catch (e) {
      Alert.alert("Couldn't change the birthday", e instanceof Error ? e.message : 'Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { profile, busy, setBirthday };
}
