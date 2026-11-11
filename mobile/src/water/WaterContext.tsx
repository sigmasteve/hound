import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { HAS_HEALTH_0_12 } from '../health/nativeBuild';
import { isSupabaseConfigured } from '../lib/supabase';
import { updateHound } from '../goals/hound';
import { setWaterSnapshot } from './waterSnapshot';
import { dayKeyBefore, DEFAULT_WATER_GOAL, localDayKey, type WaterEntry, type WaterGoal } from './water';
import {
  claimWaterDay,
  getWaterGoal,
  listWaterDays,
  listWaterLog,
  logWater,
  removeWaterEntry,
  removeWaterGoal,
  saveWaterGoal,
} from './waterApi';

// The water tracker's state, for Today's water row and sheet, the Goals
// screen, the Hound's reminders, the Yard's bowl and the challenges that
// tick on water days. A day's water is what you tapped in Hound plus what
// other apps put in Health that day.

// How far back the week strip and the four-week grid look.
export const WATER_HISTORY_DAYS = 28;

export interface WaterState {
  // False before 0153 has run: nothing about water shows.
  available: boolean;
  loaded: boolean;
  goal: WaterGoal | null;
  // Today, in ml: taps plus Health.
  todayMl: number;
  healthTodayMl: number;
  // Today's taps, oldest first.
  entries: WaterEntry[];
  // Each day's total (taps plus Health), by local day key.
  byDay: Map<string, number>;
  met: boolean;
  // Goes up by one on every tap, so the glasses know to pour.
  pours: number;
  // The day just counted as a water day, for Home to check badges.
  claimedDay: string | null;
  // The "Track your water?" offer on Today's Goals tile: true once it's
  // been turned down (×, or setup saved without water) on this phone.
  offerDismissed: boolean;
  dismissOffer(): void;
  add(ml?: number): Promise<WaterEntry | null>;
  remove(id: string): Promise<void>;
  setGoal(goal: WaterGoal): Promise<void>;
  removeGoal(): Promise<void>;
  refresh(): Promise<void>;
}

const WaterContext = createContext<WaterState | null>(null);

const LOCAL_GOAL_KEY = 'water:goal';
const LOCAL_LOG_KEY = 'water:log';

let localIds = 0;

export function WaterProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const health = useHealthProvider();
  const remote = isSupabaseConfigured && !!userId;

  const [available, setAvailable] = useState(!isSupabaseConfigured);
  const [loaded, setLoaded] = useState(false);
  const [goal, setGoalState] = useState<WaterGoal | null>(null);
  const [log, setLog] = useState<WaterEntry[]>([]);
  const [healthByDay, setHealthByDay] = useState<Map<string, number>>(new Map());
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [claimedDay, setClaimedDay] = useState<string | null>(null);
  const [pours, setPours] = useState(0);
  const [today, setToday] = useState(localDayKey());
  // Unknown (true) until read, so the offer never flashes up.
  const [offerDismissed, setOfferDismissed] = useState(true);
  const offerKey = `water:offer-dismissed:${userId ?? 'local'}`;
  useEffect(() => {
    setOfferDismissed(true);
    AsyncStorage.getItem(offerKey)
      .then((v) => setOfferDismissed(v === '1'))
      .catch(() => {});
  }, [offerKey]);
  const dismissOffer = useCallback(() => {
    setOfferDismissed(true);
    AsyncStorage.setItem(offerKey, '1').catch(() => {});
  }, [offerKey]);

  const undoneEarly = useRef(new Set<string>());
  const goalRef = useRef(goal);
  goalRef.current = goal;

  const readHealth = useCallback(async () => {
    if (!health.getDailyWaterSince) return;
    const since = new Date();
    since.setDate(since.getDate() - (WATER_HISTORY_DAYS - 1));
    try {
      setHealthByDay(await health.getDailyWaterSince(since));
    } catch {
      // Nothing from Health this time.
    }
  }, [health]);

  const refresh = useCallback(async () => {
    setToday(localDayKey());
    const since = dayKeyBefore(WATER_HISTORY_DAYS - 1);
    if (!remote) {
      try {
        const [g, l] = await Promise.all([AsyncStorage.getItem(LOCAL_GOAL_KEY), AsyncStorage.getItem(LOCAL_LOG_KEY)]);
        setGoalState(g ? (JSON.parse(g) as WaterGoal) : null);
        const entries = l ? (JSON.parse(l) as { id: string; day: string; ml: number; at: string }[]) : [];
        setLog(entries.filter((e) => e.day >= since).map((e) => ({ ...e, at: new Date(e.at) })));
      } catch {
        // Start empty.
      }
      setAvailable(true);
      setLoaded(true);
      return;
    }
    try {
      const [g, l, days] = await Promise.all([getWaterGoal(userId!), listWaterLog(userId!, since), listWaterDays(userId!, dayKeyBefore(35))]);
      setGoalState(g);
      setLog(l);
      setClaimed(new Set(days));
      setAvailable(true);
      if (g) await readHealth();
    } catch {
      // Before 0153, or offline: keep what's shown. Water stays hidden
      // until it's been read once.
    }
    setLoaded(true);
  }, [remote, userId, readHealth]);

  useEffect(() => {
    setLoaded(false);
    setGoalState(null);
    setLog([]);
    setClaimed(new Set());
    refresh();
  }, [refresh]);

  // Back in front: a new day, or water another app logged meanwhile.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Android, from the 0.12.0 build: someone who set a water goal before
  // Health Connect's water could be asked for is asked once now, so
  // water from other apps counts for them too (iPhone asked at the time).
  const hasGoal = goal !== null;
  const waterAsked = useRef(false);
  useEffect(() => {
    if (waterAsked.current || !loaded || !hasGoal || Platform.OS !== 'android' || !HAS_HEALTH_0_12 || !health.requestWaterAccess) return;
    const key = 'water:health-connect-asked';
    let cancelled = false;
    AsyncStorage.getItem(key)
      .then(async (asked) => {
        if (asked || cancelled || waterAsked.current) return;
        waterAsked.current = true;
        await AsyncStorage.setItem(key, '1');
        await health.requestWaterAccess!().catch(() => false);
        if (!cancelled) readHealth();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, hasGoal, health, readHealth]);

  const saveLocalLog = (entries: WaterEntry[]) => {
    AsyncStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(entries)).catch(() => {});
  };

  const add = useCallback(
    async (ml?: number): Promise<WaterEntry | null> => {
      const g = goalRef.current ?? DEFAULT_WATER_GOAL;
      const amount = Math.round(ml ?? g.glassMl);
      const day = localDayKey();
      const temp: WaterEntry = { id: `local-${++localIds}`, day, ml: amount, at: new Date() };
      // Shown straight away, so the glass pours on the tap.
      setToday(day);
      setLog((cur) => {
        const next = [...cur, temp];
        if (!remote) saveLocalLog(next);
        return next;
      });
      setPours((n) => n + 1);
      if (!remote) return temp;
      try {
        const id = await logWater(day, amount);
        const saved = { ...temp, id };
        // Undone before the server answered: take it back off there too.
        if (undoneEarly.current.delete(temp.id)) {
          removeWaterEntry(id).catch(() => {});
          return null;
        }
        setLog((cur) => cur.map((e) => (e.id === temp.id ? saved : e)));
        return saved;
      } catch (e) {
        undoneEarly.current.delete(temp.id);
        setLog((cur) => cur.filter((x) => x.id !== temp.id));
        Alert.alert('Couldn’t log that', e instanceof Error ? e.message : 'Try again in a moment.');
        return null;
      }
    },
    [remote],
  );

  const remove = useCallback(
    async (id: string) => {
      let removed: WaterEntry | undefined;
      setLog((cur) => {
        removed = cur.find((e) => e.id === id);
        const next = cur.filter((e) => e.id !== id);
        if (!remote) saveLocalLog(next);
        return next;
      });
      if (!remote) return;
      if (id.startsWith('local-')) {
        undoneEarly.current.add(id);
        return;
      }
      try {
        await removeWaterEntry(id);
      } catch (e) {
        if (removed) {
          const back = removed;
          setLog((cur) => [...cur, back].sort((a, b) => a.at.getTime() - b.at.getTime()));
        }
        Alert.alert('Couldn’t remove that', e instanceof Error ? e.message : 'Try again in a moment.');
      }
    },
    [remote],
  );

  const setGoal = useCallback(
    async (next: WaterGoal) => {
      const first = goalRef.current === null;
      const before = goalRef.current;
      // Asked below, so the one-time ask above stays quiet.
      if (first) waterAsked.current = true;
      setGoalState(next);
      try {
        if (remote) await saveWaterGoal(userId!, next);
        else await AsyncStorage.setItem(LOCAL_GOAL_KEY, JSON.stringify(next));
      } catch (e) {
        setGoalState(before);
        throw e;
      }
      // Asked once, when the goal is first set, so water from other apps
      // counts too.
      if (first && health.requestWaterAccess) {
        if (HAS_HEALTH_0_12) AsyncStorage.setItem('water:health-connect-asked', '1').catch(() => {});
        await health.requestWaterAccess().catch(() => false);
        readHealth();
      }
    },
    [remote, userId, health, readHealth],
  );

  const removeGoal = useCallback(async () => {
    const before = goalRef.current;
    setGoalState(null);
    try {
      if (remote) await removeWaterGoal(userId!);
      else await AsyncStorage.removeItem(LOCAL_GOAL_KEY);
    } catch (e) {
      setGoalState(before);
      throw e;
    }
  }, [remote, userId]);

  const byDay = useMemo(() => {
    const out = new Map<string, number>();
    for (const [day, ml] of healthByDay) out.set(day, ml);
    for (const e of log) out.set(e.day, (out.get(e.day) ?? 0) + e.ml);
    return out;
  }, [log, healthByDay]);

  const entries = useMemo(() => log.filter((e) => e.day === today), [log, today]);
  const todayMl = byDay.get(today) ?? 0;
  const healthTodayMl = healthByDay.get(today) ?? 0;
  const met = !!goal && todayMl >= goal.targetMl;

  // Water days: today once it's met, and any day in the last week that
  // was met and not yet counted (Hound closed when it happened).
  const claiming = useRef(new Set<string>());
  useEffect(() => {
    if (!remote || !goal || !available) return;
    const weekAgo = dayKeyBefore(7);
    for (const [day, ml] of byDay) {
      if (day < weekAgo || day > today || ml < goal.targetMl) continue;
      if (claimed.has(day) || claiming.current.has(day)) continue;
      claiming.current.add(day);
      claimWaterDay(day)
        .then((isNew) => {
          setClaimed((cur) => new Set(cur).add(day));
          if (isNew) setClaimedDay(day);
        })
        .catch(() => {})
        .finally(() => claiming.current.delete(day));
    }
  }, [remote, goal, available, byDay, claimed, today]);

  useEffect(() => {
    setWaterSnapshot({ goal, byDay });
  }, [goal, byDay]);

  // The Hound's reminders mention water, and the sip reminders follow it.
  const lastAt = entries.length > 0 ? entries[entries.length - 1].at.getTime() : null;
  useEffect(() => {
    if (!loaded) return;
    updateHound({ water: goal ? { ml: todayMl, day: today, goal, lastAt } : null });
  }, [loaded, goal, todayMl, today, lastAt]);

  const value = useMemo<WaterState>(
    () => ({
      available,
      loaded,
      goal,
      todayMl,
      healthTodayMl,
      entries,
      byDay,
      met,
      pours,
      claimedDay,
      offerDismissed,
      dismissOffer,
      add,
      remove,
      setGoal,
      removeGoal,
      refresh,
    }),
    [available, loaded, goal, todayMl, healthTodayMl, entries, byDay, met, pours, claimedDay, offerDismissed, dismissOffer, add, remove, setGoal, removeGoal, refresh],
  );

  return <WaterContext.Provider value={value}>{children}</WaterContext.Provider>;
}

export function useWater(): WaterState {
  const ctx = useContext(WaterContext);
  if (!ctx) throw new Error('useWater() must be called within a WaterProvider');
  return ctx;
}
