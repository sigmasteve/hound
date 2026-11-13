import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckIcon, MinusIcon, PencilSimpleIcon, PlusIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { WorkoutSample } from '../health/types';
import {
  LOGGED_TYPES,
  getMyLoggedWorkouts,
  isLoggedWorkout,
  logWorkout,
  loggedTypeLabel,
  phoneStepsBetween,
  undoLoggedWorkout,
  type LogResult,
  type LoggedType,
  type LoggedWorkout,
  type MyLoggedWorkouts,
} from './loggedWorkouts';

// Log a workout (0204): for people without a watch. Up to 2 a day, 5 to 90
// minutes, today or yesterday. The server checks every rule and says no in
// a sentence; this just collects the type, the minutes and when it ended.

const PRESETS = [15, 30, 45, 60, 90];
const STEP_MIN = 5;
const TIME_STEP = 15;

const timeText = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Now, rounded down to five minutes.
function nowRounded(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5));
  return d;
}

export function LogWorkoutSheet({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  // After a log or an undo, so whoever shows workouts can read them again.
  onChanged?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const [mine, setMine] = useState<MyLoggedWorkouts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [type, setType] = useState<LoggedType>('strength');
  const [minutes, setMinutes] = useState(30);
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [ended, setEnded] = useState<Date>(nowRounded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LogResult | null>(null);

  const load = useCallback(() => {
    getMyLoggedWorkouts()
      .then((m) => {
        setMine(m);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error && /my_logged_workouts/.test(e.message) ? 'Logging isn’t switched on yet.' : e instanceof Error ? e.message : 'Could not load.'));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setDone(null);
    setError(null);
    setDay('today');
    setEnded(nowRounded());
    load();
  }, [visible, load]);

  const minMin = mine?.minMin ?? 5;
  const maxMin = mine?.maxMin ?? 90;
  const perDay = mine?.perDay ?? 2;
  const valuePct = mine?.valuePct ?? 50;
  const canYesterday = (mine?.backDays ?? 1) >= 1;
  const left = day === 'today' ? (mine?.leftToday ?? perDay) : (mine?.leftYesterday ?? perDay);
  const full = !!mine && left <= 0;

  // The day picked, at the time picked (never later than now).
  const endedAt = useMemo(() => {
    const d = new Date(ended);
    if (day === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      d.setFullYear(y.getFullYear(), y.getMonth(), y.getDate());
    } else {
      const t = new Date();
      d.setFullYear(t.getFullYear(), t.getMonth(), t.getDate());
    }
    const now = new Date();
    return d > now ? nowRounded() : d;
  }, [ended, day]);

  const moveTime = (by: number) => {
    const d = new Date(endedAt.getTime() + by * 60_000);
    const now = new Date();
    if (d > now) return;
    // Stay on the day picked.
    if (!sameDay(d, endedAt)) return;
    setEnded(d);
  };

  const label = loggedTypeLabel(type).toLowerCase();
  const countsAs = Math.round((minutes * valuePct) / 100);
  const halfLine =
    valuePct >= 100
      ? 'they count in full there too'
      : valuePct <= 0
        ? 'they don’t count there'
        : type === 'strength'
          ? `${minutes} min of strength counts as ${countsAs}`
          : `${minutes} min counts as ${countsAs}`;

  const blockedText = !mine
    ? null
    : !mine.enabled
      ? 'Logging workouts is paused right now.'
      : mine.blocked
        ? 'Logging is off for your account. Workouts from a watch or your phone still count.'
        : mine.opensInDays > 0
          ? `Logging opens after your first week. In ${mine.opensInDays} ${mine.opensInDays === 1 ? 'day' : 'days'}. Until then, workouts from a watch or your phone count.`
          : null;

  const submit = async () => {
    if (saving || full || blockedText) return;
    setSaving(true);
    setError(null);
    try {
      const start = new Date(endedAt.getTime() - minutes * 60_000);
      const steps = type === 'walk' || type === 'run' ? await phoneStepsBetween(health, start, endedAt) : null;
      const r = await logWorkout({ type, minutes, endedAt, phoneSteps: steps });
      setDone(r);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!done) return;
    setSaving(true);
    try {
      await undoLoggedWorkout(done.sourceId);
      setDone(null);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) => [styles.chip, on && styles.chipOn];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Log a workout</Text>
          {mine && !blockedText && (
            <Text style={[styles.leftPill, full ? styles.leftPillFull : null]}>
              {full ? 'None left ' + (day === 'today' ? 'today' : 'for yesterday') : `${left} of ${perDay} left ${day === 'today' ? 'today' : 'for yesterday'}`}
            </Text>
          )}
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={20} color={withAlpha(colors.text, 0.65)} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lede}>No watch? Log it here. {perDay} a day, up to {maxMin} minutes each.</Text>

          {loadError ? (
            <Text style={styles.error}>{loadError}</Text>
          ) : !mine ? (
            <ActivityIndicator color={colors.accent} />
          ) : blockedText ? (
            <View style={styles.box}>
              <Text style={styles.boxText}>{blockedText}</Text>
            </View>
          ) : done ? (
            <View style={styles.doneCard}>
              <View style={styles.doneTick}>
                <CheckIcon size={26} color={colors.green} weight="bold" />
              </View>
              <Text style={styles.doneTitle}>
                {loggedTypeLabel(done.type)}, {done.minutes} min logged
              </Text>
              <Text style={styles.doneNote}>
                {sameDay(done.endedAt, new Date()) ? 'Today' : 'Yesterday'}, ended {timeText(done.endedAt)} ·{' '}
                {done.leftToday <= 0 ? 'that was your last one today' : `${done.leftToday} more you can log today`}
              </Text>
              <View style={styles.doneRow}>
                {done.undoUntil && done.undoUntil > new Date() && (
                  <Pressable onPress={undo} disabled={saving} style={styles.ghostBtn} accessibilityRole="button">
                    <Text style={styles.ghostText}>Undo ({mine?.undoMinutes ?? 15} min)</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => (done.leftToday <= 0 ? onClose() : setDone(null))}
                  style={styles.goBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.goText}>{done.leftToday <= 0 ? 'Done' : 'Log another'}</Text>
                </Pressable>
              </View>
              {error && <Text style={styles.error}>{error}</Text>}
            </View>
          ) : (
            <>
              <Text style={styles.label}>What did you do?</Text>
              <View style={styles.grid}>
                {LOGGED_TYPES.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => setType(t.id)}
                    style={chip(type === t.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: type === t.id }}
                  >
                    <Text style={styles.chipText}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>How long?</Text>
              <View style={styles.stepRow}>
                <Pressable
                  onPress={() => setMinutes((m) => Math.max(minMin, m - STEP_MIN))}
                  style={styles.stepBtn}
                  accessibilityRole="button"
                  accessibilityLabel="5 minutes less"
                >
                  <MinusIcon size={18} color={colors.text} weight="bold" />
                </Pressable>
                <Text style={styles.minutes}>
                  {minutes}
                  <Text style={styles.minutesUnit}> min</Text>
                </Text>
                <Pressable
                  onPress={() => setMinutes((m) => Math.min(maxMin, m + STEP_MIN))}
                  style={styles.stepBtn}
                  accessibilityRole="button"
                  accessibilityLabel="5 minutes more"
                >
                  <PlusIcon size={18} color={colors.text} weight="bold" />
                </Pressable>
              </View>
              <View style={styles.presets}>
                {PRESETS.filter((m) => m >= minMin && m <= maxMin).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMinutes(m)}
                    style={[styles.preset, minutes === m && styles.presetOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`${m} minutes`}
                  >
                    <Text style={styles.chipText}>{m}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>When?</Text>
              <View style={styles.whenRow}>
                <View style={styles.segment}>
                  {(canYesterday ? (['today', 'yesterday'] as const) : (['today'] as const)).map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => setDay(d)}
                      style={[styles.segBtn, day === d && styles.segOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: day === d }}
                    >
                      <Text style={[styles.segText, day === d && styles.segTextOn]}>{d === 'today' ? 'Today' : 'Yesterday'}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.stepRow}>
                <Pressable onPress={() => moveTime(-TIME_STEP)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="15 minutes earlier">
                  <MinusIcon size={18} color={colors.text} weight="bold" />
                </Pressable>
                <Text style={styles.endedText}>Ended {timeText(endedAt)}</Text>
                <Pressable onPress={() => moveTime(TIME_STEP)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="15 minutes later">
                  <PlusIcon size={18} color={colors.text} weight="bold" />
                </Pressable>
              </View>

              <View style={styles.box}>
                <Text style={styles.boxText}>
                  <Text style={{ color: colors.green, fontFamily: font.headingSemibold }}>Counts in full</Text> for goals, Daily Doors, streaks, Bingo
                  and 75 Day.{'\n'}
                  <Text style={{ color: colors.amber, fontFamily: font.headingSemibold }}>
                    {valuePct >= 100 ? 'In full' : valuePct <= 0 ? 'Not at all' : 'Half value'}
                  </Text>{' '}
                  in the sports games, Golf power and Global prizes: {halfLine}.{'\n'}
                  Never steps or miles. Friends see it as logged by hand.
                </Text>
              </View>

              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                onPress={submit}
                disabled={saving || full}
                style={[styles.logBtn, (saving || full) && styles.logBtnOff]}
                accessibilityRole="button"
              >
                <Text style={[styles.logText, (saving || full) && styles.logTextOff]}>
                  {full
                    ? day === 'today'
                      ? `That’s ${perDay} logged today. More tomorrow.`
                      : `That’s ${perDay} logged for yesterday.`
                    : saving
                      ? 'Logging…'
                      : `Log ${minutes} min of ${label}`}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// The Goals sheet's "Today's workouts": today's workouts from the phone and
// the logged ones (with the pencil and, for 15 minutes, Undo), then "Log a
// workout".
export function TodaysWorkoutsCard({ workouts, onChanged }: { workouts: WorkoutSample[]; onChanged?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<MyLoggedWorkouts | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    getMyLoggedWorkouts()
      .then(setMine)
      .catch(() => setMine(null));
  }, []);
  useEffect(load, [load]);
  // The undo countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const today = new Date();
  const todays = workouts.filter((w) => sameDay(w.when, today)).sort((a, b) => a.when.getTime() - b.when.getTime());
  const byId = new Map<string, LoggedWorkout>((mine?.logs ?? []).filter((l) => !l.undone && !l.replaced).map((l) => [l.sourceId, l]));
  const perDay = mine?.perDay ?? 2;
  // Undone ones still use up the day, so this comes from what's left.
  const loggedToday = mine ? Math.max(0, perDay - mine.leftToday) : 0;

  const changed = () => {
    load();
    onChanged?.();
  };

  const undo = async (id: string) => {
    try {
      await undoLoggedWorkout(id);
    } catch {
      // The list reloads either way and shows it standing.
    }
    changed();
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>TODAY’S WORKOUTS</Text>
        {mine && (
          <Text style={styles.cardMeta}>
            {loggedToday} of {perDay} logged
          </Text>
        )}
      </View>
      {todays.length === 0 && <Text style={styles.empty}>None yet today.</Text>}
      {todays.map((w) => {
        const logged = isLoggedWorkout(w);
        const log = logged ? byId.get(w.id) : undefined;
        const undoLeft = log?.undoUntil ? Math.ceil((log.undoUntil.getTime() - now) / 60_000) : 0;
        const ended = new Date(w.when.getTime() + (w.durationMin ?? 0) * 60_000);
        return (
          <View key={w.id} style={styles.wRow}>
            <View style={[styles.wIcon, { backgroundColor: logged ? withAlpha(colors.amber, 0.18) : withAlpha(colors.accent, 0.2) }]}>
              {logged ? <PencilSimpleIcon size={17} color={colors.amber} /> : <CheckIcon size={17} color={colors.accentActive} weight="bold" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.wName}>
                {logged && log ? loggedTypeLabel(log.type) : w.name}
                {w.durationMin ? ` · ${Math.round(w.durationMin)} min` : ''}
              </Text>
              <Text style={styles.wNote}>{logged ? `Logged by hand · ${timeText(ended)}` : `${timeText(w.when)} · from ${w.source || 'your phone'}`}</Text>
            </View>
            {logged && log && undoLeft > 0 && (
              <Pressable onPress={() => undo(w.id)} style={styles.undoBtn} accessibilityRole="button" accessibilityLabel="Undo this workout">
                <Text style={styles.undoText}>Undo · {undoLeft} min</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <Pressable onPress={() => setOpen(true)} style={styles.logLink} accessibilityRole="button">
        <PlusIcon size={16} color={colors.green} weight="bold" />
        <Text style={styles.logLinkText}>Log a workout</Text>
      </Pressable>
      <Text style={styles.logHint}>No watch? Log up to {perDay} a day.</Text>
      <LogWorkoutSheet visible={open} onClose={() => setOpen(false)} onChanged={changed} />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
    title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    leftPill: {
      fontFamily: font.headingSemibold,
      fontSize: 12,
      color: colors.green,
      backgroundColor: withAlpha(colors.green, 0.14),
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    leftPillFull: { color: '#ff8a8f', backgroundColor: 'rgba(229,72,77,0.16)' },
    body: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
    lede: { fontSize: 13.5, lineHeight: 20, color: withAlpha(colors.text, 0.72) },
    label: { fontSize: 13, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      width: '32%',
      flexGrow: 1,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipOn: { borderWidth: 2, borderColor: colors.green, backgroundColor: withAlpha(colors.green, 0.16) },
    chipText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepBtn: {
      width: 48,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    minutes: { flex: 1, textAlign: 'center', fontFamily: font.headingSemibold, fontSize: 30, color: colors.text },
    minutesUnit: { fontSize: 14, color: withAlpha(colors.text, 0.65) },
    presets: { flexDirection: 'row', gap: 6 },
    preset: {
      flex: 1,
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presetOn: { borderWidth: 2, borderColor: colors.amber, backgroundColor: withAlpha(colors.amber, 0.16) },
    whenRow: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderRadius: 12, padding: 4 },
    segBtn: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    segOn: { backgroundColor: colors.text },
    segText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    segTextOn: { color: colors.bg },
    endedText: { flex: 1, textAlign: 'center', fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    box: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginTop: 4 },
    boxText: { fontSize: 12.5, lineHeight: 19, color: withAlpha(colors.text, 0.75) },
    error: { fontSize: 13, color: colors.amber },
    logBtn: { minHeight: 52, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
    logBtnOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    logText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#161826', textAlign: 'center' },
    logTextOff: { color: withAlpha(colors.text, 0.6) },
    doneCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, gap: 10, alignItems: 'center' },
    doneTick: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: colors.green,
      backgroundColor: withAlpha(colors.green, 0.18),
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneTitle: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text, textAlign: 'center' },
    doneNote: { fontSize: 13, color: withAlpha(colors.text, 0.72), textAlign: 'center' },
    doneRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
    ghostBtn: {
      flex: 1,
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.18),
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    goBtn: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
    goText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
    card: { backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
    cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
    cardTitle: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    cardMeta: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    empty: { fontSize: 13, color: withAlpha(colors.text, 0.6), paddingVertical: 6 },
    wRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    wIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    wName: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    wNote: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    undoBtn: {
      minHeight: 36,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.18),
      paddingHorizontal: 10,
      justifyContent: 'center',
    },
    undoText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.85) },
    logLink: {
      marginTop: 6,
      minHeight: 46,
      borderRadius: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: withAlpha(colors.green, 0.6),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    logLinkText: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.green },
    logHint: { fontSize: 11.5, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
  });
}
