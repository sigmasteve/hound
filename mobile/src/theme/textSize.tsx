import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// How big the app's text is (K-07: "the font is a bit small for older
// people"). One choice in Settings, saved on this phone, applied by the
// shared Text component (src/components/Text.tsx) to every screen at
// once, so no screen needs its own sizes changed.
//
//   default  Hound's usual look, with the smallest text raised to a
//            readable minimum and faint grey text given a little more
//            contrast.
//   large    everything 12% bigger, and faint text darker still.
//   larger   everything 24% bigger.
//
// The phone's own text size setting still applies on top, but the two
// together never go past TEXT_SCALE_CAP (1.3×): the size the layouts
// are known to hold at (Today's tiles, the top bar and the tab bar).

export type TextSize = 'default' | 'large' | 'larger';

export const TEXT_SIZES: { id: TextSize; name: string; scale: number; fadedFloor: number }[] = [
  { id: 'default', name: 'Default', scale: 1, fadedFloor: 0.6 },
  { id: 'large', name: 'Large', scale: 1.12, fadedFloor: 0.7 },
  { id: 'larger', name: 'Larger', scale: 1.24, fadedFloor: 0.78 },
];

// No text is drawn smaller than this, before scaling.
export const SMALLEST_TEXT = 12;

const STORAGE_KEY = 'hound:text-size';

interface TextSizeValue {
  size: TextSize;
  scale: number;
  // Grey text drawn fainter than this (but not the deliberately faint
  // kind, like disabled labels) is raised to it.
  fadedFloor: number;
  setSize: (size: TextSize) => void;
}

const DEFAULT = TEXT_SIZES[0];

// Outside the provider (or before the saved choice loads), the default.
const TextSizeContext = createContext<TextSizeValue>({
  size: DEFAULT.id,
  scale: DEFAULT.scale,
  fadedFloor: DEFAULT.fadedFloor,
  setSize: () => {},
});

export function TextSizeProvider({ children }: { children: React.ReactNode }) {
  const [size, setSizeState] = useState<TextSize>('default');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'large' || saved === 'larger' || saved === 'default') setSizeState(saved);
      })
      .catch(() => {
        // Nothing saved, or storage unavailable: stay on the default.
      });
  }, []);

  const setSize = useCallback((next: TextSize) => {
    setSizeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Best effort: it still applies for the rest of this session.
    });
  }, []);

  const value = useMemo<TextSizeValue>(() => {
    const s = TEXT_SIZES.find((t) => t.id === size) ?? DEFAULT;
    return { size, scale: s.scale, fadedFloor: s.fadedFloor, setSize };
  }, [size, setSize]);

  return <TextSizeContext.Provider value={value}>{children}</TextSizeContext.Provider>;
}

export function useTextSize(): TextSizeValue {
  return useContext(TextSizeContext);
}
