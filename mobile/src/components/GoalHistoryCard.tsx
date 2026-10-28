import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { dayKeyOffset, endOfDay, formatAmount, goalTitle, localDayKey, type Goal, type GoalDaySummary, type GoalProgress } from '../goals/goals';
import { HISTORY_WEEKS } from '../goals/useGoalDayHistory';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// "Earlier" on the Goals sheet: the last four weeks as a grid, one cell
// a day, coloured by how many daily goals were hit, and each weekly goal
// as one bar per week. Tap a day to go back to the card showing it.
export function GoalHistoryCard({
  since,
  summaries,
  todayKey,
  shieldDay,
  bestStreak,
  weekly,
  onSelectDay,
  onBack,
}: {
  // The Monday the grid starts on (historyStart).
  since: Date;
  summaries: Map<string, GoalDaySummary>;
  todayKey: string;
  shieldDay: string | null;
  bestStreak: number | null;
  // Each weekly goal, newest week first.
  weekly: { goal: Goal; weeks: { monday: Date; progress: GoalProgress }[] }[];
  onSelectDay: (day: string) => void;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const weeks = useMemo(() => {
    const rows: string[][] = [];
    for (let w = 0; w < HISTORY_WEEKS; w++) {
      rows.push(Array.from({ length: 7 }, (_, i) => dayKeyOffset(since, w * 7 + i)));
    }
    return rows;
  }, [since]);

  let hit = 0;
  let counted = 0;
  for (const s of summaries.values()) {
    if (!s.hasData || s.day > todayKey) continue;
    counted++;
    if (s.total > 0 && s.done === s.total) hit++;
  }
  const hasDaily = [...summaries.values()].some((s) => s.total > 0);

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to today's goals">
        <CaretLeftIcon size={14} color={colors.accentActive} weight="bold" />
        <Text style={styles.backText}>Goals</Text>
      </Pressable>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>Last {HISTORY_WEEKS} weeks</Text>
        <Text style={styles.subtitle}>
          {hasDaily ? `${hit} of ${counted} days hit` : 'No daily goals yet'}
          {bestStreak ? ` · best streak ${bestStreak}` : ''}
        </Text>
      </View>

      {hasDaily && (
        <>
          <View style={styles.grid}>
            <View style={styles.gridRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={i} style={styles.weekday}>
                  {w}
                </Text>
              ))}
            </View>
            {weeks.map((row, i) => (
              <View key={i} style={styles.gridRow}>
                {row.map((day) => {
                  const s = summaries.get(day);
                  const future = day > todayKey;
                  const allDone = !!s && s.total > 0 && s.done === s.total;
                  const shielded = !allDone && day === shieldDay && !future;
                  const ratio = s && s.total > 0 ? s.done / s.total : 0;
                  const cellStyle = future
                    ? styles.cellFuture
                    : !s || !s.hasData
                      ? styles.cellNoData
                      : allDone
                        ? { backgroundColor: colors.green }
                        : shielded
                          ? { backgroundColor: colors.accent }
                          : ratio >= 0.5
                            ? { backgroundColor: withAlpha(colors.accent, 0.45) }
                            : ratio > 0
                              ? { backgroundColor: withAlpha(colors.accent, 0.2) }
                              : styles.cellNone;
                  const textStyle = future
                    ? { color: withAlpha(colors.text, 0.25) }
                    : allDone || shielded
                      ? { color: colors.bg, fontFamily: font.headingSemibold }
                      : !s || !s.hasData
                        ? { color: withAlpha(colors.text, 0.3) }
                        : { color: withAlpha(colors.text, 0.75) };
                  const n = endOfDay(day).getDate();
                  return (
                    <Pressable
                      key={day}
                      disabled={future}
                      onPress={() => onSelectDay(day)}
                      style={({ pressed }) => [styles.cell, cellStyle, day === todayKey && styles.cellToday, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${endOfDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}: ${
                        future ? 'not yet' : allDone ? 'all goals done' : shielded ? 'covered by a shield' : s?.hasData ? `${s.done} of ${s.total} goals done` : 'no data'
                      }`}
                    >
                      <Text style={[styles.cellText, textStyle]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            <Legend color={colors.green} label="All goals" />
            <Legend color={withAlpha(colors.accent, 0.45)} label="Some" />
            <Legend color={colors.accent} label="Shield" />
            <Legend color={withAlpha(colors.text, 0.08)} label="None" />
          </View>
          <Text style={styles.note}>
            Tap a day for its numbers, measured against your goals as they are today.
            {Platform.OS === 'android' ? ' Health Connect keeps about 30 days.' : ''}
          </Text>
        </>
      )}

      {weekly.length > 0 && (
        <View style={{ gap: 10, marginTop: hasDaily ? 4 : 0 }}>
          <View style={{ gap: 2 }}>
            <Text style={styles.sectionTitle}>Weekly goals</Text>
            <Text style={styles.subtitle}>This week and the {HISTORY_WEEKS - 1} before</Text>
          </View>
          {weekly.map(({ goal, weeks: rows }) => (
            <View key={goal.id} style={{ gap: 6 }}>
              <Text style={styles.goalName}>{goalTitle(goal)}</Text>
              {rows.map(({ monday, progress: p }) => (
                <View key={localDayKey(monday)} style={styles.weekRow}>
                  <Text style={styles.weekLabel}>{weekLabel(monday, todayKey)}</Text>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(2, Math.min(100, p.pct))}%`, backgroundColor: p.done ? colors.green : colors.accent },
                      ]}
                    />
                  </View>
                  <Text style={styles.weekValue}>
                    {formatAmount(goal.metric, p.value)}
                    <Text style={styles.weekTarget}> / {formatAmount(goal.metric, goal.target)}</Text>
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

// "Oct 27 – now" for the current week, "Oct 20 – 26" otherwise.
function weekLabel(monday: Date, todayKey: string): string {
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const start = monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (localDayKey(sunday) >= todayKey) return `${start} – now`;
  const end =
    sunday.getMonth() === monday.getMonth()
      ? String(sunday.getDate())
      : sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${start} – ${end}`;
}

function Legend({ color, label }: { color: string; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
    backText: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive },
    title: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    subtitle: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    sectionTitle: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    grid: { gap: 6 },
    gridRow: { flexDirection: 'row', gap: 6 },
    weekday: { flex: 1, textAlign: 'center', fontFamily: font.heading, fontSize: 10.5, color: withAlpha(colors.text, 0.5) },
    cell: { flex: 1, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    cellText: { fontSize: 11.5, fontFamily: font.heading },
    cellFuture: { backgroundColor: 'transparent' },
    cellNoData: { backgroundColor: withAlpha(colors.text, 0.04) },
    cellNone: { backgroundColor: withAlpha(colors.text, 0.08) },
    cellToday: { borderWidth: 2, borderColor: colors.accentActive },
    legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    swatch: { width: 10, height: 10, borderRadius: 3 },
    legendText: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.5), textAlign: 'center' },
    goalName: { fontSize: 13, color: withAlpha(colors.text, 0.75) },
    weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    weekLabel: { width: 86, fontSize: 12, color: withAlpha(colors.text, 0.6) },
    bar: { flex: 1, height: 8, borderRadius: 999, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 999 },
    weekValue: { minWidth: 92, textAlign: 'right', fontSize: 12.5, color: colors.text },
    weekTarget: { color: withAlpha(colors.text, 0.55) },
  });
}
