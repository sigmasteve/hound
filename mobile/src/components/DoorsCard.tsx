import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import {
  BarbellIcon,
  BoneIcon,
  CheckIcon,
  DropIcon,
  FlameIcon,
  FootprintsIcon,
  HandsClappingIcon,
  LockSimpleIcon,
  PawPrintIcon,
  TargetIcon,
} from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { DayCard } from './DayCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { DOOR_POINTS, RUN_FROM, taskHint, taskShort, taskTitle, type Door, type DoorTaskKind } from '../challenges/doors';

// Door colours are fixed, not themed, like the Hound'opoly board's: a
// row of painted doors reads the same in both themes.
const DOOR_COLORS = ['#b8433a', '#2f7a52', '#2d5d8a', '#8a5a2b', '#6b4a8a'];
const GOLD = '#f3d27a';
const INSIDE = '#fff6e3';

const TASK_ICON: Record<DoorTaskKind, React.ComponentType<{ size: number; color: string; weight?: 'fill' | 'bold' | 'regular' }>> = {
  steps: FootprintsIcon,
  workout: BarbellIcon,
  water: DropIcon,
  goal_day: TargetIcon,
  treat: BoneIcon,
  walk: PawPrintIcon,
  cheer: HandsClappingIcon,
};

const doorColor = (no: number) => DOOR_COLORS[(no * 3) % DOOR_COLORS.length];

export function DoorsCard({
  name,
  dayNo,
  doors,
  points,
  rank,
  players,
  run,
  houndName,
  progress,
  onOpen,
}: {
  name: string;
  // Today's door number; null before the first or after the last.
  dayNo: number | null;
  doors: Door[];
  points: number;
  rank: number | null;
  players: number;
  // Done doors in a row going into today.
  run: number;
  houndName: string;
  // How far today's task has got, when it has a measure: 5 of 8 cups.
  progress?: { now: number; of: number; unit: string } | null;
  onOpen: (no: number) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const today = dayNo != null ? (doors.find((d) => d.no === dayNo) ?? null) : null;

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>{name}</Text>
        <Text style={styles.meta}>
          {doors.length} doors · one opens each morning{dayNo != null ? ` · Day ${dayNo} of ${doors.length}` : ''}
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="Points" value={String(points)} styles={styles} />
        <Stat label="Place" value={rank != null ? `#${rank}` : '—'} sub={`of ${players.toLocaleString()}`} styles={styles} />
        <Stat
          label="Run"
          value={String(run)}
          sub={run >= RUN_FROM ? '+1 a day' : `${RUN_FROM - run} to +1`}
          icon={<FlameIcon size={14} color={run >= RUN_FROM ? '#e0782a' : withAlpha(colors.text, 0.35)} weight="fill" />}
          styles={styles}
        />
      </View>

      {today && <TodayDoor door={today} houndName={houndName} progress={progress} onOpen={onOpen} styles={styles} />}

      <View style={{ gap: 8 }}>
        <Text style={styles.sectionTitle}>The calendar</Text>
        <View style={styles.grid}>
          {doors.map((d) => (
            <SmallDoor key={d.no} door={d} styles={styles} />
          ))}
        </View>
        <View style={styles.legend}>
          <Legend swatch={<View style={[styles.legendDot, { backgroundColor: colors.green }]} />} label="Done" styles={styles} />
          <Legend swatch={<View style={[styles.legendDot, { backgroundColor: INSIDE, borderWidth: 1, borderColor: withAlpha(colors.text, 0.2) }]} />} label="Opened" styles={styles} />
          <Legend swatch={<View style={[styles.legendDot, { backgroundColor: withAlpha(colors.text, 0.2) }]} />} label="Missed" styles={styles} />
        </View>
      </View>

      <DayCard title="How it works">
        <Text style={styles.note}>
          One door opens each morning, and only on its own day. Opening it is {DOOR_POINTS.open} point and shows today’s task. Do the task by midnight
          for {DOOR_POINTS.done} more. From the {RUN_FROM}rd done door in a row, each one is worth {DOOR_POINTS.run} more. One missed day a week doesn’t
          break your run. Tasks are checked from your Health data, water, goals and Kennel; nothing to tick.
        </Text>
      </DayCard>
    </Card>
  );
}

function Stat({ label, value, sub, icon, styles }: { label: string; value: string; sub?: string; icon?: React.ReactNode; styles: Styles }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statRow}>
        {icon}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function Legend({ swatch, label, styles }: { swatch: React.ReactNode; label: string; styles: Styles }) {
  return (
    <View style={styles.legendItem}>
      {swatch}
      <Text style={styles.statSub}>{label}</Text>
    </View>
  );
}

// Today's door, big: closed with Open on it, or swung open on the task.
function TodayDoor({
  door,
  houndName,
  progress,
  onOpen,
  styles,
}: {
  door: Door;
  houndName: string;
  progress?: { now: number; of: number; unit: string } | null;
  onOpen: (no: number) => void;
  styles: Styles;
}) {
  const { colors } = useTheme();
  const swing = useRef(new Animated.Value(door.state === 'ready' ? 0 : 1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const [swinging, setSwinging] = useState(false);
  const closed = door.state === 'ready' && !swinging;

  useEffect(() => {
    if (door.state !== 'ready') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [door.state, glow]);

  const open = () => {
    setSwinging(true);
    Animated.timing(swing, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }).start(() => onOpen(door.no));
  };

  const t = door.task;
  const Icon = t ? TASK_ICON[t.kind] : null;
  const done = door.state === 'done';
  const pct = progress ? Math.min(1, progress.now / Math.max(1, progress.of)) : done ? 1 : 0;

  return (
    <View style={styles.todayWrap}>
      <Text style={styles.todayLabel}>Today · Door {door.no}</Text>
      <View style={styles.frame}>
        {/* Behind the door: today's task. */}
        <View style={styles.inside}>
          {t && Icon ? (
            <>
              <View style={[styles.taskIcon, done && { backgroundColor: colors.green }]}>
                {done ? <CheckIcon size={26} color="#ffffff" weight="bold" /> : <Icon size={26} color="#5a3d1e" weight="fill" />}
              </View>
              <Text style={styles.taskTitle}>{taskTitle(t, houndName)}</Text>
              <Text style={styles.taskHint}>{taskHint(t)}</Text>
              {progress && !done && (
                <View style={{ width: '100%', gap: 4 }}>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
                  </View>
                  <Text style={styles.barText}>
                    {progress.now.toLocaleString()} of {progress.of.toLocaleString()} {progress.unit}
                  </Text>
                </View>
              )}
              <Text style={[styles.taskPoints, done && { color: '#2f7a52' }]}>
                {done ? `Done · +${DOOR_POINTS.open + DOOR_POINTS.done} today` : `+${DOOR_POINTS.done} when it’s done, by midnight`}
              </Text>
              {door.bonus ? <Text style={styles.bonus}>🎁 Behind the door: {door.bonus}</Text> : null}
            </>
          ) : null}
        </View>
        {/* The door itself, hinged on the left. */}
        {(closed || swinging) && (
          <Animated.View
            style={[
              styles.bigDoor,
              { backgroundColor: doorColor(door.no) },
              {
                transformOrigin: 'left',
                transform: [{ perspective: 900 }, { rotateY: swing.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-108deg'] }) }],
              },
            ]}
            pointerEvents={swinging ? 'none' : 'auto'}
          >
            <Pressable style={styles.bigDoorPress} onPress={open} accessibilityRole="button" accessibilityLabel={`Open door ${door.no}`}>
              <View style={styles.panelTop} />
              <Text style={styles.bigNo}>{door.no}</Text>
              <View style={styles.knob} />
              <Animated.View style={[styles.openPill, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }]}>
                <Text style={styles.openText}>Tap to open</Text>
              </Animated.View>
              <View style={styles.panelBottom} />
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

function SmallDoor({ door, styles }: { door: Door; styles: Styles }) {
  const { colors } = useTheme();
  const Icon = door.task ? TASK_ICON[door.task.kind] : null;
  if (door.state === 'done' || door.state === 'opened') {
    const done = door.state === 'done';
    return (
      <View style={[styles.small, styles.smallInside, done && { borderColor: colors.green }]}>
        {Icon && <Icon size={16} color={done ? '#2f7a52' : '#8a6a44'} weight="fill" />}
        <Text style={styles.smallTask} numberOfLines={1}>
          {door.task ? taskShort(door.task) : ''}
        </Text>
        <Text style={styles.smallNoInside}>{door.no}</Text>
        {done && (
          <View style={styles.tick}>
            <CheckIcon size={9} color="#ffffff" weight="bold" />
          </View>
        )}
      </View>
    );
  }
  if (door.state === 'missed') {
    return (
      <View style={[styles.small, styles.smallMissed]}>
        <LockSimpleIcon size={13} color={withAlpha(colors.text, 0.4)} weight="fill" />
        <Text style={styles.smallNoMissed}>{door.no}</Text>
      </View>
    );
  }
  const today = door.state === 'ready';
  return (
    <View style={[styles.small, { backgroundColor: doorColor(door.no) }, today && styles.smallToday, !today && styles.smallLater]}>
      <View style={styles.smallPanel} />
      <Text style={styles.smallNo}>{door.no}</Text>
      <View style={styles.smallKnob} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    sectionTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08), gap: 1 },
    statLabel: { fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    statRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statValue: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] },
    statSub: { fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
    todayWrap: { gap: 6 },
    todayLabel: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    frame: {
      height: 250,
      borderRadius: 16,
      borderTopLeftRadius: 90,
      borderTopRightRadius: 90,
      backgroundColor: '#e9dcc3',
      padding: 8,
      borderWidth: 3,
      borderColor: '#c9b48c',
    },
    inside: {
      flex: 1,
      borderRadius: 10,
      borderTopLeftRadius: 82,
      borderTopRightRadius: 82,
      backgroundColor: INSIDE,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      paddingTop: 26,
      gap: 6,
    },
    taskIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    taskTitle: { fontFamily: font.headingSemibold, fontSize: 17, color: '#2b2118', textAlign: 'center' },
    taskHint: { fontSize: 12.5, color: '#6b5a48', textAlign: 'center', lineHeight: 17 },
    taskPoints: { fontFamily: font.heading, fontSize: 12.5, color: '#8a5a2b' },
    bonus: { fontSize: 12.5, color: '#6b5a48' },
    bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(90,61,30,0.15)', overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: '#2f7a52' },
    barText: { fontSize: 11.5, color: '#6b5a48', textAlign: 'center', fontVariant: ['tabular-nums'] },
    bigDoor: {
      position: 'absolute',
      left: 8,
      right: 8,
      top: 8,
      bottom: 8,
      borderRadius: 10,
      borderTopLeftRadius: 82,
      borderTopRightRadius: 82,
      overflow: 'hidden',
      backfaceVisibility: 'hidden',
    },
    bigDoorPress: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    panelTop: { position: 'absolute', top: 30, left: 30, right: 30, height: 70, borderTopLeftRadius: 60, borderTopRightRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)' },
    panelBottom: { position: 'absolute', bottom: 18, left: 30, right: 30, height: 50, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)' },
    bigNo: { fontFamily: font.headingSemibold, fontSize: 44, color: GOLD },
    knob: { position: 'absolute', right: 22, top: '55%', width: 12, height: 12, borderRadius: 6, backgroundColor: GOLD },
    openPill: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999, backgroundColor: GOLD },
    openText: { fontFamily: font.headingSemibold, fontSize: 13, color: '#4a2f12' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    small: {
      width: '15%',
      flexGrow: 1,
      aspectRatio: 0.78,
      borderRadius: 6,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    smallLater: { opacity: 0.9 },
    smallToday: { borderWidth: 3, borderColor: GOLD },
    smallPanel: { position: 'absolute', top: 7, left: 7, right: 7, bottom: 7, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderRadius: 3, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)' },
    smallNo: { fontFamily: font.headingSemibold, fontSize: 15, color: GOLD },
    smallKnob: { position: 'absolute', right: 6, top: '55%', width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD },
    smallInside: { backgroundColor: INSIDE, borderWidth: 2, borderColor: '#e2d2b4', gap: 1 },
    smallTask: { fontSize: 9.5, fontFamily: font.heading, color: '#6b5a48' },
    smallNoInside: { position: 'absolute', top: 3, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: '#a08a6c' },
    tick: { position: 'absolute', bottom: 3, right: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: '#2f7a52', alignItems: 'center', justifyContent: 'center' },
    smallMissed: { backgroundColor: withAlpha(colors.text, 0.1), gap: 2 },
    smallNoMissed: { fontSize: 11, fontFamily: font.heading, color: withAlpha(colors.text, 0.4) },
    legend: { flexDirection: 'row', gap: 14, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: 3 },
  });
}
