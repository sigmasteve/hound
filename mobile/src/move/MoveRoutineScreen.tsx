import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clockMS, routineById, routineMinutes, routineSeconds, routineSteps } from './move';
import {
  cancelMoveSession,
  finishMoveSession,
  getMovePack,
  movePackBegan,
  movePackDone,
  saveSessionOffline,
  startMoveSession,
  type MoveFinish,
  type MovePack,
} from './moveApi';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { PersonAvatar } from '../fasting/FastingParts';
import { offlineEnabled } from '../offline/offlineConfig';
import { isNetworkError, reportNetworkFailure } from '../offline/network';
import { MoveFinishView, MoveSavedOffline } from './MoveParts';

// A guided routine (0270): each move on a timer, then rest, round after
// round. The server times it (move_session_start / _finish), so finishing
// is a ✓ Timed session. The clock runs from real time, so it stays right
// if the phone sleeps or the app goes to the background.
export function MoveRoutineScreen({
  routineId,
  packId,
  onBack,
}: {
  routineId: string;
  // Move together (0275): this routine is part of a pack.
  packId?: string;
  onBack: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routine = routineById(routineId);
  const steps = useMemo(() => (routine ? routineSteps(routine) : []), [routine]);
  const total = routine ? routineSeconds(routine) : 0;

  // The server's session id, or 'offline' when it couldn't be reached and
  // the phone times it (0271).
  const [session, setSession] = useState<string | null>(null);
  const startedAt = useRef<Date | null>(null);
  // Saved on the phone, to sync later: the minutes.
  const [queued, setQueued] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  // Seconds done, from real time: banked while paused, plus since resume.
  const banked = useRef(0);
  const resumedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<MoveFinish | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Move together: the others, and your bonus once everyone's done.
  const [pack, setPack] = useState<MovePack | null>(null);
  const [packBones, setPackBones] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    if (!packId) return;
    const load = () => {
      getMovePack(packId).then(setPack).catch(() => {});
      setClock(Date.now());
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [packId]);

  const now = () => banked.current + (resumedAt.current ? (Date.now() - resumedAt.current) / 1000 : 0);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(now()), 250);
    const sub = AppState.addEventListener('change', () => setElapsed(now()));
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [running]);

  // Where we are.
  let acc = 0;
  let k = 0;
  while (k < steps.length - 1 && acc + steps[k].sec <= elapsed) {
    acc += steps[k].sec;
    k++;
  }
  const step = steps[k];
  const left = step ? Math.max(0, step.sec - (elapsed - acc)) : 0;
  const done = elapsed >= total && total > 0;

  const finish = async () => {
    if (!session || busy) return;
    setBusy(true);
    setRunning(false);
    const mins = Math.max(1, Math.round(Math.min(now(), total) / 60));
    const saveOffline = async () => {
      await saveSessionOffline({
        kind: 'routine',
        ref: routine!.id,
        startedAt: startedAt.current ?? new Date(Date.now() - mins * 60000),
        endedAt: new Date(),
        minutes: mins,
        hard: false,
        sets: null,
        label: routine!.name,
      });
      setQueued(mins);
    };
    try {
      if (session === 'offline') await saveOffline();
      else {
        setResult(await finishMoveSession(session, mins, false, null));
        if (packId) {
          const b = await movePackDone(packId).catch(() => 0);
          setPackBones(b);
          if (b > 0) notifyBonesChanged();
          getMovePack(packId).then(setPack).catch(() => {});
        }
      }
    } catch (e) {
      if (offlineEnabled() && isNetworkError(e)) {
        reportNetworkFailure();
        await saveOffline();
      } else setError(e instanceof Error ? e.message : 'Could not save it.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (done && running) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, running]);

  if (!routine) {
    return (
      <SafeAreaView style={styles.root}>
        <Text style={styles.small}>That routine isn’t here.</Text>
      </SafeAreaView>
    );
  }

  const start = async () => {
    setError(null);
    try {
      if (!session) {
        try {
          const s = await startMoveSession('routine', routine.id);
          setSession(s.id);
          if (packId) movePackBegan(packId, s.id).catch(() => {});
        } catch (e) {
          // No connection: the phone times it and it syncs later (0271).
          if (!(offlineEnabled() && isNetworkError(e))) throw e;
          reportNetworkFailure();
          setSession('offline');
        }
        startedAt.current = new Date();
      }
      resumedAt.current = Date.now();
      setRunning(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    }
  };
  const pause = () => {
    banked.current = now();
    resumedAt.current = null;
    setElapsed(banked.current);
    setRunning(false);
  };
  const skip = () => {
    if (!step) return;
    banked.current = acc + step.sec;
    if (resumedAt.current) resumedAt.current = Date.now();
    setElapsed(banked.current);
  };
  const back = () => {
    if (!session || result || queued !== null) return onBack();
    Alert.alert('Stop the routine?', elapsed >= 60 ? 'Save what you did, or leave without saving.' : 'It won’t be saved.', [
      { text: 'Keep going', style: 'cancel' },
      ...(elapsed >= 60 ? [{ text: 'Save and stop', onPress: () => finish() }] : []),
      {
        text: 'Leave',
        style: 'destructive' as const,
        onPress: () => {
          if (session !== 'offline') cancelMoveSession(session).catch(() => {});
          onBack();
        },
      },
    ]);
  };

  const workDone = steps.slice(0, k).filter((s) => s.work).length;
  const works = steps.filter((s) => s.work).length;
  const nextWork = steps.slice(k + 1).find((s) => s.work);
  const R = 70;
  const C = 2 * Math.PI * R;
  const ringCol = step?.work ? colors.accent : colors.green;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>{routine.name}</Text>
        <View style={{ width: 20 }} />
      </View>
      {queued !== null ? (
        <View style={styles.body}>
          <MoveSavedOffline title={routine.short} minutes={queued} activity={routine.id.startsWith('stretch') ? 'stretching' : 'strength_light'} />
        </View>
      ) : result ? (
        <View style={styles.body}>
          <MoveFinishView title={routine.short} result={result} timed />
          {pack && (
            <View style={{ gap: 8, marginTop: 10 }}>
              <Text style={[styles.small, { textAlign: 'center', color: packBones ? colors.green : styles.small.color }]}>
                {packBones
                  ? `Everyone finished together: +${packBones} Bones 🐾`
                  : `The +${pack.bonus} Bones together bonus comes when everyone who joined finishes.`}
              </Text>
              <PackStrip pack={pack} now={clock} styles={styles} colors={colors} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.body}>
          {pack && <PackStrip pack={pack} now={clock} styles={styles} colors={colors} />}
          <View style={styles.segs}>
            {Array.from({ length: works }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.seg,
                  i < workDone && { backgroundColor: colors.accent },
                  i === workDone && step?.work && running && { backgroundColor: withAlpha(colors.accent, 0.45) },
                ]}
              />
            ))}
          </View>
          <View style={styles.between}>
            <Text style={styles.small}>
              Round {(step?.round ?? 0) + 1} of {routine.rounds} · {routine.gear}
            </Text>
            <Text style={styles.small}>{clockMS(total - elapsed)} left</Text>
          </View>
          <View style={styles.stage}>
            <View style={[styles.phase, { backgroundColor: withAlpha(ringCol, 0.14) }]}>
              <Text style={[styles.phaseText, { color: ringCol }]}>{!running && elapsed === 0 ? 'Ready' : step?.work ? 'Go' : 'Rest'}</Text>
            </View>
            <View style={{ width: 170, height: 170, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={170} height={170} style={StyleSheet.absoluteFill}>
                <Circle cx={85} cy={85} r={R} stroke={withAlpha(colors.text, 0.08)} strokeWidth={12} fill="none" />
                <Circle
                  cx={85}
                  cy={85}
                  r={R}
                  stroke={ringCol}
                  strokeWidth={12}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${C * (step ? left / step.sec : 0)} ${C}`}
                  transform="rotate(-90 85 85)"
                />
              </Svg>
              <Text style={styles.sec}>{Math.ceil(left)}</Text>
            </View>
            <Text style={styles.move}>{step?.work ? step.move.name : 'Rest'}</Text>
            <Text style={styles.cue}>{step?.work ? step.move.cue : `Breathe. Up next: ${step?.move.name}.`}</Text>
            <Text style={styles.small}>{nextWork && step?.work ? `Next: ${nextWork.move.name}` : !nextWork ? 'Last one!' : ''}</Text>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          {busy && <ActivityIndicator color={colors.accent} />}
          <Text style={[styles.small, { textAlign: 'center' }]}>
            {routineMinutes(routine)} minutes · counts as {routine.id.startsWith('stretch') ? 'stretching' : 'strength'} · ✓ Timed
          </Text>
        </View>
      )}
      <View style={styles.pinned}>
        {result || queued !== null ? (
          <Button label="Done" variant="primary" block onPress={onBack} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Skip" block style={{ flex: 1 }} disabled={!running} onPress={skip} />
            <Button
              label={running ? 'Pause' : elapsed > 0 ? 'Resume' : 'Start'}
              variant="primary"
              block
              style={{ flex: 2 }}
              disabled={busy}
              onPress={running ? pause : start}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    body: { flex: 1, paddingHorizontal: 16, gap: 8 },
    segs: { flexDirection: 'row', gap: 3 },
    seg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1) },
    between: { flexDirection: 'row', justifyContent: 'space-between' },
    stage: { flex: 1, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
    phase: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
    phaseText: { fontSize: 12.5, fontFamily: font.headingSemibold },
    sec: { fontSize: 44, fontFamily: font.headingSemibold, color: colors.text, fontVariant: ['tabular-nums'] },
    move: { fontSize: 26, fontFamily: font.headingSemibold, color: colors.text, textAlign: 'center' },
    cue: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.62), textAlign: 'center', maxWidth: 280 },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    error: { fontSize: 13, color: colors.amber, textAlign: 'center' },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
    pack: { borderRadius: 14, backgroundColor: colors.surface, padding: 10, gap: 6 },
    packRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    packTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    packFill: { height: 5, borderRadius: 3 },
  });
}

// The others in a Move together pack, each with how far along they are.
function PackStrip({
  pack,
  now,
  styles,
  colors,
}: {
  pack: MovePack;
  now: number;
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  const others = pack.members.filter((m) => !m.me && m.state !== 'invited');
  if (others.length === 0) return <Text style={styles.small}>Move together: waiting for friends to join.</Text>;
  return (
    <View style={styles.pack}>
      {others.map((m) => {
        const pct =
          m.state === 'done' ? 1 : m.state === 'going' && m.startedAt ? Math.min(0.99, (now - new Date(m.startedAt).getTime()) / (pack.minutes * 60000)) : 0;
        const col = m.state === 'done' ? colors.green : colors.accent;
        return (
          <View key={m.person.id} style={styles.packRow}>
            <PersonAvatar p={m.person} size={24} />
            <Text style={[styles.small, { width: 64 }]} numberOfLines={1}>
              {m.person.name}
            </Text>
            <View style={styles.packTrack}>
              <View style={[styles.packFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: col }]} />
            </View>
            <Text style={[styles.small, { width: 40, textAlign: 'right', color: m.state === 'done' ? colors.green : styles.small.color }]}>
              {m.state === 'done' ? '✓' : m.state === 'going' ? `${Math.round(pct * 100)}%` : m.state === 'waiting' ? 'soon' : '–'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
