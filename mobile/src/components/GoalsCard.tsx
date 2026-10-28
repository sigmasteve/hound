import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import {
  BarbellIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FireIcon,
  FootprintsIcon,
  PathIcon,
  ShareNetworkIcon,
  ShieldCheckIcon,
  TimerIcon,
} from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { GoalTrail, type TrailAvatar } from './GoalTrail';
import { GoalWeekStrip } from './GoalWeekStrip';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  describeDay,
  endOfDay,
  formatAmount,
  goalTitle,
  pacePct,
  pastLine,
  progressLine,
  type GoalDaySummary,
  type GoalMetric,
  type GoalProgress,
} from '../goals/goals';
import { SHIELD_MAX, type GoalStreak } from '../goals/goalStreakApi';

const ICONS: Record<GoalMetric, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  distance_mi: PathIcon,
  workouts: BarbellIcon,
  workout_minutes: TimerIcon,
};

// What the streak line says: how many days in a row, and what today
// adds. Only for someone with a daily goal.
// The streak line: short enough for one row, with what today pays or
// that today's done.
function streakText(s: GoalStreak, currencyName: string): { title: string; detail: string } {
  const pays = `+${s.nextBones} ${currencyName} today`;
  if (s.streak === 0) return { title: 'Start a streak', detail: pays };
  const title = `${s.streak}-day streak`;
  if (s.hitToday) return { title, detail: 'back tomorrow' };
  if (s.shieldCovering) return { title, detail: 'a shield covers yesterday' };
  return { title, detail: pays };
}

// The last week of goal days under the streak line (GoalWeekStrip), and
// the past day being shown in place of today, if one was tapped. Put
// together by GoalsSheet (src/home); null leaves the card as today only.
export interface GoalHistoryView {
  // Oldest first, today last.
  week: GoalDaySummary[];
  todayKey: string;
  shieldDay: string | null;
  selected: GoalDaySummary | null;
  onSelect: (day: string | null) => void;
  onEarlier: () => void;
}

// "Oct 2 – 8", "Sep 29 – Oct 5": the week the strip is showing.
function describeRange(first: string, last: string): string {
  const a = endOfDay(first);
  const b = endOfDay(last);
  const start = a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const end = a.getMonth() === b.getMonth() ? String(b.getDate()) : b.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${start} – ${end}`;
}

// Today's first card: every goal, where you are on it, and what's left.
// The heading says whether the Hound is still on you. With a past day
// selected (history.selected) it shows that day's numbers instead, the
// trails frozen where they ended.
export function GoalsCard({
  progress,
  streak,
  currencyName,
  onBuyShield,
  avatar,
  needsSetup,
  onOpenGoal,
  onEdit,
  onSetGoals,
  onShare,
  history = null,
}: {
  progress: GoalProgress[];
  // Goal days in a row (0099_goal_streaks.sql); null until it loads.
  streak: GoalStreak | null;
  currencyName: string;
  // Spends Bones on a Streak Shield (asks first); null hides the button.
  onBuyShield: (() => void) | null;
  // You, running each goal's trail (GoalTrail).
  avatar: TrailAvatar;
  // Goals nobody has chosen yet (the starters): offer to set them.
  needsSetup: boolean;
  onOpenGoal: (p: GoalProgress) => void;
  onEdit: () => void;
  onSetGoals: () => void;
  // Shares today's goals as a picture (ShareSheet); null hides it.
  onShare: (() => void) | null;
  history?: GoalHistoryView | null;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const past = history?.selected ?? null;
  const rows = past ? past.progress : progress;
  const done = rows.filter((p) => p.done).length;
  const allDone = rows.length > 0 && done === rows.length;
  const streakLine =
    streak && progress.some((p) => p.goal.period === 'day') ? streakText(streak, currencyName) : null;

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>
            {past ? describeDay(past.day) : allDone ? "The Hound's off your back" : "The Hound's on you"}
          </Text>
          <Text style={styles.subtitle}>
            {past
              ? !past.hasData
                ? 'Nothing on this phone for that day.'
                : past.total === 0
                  ? 'No daily goals.'
                  : `${done} of ${past.total} goals done`
              : progress.length === 0
                ? 'Set a goal and Hound will keep you on it.'
                : allDone
                  ? 'Every goal is done. Nice work.'
                  : `${done} of ${progress.length} goals done`}
          </Text>
        </View>
        {!past && onShare && progress.length > 0 && (
          <Pressable onPress={onShare} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share today's goals">
            <ShareNetworkIcon size={18} color={colors.accentActive} style={{ marginTop: 2 }} />
          </Pressable>
        )}
        {!past && !needsSetup && (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
            <Text style={styles.edit}>{progress.length === 0 ? 'Add a goal' : 'Edit'}</Text>
          </Pressable>
        )}
      </View>

      {/* One row: the streak, and your shields on the right (tap to get
          one while you hold fewer than SHIELD_MAX). It's about today, so
          it goes while a past day is up. */}
      {!past && streakLine && streak && (
        <View style={styles.streak}>
          <FireIcon size={18} color={streak.streak > 0 ? colors.amber : withAlpha(colors.text, 0.4)} weight="fill" />
          <Text style={styles.streakLine} numberOfLines={1}>
            <Text style={styles.streakTitle}>{streakLine.title}</Text>
            <Text style={styles.streakDetail}> · {streakLine.detail}</Text>
          </Text>
          <Pressable
            style={styles.shieldChip}
            onPress={onBuyShield && streak.shields < SHIELD_MAX ? onBuyShield : undefined}
            disabled={!onBuyShield || streak.shields >= SHIELD_MAX}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${streak.shields} of ${SHIELD_MAX} Streak Shields${
              streak.shields < SHIELD_MAX ? `. Get one for ${streak.shieldCost} ${currencyName}` : ''
            }`}
          >
            <ShieldCheckIcon
              size={15}
              color={streak.shields > 0 ? colors.accentActive : withAlpha(colors.text, 0.45)}
              weight={streak.shields > 0 ? 'fill' : 'regular'}
            />
            <Text style={styles.shieldCount}>{streak.shields}</Text>
            {onBuyShield && streak.shields < SHIELD_MAX && <Text style={styles.shieldBuy}>+</Text>}
          </Pressable>
        </View>
      )}

      {/* The last seven days; tap one to see it, "Earlier" for the rest. */}
      {history && (
        <View style={{ gap: 8 }}>
          <GoalWeekStrip
            days={history.week}
            todayKey={history.todayKey}
            shieldDay={history.shieldDay}
            selected={past?.day ?? null}
            onSelect={history.onSelect}
          />
          {past ? (
            <View style={styles.pastBar}>
              <CalendarBlankIcon size={15} color={colors.accentActive} />
              <Text style={styles.pastBarTitle} numberOfLines={1}>
                {describeRange(history.week[0].day, history.week[history.week.length - 1].day)}
              </Text>
              <Pressable onPress={history.onEarlier} hitSlop={8} accessibilityRole="button" style={styles.pastBack}>
                <Text style={styles.linkText}>Earlier</Text>
              </Pressable>
              <Text style={styles.hint}>·</Text>
              <Pressable onPress={() => history.onSelect(null)} hitSlop={8} accessibilityRole="button" style={styles.pastBack}>
                <Text style={styles.linkText}>Today</Text>
                <CaretRightIcon size={12} color={colors.accentActive} weight="bold" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.stripFooter}>
              <Text style={styles.hint}>Tap a day to see it · </Text>
              <Pressable onPress={history.onEarlier} hitSlop={8} accessibilityRole="button" style={styles.pastBack}>
                <Text style={styles.linkText}>Earlier</Text>
                <CaretRightIcon size={12} color={colors.accentActive} weight="bold" />
              </Pressable>
            </View>
          )}
        </View>
      )}

      {needsSetup && !past && (
        <View style={styles.setup}>
          <Text style={styles.setupText}>These are starter goals. Make them yours.</Text>
          <Button label="Set your goals" variant="primary" small onPress={onSetGoals} />
        </View>
      )}

      {rows.map((p) => {
        const Icon = ICONS[p.goal.metric];
        const pace = past ? null : pacePct(p.goal);
        const houndOnYou = pace !== null && !p.done && pace > p.pct;
        return (
          <Pressable
            key={p.goal.id}
            onPress={() => onOpenGoal(p)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <View style={styles.rowTop}>
              <Icon size={15} color={colors.accent} />
              <Text style={styles.goalName} numberOfLines={1}>
                {goalTitle(p.goal)}
              </Text>
              {p.done && <CheckCircleIcon size={16} color={colors.green} weight="fill" />}
            </View>
            <View style={styles.valueRow}>
              <Text style={styles.value}>{formatAmount(p.goal.metric, p.value)}</Text>
              <Text style={styles.target}> / {formatAmount(p.goal.metric, p.goal.target)}</Text>
              <Text
                style={[styles.status, p.done && { color: colors.green }, houndOnYou && { color: colors.amber }]}
                numberOfLines={1}
              >
                {past ? pastLine(p) : progressLine(p)}
              </Text>
            </View>
            <GoalTrail pct={p.pct} done={p.done} pace={p.done ? null : pace} avatar={avatar} />
          </Pressable>
        );
      })}
      {past && past.hasData && <Text style={styles.hint}>Measured against your goals as they are today.</Text>}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    title: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    subtitle: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    edit: { fontFamily: font.heading, fontSize: 14, color: colors.accentActive, paddingTop: 2 },
    row: { gap: 6 },
    setup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    setupText: { flex: 1, fontSize: 13, color: colors.text },
    streak: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.amber, 0.1),
    },
    streakLine: { flex: 1 },
    streakTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    streakDetail: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    shieldChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    shieldCount: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    shieldBuy: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.accentActive },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    goalName: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.75) },
    valueRow: { flexDirection: 'row', alignItems: 'baseline' },
    value: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    target: { fontSize: 14, color: withAlpha(colors.text, 0.55) },
    status: { flex: 1, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.6), marginLeft: 8 },
    stripFooter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    hint: { fontSize: 12, color: withAlpha(colors.text, 0.5), textAlign: 'center' },
    linkText: { fontFamily: font.heading, fontSize: 12.5, color: colors.accentActive },
    pastBack: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    pastBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    pastBarTitle: { flex: 1, fontFamily: font.heading, fontSize: 13.5, color: colors.text },
  });
}
