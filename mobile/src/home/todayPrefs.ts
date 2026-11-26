import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The card across the top of Today, for people who fast (Steve, Nov 2026;
// an extra in Customize Today since 0278): swipe Your day sideways to the
// Fasting card and back. Kept on this phone, so Today opens on whichever
// was showing last.
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
