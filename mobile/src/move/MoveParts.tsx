import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BarbellIcon,
  BasketballIcon,
  BicycleIcon,
  BroomIcon,
  FlowerLotusIcon,
  HeartbeatIcon,
  LightningIcon,
  PersonSimpleRunIcon,
  PersonSimpleTaiChiIcon,
  SwimmingPoolIcon,
  TennisBallIcon,
  TrophyIcon,
} from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { ACTIVITY_LABEL, fmtPts, isStrength } from './move';
import { getMoveRates, type MoveFinish, type StrengthGoal } from './moveApi';

// Pieces the Move screens share: an activity's icon and colour, the
// strength week strip, and the finish.

const ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; weight?: any }>> = {
  steps: PersonSimpleRunIcon,
  stretching: PersonSimpleTaiChiIcon,
  yoga: FlowerLotusIcon,
  pilates: PersonSimpleTaiChiIcon,
  housework: BroomIcon,
  strength_heavy: BarbellIcon,
  strength_light: BarbellIcon,
  pickleball: TennisBallIcon,
  dance: HeartbeatIcon,
  elliptical: HeartbeatIcon,
  swim: SwimmingPoolIcon,
  basketball: BasketballIcon,
  spin: BicycleIcon,
  cycling: BicycleIcon,
  rowing: HeartbeatIcon,
  tennis_soccer: TennisBallIcon,
  hiit: LightningIcon,
  other: HeartbeatIcon,
};

export function activityColor(activity: string, colors: Palette): string {
  if (isStrength(activity)) return colors.accent;
  if (activity === 'steps') return '#4f9fe0';
  if (['yoga', 'pilates', 'stretching'].includes(activity)) return colors.amber;
  return colors.green;
}

export function ActivityIcon({ activity, size = 32 }: { activity: string; size?: number }) {
  const { colors } = useTheme();
  const Icon = ICONS[activity] ?? HeartbeatIcon;
  const col = activityColor(activity, colors);
  return (
    <View style={{ width: size, height: size, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(col, 0.14) }}>
      <Icon size={Math.round(size * 0.56)} color={col} weight="bold" />
    </View>
  );
}

// The last six weeks against your goal; this week last, outlined.
export function StrengthWeeks({ goal }: { goal: StrengthGoal }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.weeks}>
      {goal.weeks.map((w, i) => {
        const now = i === goal.weeks.length - 1;
        const met = w.days >= goal.target;
        return (
          <View
            key={w.monday}
            style={[styles.week, met && { backgroundColor: withAlpha(colors.green, 0.16) }, now && { borderColor: colors.accent, borderWidth: 2 }]}
            accessibilityLabel={`Week of ${w.monday}: ${w.days} of ${goal.target}`}
          >
            <Text style={[styles.weekText, met && { color: colors.green, fontFamily: font.headingSemibold }]}>
              {now ? `${w.days}/${goal.target}` : met ? '✓' : w.days > 0 ? `${w.days}` : '–'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function MoveFinishView({ title, result, timed }: { title: string; result: MoveFinish; timed: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const g = result.strength;
  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.hero, { backgroundColor: colors.accent }]}>
        <Text style={styles.heroSmall}>
          {title} · {result.minutes} min{timed ? ' · ✓ Timed' : ''}
        </Text>
        <Text style={styles.heroBig}>+{fmtPts(result.pts)}</Text>
        <Text style={styles.heroSmall}>Move points · {fmtPts(result.today)} from activities today</Text>
      </View>
      {result.prs.map((p) => (
        <View key={p.exercise} style={styles.card}>
          <View style={styles.between}>
            <Text style={styles.strong}>New best</Text>
            <TrophyIcon size={18} color={colors.amber} weight="fill" />
          </View>
          <Text style={styles.prText}>
            {p.exercise} {p.weightLb !== null ? `${p.weightLb} lb × ${p.reps}` : `× ${p.reps}`}
          </Text>
          {(p.prevWeightLb !== null || p.prevReps !== null) && (
            <Text style={styles.small}>
              Up from {p.prevWeightLb !== null ? `${p.prevWeightLb} lb × ${p.prevReps ?? '?'}` : `× ${p.prevReps}`}
            </Text>
          )}
        </View>
      ))}
      {isStrength(result.activity) && (
        <View style={styles.card}>
          <View style={styles.between}>
            <Text style={styles.strong}>Strength this week</Text>
            <Text style={[styles.small, g.thisWeek >= g.target && { color: colors.green, fontFamily: font.headingSemibold }]}>
              {g.thisWeek} of {g.target}
              {g.thisWeek >= g.target ? ' ✓' : ''}
            </Text>
          </View>
          <StrengthWeeks goal={g} />
          <Text style={styles.small}>
            {g.streak > 0 ? `Week streak: ${g.streak}. ` : ''}Your goal is {g.target} a week. Rest days count, so take one.
          </Text>
        </View>
      )}
      <Text style={[styles.small, { textAlign: 'center' }]}>{ACTIVITY_LABEL[result.activity] ?? 'Workout'} counts toward your goals and Move points challenges.</Text>
    </View>
  );
}

// Finished with no connection (0271): saved on the phone, to sync.
export function MoveSavedOffline({ title, minutes, activity }: { title: string; minutes: number; activity: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    getMoveRates()
      .then(({ rates }) => setRate(rates.find((r) => r.activity === activity)?.perMin ?? null))
      .catch(() => {});
  }, [activity]);
  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.hero, { backgroundColor: colors.accent }]}>
        <Text style={styles.heroSmall}>
          {title} · {minutes} min · ✓ Timed
        </Text>
        <Text style={[styles.heroBig, { fontSize: 30, lineHeight: 38 }]}>Saved on your phone</Text>
        <Text style={styles.heroSmall}>{rate !== null ? `About ${fmtPts(minutes * rate)} Move points` : 'Move points on the way'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.strong}>No connection right now</Text>
        <Text style={styles.small}>
          It syncs by itself when you’re back online. Your points, any new bests and your strength week update then.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    weeks: { flexDirection: 'row', gap: 6, marginTop: 6 },
    week: {
      flex: 1,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.text, 0.06),
      borderWidth: 2,
      borderColor: 'transparent',
    },
    weekText: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    hero: { borderRadius: 20, padding: 18, alignItems: 'center', gap: 2 },
    heroSmall: { fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
    heroBig: { fontSize: 46, lineHeight: 52, fontFamily: font.headingSemibold, color: '#fff' },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 12, gap: 4 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    strong: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    prText: { fontSize: 20, fontFamily: font.headingSemibold, color: colors.text },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
  });
}
