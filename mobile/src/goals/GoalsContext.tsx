import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { getLocalRemindersEnabled, getReminderPermission, requestReminderPermission } from '../notifications/localReminders';
import { MAX_GOALS, type Goal, type GoalDraft } from './goals';
import {
  addGoal as addGoalApi,
  DEFAULT_HOUND_LEVEL,
  ensureStarterGoals,
  getHoundSettings,
  listGoals,
  removeGoal as removeGoalApi,
  saveHoundSettings,
  updateGoal as updateGoalApi,
  type HoundLevel,
} from './goalsApi';
import { updateHound } from './hound';

// Your goals and how hard the Hound reminds you about them. They live on
// the server (0097_goals.sql). Without a connection (the web preview, or
// a server that doesn't have 0097 yet) they live on this phone instead,
// so the app still works the same way.

// The two sliders that used to be in Settings. Read once, to seed a new
// user's starter goals with whatever they had picked.
const LEGACY_SLIDERS_KEY = 'hound:daily-goals';
const LOCAL_GOALS_KEY = 'hound:goals';
const LOCAL_LEVEL_KEY = 'hound:hound-level';

export const DEFAULT_STEPS_GOAL = 10_000;
export const DEFAULT_DISTANCE_GOAL_MI = 3;

function starterGoals(steps: number, distanceMi: number): Goal[] {
  return [
    { id: 'local-steps', metric: 'steps', period: 'day', target: steps, activity: null, label: null, sort: 0 },
    { id: 'local-distance', metric: 'distance_mi', period: 'day', target: distanceMi, activity: null, label: null, sort: 1 },
    { id: 'local-workouts', metric: 'workouts', period: 'week', target: 3, activity: null, label: null, sort: 2 },
  ];
}

async function readLegacySliders(): Promise<{ steps: number; distanceMi: number }> {
  try {
    const saved = await AsyncStorage.getItem(LEGACY_SLIDERS_KEY);
    const parsed = saved ? (JSON.parse(saved) as { stepsGoal?: number; distanceGoalMi?: number }) : {};
    return {
      steps: typeof parsed.stepsGoal === 'number' && parsed.stepsGoal > 0 ? parsed.stepsGoal : DEFAULT_STEPS_GOAL,
      distanceMi:
        typeof parsed.distanceGoalMi === 'number' && parsed.distanceGoalMi > 0 ? parsed.distanceGoalMi : DEFAULT_DISTANCE_GOAL_MI,
    };
  } catch {
    return { steps: DEFAULT_STEPS_GOAL, distanceMi: DEFAULT_DISTANCE_GOAL_MI };
  }
}

interface GoalsContextValue {
  goals: Goal[];
  loaded: boolean;
  houndLevel: HoundLevel;
  // The daily steps and distance goals, if you have them. Challenges and
  // other screens that just need "your daily target" read these.
  stepsGoal: number;
  distanceGoalMi: number;
  addGoal: (draft: GoalDraft) => Promise<void>;
  updateGoal: (id: string, patch: Partial<GoalDraft>) => Promise<void>;
  removeGoal: (id: string) => Promise<void>;
  setHoundLevel: (level: HoundLevel) => Promise<void>;
  refresh: () => Promise<void>;
}

const GoalsReactContext = createContext<GoalsContextValue | null>(null);

export function GoalsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [houndLevel, setLevel] = useState<HoundLevel>(DEFAULT_HOUND_LEVEL);
  // Whether goals are on this phone rather than the server.
  const localRef = useRef(!isSupabaseConfigured);

  const loadLocal = useCallback(async () => {
    localRef.current = true;
    try {
      const [savedGoals, savedLevel] = await Promise.all([
        AsyncStorage.getItem(LOCAL_GOALS_KEY),
        AsyncStorage.getItem(LOCAL_LEVEL_KEY),
      ]);
      if (savedGoals) {
        setGoals(JSON.parse(savedGoals) as Goal[]);
      } else {
        const { steps, distanceMi } = await readLegacySliders();
        setGoals(starterGoals(steps, distanceMi));
      }
      setLevel((savedLevel as HoundLevel | null) ?? DEFAULT_HOUND_LEVEL);
    } catch {
      setGoals(starterGoals(DEFAULT_STEPS_GOAL, DEFAULT_DISTANCE_GOAL_MI));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured || !userId) {
      await loadLocal();
      setLoaded(true);
      return;
    }
    try {
      const { steps, distanceMi } = await readLegacySliders();
      await ensureStarterGoals(steps, distanceMi);
      const [list, settings] = await Promise.all([listGoals(userId), getHoundSettings(userId)]);
      localRef.current = false;
      setGoals(list);
      let level = settings.level;
      // Someone who had turned the old "Daily reminders" switch off keeps
      // their reminders off.
      if (!settings.saved && !(await getLocalRemindersEnabled())) {
        level = 'off';
        saveHoundSettings(userId, { level }).catch(() => {});
      }
      setLevel(level);
    } catch {
      await loadLocal();
    }
    setLoaded(true);
  }, [userId, loadLocal]);

  useEffect(() => {
    setLoaded(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (loaded) updateHound({ userId: localRef.current ? null : userId, level: houndLevel });
  }, [loaded, userId, houndLevel]);

  const saveLocal = useCallback((next: Goal[]) => {
    setGoals(next);
    AsyncStorage.setItem(LOCAL_GOALS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const addGoal = useCallback(
    async (draft: GoalDraft) => {
      if (goals.length >= MAX_GOALS) throw new Error(`You can have up to ${MAX_GOALS} goals at a time.`);
      const sort = goals.reduce((max, g) => Math.max(max, g.sort), -1) + 1;
      if (localRef.current || !userId) {
        saveLocal([...goals, { ...draft, id: `local-${Date.now()}`, sort }]);
        return;
      }
      const created = await addGoalApi(userId, draft, sort);
      setGoals((cur) => [...cur, created]);
    },
    [goals, userId, saveLocal],
  );

  const updateGoal = useCallback(
    async (id: string, patch: Partial<GoalDraft>) => {
      if (localRef.current || !userId) {
        saveLocal(goals.map((g) => (g.id === id ? { ...g, ...patch } : g)));
        return;
      }
      await updateGoalApi(id, patch);
      setGoals((cur) => cur.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },
    [goals, userId, saveLocal],
  );

  const removeGoal = useCallback(
    async (id: string) => {
      if (localRef.current || !userId) {
        saveLocal(goals.filter((g) => g.id !== id));
        return;
      }
      await removeGoalApi(id);
      setGoals((cur) => cur.filter((g) => g.id !== id));
    },
    [goals, userId, saveLocal],
  );

  const setHoundLevel = useCallback(
    async (level: HoundLevel) => {
      // Choosing a level is the moment to ask for notifications, if they
      // haven't been answered yet.
      if (level !== 'off' && (await getReminderPermission()) === 'undetermined') {
        await requestReminderPermission().catch(() => false);
      }
      if (localRef.current || !userId) {
        AsyncStorage.setItem(LOCAL_LEVEL_KEY, level).catch(() => {});
      } else {
        await saveHoundSettings(userId, { level });
      }
      setLevel(level);
    },
    [userId],
  );

  const value = useMemo<GoalsContextValue>(() => {
    const steps = goals.find((g) => g.metric === 'steps' && g.period === 'day' && !g.label);
    const distance = goals.find((g) => g.metric === 'distance_mi' && g.period === 'day' && !g.label);
    return {
      goals,
      loaded,
      houndLevel,
      stepsGoal: steps?.target ?? DEFAULT_STEPS_GOAL,
      distanceGoalMi: distance?.target ?? DEFAULT_DISTANCE_GOAL_MI,
      addGoal,
      updateGoal,
      removeGoal,
      setHoundLevel,
      refresh,
    };
  }, [goals, loaded, houndLevel, addGoal, updateGoal, removeGoal, setHoundLevel, refresh]);

  return <GoalsReactContext.Provider value={value}>{children}</GoalsReactContext.Provider>;
}

export function useGoals(): GoalsContextValue {
  const ctx = useContext(GoalsReactContext);
  if (!ctx) throw new Error('useGoals() must be called within a GoalsProvider');
  return ctx;
}
