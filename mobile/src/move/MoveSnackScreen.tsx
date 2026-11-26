import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { ArrowLeftIcon, FootprintsIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { hasLiveFeatures, pedometerStepsSince, watchLiveSteps } from '../packFun/packFunSensors';
import { finishSnack, getMySnacks, startSnack, type MySnacks, type Snack } from './moveApi';
import { saveSnackNudges } from './snackNudges';
import { clockMS } from './move';

// A movement snack (0275): "250 steps in the next 10 minutes?". The
// phone's own step counter fills the ring; done in time, the server pays
// the Bones (up to the day's paid snacks). Opened from a nudge, or Move's
// "Take one now".
export function MoveSnackScreen({ source, onBack }: { source: 'nudge' | 'self'; onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [me, setMe] = useState<MySnacks | null | undefined>(undefined);
  const [snack, setSnack] = useState<Snack | null>(null);
  const [steps, setSteps] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{ bones: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Steps counted before this screen started watching (a snack resumed),
  // and the latest live count since it did.
  const base = useRef(0);
  const finishing = useRef(false);
  const live = hasLiveFeatures();

  useEffect(() => {
    getMySnacks()
      .then((m) => {
        setMe(m);
        if (m?.today.open) setSnack(m.today.open);
      })
      .catch((e) => {
        setMe(null);
        setError(e instanceof Error ? e.message : 'Could not load.');
      });
  }, []);

  // Count from the snack's start: the motion chip's steps since then (on
  // iPhone, which also covers time Hound was in the background), plus the
  // live count while the screen's open.
  useEffect(() => {
    if (!snack || result) return;
    let stop = () => {};
    let cancelled = false;
    const catchUp = async () => {
      const since = await pedometerStepsSince(new Date(snack.startedAt));
      if (!cancelled && since !== null) setSteps((s) => Math.max(s, since));
      return since;
    };
    (async () => {
      const since = await catchUp();
      base.current = since ?? 0;
      if (cancelled) return;
      stop = watchLiveSteps((n) => setSteps((s) => Math.max(s, base.current + n)));
    })();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void catchUp();
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      cancelled = true;
      stop();
      sub.remove();
      clearInterval(t);
    };
  }, [snack, result]);

  const left = snack ? Math.max(0, new Date(snack.expiresAt).getTime() - now) / 1000 : 0;
  const timeUp = !!snack && !result && left <= 0;

  const finish = useCallback(
    async (count: number) => {
      if (!snack || finishing.current) return;
      finishing.current = true;
      setBusy(true);
      try {
        const r = await finishSnack(snack.id, count);
        setResult({ bones: r.bones });
        if (r.bones > 0) notifyBonesChanged();
        if (me) {
          const next = { ...me, today: r.today };
          setMe(next);
          saveSnackNudges(next).catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save it.');
        finishing.current = false;
      } finally {
        setBusy(false);
      }
    },
    [snack, me],
  );

  useEffect(() => {
    if (snack && !result && steps >= snack.steps && left > -60) void finish(steps);
  }, [steps, snack, result, left, finish]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startSnack(source);
      finishing.current = false;
      base.current = 0;
      setSteps(0);
      setResult(null);
      setSnack(r.snack);
      if (me) setMe({ ...me, today: r.today });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start.');
    } finally {
      setBusy(false);
    }
  };

  const target = snack?.steps ?? me?.steps ?? 250;
  const minutes = snack?.minutes ?? me?.minutes ?? 10;
  const pct = Math.min(1, steps / Math.max(1, target));
  const R = 84;
  const C = 2 * Math.PI * R;
  const ringCol = result ? colors.green : timeUp ? colors.amber : colors.accent;
  const paidLeft = me ? Math.max(0, me.maxDay - me.today.paid) : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: 'center' }]}>Movement snack</Text>
        <View style={{ width: 20 }} />
      </View>
      <View style={styles.body}>
        {me === undefined ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Text style={styles.lead}>
              {result
                ? 'Snack done 🐾'
                : timeUp
                  ? 'Time’s up. So close!'
                  : snack
                    ? 'Keep moving: walk, climb the stairs, march in place.'
                    : `${target} steps in the next ${minutes} minutes?`}
            </Text>
            <View style={{ width: 200, height: 200, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={200} height={200} style={StyleSheet.absoluteFill}>
                <Circle cx={100} cy={100} r={R} stroke={withAlpha(colors.text, 0.08)} strokeWidth={14} fill="none" />
                <Circle
                  cx={100}
                  cy={100}
                  r={R}
                  stroke={ringCol}
                  strokeWidth={14}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${C * pct} ${C}`}
                  transform="rotate(-90 100 100)"
                />
              </Svg>
              <FootprintsIcon size={22} color={ringCol} weight="fill" />
              <Text style={styles.big}>{Math.min(steps, 99999).toLocaleString()}</Text>
              <Text style={styles.small}>of {target} steps</Text>
            </View>
            {snack && !result && !timeUp && <Text style={styles.clock}>{clockMS(left)} left</Text>}
            {result && (
              <View style={[styles.card, { alignItems: 'center' }]}>
                <Text style={styles.win}>{result.bones > 0 ? `+${result.bones} Bones` : 'Done!'}</Text>
                <Text style={styles.small}>
                  {result.bones > 0
                    ? `${me?.today.paid ?? 1} of ${me?.maxDay ?? 3} paid snacks today.`
                    : 'Today’s Bones snacks are used up, but every step still counts.'}
                </Text>
              </View>
            )}
            {!live && (
              <Text style={styles.note}>
                Movement snacks count your phone’s own steps. Allow Motion & Fitness (iPhone) or Physical activity (Android) for Hound in your
                phone’s settings.
              </Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            {me && !snack && (
              <Text style={styles.small}>
                {paidLeft > 0 ? `+${me.bones} Bones each, ${paidLeft} more today.` : 'Today’s Bones snacks are used up, but a snack still counts.'}
              </Text>
            )}
          </>
        )}
      </View>
      <View style={styles.pinned}>
        {result ? (
          <Button label="Done" variant="primary" block onPress={onBack} />
        ) : snack && !timeUp ? (
          <Button label={busy ? 'Saving…' : 'Counting your steps…'} block disabled onPress={() => {}} />
        ) : (
          <Button
            label={busy ? 'Starting…' : timeUp ? 'Try another' : `Start: ${target} steps in ${minutes} min`}
            variant="primary"
            block
            disabled={busy || me === undefined || !live}
            onPress={start}
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
    body: { flex: 1, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', gap: 14 },
    lead: { fontSize: 18, lineHeight: 24, fontFamily: font.headingSemibold, color: colors.text, textAlign: 'center' },
    big: { fontSize: 40, fontFamily: font.headingSemibold, color: colors.text, fontVariant: ['tabular-nums'] },
    clock: { fontSize: 16, fontFamily: font.headingSemibold, color: colors.accentActive, fontVariant: ['tabular-nums'] },
    card: { borderRadius: 16, backgroundColor: colors.surface, padding: 14, gap: 4, alignSelf: 'stretch' },
    win: { fontSize: 26, fontFamily: font.headingSemibold, color: colors.green },
    small: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    note: { fontSize: 13, lineHeight: 18, color: colors.amber, textAlign: 'center' },
    error: { fontSize: 13, color: colors.amber, textAlign: 'center' },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  });
}
