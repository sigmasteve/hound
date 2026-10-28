import React, { useCallback, useMemo, useState } from 'react';
import type { HealthSnapshot } from '../health/types';
import { GoalsCard, type GoalHistoryView } from '../components/GoalsCard';
import { GoalHistoryCard } from '../components/GoalHistoryCard';
import { dayKeyOffset, endOfDay, goalDaySummary, goalWeekProgress, localDayKey, weekStart, type GoalDaySummary } from '../goals/goals';
import { HISTORY_WEEKS, useGoalDayHistory } from '../goals/useGoalDayHistory';

type CardProps = Omit<React.ComponentProps<typeof GoalsCard>, 'history'>;

// What the Goals tile opens: the goals card with the week strip under its
// streak line, a past day's numbers when one is tapped, and "Earlier",
// the four-week grid (GoalHistoryCard). Keeps the history and which view
// is up; both reset when the sheet closes, since it unmounts.
export function GoalsSheet({ snap, ...card }: CardProps & { snap: HealthSnapshot | null }) {
  const todayKey = localDayKey(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // The last day the week strip shows: today, until a day outside the
  // strip is picked from the grid; then the strip moves so that day sits
  // in the middle (or as near as today allows), and stays put while
  // neighbouring days are tapped.
  const [windowEnd, setWindowEnd] = useState(todayKey);
  const [earlier, setEarlier] = useState(false);
  const goals = useMemo(() => card.progress.map((p) => p.goal), [card.progress]);
  const hasDaily = goals.some((g) => g.period === 'day');
  const hasWeekly = goals.some((g) => g.period === 'week');
  const history = useGoalDayHistory(snap, hasDaily || hasWeekly);

  const select = useCallback(
    (day: string | null) => {
      if (day === todayKey) day = null;
      setSelectedDay(day);
      if (day === null) {
        setWindowEnd(todayKey);
        return;
      }
      const end = endOfDay(day);
      const windowStart = dayKeyOffset(endOfDay(windowEnd), -6);
      if (day < windowStart || day > windowEnd) {
        const centred = dayKeyOffset(end, 3);
        setWindowEnd(centred < todayKey ? centred : todayKey);
      }
    },
    [todayKey, windowEnd],
  );

  // One summary per day from the start of the history through today;
  // today's comes from the live progress, which is fresher than the
  // phone's per-day history.
  const summaries = useMemo(() => {
    const map = new Map<string, GoalDaySummary>();
    if (!history) return map;
    for (let i = 0; i < HISTORY_WEEKS * 7; i++) {
      const day = dayKeyOffset(history.since, i);
      if (day > todayKey) break;
      if (day === todayKey) {
        const progress = card.progress.filter((p) => p.goal.period === 'day');
        map.set(day, { day, progress, done: progress.filter((p) => p.done).length, total: progress.length, hasData: true });
      } else {
        map.set(day, goalDaySummary(goals, day, history.days, history.workouts));
      }
    }
    return map;
  }, [history, goals, card.progress, todayKey]);

  const week = useMemo(() => {
    const out: GoalDaySummary[] = [];
    const end = endOfDay(windowEnd);
    for (let i = 6; i >= 0; i--) {
      const day = dayKeyOffset(end, -i);
      out.push(summaries.get(day) ?? (history ? goalDaySummary(goals, day, history.days, history.workouts) : { day, progress: [], done: 0, total: 0, hasData: false }));
    }
    return out;
  }, [summaries, windowEnd, history, goals]);

  const weekly = useMemo(() => {
    if (!history) return [];
    const live = snap ? { stepsToday: snap.stepsToday, distanceTodayMi: snap.distanceTodayMi } : null;
    const thisMonday = weekStart();
    return goals
      .filter((g) => g.period === 'week')
      .map((goal) => ({
        goal,
        weeks: Array.from({ length: HISTORY_WEEKS }, (_, i) => {
          const monday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7 * i);
          return { monday, progress: goalWeekProgress(goal, monday, history.days, history.workouts, live) };
        }),
      }));
  }, [history, goals, snap]);

  if (earlier && history) {
    return (
      <GoalHistoryCard
        since={history.since}
        summaries={summaries}
        todayKey={todayKey}
        shieldDay={history.shieldDay}
        bestStreak={card.streak?.best ?? null}
        weekly={weekly}
        onSelectDay={(day) => {
          select(day);
          setEarlier(false);
        }}
        onBack={() => setEarlier(false)}
      />
    );
  }

  const view: GoalHistoryView | null =
    history && hasDaily
      ? {
          week,
          todayKey,
          shieldDay: history.shieldDay,
          selected: selectedDay ? (summaries.get(selectedDay) ?? { day: selectedDay, progress: [], done: 0, total: 0, hasData: false }) : null,
          onSelect: select,
          onEarlier: () => setEarlier(true),
        }
      : null;

  return <GoalsCard {...card} history={view} />;
}
