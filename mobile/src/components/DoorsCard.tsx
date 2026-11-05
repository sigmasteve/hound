import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
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
import { Avatar } from './Avatar';
import { Card } from './Card';
import { DayCard } from './DayCard';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { DOOR_POINTS, RUN_FROM, taskHint, taskShort, taskTitle, type Door, type DoorTaskKind } from '../challenges/doors';
import { todaysDoor, type DoorsGame } from '../challenges/doorsApi';
import type { Participant } from '../challenges/types';

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

export type DoorsPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

export function DoorsCard({
  name,
  game,
  houndName,
  people,
  userId,
  stepsToday,
  onOpen,
  onCheer,
}: {
  name: string;
  game: DoorsGame;
  houndName: string;
  people: DoorsPerson[];
  userId: string | null;
  // The phone's own count today; null while loading.
  stepsToday: number | null;
  // Opens today's door; true once it's open.
  onOpen: (no: number) => Promise<boolean>;
  // A cheer for someone on the board (counts for a cheer door).
  onCheer?: (userId: string) => Promise<void>;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const doors = game.doors;
  const today = todaysDoor(game);
  const dayNo = today?.no ?? null;
  const [cheered, setCheered] = useState<Set<string>>(new Set());

  // How far today's task has got, where it has a measure.
  const t = today?.task;
  const progress =
    t?.kind === 'steps' && t.steps
      ? { now: Math.max(stepsToday ?? 0, game.stepsToday ?? 0), of: t.steps, unit: 'steps' }
      : t?.kind === 'water'
        ? { now: Math.round(game.waterMl / 236.6), of: Math.max(1, Math.round(game.waterTargetMl / 236.6)), unit: 'cups' }
        : null;
  const before = !today && doors.length > 0 && doors[0].state === 'locked';

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>{name}</Text>
        <Text style={styles.meta}>
          {doors.length} doors · one opens each morning{dayNo != null ? ` · Day ${dayNo} of ${doors.length}` : ''}
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat label="Points" value={String(game.points)} styles={styles} />
        <Stat label="Place" value={game.place != null ? `#${game.place}` : '—'} sub={`of ${game.players.toLocaleString()}`} styles={styles} />
        <Stat
          label="Run"
          value={String(game.run)}
          sub={game.run >= RUN_FROM ? '+1 a day' : `${RUN_FROM - game.run} to +1`}
          icon={<FlameIcon size={14} color={game.run >= RUN_FROM ? '#e0782a' : withAlpha(colors.text, 0.35)} weight="fill" />}
          styles={styles}
        />
      </View>

      {today && <TodayDoor door={today} houndName={houndName} progress={progress} onOpen={onOpen} styles={styles} />}
      {before && <Text style={styles.note}>Door 1 opens on {formatDay(doors[0].day)}. Come back that morning and knock.</Text>}
      {!today && !before && (
        <Text style={styles.note}>
          Every door’s been and gone. You opened {game.opened} and did {game.done}, for {game.points} points
          {game.place != null ? `: #${game.place} of ${game.players.toLocaleString()}` : ''}.
        </Text>
      )}

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

      {game.board.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Standings</Text>
          {game.board.map((r) => {
            const who = people.find((p) => p.userId === r.userId);
            const me = r.userId === userId;
            const done = cheered.has(r.userId);
            return (
              <View key={r.userId} style={[styles.standRow, me && styles.standMe]}>
                <Text style={styles.standPlace}>{r.place}</Text>
                <Avatar
                  initials={who?.initials ?? '?'}
                  tint={me ? TINT_A : TINT_N}
                  size={28}
                  fontSize={10}
                  frameId={who?.frameId}
                  backgroundId={who?.backgroundId}
                  iconId={who?.iconId}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.standName} numberOfLines={1}>
                    {me ? 'You' : (who?.name ?? 'Someone')}
                  </Text>
                  <Text style={styles.statSub}>
                    {r.done} done{r.run >= RUN_FROM ? ` · ${r.run} in a row` : ''}
                  </Text>
                </View>
                <Text style={styles.standPoints}>{r.points}</Text>
                {!me && onCheer && (
                  <Pressable
                    onPress={async () => {
                      if (done) return;
                      setCheered((c) => new Set(c).add(r.userId));
                      try {
                        await onCheer(r.userId);
                      } catch {
                        setCheered((c) => {
                          const n = new Set(c);
                          n.delete(r.userId);
                          return n;
                        });
                      }
                    }}
                    style={[styles.cheer, done && styles.cheerDone]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Cheer ${who?.name ?? 'them'}`}
                  >
                    <Text style={styles.cheerText}>👏</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      <DayCard title="How it works">
        <Text style={styles.note}>
          One door opens each morning, and only on its own day. Opening it is {DOOR_POINTS.open} point and shows today’s task. Do the task by midnight
          for {DOOR_POINTS.done} more. From the {RUN_FROM}rd done door in a row, each one is worth {DOOR_POINTS.run} more. One missed day a week doesn’t
          break your run. Tasks are checked from your Health data, water, goals and Kennel; nothing to tick. For a cheer door, tap 👏 beside someone in the standings.
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
  onOpen: (no: number) => Promise<boolean>;
  styles: Styles;
}) {
  const { colors } = useTheme();
  const swing = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  // Knocking: waiting on the server for what's behind it. Swinging: the
  // door's on its way open, still drawn over the task.
  const [phase, setPhase] = useState<'idle' | 'knocking' | 'swinging'>('idle');
  const showDoor = door.state === 'ready' || phase !== 'idle';
  const swinging = phase === 'swinging';

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

  const open = async () => {
    if (phase !== 'idle') return;
    setPhase('knocking');
    const ok = await onOpen(door.no);
    if (!ok) {
      setPhase('idle');
      return;
    }
    swing.setValue(0);
    setPhase('swinging');
    Animated.timing(swing, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }).start(() => setPhase('idle'));
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
        {showDoor && (
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
                {phase === 'knocking' ? <ActivityIndicator size="small" color="#4a2f12" /> : <Text style={styles.openText}>Tap to open</Text>}
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

// "Monday, Dec 1" for a door's day.
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
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
    standRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 10 },
    standMe: { backgroundColor: withAlpha(colors.accent, 0.1) },
    standPlace: { width: 22, textAlign: 'center', fontFamily: font.heading, fontSize: 13, color: withAlpha(colors.text, 0.6), fontVariant: ['tabular-nums'] },
    standName: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    standPoints: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
    cheer: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.accent, 0.12) },
    cheerDone: { backgroundColor: withAlpha(colors.green, 0.3) },
    cheerText: { fontSize: 15 },
    legend: { flexDirection: 'row', gap: 14, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendDot: { width: 10, height: 10, borderRadius: 3 },
  });
}
