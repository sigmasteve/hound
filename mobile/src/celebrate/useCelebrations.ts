import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CheckCircleIcon, WarningCircleIcon } from 'phosphor-react-native';
import { goalTitle, localDayKey, type GoalProgress } from '../goals/goals';
import { goalsEarned, type GoalStreak } from '../goals/goalStreakApi';
import type { ToastMessage } from '../components/Toast';
import { buzz, playSound } from './feedback';
import { getCelebratePrefs } from './prefs';
import { allDoneMessage, manyDoneMessage, missedMessage, oneDoneMessage } from './messages';

// Today's celebrations, each once per day on this phone, including for
// what happened while Hound was closed (the next open catches it):
//   - every daily goal done: big confetti, the party horn, a success buzz
//     and the "All goals done!" card;
//   - any other goal done: a little confetti, a pop, a tap and a toast;
//   - the day after a missed goal day that broke a streak (or that a
//     Streak Shield will cover): "Oh snap…", a sad trombone and a warning
//     buzz.
// Cards go through Today's one-pop-up-per-open rule (takePopup); when
// that's used, they become a toast.

export interface CelebrationCard {
  kind: 'allDone' | 'missed';
  title: string;
  body: string;
}

const doneKey = (userId: string) => `celebrate:done:${userId}`;
const streakKey = (userId: string) => `celebrate:streak:${userId}`;
const missedKey = (userId: string) => `celebrate:missed:${userId}`;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export function useCelebrations({
  userId,
  progress,
  streak,
  houndName,
  takePopup,
  pushToast,
  yesterdayEarned = false,
}: {
  userId: string | null | undefined;
  progress: GoalProgress[] | null;
  streak: GoalStreak | null;
  houndName: string;
  // Whether the phone says yesterday's goals were met (null: not known
  // yet). A streak at 0 then isn't a miss, it's a claim the server
  // hasn't had yet (useGoalStreak's catch-up) — no "Oh snap" for that.
  yesterdayEarned?: boolean | null;
  takePopup: () => boolean;
  pushToast: (t: ToastMessage) => void;
}) {
  const [confetti, setConfetti] = useState<{ big: boolean; key: number } | null>(null);
  const [card, setCard] = useState<CelebrationCard | null>(null);
  // One check at a time; a check that arrives meanwhile runs after it.
  const running = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ progress, streak, houndName, takePopup, pushToast, yesterdayEarned });
  latest.current = { progress, streak, houndName, takePopup, pushToast, yesterdayEarned };

  const celebrateGoals = useCallback(async (uid: string) => {
    const { progress: p, streak: s, houndName: name } = latest.current;
    if (!p || p.length === 0 || !s) return;
    const today = localDayKey(new Date());
    const stored = await readJson<{ day: string; ids: string[]; allDone: boolean }>(doneKey(uid));
    const seen = stored?.day === today ? stored : { day: today, ids: [], allDone: false };
    const done = p.filter((g) => g.done);
    const fresh = done.filter((g) => !seen.ids.includes(g.goal.id));
    const allDone = goalsEarned(p).day;
    if (fresh.length === 0 && (!allDone || seen.allDone)) return;
    writeJson(doneKey(uid), { day: today, ids: done.map((g) => g.goal.id), allDone: seen.allDone || allDone });

    const { tone } = await getCelebratePrefs();
    if (allDone && !seen.allDone) {
      setConfetti({ big: true, key: Date.now() });
      playSound('party');
      buzz('success');
      const message = allDoneMessage(tone, name, s.hitToday ? s.streak : s.streak + 1);
      if (latest.current.takePopup()) setCard({ kind: 'allDone', ...message });
      else latest.current.pushToast({ id: `all-done-${today}`, text: message.title, Icon: CheckCircleIcon });
      return;
    }
    setConfetti({ big: false, key: Date.now() });
    playSound('pop');
    buzz('light');
    latest.current.pushToast({
      id: `goal-done-${Date.now()}`,
      text: fresh.length === 1 ? oneDoneMessage(tone, goalTitle(fresh[0].goal)) : manyDoneMessage(tone, fresh.length),
      Icon: CheckCircleIcon,
    });
  }, []);

  const checkMissed = useCallback(async (uid: string) => {
    const { progress: p, streak: s, houndName: name, yesterdayEarned: earnedYesterday } = latest.current;
    if (!p || !s || !p.some((g) => g.goal.period === 'day')) return;
    // Not yet known whether yesterday was earned, or it was and the
    // server hasn't recorded it yet: wait, without noting today's streak,
    // so the check runs properly once the claim has landed.
    if (earnedYesterday === null) return;
    if (earnedYesterday && s.streak === 0 && !s.hitToday) return;
    const today = localDayKey(new Date());
    const before = await readJson<{ day: string; streak: number }>(streakKey(uid));
    writeJson(streakKey(uid), { day: today, streak: s.streak });
    if ((await AsyncStorage.getItem(missedKey(uid)).catch(() => null)) === today) return;

    const shielded = s.shieldCovering && !s.hitToday;
    const broken = !!before && before.day !== today && before.streak > 0 && s.streak === 0 && !s.hitToday;
    if (!shielded && !broken) return;
    await AsyncStorage.setItem(missedKey(uid), today).catch(() => {});

    const { tone } = await getCelebratePrefs();
    const message = missedMessage(tone, name, shielded ? s.streak : (before?.streak ?? 0), shielded);
    playSound('womp');
    buzz('warning');
    if (latest.current.takePopup()) setCard({ kind: 'missed', ...message });
    else latest.current.pushToast({ id: `missed-${today}`, text: `${message.title} ${message.body}`, Icon: WarningCircleIcon });
  }, []);

  useEffect(() => {
    if (!userId || !progress || !streak) return;
    running.current = running.current
      .then(() => checkMissed(userId))
      .then(() => celebrateGoals(userId))
      .catch(() => {});
  }, [userId, progress, streak, yesterdayEarned, checkMissed, celebrateGoals]);

  return {
    confetti,
    clearConfetti: useCallback(() => setConfetti(null), []),
    card,
    closeCard: useCallback(() => {
      setCard(null);
      setConfetti(null);
    }, []),
  };
}
