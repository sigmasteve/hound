import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, CheckIcon, PlusIcon, TrophyIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { clockMS, fmtPts, templateById } from './move';
import { cancelMoveSession, finishMoveSession, getExerciseHistory, getMoveRates, startMoveSession, type ExerciseHistory, type MoveFinish } from './moveApi';
import { MoveFinishView } from './MoveParts';

// A strength log (0270): a template's exercises, sets you tick as you go
// (weights optional), timed on the server while it's open. A ticked set
// past your best for that exercise lights up as a new best.

interface SetRow {
  weight: string;
  reps: string;
  done: boolean;
}
interface Exercise {
  name: string;
  sets: SetRow[];
}

const newSet = (w = '', r = ''): SetRow => ({ weight: w, reps: r, done: false });

export function MoveStrengthScreen({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const template = templateById(templateId);
  const [history, setHistory] = useState<Record<string, ExerciseHistory>>({});
  const [exercises, setExercises] = useState<Exercise[]>(() => template.exercises.map((name) => ({ name, sets: [newSet(), newSet()] })));
  const [session, setSession] = useState<{ id: string; startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [hard, setHard] = useState(false);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MoveFinish | null>(null);
  // Points a minute, light and hard (Admin's rates).
  const [rate, setRate] = useState({ light: 100, heavy: 170 });

  useEffect(() => {
    getMoveRates()
      .then(({ rates }) =>
        setRate({
          light: rates.find((r) => r.activity === 'strength_light')?.perMin ?? 100,
          heavy: rates.find((r) => r.activity === 'strength_heavy')?.perMin ?? 170,
        }),
      )
      .catch(() => {});
    startMoveSession('strength', template.id)
      .then((s) => setSession({ id: s.id, startedAt: Date.now() }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not start.'));
    getExerciseHistory()
      .then((h) => {
        setHistory(h);
        // Start each exercise at what you did last time.
        setExercises((xs) =>
          xs.map((x) => {
            const last = h[x.name.toLowerCase()];
            return last && !x.sets.some((s) => s.done || s.weight || s.reps)
              ? { ...x, sets: x.sets.map(() => newSet(last.lastWeightLb ? String(last.lastWeightLb) : '', last.lastReps ? String(last.lastReps) : '')) }
              : x;
          }),
        );
      })
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [template.id]);

  const mins = session ? Math.max(1, Math.round((now - session.startedAt) / 60000)) : 0;
  const doneSets = exercises.flatMap((x) => x.sets.map((s, i) => ({ x, s, i }))).filter(({ s }) => s.done && Number(s.reps) > 0);

  const update = (xi: number, si: number, patch: Partial<SetRow>) =>
    setExercises((xs) => xs.map((x, i) => (i !== xi ? x : { ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) })));

  // Would this ticked set beat your best so far (heavier, or as heavy with more reps)?
  const isBest = (name: string, s: SetRow) => {
    const h = history[name.toLowerCase()];
    if (!h || !s.done) return false;
    const w = Number(s.weight) || 0;
    return h.bestWeightLb !== null ? w > h.bestWeightLb : w > 0;
  };

  const finish = async () => {
    if (!session) return;
    if (doneSets.length === 0) {
      Alert.alert('Nothing ticked yet', 'Tick the sets you’ve done, then finish.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sets = exercises.flatMap((x) =>
        x.sets
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.done && Number(s.reps) > 0)
          .map(({ s, i }) => ({ exercise: x.name, setNo: i + 1, weightLb: Number(s.weight) > 0 ? Number(s.weight) : null, reps: Math.round(Number(s.reps)) })),
      );
      setResult(await finishMoveSession(session.id, mins, hard, sets));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save it.');
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (!session || result) return onBack();
    Alert.alert('Leave this log?', doneSets.length ? 'Finish to save it, or leave without saving.' : 'Nothing is saved yet.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          cancelMoveSession(session.id).catch(() => {});
          onBack();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>{template.id === 'own' ? 'Strength' : template.name}</Text>
        <View style={{ width: 20 }} />
      </View>
      {result ? (
        <ScrollView contentContainerStyle={styles.body}>
          <MoveFinishView title={template.id === 'own' ? 'Strength' : template.name} result={result} timed />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.between}>
            <Text style={styles.small}>
              {session ? (
                <>
                  Timing · <Text style={styles.strong}>{clockMS((now - session.startedAt) / 1000)}</Text>
                </>
              ) : (
                'Starting…'
              )}
            </Text>
            <Text style={styles.small}>Weights optional</Text>
          </View>
          {exercises.map((x, xi) => {
            const h = history[x.name.toLowerCase()];
            const best = x.sets.some((s) => isBest(x.name, s));
            return (
              <View key={`${x.name}-${xi}`} style={styles.ex}>
                <View style={styles.between}>
                  <Text style={styles.strong}>{x.name}</Text>
                  {best && (
                    <View style={[styles.tag, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
                      <TrophyIcon size={12} color={colors.accentActive} weight="fill" />
                      <Text style={[styles.tagText, { color: colors.accentActive }]}>New best</Text>
                    </View>
                  )}
                </View>
                {x.sets.map((s, si) => (
                  <View key={si} style={styles.set}>
                    <Text style={styles.setNo}>{si + 1}</Text>
                    <TextInput
                      style={styles.input}
                      value={s.weight}
                      onChangeText={(v) => update(xi, si, { weight: v.replace(/[^0-9.]/g, '') })}
                      placeholder="lb"
                      placeholderTextColor={withAlpha(colors.text, 0.35)}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`${x.name} set ${si + 1} weight`}
                    />
                    <TextInput
                      style={styles.input}
                      value={s.reps}
                      onChangeText={(v) => update(xi, si, { reps: v.replace(/[^0-9]/g, '') })}
                      placeholder="reps"
                      placeholderTextColor={withAlpha(colors.text, 0.35)}
                      keyboardType="number-pad"
                      accessibilityLabel={`${x.name} set ${si + 1} reps`}
                    />
                    <Pressable
                      onPress={() => update(xi, si, { done: !s.done })}
                      style={[styles.chk, s.done && { backgroundColor: colors.green, borderColor: colors.green }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: s.done }}
                      accessibilityLabel={`Set ${si + 1} done`}
                      hitSlop={6}
                    >
                      {s.done && <CheckIcon size={15} color="#fff" weight="bold" />}
                    </Pressable>
                  </View>
                ))}
                <View style={styles.between}>
                  <Text style={styles.small}>
                    {h ? `Last time: ${h.lastWeightLb ? `${h.lastWeightLb} lb × ` : '× '}${h.lastReps ?? '?'}` : 'First time logging this'}
                  </Text>
                  {x.sets.length < 10 && (
                    <Pressable
                      onPress={() => setExercises((xs) => xs.map((y, i) => (i === xi ? { ...y, sets: [...y.sets, newSet(y.sets.at(-1)?.weight, y.sets.at(-1)?.reps)] } : y)))}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>+ Set</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
          <View style={[styles.ex, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={adding}
              onChangeText={setAdding}
              placeholder="Add an exercise"
              placeholderTextColor={withAlpha(colors.text, 0.4)}
              maxLength={60}
              returnKeyType="done"
            />
            <Pressable
              disabled={!adding.trim()}
              onPress={() => {
                setExercises((xs) => [...xs, { name: adding.trim(), sets: [newSet(), newSet()] }]);
                setAdding('');
              }}
              style={[styles.addBtn, { opacity: adding.trim() ? 1 : 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Add the exercise"
            >
              <PlusIcon size={18} color="#fff" weight="bold" />
            </Pressable>
          </View>
          <View style={[styles.ex, styles.between]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.strong}>A hard session</Text>
              <Text style={styles.small}>Heavy weights or circuits with little rest: worth more a minute.</Text>
            </View>
            <Switch value={hard} onValueChange={setHard} trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.2) }} />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      )}
      <View style={styles.pinned}>
        {result ? (
          <Button label="Done" variant="primary" block onPress={onBack} />
        ) : busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Button
            label={`Finish · ${doneSets.length} ${doneSets.length === 1 ? 'set' : 'sets'} · about ${fmtPts(mins * (hard ? rate.heavy : rate.light))} Move points`}
            variant="primary"
            block
            disabled={!session}
            onPress={finish}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
    body: { padding: 16, gap: 10, paddingBottom: 24 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    strong: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    ex: { borderRadius: 14, backgroundColor: colors.surface, padding: 12, gap: 6 },
    set: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    setNo: { width: 18, fontSize: 13, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.5) },
    input: {
      flex: 1,
      width: 0,
      minWidth: 0,
      minHeight: 40,
      borderRadius: 9,
      backgroundColor: withAlpha(colors.text, 0.06),
      paddingHorizontal: 10,
      fontSize: 16,
      color: colors.text,
      fontFamily: font.body,
    },
    chk: {
      width: 32,
      height: 32,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: withAlpha(colors.text, 0.15),
      alignItems: 'center',
      justifyContent: 'center',
    },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
    tagText: { fontSize: 11.5, fontFamily: font.headingSemibold },
    link: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.accentActive },
    addBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    error: { fontSize: 13, color: colors.amber },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  });
}
