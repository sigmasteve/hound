import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildPalette, type Palette, type ThemeMode } from './tokens';
import { createTextStyles } from './text';

const STORAGE_KEY = 'hound:theme-mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: Palette;
  text: ReturnType<typeof createTextStyles>;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeReactContext = createContext<ThemeContextValue | null>(null);

// Dark has been this app's only look since before Light mode existed —
// the toggle in Settings is what actually changes this, once its
// persisted choice (if any) loads below.
const DEFAULT_MODE: ThemeMode = 'dark';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);

  // Reads whatever the Settings toggle last wrote, once, on mount — same
  // "start on the safe default, upgrade once the async read resolves"
  // shape as this app's session-restore and highlighted-challenge fetches
  // elsewhere use, so a cold start never flashes the wrong theme long
  // enough to matter, and a device with nothing stored yet (or storage
  // that throws) just stays on DEFAULT_MODE rather than erroring.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') setModeState(saved);
      })
      .catch(() => {
        // No persisted preference, or storage unavailable — stay on the
        // default rather than guessing.
      });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Best-effort — the toggle still works for the rest of this session
      // even if the choice doesn't survive a restart.
    });
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'light' ? 'dark' : 'light');
  }, [mode, setMode]);

  const colors = useMemo(() => buildPalette(mode), [mode]);
  const text = useMemo(() => createTextStyles(colors), [colors]);
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, colors, text, setMode, toggleMode }),
    [mode, colors, text, setMode, toggleMode],
  );

  return <ThemeReactContext.Provider value={value}>{children}</ThemeReactContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeReactContext);
  if (!ctx) throw new Error('useTheme() must be called within a ThemeProvider');
  return ctx;
}
