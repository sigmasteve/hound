import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from '../components/Text';
import Svg, { Circle } from 'react-native-svg';
import { BarbellIcon, CaretRightIcon, CheckCircleIcon, FireIcon, FootprintsIcon, PathIcon, TimerIcon, XIcon } from 'phosphor-react-native';
import { GoalTrail, type TrailAvatar } from '../components/GoalTrail';
import { HoundArt } from '../kennel/HoundArt';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { formatAmount, goalTitle, pacePct, progressLine, type GoalMetric, type GoalProgress } from '../goals/goals';
import type { GoalStreak } from '../goals/goalStreakApi';
import type { Kennel } from '../kennel/kennelApi';
import type { GoalsTileStyle } from './todayPrefs';

// Today as tiles: a wide goals tile, then small tiles for your hound,
// what needs you, your challenges and last week. Each tile is a summary;
// tapping one opens a sheet (TileSheet) with the full cards that used to
// sit on Today one after another.

const ICONS: Record<GoalMetric, React.ComponentType<any>> = {
  steps: FootprintsIcon,
  distance_mi: PathIcon,
  workouts: BarbellIcon,
  workout_minutes: TimerIcon,
};

// The goals tile shows this many goals; the rest are in its sheet.
const TILE_GOALS = 3;

export function Tile({
  label,
  badge,
  accessory,
  wide,
  onPress,
  accessibilityLabel,
  children,
}: {
  label: string;
  badge?: number;
  // On the right of the label row (the goals tile's streak).
  accessory?: React.ReactNode;
  wide?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, wide ? styles.wide : styles.half, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.labelRow}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        {accessory && <View style={{ marginLeft: 'auto' }}>{accessory}</View>}
      </View>
      {children}
    </Pressable>
  );
}

// A tile's big number or word, and the lines under it (a line can have
// its own color, like the step rank's ▲ and ▼).
export type TileLine = string | { text: string; color?: string };

export function TileValue({ value, lines }: { value: string; lines: TileLine[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {lines.map((line, i) =>
        typeof line === 'string' ? (
          <Text key={i} style={styles.line} numberOfLines={2}>
            {line}
          </Text>
        ) : (
          <Text key={i} style={[styles.line, line.color ? { color: line.color, fontFamily: font.headingSemibold } : null]} numberOfLines={1}>
            {line.text}
          </Text>
        ),
      )}
    </>
  );
}

const MOOD_WORD: Record<Kennel['mood'], string> = {
  happy: 'Happy',
  okay: 'Doing okay',
  hungry: 'Hungry',
  sleepy: 'Sleepy',
};

export function HoundTile({ kennel, onPress }: { kennel: Kennel; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level);
  return (
    <Tile label={kennel.name} onPress={onPress} accessibilityLabel={`${kennel.name}, ${MOOD_WORD[kennel.mood]}. Open`}>
      <TileValue value={MOOD_WORD[kennel.mood]} lines={[kennel.treatedToday ? 'Treated today' : 'Treat ready', 'Kennel ›']} />
      <View style={styles.hound} pointerEvents="none">
        <HoundArt
          rank={rank.id}
          mood={kennel.mood}
          neckId={kennel.neckId}
          headId={kennel.headId}
          faceId={kennel.faceId}
          coatId={kennel.coatId}
          ears={kennel.ears}
          tail={kennel.tail}
          markings={kennel.markings}
          breedId={kennel.breedId}
          size={84}
        />
      </View>
    </Tile>
  );
}

// The wide goals tile, as rings or as trails (Settings → Today).
export function GoalsTile({
  progress,
  streak,
  tileStyle,
  avatar,
  needsSetup,
  onOpen,
  onSetGoals,
}: {
  progress: GoalProgress[];
  streak: GoalStreak | null;
  tileStyle: GoalsTileStyle;
  avatar: TrailAvatar;
  needsSetup: boolean;
  onOpen: () => void;
  onSetGoals: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The count is today's: only daily goals earn the goal day (streak,
  // Bones, Bone Dig). Weekly goals pay their own bonus once the week's
  // are all done, so they're marked "This week" and listed after.
  const daily = progress.filter((p) => p.goal.period === 'day');
  const weekly = progress.filter((p) => p.goal.period === 'week');
  const counted = daily.length > 0 ? daily : weekly;
  const done = counted.filter((p) => p.done).length;
  const heading = daily.length > 0 ? 'Today' : 'This week';
  const shown = [...daily, ...weekly].slice(0, TILE_GOALS);
  const more = progress.length - shown.length;
  const ringColors = [colors.accent400, colors.green, colors.amber];

  return (
    <Tile
      label={`${heading} · ${done} of ${counted.length}`}
      wide
      onPress={onOpen}
      accessibilityLabel={`Goals. ${heading}, ${done} of ${counted.length} done. Open`}
      accessory={
        streak && streak.streak > 0 ? (
          <View style={styles.streak}>
            <FireIcon size={14} color={colors.amber} weight="fill" />
            <Text style={styles.streakText}>{streak.streak}-day streak</Text>
          </View>
        ) : null
      }
    >

      {tileStyle === 'rings' ? (
        <View style={styles.ringsRow}>
          <Rings progress={shown} colors={ringColors} done={done} total={counted.length} track={withAlpha(colors.text, 0.1)} textColor={colors.text} />
          <View style={styles.legend}>
            {shown.map((p, i) => (
              <View key={p.goal.id} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: ringColors[i] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendValue} numberOfLines={1}>
                    {formatAmount(p.goal.metric, p.value)} / {formatAmount(p.goal.metric, p.goal.target)}
                    {p.goal.metric === 'steps' ? ' steps' : p.goal.metric === 'workouts' ? ' workouts' : ''}
                  </Text>
                  <Text style={[styles.legendSub, p.done && { color: colors.green }]} numberOfLines={1}>
                    {p.goal.period === 'week'
                      ? p.done
                        ? '✓ Done this week'
                        : `This week · ${weekLeft(p)}`
                      : p.done
                        ? '✓ Done'
                        : progressLine(p)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: 10, marginTop: 4 }}>
          {shown.map((p) => {
            const Icon = ICONS[p.goal.metric];
            const pace = pacePct(p.goal);
            return (
              <View key={p.goal.id} style={{ gap: 2 }}>
                <View style={styles.trailTop}>
                  <Icon size={14} color={colors.accent} />
                  <Text style={styles.trailName} numberOfLines={1}>
                    {goalTitle(p.goal)}
                  </Text>
                  {p.goal.period === 'week' ? (
                    <View style={[styles.weekTag, { marginLeft: 'auto' }]}>
                      <Text style={styles.weekTagText}>{p.done ? 'Done this week' : `This week · ${weekLeft(p)}`}</Text>
                    </View>
                  ) : p.done ? (
                    <View style={{ marginLeft: 'auto' }}>
                      <CheckCircleIcon size={15} color={colors.green} weight="fill" />
                    </View>
                  ) : (
                    <Text style={styles.trailLeft} numberOfLines={1}>
                      {progressLine(p)}
                    </Text>
                  )}
                </View>
                <GoalTrail pct={p.pct} done={p.done} pace={p.done ? null : pace} avatar={avatar} />
              </View>
            );
          })}
        </View>
      )}

      {(more > 0 || needsSetup) && (
        <View style={styles.goalsFoot}>
          {more > 0 && <Text style={styles.line}>+{more} more</Text>}
          {needsSetup && (
            <Pressable onPress={onSetGoals} hitSlop={8} accessibilityRole="button" style={{ marginLeft: 'auto' }}>
              <Text style={styles.setGoals}>Starter goals · Set yours ›</Text>
            </Pressable>
          )}
        </View>
      )}
    </Tile>
  );
}

// "6 days left", or "last day": the rest of a weekly goal's line shows
// in its numbers and its trail.
function weekLeft(p: GoalProgress): string {
  return p.daysLeft === 1 ? 'last day' : `${p.daysLeft} days left`;
}

// One ring per goal, outermost first, with how many are done in the middle.
function Rings({
  progress,
  colors: ringColors,
  done,
  total,
  track,
  textColor,
}: {
  progress: GoalProgress[];
  colors: string[];
  done: number;
  total: number;
  track: string;
  textColor: string;
}) {
  const size = 112;
  const stroke = 11;
  const gap = 3;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {progress.map((p, i) => {
          const r = size / 2 - stroke / 2 - i * (stroke + gap);
          const c = 2 * Math.PI * r;
          const pct = p.done ? 1 : Math.max(0, Math.min(1, p.pct / 100));
          return (
            <React.Fragment key={p.goal.id}>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
              {pct > 0 && (
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={ringColors[i]}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${c} ${c}`}
                  strokeDashoffset={c * (1 - pct)}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              )}
            </React.Fragment>
          );
        })}
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: font.headingSemibold, fontSize: 17, color: textColor }}>
            {total > 0 && done === total ? '✓' : `${done}/${total}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

// A tile's details, sliding up over Today. Drawn inside the screen rather
// than as a Modal, so the dig, share and celebration popups (which are
// Modals) still open on top of it: iOS shows only one Modal at a time.
export function TileSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [slide]);

  // Android's back button closes the sheet, not the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }]}
      >
        <View style={styles.grab} />
        <View style={styles.sheetHeader}>
          <Text style={[text.h4, { flex: 1 }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={18} color={withAlpha(colors.text, 0.6)} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

// "See all" at the bottom of a sheet, for the tab with the rest.
export function SheetLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sheetLink, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Text style={styles.sheetLinkText}>{label}</Text>
      <CaretRightIcon size={14} color={colors.accentActive} />
    </Pressable>
  );
}

export const tileGrid: ViewStyle = { gap: 10 };
export const tileRow: ViewStyle = { flexDirection: 'row', gap: 10 };

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    tile: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 13,
      gap: 3,
      overflow: 'hidden',
    },
    // Every flex value spelled out in both: a tile that switches from wide
    // to half (when Week in review loads after the rest) otherwise kept
    // the wide one's sizing and stayed too wide.
    half: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 150 },
    wide: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, minHeight: 0 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: {
      flexShrink: 1,
      fontFamily: font.headingSemibold,
      fontSize: 11.5,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: withAlpha(colors.text, 0.55),
    },
    badge: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: colors.accent400, alignItems: 'center', justifyContent: 'center' },
    badgeText: { fontFamily: font.headingSemibold, fontSize: 11.5, color: '#1b1d29' },
    value: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text, marginTop: 2 },
    line: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    hound: { position: 'absolute', right: -6, bottom: -4 },
    streak: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    streakText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.amber },
    ringsRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
    legend: { flex: 1, gap: 9 },
    legendRow: { flexDirection: 'row', gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
    legendValue: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    legendSub: { fontSize: 12, color: withAlpha(colors.text, 0.6), marginTop: 1 },
    trailTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    trailName: { flexShrink: 1, fontSize: 13, color: colors.text },
    weekTag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: withAlpha(colors.amber, 0.16) },
    weekTagText: { fontFamily: font.headingSemibold, fontSize: 10.5, color: colors.amber },
    trailLeft: { marginLeft: 'auto', fontSize: 12, color: withAlpha(colors.text, 0.6), maxWidth: '45%' },
    goalsFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    setGoals: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.accentActive },
    dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      backgroundColor: colors.bg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 8,
    },
    grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.25) },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    sheetBody: { padding: 16, paddingTop: 6, gap: 14, paddingBottom: 40 },
    sheetLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
    sheetLinkText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.accentActive },
  });
}
