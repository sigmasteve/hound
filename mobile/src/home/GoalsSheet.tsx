import React, { useMemo, useState } from 'react';
import type { HealthSnapshot } from '../health/types';
import { GoalsCard, type GoalHistoryView } from '../components/GoalsCard';
import { GoalHistoryCard } from '../components/GoalHistoryCard';
import { dayKeyOffset, goalDaySummary, goalWeekProgress, localDayKey, weekStart, type GoalDaySummary } from '../goals/goals';
import { HISTORY_WEEKS, useGoalDayHistory } from '../goals/useGoalDayHistory';

type CardProps = Omit<React.ComponentProps<typeof GoalsCard>, 'history'>;

// What the Goals tile opens: the goals card with the week strip under its
// streak line, a past day's numbers when one is tapped, and "Earlier",
// the four-week grid (GoalHistoryCard). Keeps the history and which view
// is up; both reset when the sheet closes, since it unmounts.
export function GoalsSheet({ snap, ...card }: CardProps & { snap: HealthSnapshot | null }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(false);
  const goals = useMemo(() => card.progress.map((p) => p.goal), [card.progress]);
  const hasDaily = goals.some((g) => g.period === 'day');
  const hasWeekly = goals.some((g) => g.period === 'week');
  const history = useGoalDayHistory(snap, hasDaily || hasWeekly);
  const todayKey = localDayKey(new Date());

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
    for (let i = 6; i >= 0; i--) {
      const day = dayKeyOffset(new Date(), -i);
      out.push(summaries.get(day) ?? { day, progress: [], done: 0, total: 0, hasData: false });
    }
    return out;
  }, [summaries]);

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
          setSelectedDay(day === todayKey ? null : day);
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
          onSelect: setSelectedDay,
          onEarlier: () => setEarlier(true),
        }
      : null;

  return <GoalsCard {...card} history={view} />;
}
