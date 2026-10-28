import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { CheckIcon, ShieldCheckIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { endOfDay, type GoalDaySummary } from '../goals/goals';

const RING = 26;
const STROKE = 3.5;

// The last seven days of goals, one small ring each, under the streak
// line on the Goals sheet: green with a tick when every daily goal was
// hit, a shield where a Streak Shield covered a miss, a part-filled ring
// otherwise (how far the goals got, on average), faint where the phone
// has nothing for that day. Tap one to see that day's numbers.
export function GoalWeekStrip({
  days,
  todayKey,
  shieldDay,
  selected,
  onSelect,
}: {
  // Oldest first, today last.
  days: GoalDaySummary[];
  todayKey: string;
  shieldDay: string | null;
  // The day being shown; null for today.
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      {days.map((d) => {
        const isToday = d.day === todayKey;
        const isSelected = selected === d.day || (selected === null && isToday);
        const allDone = d.total > 0 && d.done === d.total;
        const shielded = !allDone && d.day === shieldDay;
        const label = isToday ? 'Today' : endOfDay(d.day).toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <Pressable
            key={d.day}
            onPress={() => onSelect(isToday ? null : d.day)}
            style={({ pressed }) => [styles.day, isSelected && styles.daySelected, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${allDone ? 'all goals done' : shielded ? 'covered by a shield' : d.hasData ? `${d.done} of ${d.total} goals done` : 'no data'}`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.label, (isToday || isSelected) && { color: colors.accentActive }]}>{label}</Text>
            <DayRing summary={d} allDone={allDone} shielded={shielded} />
          </Pressable>
        );
      })}
    </View>
  );
}

function DayRing({ summary, allDone, shielded }: { summary: GoalDaySummary; allDone: boolean; shielded: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (allDone) {
    return (
      <View style={[styles.disc, { backgroundColor: colors.green }]}>
        <CheckIcon size={13} color={colors.bg} weight="bold" />
      </View>
    );
  }
  if (shielded) {
    return (
      <View style={[styles.disc, { backgroundColor: colors.accent }]}>
        <ShieldCheckIcon size={13} color={colors.bg} weight="fill" />
      </View>
    );
  }
  if (!summary.hasData) return <View style={[styles.disc, { backgroundColor: withAlpha(colors.text, 0.08) }]} />;
  const pct =
    summary.progress.length === 0
      ? 0
      : summary.progress.reduce((s, p) => s + Math.min(100, p.pct), 0) / summary.progress.length / 100;
  const r = RING / 2 - STROKE / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={RING} height={RING}>
      <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={withAlpha(colors.text, 0.14)} strokeWidth={STROKE} fill="none" />
      {pct > 0 && (
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      )}
    </Svg>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    day: { alignItems: 'center', gap: 6, flex: 1, paddingVertical: 6, borderRadius: 10 },
    daySelected: { backgroundColor: withAlpha(colors.accent, 0.14) },
    label: { fontFamily: font.heading, fontSize: 11, color: withAlpha(colors.text, 0.55) },
    disc: { width: RING, height: RING, borderRadius: RING / 2, alignItems: 'center', justifyContent: 'center' },
  });
}
