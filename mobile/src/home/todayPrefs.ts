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

// The card across the top of Today, for people who fast (Steve, Nov 2026):
// swipe the Goals tile sideways to the Fasting card and back. Kept on this
// phone, so Today opens on whichever was showing last.
export type TodayTopCard = 'goals' | 'fasting';

const TOP_KEY = 'today:top-card';
let topCache: TodayTopCard | null = null;

export async function getTodayTopCard(): Promise<TodayTopCard> {
  if (topCache) return topCache;
  const stored = await AsyncStorage.getItem(TOP_KEY).catch(() => null);
  topCache = stored === 'fasting' ? 'fasting' : 'goals';
  return topCache;
}

export function setTodayTopCard(card: TodayTopCard): void {
  if (topCache === card) return;
  topCache = card;
  AsyncStorage.setItem(TOP_KEY, card).catch(() => {});
}

// Null until the phone's choice has loaded.
export function useTodayTopCard(): [TodayTopCard | null, (c: TodayTopCard) => void] {
  const [card, setCard] = useState(topCache);
  useEffect(() => {
    getTodayTopCard().then(setCard);
  }, []);
  return [
    card,
    (c: TodayTopCard) => {
      setTodayTopCard(c);
      setCard(c);
    },
  ];
}
