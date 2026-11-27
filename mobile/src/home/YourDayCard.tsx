import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ForkKnifeIcon, PlusIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { GoalProgress } from '../goals/goals';
import type { GoalStreak } from '../goals/goalStreakApi';
import { clockText, leftText, planLabel } from '../fasting/fasting';
import { hoursSince, type MyFasting } from '../fasting/fastingApi';
import { fmtPts } from '../move/move';
import { HolidayCorner } from '../holiday/HolidayDecor';

// Your day (Steve, Nov 2026: "I love the proposed Your day card"): the
// three things people come to Hound for, side by side at the top of
// Today. Steps & workouts (synced from Health or a watch), Fasting, and
// Move (what you log or time in Hound). Fasting and Move show for the
// people who use them (the welcome wizard's checkboxes, or they already
// do); each ring opens its own screen. Water, when there's a water goal,
// is the row under the rings.

export interface DayPillars {
  fasting: boolean;
  move: boolean;
}

export function YourDayCard({
  progress,
  streak,
  steps,
  workouts,
  fasting,
  now,
  movePts,
  pillars,
  needsSetup,
  water,
  onOpenSteps,
  onOpenFasting,
  onOpenMove,
  onSetGoals,
}: {
  progress: GoalProgress[];
  streak: GoalStreak | null;
  steps: number | null;
  workouts: number;
  fasting: MyFasting | null;
  now: number;
  movePts: number | null;
  pillars: DayPillars;
  needsSetup: boolean;
  water?: React.ReactNode;
  onOpenSteps: () => void;
  onOpenFasting: () => void;
  onOpenMove: () => void;
  onSetGoals: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Today's goals, as the old Goals tile counted them: daily ones when there
  // are any, else the week's.
  const daily = progress.filter((p) => p.goal.period === 'day');
  const counted = daily.length > 0 ? daily : progress.filter((p) => p.goal.period === 'week');
  const done = counted.filter((p) => p.done).length;
  const stepGoal = progress.find((p) => p.goal.metric === 'steps' && p.goal.period === 'day');
  const stepPct = stepGoal ? Math.min(100, Math.round(stepGoal.pct)) : null;

  const o = fasting?.open ?? null;
  const h = o ? hoursSince(o.startedAt, now) : 0;
  const fastPct = o ? Math.min(100, (h / o.goalHours) * 100) : 0;
  const fastDone = !!o && h >= o.goalHours;

  const steps0 = steps ?? 0;
  const cols = 1 + (pillars.fasting ? 1 : 0) + (pillars.move ? 1 : 0);
  const blue = '#4f9fe0';

  return (
    <View style={styles.card}>
      <HolidayCorner />
      <View style={styles.head}>
        <Text style={styles.title}>Your day</Text>
        <Text style={styles.headRight}>
          {needsSetup ? '' : counted.length > 0 ? `${done} of ${counted.length} ${counted.length === 1 ? 'goal' : 'goals'}` : ''}
          {streak && streak.streak > 1 ? `  ·  🔥 ${streak.streak}` : ''}
        </Text>
      </View>
      <View style={styles.rings}>
        <Pillar
          label="Steps & workouts"
          ring={<Ring pct={stepPct ?? 0} color={stepPct !== null && stepPct >= 100 ? colors.green : blue} center={stepPct !== null ? `${stepPct}%` : '—'} styles={styles} colors={colors} />}
          big={steps === null ? '—' : steps0.toLocaleString()}
          sub={`${workouts === 1 ? '1 workout' : `${workouts} workouts`}`}
          onPress={onOpenSteps}
          styles={styles}
          wide={cols === 1}
          a11y={`Steps and workouts: ${steps0} steps, ${workouts} workouts. Open`}
        />
        {pillars.fasting && (
          <Pillar
            label="Fasting"
            ring={
              o ? (
                <Ring pct={fastPct} color={fastDone ? colors.green : colors.amber} center={clockText(h)} styles={styles} colors={colors} small />
              ) : (
                <Ring pct={0} color={colors.amber} icon={<ForkKnifeIcon size={18} color={colors.amber} weight="fill" />} styles={styles} colors={colors} />
              )
            }
            big={o ? (fastDone ? 'Goal ✓' : `${leftText(o.goalHours - h)} left`) : 'Start'}
            sub={o ? `${planLabel(o.goalHours)} fast` : fasting ? `${planLabel(fasting.planHours)}${fasting.numbers.streak > 0 ? ` · 🔥 ${fasting.numbers.streak}` : ''}` : 'Fasting'}
            onPress={onOpenFasting}
            styles={styles}
            a11y={o ? `Fasting, ${clockText(h)} of ${o.goalHours} hours. Open` : 'Fasting. Start a fast'}
          />
        )}
        {pillars.move && (
          <Pillar
            label="Move"
            ring={<Ring pct={0} color={colors.green} icon={<PlusIcon size={18} color={colors.green} weight="bold" />} styles={styles} colors={colors} />}
            big={movePts === null ? '—' : fmtPts(movePts)}
            sub={movePts ? 'Move points' : 'Log an activity'}
            onPress={onOpenMove}
            styles={styles}
            a11y={`Move: ${movePts ?? 0} Move points today. Log an activity`}
          />
        )}
      </View>
      {needsSetup && (
        <Pressable onPress={onSetGoals} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.link}>Set your goals ›</Text>
        </Pressable>
      )}
      {water}
    </View>
  );
}

function Pillar({
  label,
  ring,
  big,
  sub,
  onPress,
  styles,
  wide,
  a11y,
}: {
  label: string;
  ring: React.ReactNode;
  big: string;
  sub: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  wide?: boolean;
  a11y: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pillar, wide && styles.pillarWide]} accessibilityRole="button" accessibilityLabel={a11y}>
      {ring}
      <View style={wide ? { flex: 1 } : { alignItems: 'center' }}>
        <Text style={[styles.label, wide && { textAlign: 'left' }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.big, wide && { textAlign: 'left' }]} numberOfLines={1} adjustsFontSizeToFit>
          {big}
        </Text>
        <Text style={[styles.sub, wide && { textAlign: 'left' }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

function Ring({
  pct,
  color,
  center,
  icon,
  small,
  styles,
  colors,
}: {
  pct: number;
  color: string;
  center?: string;
  icon?: React.ReactNode;
  small?: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  const S = 54;
  const R = 23;
  const C = 2 * Math.PI * R;
  return (
    <View style={{ width: S, height: S, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
        <Circle cx={S / 2} cy={S / 2} r={R} stroke={withAlpha(colors.text, 0.1)} strokeWidth={6} fill="none" />
        {pct > 0 && (
          <Circle
            cx={S / 2}
            cy={S / 2}
            r={R}
            stroke={color}
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(C * Math.min(100, pct)) / 100} ${C}`}
            transform={`rotate(-90 ${S / 2} ${S / 2})`}
          />
        )}
      </Svg>
      {icon ?? <Text style={[styles.center, small && { fontSize: 10.5 }]}>{center}</Text>}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { borderRadius: 20, backgroundColor: colors.surface, padding: 14, gap: 10, overflow: 'hidden' },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    title: { fontSize: 17, fontFamily: font.headingSemibold, color: colors.text },
    headRight: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    rings: { flexDirection: 'row', gap: 6 },
    pillar: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 },
    pillarWide: { flexDirection: 'row', gap: 14 },
    label: { fontSize: 11.5, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    big: { fontSize: 17, fontFamily: font.headingSemibold, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 11.5, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    center: { fontSize: 12, fontFamily: font.headingSemibold, color: colors.text, fontVariant: ['tabular-nums'] },
    link: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.accentActive },
  });
}
