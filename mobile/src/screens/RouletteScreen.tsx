import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Path, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { useHealthProvider } from '../health/HealthContext';
import { localDayKey } from '../goals/goals';
import {
  PICKABLE,
  SEGMENTS,
  STAKES,
  progressLine,
  segmentIndex,
  stakeName,
  taskHow,
  taskTitle,
  worthLine,
  type RouletteStake,
  type RouletteTask,
} from '../challenges/roulette';
import { bankRoulette, claimRouletteSteps, getRoulette, pickRouletteTask, spinRoulette, type RouletteGame } from '../challenges/rouletteApi';

// Hound Roulette's wheel (0236; mockup claude.ai/artifact/HfDqdw7FaXZmCeDy68pJcX).
// Bank the ride (before you spin), pick a stake, spin: the server has
// already picked today's slot, and the wheel turns to it. Then today's
// task, scored from Health and the rest of Hound as it lands.

const SPIN_MS = 3600;

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const t = (a * Math.PI) / 180;
    return `${(cx + r * Math.sin(t)).toFixed(1)} ${(cy - r * Math.cos(t)).toFixed(1)}`;
  };
  return `M${cx} ${cy} L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`;
}

export function RouletteScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { width } = useWindowDimensions();
  const [game, setGame] = useState<RouletteGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stake, setStake] = useState<RouletteStake>('bold');
  const [busy, setBusy] = useState(false);
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [flashAt, setFlashAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<RouletteGame | null>(null);
  const anim = useRef<{ from: number; to: number; t0: number } | null>(null);
  const stepsToday = useRef<number | null>(null);

  // The phone's own counts for yesterday and today, before anything settles.
  const claim = useCallback(async () => {
    try {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      y.setHours(0, 0, 0, 0);
      const days = await health.getDailyStepsSince(y);
      for (const d of days) {
        if (d.date === localDayKey(new Date())) stepsToday.current = d.steps;
        await claimRouletteSteps(challengeId, d.date, d.steps).catch(() => false);
      }
    } catch {
      // No Health: the synced counts still score it.
    }
  }, [challengeId, health]);

  const load = useCallback(async () => {
    try {
      const g = await getRoulette(challengeId);
      setGame(g);
      setError(null);
      if (g.spin) setRot(-(segmentIndex(g.spin.segment) * 36 + 18));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the wheel.');
    }
  }, [challengeId]);

  useEffect(() => {
    claim().finally(load);
  }, [claim, load]);

  useEffect(() => {
    if (!spinning && Date.now() - flashAt > 1700) return;
    let raf = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const a = anim.current;
      if (a) {
        const k = Math.min(1, (t - a.t0) / SPIN_MS);
        const e = 1 - Math.pow(1 - k, 3.4);
        setRot(a.from + (a.to - a.from) * e);
        if (k >= 1) {
          anim.current = null;
          setSpinning(false);
          setFlashAt(t);
          if (pending.current) setGame(pending.current);
          pending.current = null;
          buzz('success');
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, flashAt]);

  const spin = async () => {
    if (!game || busy || spinning || game.reason || game.spin) return;
    setBusy(true);
    try {
      await claim();
      const g = await spinRoulette(challengeId, stake);
      const seg = g.spin ? segmentIndex(g.spin.segment) : 0;
      const jitter = (Math.random() - 0.5) * 22;
      const land = -(seg * 36 + 18 + jitter);
      const base = rot - (rot % 360);
      const to = base + 360 * 5 + ((((land - base) % 360) + 360) % 360);
      pending.current = g;
      anim.current = { from: rot, to, t0: Date.now() };
      setSpinning(true);
      buzz('light');
    } catch (e) {
      Alert.alert('Hound Roulette', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const bank = async () => {
    if (!game || busy) return;
    setBusy(true);
    try {
      await claim();
      setGame(await bankRoulette(challengeId));
      buzz('success');
    } catch (e) {
      Alert.alert('Hound Roulette', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const pick = async (task: RouletteTask) => {
    if (busy) return;
    setBusy(true);
    try {
      setGame(await pickRouletteTask(challengeId, task));
    } catch (e) {
      Alert.alert('Hound Roulette', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
        </View>
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  const size = Math.min(300, width - 64);
  const C = size / 2;
  const R = C - 4;
  const shown = spinning ? null : game.spin;
  const flash = !spinning && game.spin && now - flashAt < 1600 ? SEGMENTS[segmentIndex(game.spin.segment)] : null;
  const canBank = !game.spin && !game.reason && game.ride > 0;
  const canSpin = !game.spin && !game.reason && !spinning;
  const picking = shown && shown.segment === 'pick' && !shown.task;
  const steps = shown?.task === 'steps' && stepsToday.current != null ? Math.max(stepsToday.current, shown.progress ?? 0) : shown?.progress ?? null;
  const line = shown ? progressLine(shown.task, shown.target, steps) : null;
  const pct = shown && shown.target && steps != null ? Math.min(1, steps / shown.target) : 0;

  const label = spinning
    ? 'Spinning…'
    : canSpin
      ? `Spin · ${stakeName(stake)}`
      : picking
        ? 'Pick one above'
        : shown?.status === 'done'
          ? 'Done! Back tomorrow'
          : shown
            ? 'Do it by midnight · scored from Health'
            : game.reason ?? 'Back tomorrow';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ paddingBottom: 4 }}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              HOUND ROULETTE{game.dayNo >= 1 && game.dayNo <= game.days ? ` · DAY ${game.dayNo} OF ${game.days}` : ''}
            </Text>
            <Text style={styles.title}>Today’s spin</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.title}>{game.banked}</Text>
            <Text style={styles.small}>points banked</Text>
          </View>
        </View>

        {game.raidOnMe && !shown?.status?.startsWith('done') && (
          <View style={styles.raid}>
            <Text style={styles.raidText}>
              {game.raidOnMe.by.split(' ')[0]} is raiding your ride. Make today’s task, or they take it.
            </Text>
          </View>
        )}

        <View style={styles.ride}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.rideLabel]}>RIDING</Text>
            <Text style={styles.rideValue}>{game.ride > 0 ? `${game.ride} points × ${game.mult} = ${game.bankValue}` : 'Nothing riding'}</Text>
            <Text style={styles.small}>
              {game.ride > 0
                ? `${game.rideDays} ${game.rideDays === 1 ? 'day' : 'days'} in a row. Miss a task and the ride’s gone.`
                : 'Finish tasks to build a ride, then bank it.'}
            </Text>
          </View>
          <Pressable
            onPress={bank}
            disabled={!canBank || busy}
            style={[styles.bankBtn, canBank ? styles.bankOn : styles.bankOff]}
            accessibilityRole="button"
            accessibilityLabel={canBank ? `Bank ${game.bankValue} points` : 'Bank'}
          >
            <Text style={[styles.bankText, !canBank && { color: withAlpha(colors.text, 0.5) }]}>{game.ride > 0 ? `Bank ${game.bankValue}` : 'Bank'}</Text>
          </Pressable>
        </View>

        <View style={styles.stakes}>
          {STAKES.map((s) => {
            const on = (game.spin?.stake ?? stake) === s.id;
            const off = !canSpin;
            return (
              <Pressable
                key={s.id}
                onPress={() => !off && setStake(s.id)}
                disabled={off}
                style={[styles.stake, on && styles.stakeOn, off && !on && { opacity: 0.45 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.stakeName, on && { color: '#ffd2a6' }]}>{s.name}</Text>
                <Text style={styles.stakeSub}>{s.sub(game.settings)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ alignItems: 'center', justifyContent: 'center', height: size + 14 }}>
          <Svg width={size} height={size + 14} accessibilityLabel="The roulette wheel">
            <Circle cx={C} cy={C + 12} r={R + 2} fill="#2a2c38" stroke="#f0c24a" strokeWidth={3} />
            <G rotation={rot} origin={`${C}, ${C + 12}`}>
              {SEGMENTS.map((s, i) => (
                <G key={s.id}>
                  <Path d={arc(C, C + 12, R - 2, i * 36, i * 36 + 36)} fill={s.fill} stroke="#161826" strokeWidth={2} />
                  <G rotation={i * 36 + 18 - 90} origin={`${C}, ${C + 12}`}>
                    <SvgText x={C + R - 14} y={C + 12 + 4} textAnchor="end" fontSize={size < 280 ? 9.5 : 11} fontWeight="800" fill={s.ink}>
                      {s.label}
                    </SvgText>
                  </G>
                </G>
              ))}
            </G>
            <Circle cx={C} cy={C + 12} r={R * 0.23} fill="#161826" stroke="#f0c24a" strokeWidth={3} />
            <G fill="#f0c24a">
              <Ellipse cx={C} cy={C + 12 + 6} rx={R * 0.075} ry={R * 0.062} />
              <Ellipse cx={C - R * 0.09} cy={C + 12 - R * 0.035} rx={R * 0.03} ry={R * 0.042} />
              <Ellipse cx={C - R * 0.03} cy={C + 12 - R * 0.075} rx={R * 0.03} ry={R * 0.042} />
              <Ellipse cx={C + R * 0.03} cy={C + 12 - R * 0.075} rx={R * 0.03} ry={R * 0.042} />
              <Ellipse cx={C + R * 0.09} cy={C + 12 - R * 0.035} rx={R * 0.03} ry={R * 0.042} />
            </G>
            <Path d={`M${C} 26 L${C - 11} 2 L${C + 11} 2 Z`} fill="#ffffff" stroke="#161826" strokeWidth={2} />
          </Svg>
          {flash && (
            <View pointerEvents="none" style={[styles.flash, { backgroundColor: flash.fill }]}>
              <Text style={[styles.flashText, { color: flash.ink }]}>{flash.label}</Text>
            </View>
          )}
        </View>

        {!shown && (
          <Text style={styles.msg}>
            {game.reason ??
              `Pick your stake, then spin: the wheel picks today’s task, sized from your own average (${game.avg.toLocaleString('en-US')} steps a day). Do it by midnight and it’s scored from Health, nothing to tick. Bank the ride before you spin to keep it safe.`}
          </Text>
        )}

        {picking && (
          <View style={{ gap: 8 }}>
            <Text style={styles.pickHead}>Pick yours: choose today’s task</Text>
            <View style={styles.pickGrid}>
            {PICKABLE.map((t) => (
              <Pressable key={t} onPress={() => pick(t)} disabled={busy} style={styles.pickRow} accessibilityRole="button">
                <Text style={styles.pickText} numberOfLines={2}>
                  {taskTitle(t, game.picks[t])}
                </Text>
              </Pressable>
            ))}
            </View>
          </View>
        )}

        {shown && !picking && (
          <View style={styles.task}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.tag, { backgroundColor: SEGMENTS[segmentIndex(shown.segment)].fill, color: SEGMENTS[segmentIndex(shown.segment)].ink }]}>
                {shown.task === 'free' ? 'FREE DAY' : shown.double ? 'DOUBLE' : shown.segment === 'pick' ? 'YOUR PICK' : 'TODAY'}
              </Text>
              {shown.task !== 'free' && <Text style={styles.small}>{worthLine(shown.stake, game.ride - (shown.status === 'done' ? shown.points : 0), shown.double, game.settings)}</Text>}
            </View>
            <Text style={styles.taskTitle}>{taskTitle(shown.task, shown.target, shown.double)}</Text>
            <Text style={styles.small}>{taskHow(shown.task)}</Text>
            {line && shown.status !== 'done' && (
              <View style={{ gap: 4 }}>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
                </View>
                <Text style={styles.barText}>{line}</Text>
              </View>
            )}
            {shown.status === 'done' && (
              <Text style={styles.done}>
                {shown.task === 'free' ? `+${shown.points} on the ride, nothing to do.` : `Done: +${shown.points} on the ride.`} Bank it tomorrow morning, or let it ride.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.pinned}>
        <Pressable
          onPress={spin}
          disabled={!canSpin || busy}
          style={[styles.act, canSpin ? { backgroundColor: '#f08a24' } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !canSpin && { color: withAlpha(colors.text, 0.7), fontSize: 14 }]}>{label}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
    raid: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: withAlpha('#e05b5b', 0.18), borderWidth: 1, borderColor: withAlpha('#e05b5b', 0.5) },
    raidText: { fontSize: 13, color: colors.text, fontFamily: font.headingSemibold },
    ride: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, backgroundColor: colors.surface },
    rideLabel: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6, color: '#c99a1a' },
    rideValue: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    bankBtn: { minWidth: 92, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    bankOn: { backgroundColor: '#f0c24a' },
    bankOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    bankText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
    stakes: { flexDirection: 'row', gap: 8 },
    stake: {
      flex: 1,
      minHeight: 54,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: withAlpha(colors.text, 0.14),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    stakeOn: { borderColor: '#f08a24', backgroundColor: '#3a2a1a' },
    stakeName: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    stakeSub: { fontSize: 11, color: withAlpha(colors.text, 0.65), marginTop: 2 },
    flash: { position: 'absolute', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 10 },
    flashText: { fontFamily: font.headingSemibold, fontSize: 24 },
    msg: { fontSize: 13, lineHeight: 19, color: withAlpha(colors.text, 0.78) },
    pickHead: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pickRow: { width: '48%', flexGrow: 1, minHeight: 48, borderRadius: 12, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: withAlpha(colors.text, 0.12) },
    pickText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    task: { borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.surface },
    tag: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 3, fontSize: 10.5, fontFamily: font.headingSemibold, letterSpacing: 0.6 },
    taskTitle: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    bar: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 4, backgroundColor: '#4f7be0' },
    barText: { fontSize: 11.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.75) },
    done: { fontSize: 13, lineHeight: 18, color: colors.text },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
