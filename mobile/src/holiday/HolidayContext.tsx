import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured } from '../lib/supabase';
import { localDayKey } from '../water/water';
import { getHolidayTheme, holidayCountdownTap, holidayThemeSeen, type HolidayRun } from './holidayApi';
import { HOLIDAY_THEMES, holidayPill, type HolidayTheme } from './holidays';

// The holiday theme showing on Today (0184), for the decorations in
// HolidayDecor.tsx. Today wraps itself in HolidayProvider, which asks
// for the theme on the phone's own day when Today opens and whenever the
// app comes back to the front, and notes once a day that it was seen.

export interface HolidayValue {
  run: HolidayRun;
  theme: HolidayTheme;
  pill: string;
  // The falling snow / leaves / confetti: on for this run, and not
  // turned off in Settings.
  effects: boolean;
  // False with Reduce Motion on: everything stays still.
  motion: boolean;
  onPillTap: () => void;
}

const HolidayCtx = createContext<HolidayValue | null>(null);

// Null when no theme is on (or outside Today).
export function useHoliday(): HolidayValue | null {
  return useContext(HolidayCtx);
}

// Settings → Holiday decorations: this person's own switch for the
// falling effects, shared with Today as it changes.
const EFFECTS_KEY = 'hound:holiday-effects';
let effectsOn = true;
let effectsLoaded = false;
const listeners = new Set<(on: boolean) => void>();

function loadEffects(): Promise<boolean> {
  if (effectsLoaded) return Promise.resolve(effectsOn);
  return AsyncStorage.getItem(EFFECTS_KEY)
    .then((v) => {
      effectsOn = v !== 'off';
      effectsLoaded = true;
      return effectsOn;
    })
    .catch(() => effectsOn);
}

export function useHolidayEffectsPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(effectsOn);
  useEffect(() => {
    loadEffects().then(setOn);
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  const set = useCallback((next: boolean) => {
    effectsOn = next;
    effectsLoaded = true;
    listeners.forEach((l) => l(next));
    AsyncStorage.setItem(EFFECTS_KEY, next ? 'on' : 'off').catch(() => {
      // Best effort: it still applies until the app restarts.
    });
  }, []);
  return [on, set];
}

const SEEN_KEY = 'hound:holiday-seen';

export function HolidayProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<HolidayRun | null>(null);
  const [day, setDay] = useState(localDayKey());
  const [prefOn] = useHolidayEffectsPref();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    const today = localDayKey();
    setDay(today);
    getHolidayTheme(today)
      .then(setRun)
      .catch(() => {
        // Never break Today: no theme, no decorations.
      });
  }, []);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  // Once a day a person (and again if they change the effects switch).
  useEffect(() => {
    if (!run) return;
    const mark = `${run.theme}:${day}:${prefOn ? 'on' : 'off'}`;
    AsyncStorage.getItem(SEEN_KEY)
      .then((last) => {
        if (last === mark) return;
        return holidayThemeSeen(run.theme, day, !prefOn).then(() => AsyncStorage.setItem(SEEN_KEY, mark));
      })
      .catch(() => {});
  }, [run, day, prefOn]);

  const value = useMemo<HolidayValue | null>(() => {
    if (!run) return null;
    const theme = HOLIDAY_THEMES[run.theme];
    const pill = holidayPill(run.theme, day);
    return {
      run,
      theme,
      pill,
      effects: run.effects && prefOn,
      motion: !reduceMotion,
      onPillTap: () => {
        holidayCountdownTap(run.theme, day).catch(() => {});
        Alert.alert(`${theme.emoji} ${pill}`, theme.note);
      },
    };
  }, [run, day, prefOn, reduceMotion]);

  return <HolidayCtx.Provider value={value}>{children}</HolidayCtx.Provider>;
}

// For previews: a theme without asking the server.
export function HolidayPreviewProvider({ value, children }: { value: HolidayValue | null; children: React.ReactNode }) {
  return <HolidayCtx.Provider value={value}>{children}</HolidayCtx.Provider>;
}
