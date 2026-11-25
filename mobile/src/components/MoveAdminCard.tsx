import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { AdminNote } from './AdminParts';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getMoveOverview, getMoveRates, setMoveConfig, type MoveOverview, type MoveRate } from '../move/moveApi';
import { ACTIVITY_LABEL, ROUTINES } from '../move/move';

// Admin → Overview → Fitness → Move points (0270): who times sessions in
// Hound, routines and strength logs, new bests, where the week's workout
// minutes came from (a watch, by hand, timed in Hound), the strength goals
// people set, and Move points challenges.
export function moveSummary(d: MoveOverview): string {
  return `${d.timedPeople7d} timed in Hound this week · ${d.moveChallengesLive} Move points ${d.moveChallengesLive === 1 ? 'challenge' : 'challenges'} live`;
}

export function MoveAdminCard({ onLoaded }: { onLoaded?: (d: MoveOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MoveOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useFocusEffect(
    useCallback(() => {
      getMoveOverview()
        .then((d) => {
          setData(d);
          setError(null);
          loaded.current?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_move_overview/.test(e.message)
              ? 'Run 0270_move_points.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Move numbers.',
          ),
        );
    }, []),
  );

  const m = data?.minutes7d;
  const allMin = m ? m.device + m.hand + m.hound : 0;
  const pct = (n: number) => (allMin ? `${Math.round((n / allMin) * 100)}%` : '—');
  const rows: [string, string][] = data
    ? [
        ['Have timed a session in Hound', `${data.timedPeople} · ${data.timedPeople7d} this week`],
        ['Guided routines / strength logs, 7 days', `${data.routines7d} / ${data.strengthLogs7d}`],
        [
          'Most-run routines',
          data.topRoutines.length ? data.topRoutines.map((r) => `${ROUTINES.find((x) => x.id === r.ref)?.short ?? r.ref} ${r.n}`).join(' · ') : '—',
        ],
        ['New bests, 7 days', `${data.prs7d}`],
        ['People with a workout that earns points, 7 days', `${data.peopleWithActivity7d}`],
        [
          'Workout minutes, 7 days',
          m ? `${allMin.toLocaleString()}: watch ${pct(m.device)} · by hand ${pct(m.hand)} · timed in Hound ${pct(m.hound)}` : '—',
        ],
        [
          'Activities, 7 days',
          Object.entries(data.byActivity7d)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([k, n]) => `${ACTIVITY_LABEL[k] ?? k} ${n}`)
            .join(' · ') || '—',
        ],
        [
          'Strength goals set (a week)',
          Object.entries(data.goals)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([k, n]) => `${k}: ${n}`)
            .join(' · ') || 'None yet (2 to start)',
        ],
        ['Move points challenges', `${data.moveChallengesLive} live · ${data.moveChallenges} ever`],
        ['By hand, per day', `${data.handCapMin} min (Bones → Move points)`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Move points</Text>
      <Text style={styles.footNote}>
        Steps plus every workout, by how hard it is. Timed in Hound (guided routines, strength logs) or from a watch counts in full; by hand, up to the
        daily cap.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

// Admin → Bones → Move points: points a minute for each activity, and the
// minutes by hand that count a day. Changes apply to what's recorded after.
export function MoveRatesCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rates, setRates] = useState<MoveRate[] | null>(null);
  const [input, setInput] = useState<Record<string, string>>({});
  const [cap, setCap] = useState('120');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getMoveRates()
        .then(({ rates: r, handCapMin }) => {
          setRates(r);
          setInput(Object.fromEntries(r.map((x) => [x.activity, String(x.perMin)])));
          setCap(String(handCapMin));
          setError(null);
        })
        .catch((e) => setError(e instanceof Error && /move_rates/.test(e.message) ? 'Run 0270_move_points.sql to set these.' : 'Could not load the rates.'));
    }, []),
  );

  const save = async () => {
    if (!rates) return;
    const out: Record<string, number> = {};
    for (const r of rates) {
      const n = Number(input[r.activity]);
      if (!Number.isInteger(n) || n < 0 || n > 1000) {
        setError(`Enter whole points a minute (0 to 1,000) for “${r.label}”.`);
        return;
      }
      if (n !== r.perMin) out[r.activity] = n;
    }
    const c = Number(cap);
    if (!Number.isInteger(c) || c < 0 || c > 1440) {
      setError('Enter whole minutes by hand, 0 to 1,440.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setMoveConfig({ rates: out, handCapMin: c });
      setRates(rates.map((r) => (out[r.activity] !== undefined ? { ...r, perMin: out[r.activity] } : r)));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Move points</Text>
      <AdminNote
        short="Points a minute for each activity. 1 point = 1 step's worth."
        more="Started at 100 × MET ÷ 3.5, so a brisk walk earns what its steps do. Walking, running and hiking stay 0: their steps already count. A workout keeps the rate it was recorded with, so a change applies to what's recorded after it."
      />
      {error && <Text style={styles.loadError}>{error}</Text>}
      {!rates ? (
        !error && <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {rates.map((r) => (
            <TextField
              key={r.activity}
              label={r.label}
              value={input[r.activity] ?? ''}
              onChangeText={(v) => {
                setInput({ ...input, [r.activity]: v });
                setSaved(false);
              }}
              keyboardType="number-pad"
            />
          ))}
          <TextField
            label="By hand: minutes a day that count"
            value={cap}
            onChangeText={(v) => {
              setCap(v);
              setSaved(false);
            }}
            keyboardType="number-pad"
          />
          {saved && !error && <Text style={styles.success}>Saved.</Text>}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" disabled={saving} onPress={save} />
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    success: { fontSize: 12.5, color: colors.green },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
