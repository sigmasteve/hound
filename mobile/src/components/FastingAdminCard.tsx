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
import { getFastingConfig, getFastingOverview, setFastingConfig, type FastingOverview } from '../fasting/fastingApi';
import { planLabel, type FastingConfig } from '../fasting/fasting';

// Admin → Overview → Fitness → Fasting (0261): who's tried it, who's at
// it now, how they fast, the friends side, and the safety signals.
export function fastingSummary(d: FastingOverview): string {
  return `${d.tried} tried · ${d.fastingNow} fasting now`;
}

export function FastingAdminCard({ onLoaded }: { onLoaded?: (d: FastingOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<FastingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A ref, so a new callback each render doesn't refetch.
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useFocusEffect(
    useCallback(() => {
      getFastingOverview()
        .then((d) => {
          setData(d);
          setError(null);
          loaded.current?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_fasting_overview/.test(e.message)
              ? 'Run 0261_fasting.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the fasting numbers.',
          ),
        );
    }, []),
  );

  const plans = data
    ? Object.entries(data.plans)
        .sort((a, b) => b[1] - a[1])
        .map(([h, n]) => `${planLabel(Number(h))} · ${n}`)
        .join('   ')
    : '';
  const feels = data
    ? ['easy', 'ok', 'tough', 'unwell']
        .filter((k) => data.feel7d[k])
        .map((k) => `${k === 'unwell' ? 'Not well' : k[0].toUpperCase() + k.slice(1)} ${data.feel7d[k]}`)
        .join(' · ')
    : '';
  const rows: [string, string, boolean?][] = data
    ? [
        ['Have fasted', `${data.tried}`],
        ['Fasting right now', `${data.fastingNow}`],
        ['Fasted in the last 7 days', `${data.fasted7d} people · ${data.fasts7d} fasts`],
        ['Median fast, 7 days', data.medianHours7d == null ? '—' : `${data.medianHours7d} h`],
        ['Ended on plan, 7 days', data.onPlanPct7d == null ? '—' : `${data.onPlanPct7d}%`],
        ['Plans (last 30 days, people)', plans || '—'],
        ['Streaks of 7+ / 30+ going', `${data.streak7} / ${data.streak30} · best ever ${data.bestStreak}`],
        ['Pack fasts, 7 days', `${data.packs7d} (${data.packPeople7d} people) · ${data.packsPaid7d} everyone made it`],
        ['Cheers / pack notes, 7 days', `${data.cheers7d} / ${data.notes7d}`],
        ['Clubs with 2+ who fast', `${data.clubsFasting} · ${data.fastingClubs} Fasting ${data.fastingClubs === 1 ? 'club' : 'clubs'}`],
        ['How it felt, 7 days', feels || '—'],
        ['Over 36 h, 7 days', `${data.over36_7d} ended · ${data.openOver36} going now`, data.over36_7d + data.openOver36 > 0],
        ['“Not well” at the end, 7 days', `${data.unwell7d}`, data.unwell7d > 0],
        ['Said under 16', `${data.under16}`],
        ['Not sharing with friends', `${data.notSharing}`],
        ['Bones paid, 7 days', data.bones7d.toLocaleString()],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Fasting</Text>
      <Text style={styles.footNote}>
        Everyone who&rsquo;s started a fast. The amber rows are the ones to watch: very long fasts, and people who ended feeling unwell.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value, warn]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.value, warn && { color: colors.amber }]}>{value}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

const FIELDS: [keyof FastingConfig, string][] = [
  ['bones12', '12 h fast'],
  ['bones14', '14 h fast'],
  ['bones16', '16 h fast'],
  ['bones18', '18 h fast'],
  ['bones20', '20 h fast (and longer)'],
  ['streak3', '3 days on plan in a row'],
  ['streak7', '7 days in a row'],
  ['streak14', '14 days in a row'],
  ['streak30', '30 days in a row'],
  ['streak100', '100 days in a row'],
  ['packBonus', 'Pack fast, everyone made it (each)'],
];

// Admin → Bones → Fasting: what fasting pays.
export function FastingBonesCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [input, setInput] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getFastingConfig()
        .then((c) => setInput(Object.fromEntries(FIELDS.map(([k]) => [k, String(c[k])]))))
        .catch((e) =>
          setError(e instanceof Error && /fasting_config/.test(e.message) ? 'Run 0261_fasting.sql to set these.' : 'Could not load the fasting Bones.'),
        );
    }, []),
  );

  const save = async () => {
    if (!input) return;
    const c = {} as FastingConfig;
    for (const [k, label] of FIELDS) {
      const n = Number(input[k]);
      if (!Number.isInteger(n) || n < 0 || n > 100000) {
        setError(`Enter a whole number of Bones for “${label}”.`);
        return;
      }
      c[k] = n;
    }
    setSaving(true);
    setError(null);
    try {
      await setFastingConfig(c);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Fasting</Text>
      <AdminNote
        short="What a fast pays, by the hours it reached, and the streak and pack bonuses."
        more="Paid once a day, for the first fast that ends that day. Nothing more past 20 hours, on purpose: longer fasts aren’t proven better and carry more risk. A streak counts days on plan in a row (rest days and one missed day a week don’t break it). Changes apply to the next fast that ends. These Bones never count toward challenge unlocks."
      />
      {error && <Text style={styles.loadError}>{error}</Text>}
      {!input ? (
        !error && <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {FIELDS.map(([k, label]) => (
            <TextField
              key={k}
              label={label}
              value={input[k]}
              onChangeText={(v) => {
                setInput({ ...input, [k]: v });
                setSaved(false);
              }}
              keyboardType="number-pad"
            />
          ))}
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
