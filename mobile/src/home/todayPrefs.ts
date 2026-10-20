import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Settings → Today, kept on this phone: how the goals tile on Today shows
// your goals. Rings (the default) puts one ring per goal next to the
// numbers; trails has your avatar running each goal's trail toward the
// bone, with the Hound pacing behind (GoalTrail).
export type GoalsTileStyle = 'rings' | 'trails';

const STYLE_KEY = 'today:goals-tile';

let cache: GoalsTileStyle | null = null;
const listeners = new Set<() => void>();

export async function getGoalsTileStyle(): Promise<GoalsTileStyle> {
  if (cache) return cache;
  const stored = await AsyncStorage.getItem(STYLE_KEY).catch(() => null);
  cache = stored === 'trails' ? 'trails' : 'rings';
  return cache;
}

export async function setGoalsTileStyle(style: GoalsTileStyle): Promise<void> {
  cache = style;
  listeners.forEach((l) => l());
  await AsyncStorage.setItem(STYLE_KEY, style).catch(() => {});
}

export function useGoalsTileStyle(): GoalsTileStyle | null {
  const [style, setStyle] = useState(cache);
  useEffect(() => {
    const update = () => getGoalsTileStyle().then(setStyle);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return style;
}
