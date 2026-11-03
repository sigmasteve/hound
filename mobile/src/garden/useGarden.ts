import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { buySeedPack, claimFreeSeed, digUpPlant, getGarden, pickPlant, plantSeed, type Garden } from './garden';

// The Kennel's garden (0162): loaded each time the Kennel comes into
// view, so the plants have grown with the steps since.

export interface GardenState {
  garden: Garden | null;
  // False before 0162 has run: no garden shows.
  available: boolean;
  busy: boolean;
  plant(plot: number, seed: string): Promise<boolean>;
  pick(plot: number): Promise<boolean>;
  digUp(plot: number): Promise<boolean>;
  claim(seed: string): Promise<boolean>;
  buy(seed: string): Promise<boolean>;
}

export function useGarden(onBalance?: (n: number) => void): GardenState {
  const [garden, setGarden] = useState<Garden | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const preview = (globalThis as any).__previewGarden as Garden | undefined;
      if (preview) {
        setGarden(preview);
        return;
      }
      if (!isSupabaseConfigured) return;
      getGarden(localDayKey())
        .then((g) => {
          setGarden(g);
          setAvailable(true);
        })
        .catch((e) => {
          if (e instanceof Error && /my_garden/.test(e.message)) setAvailable(false);
        });
    }, []),
  );

  const run = (title: string, fn: (day: string) => Promise<Garden>) => async (): Promise<boolean> => {
    if ((globalThis as any).__previewGarden) return false;
    setBusy(true);
    try {
      const g = await fn(localDayKey());
      setGarden(g);
      if (g.balance !== null) onBalance?.(g.balance);
      return true;
    } catch (e) {
      Alert.alert(title, e instanceof Error ? e.message : 'Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    garden,
    available,
    busy,
    plant: (plot, seed) => run("Couldn't plant it", (d) => plantSeed(d, plot, seed))(),
    pick: (plot) => run("Couldn't pick it", (d) => pickPlant(d, plot))(),
    digUp: (plot) => run("Couldn't dig it up", (d) => digUpPlant(d, plot))(),
    claim: (seed) => run("Couldn't get the seed", (d) => claimFreeSeed(d, seed))(),
    buy: (seed) => run("Couldn't buy the seeds", (d) => buySeedPack(d, seed))(),
  };
}
