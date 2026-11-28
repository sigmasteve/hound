import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The Goals card (0287), kept on this phone: how it shows your goals.
// Rings (the default) puts one ring per goal next to the numbers; trails
// has your avatar running each goal's trail toward the bone, with the
// Hound pacing behind (GoalTrail).
export type GoalsTileStyle = 'rings' | 'trails';

const STYLE_KEY = 'today:goals-tile';
let styleCache: GoalsTileStyle | null = null;
const styleListeners = new Set<() => void>();

export async function getGoalsTileStyle(): Promise<GoalsTileStyle> {
  if (styleCache) return styleCache;
  const stored = await AsyncStorage.getItem(STYLE_KEY).catch(() => null);
  styleCache = stored === 'trails' ? 'trails' : 'rings';
  return styleCache;
}

export async function setGoalsTileStyle(style: GoalsTileStyle): Promise<void> {
  styleCache = style;
  styleListeners.forEach((l) => l());
  await AsyncStorage.setItem(STYLE_KEY, style).catch(() => {});
}

export function useGoalsTileStyle(): GoalsTileStyle | null {
  const [style, setStyle] = useState(styleCache);
  useEffect(() => {
    const update = () => getGoalsTileStyle().then(setStyle);
    update();
    styleListeners.add(update);
    return () => {
      styleListeners.delete(update);
    };
  }, []);
  return style;
}

// The card across the top of Today: Your day ('goals', its old name),
// and the extras to swipe to (Customize Today): the Goals card (0287,
// 'classic') and the Fasting card. Kept on this phone, so Today opens on
// whichever was showing last.
export type TodayTopCard = 'goals' | 'classic' | 'fasting';

const TOP_KEY = 'today:top-card';
let topCache: TodayTopCard | null = null;

export async function getTodayTopCard(): Promise<TodayTopCard> {
  if (topCache) return topCache;
  const stored = await AsyncStorage.getItem(TOP_KEY).catch(() => null);
  topCache = stored === 'fasting' || stored === 'classic' ? stored : 'goals';
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
