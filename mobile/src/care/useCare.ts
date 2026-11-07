import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { feedTreat, finishBath, getCare, giftTreat, giveBath, makeTreat, type Care } from './care';

// The Kennel's bath and kitchen (0169): loaded when the Kennel comes into
// view, and again when the day's walks change (a long walk muddies the
// hound).

export interface CareState {
  care: Care | null;
  // False before 0169 has run: nothing about care shows.
  available: boolean;
  busy: boolean;
  // Bumped by each bath, so the Yard can show it happening.
  bathN: number;
  // The quick bath (no game, no Bones), shown happening in the Yard.
  bath(): Promise<boolean>;
  // The bath played in BathScene (0177): its bubbles pay Bones.
  finishBath(bubbles: number, golden: boolean): Promise<boolean>;
  make(recipe: string): Promise<boolean>;
  feed(treat: string): Promise<boolean>;
  gift(friend: string, treat: string, note: string | null): Promise<boolean>;
  reload(): void;
}

export function useCare(walksVersion: unknown, onChanged?: () => void): CareState {
  const [care, setCare] = useState<Care | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [bathN, setBathN] = useState(0);

  const reload = useCallback(() => {
    const preview = (globalThis as any).__previewCare as Care | undefined;
    if (preview) {
      setCare(preview);
      return;
    }
    if (!isSupabaseConfigured) return;
    getCare(localDayKey())
      .then((c) => {
        setCare(c);
        setAvailable(true);
      })
      .catch((e) => {
        if (e instanceof Error && /my_care/.test(e.message)) setAvailable(false);
      });
  }, []);

  useFocusEffect(reload);
  useEffect(reload, [walksVersion, reload]);

  const run = (title: string, fn: (day: string) => Promise<Care>, after?: () => void) => async (): Promise<boolean> => {
    if ((globalThis as any).__previewCare) {
      after?.();
      return false;
    }
    setBusy(true);
    try {
      setCare(await fn(localDayKey()));
      after?.();
      onChanged?.();
      return true;
    } catch (e) {
      Alert.alert(title, e instanceof Error ? e.message : 'Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    care,
    available,
    busy,
    bathN,
    reload,
    bath: () => run("Couldn't give a bath", giveBath, () => setBathN((n) => n + 1))(),
    finishBath: (bubbles, golden) => run("Couldn't finish the bath", (d) => finishBath(d, bubbles, golden))(),
    make: (recipe) => run("Couldn't make it", (d) => makeTreat(d, recipe))(),
    feed: (treat) => run("Couldn't give the treat", (d) => feedTreat(d, treat))(),
    gift: (friend, treat, note) => run("Couldn't send it", (d) => giftTreat(d, friend, treat, note))(),
  };
}
