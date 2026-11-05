import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getDoorsAdminOverview, setDoorsSettings, type DoorsAdminOverview } from '../challenges/doorsApi';
import type { DoorTaskKind } from '../challenges/doors';

const TASK_NAMES: Record<DoorTaskKind, string> = {
  steps: 'Steps',
  workout: 'Workout',
  water: 'Water',
  goal_day: 'All goals',
  treat: 'Treat',
  walk: 'Walk',
  cheer: 'Cheer',
};

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Daily Doors (0172): who's joined, how many open and do their
// door each day, and which tasks get done.
export function DoorsAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DoorsAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The settings, as typed.
  const [every, setEvery] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [finish, setFinish] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      getDoorsAdminOverview()
        .then((d) => {
          setData(d);
          setError(null);
          setEvery(String(d.settings.bonusEvery));
          setLow(String(d.settings.bonusMin));
          setHigh(String(d.settings.bonusMax));
          setFinish(String(d.settings.finishBones));
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_doors_overview/.test(e.message)
              ? 'Run 0171 and 0172_doors.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Daily Doors numbers.',
          ),
        );
    }, []),
  );

  const save = async () => {
    const n = [every, low, high, finish].map(Number);
    const [e, lo, hi, fin] = n;
    if (n.some((x) => !Number.isInteger(x) || x < 0)) {
      setSaveNote({ ok: false, text: 'Whole numbers only.' });
      return;
    }
    if (e < 1 || e > 30) {
      setSaveNote({ ok: false, text: 'Bones go behind every 1st to every 30th door.' });
      return;
    }
    if (lo > hi || hi > 500) {
      setSaveNote({ ok: false, text: 'The low amount can’t be over the high one, and the high one is at most 500.' });
      return;
    }
    if (fin > 1000) {
      setSaveNote({ ok: false, text: 'Bones for finishing is at most 1,000.' });
      return;
    }
    setSaving(true);
    setSaveNote(null);
    try {
      await setDoorsSettings({ bonusEvery: e, bonusMin: lo, bonusMax: hi, finishBones: fin });
      setSaveNote({ ok: true, text: 'Saved. Doors opened from now on use these.' });
    } catch (err) {
      setSaveNote({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const rows: [string, string][] = data
    ? [
        ['Challenges', `${data.live} on now · ${data.challenges} in all`],
        ['Joined', `${data.joined} · ${data.everOpened} have opened a door`],
        ['Today', `${data.openedToday} opened · ${data.doneToday} done (${pct(data.doneToday, data.openedToday)})`],
        ['All doors', `${data.opens} opened · ${data.done} done (${pct(data.done, data.opens)}) · ${data.prizes} last-door prizes`],
        ...data.games.map((g): [string, string] => [
          g.name,
          `${g.players} playing · door ${Math.max(0, Math.min(g.door, g.doors))} of ${g.doors} · ${g.openedToday} opened today, ${g.doneToday} done`,
        ]),
        [
          'Tasks done once opened',
          data.tasks.length ? data.tasks.map((t) => `${TASK_NAMES[t.task] ?? t.task} ${pct(t.done, t.opened)}`).join(' · ') : 'No doors opened yet',
        ],
        [
          'Last 14 days (opened / done)',
          data.days.length ? data.days.map((d) => `${d.day.slice(5)}: ${d.opened}/${d.done}`).join(' · ') : 'No doors opened yet',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Daily Doors</Text>
      <Text style={styles.footNote}>
        A door a day. Opening it is the check-in; the task behind it is checked from Health, water, goals and the Kennel. Opened
        against joined is how many come back each day.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          <View style={[styles.row, { gap: 10 }]}>
            <Text style={text.h4}>Bones</Text>
            <Text style={styles.footNote}>
              Behind every Nth door, a random amount from low to high, paid when it&rsquo;s opened. Then Bones for everyone in it when it
              ends, whatever their place (on top of the usual 5). Changes count from the next door opened.
            </Text>
            <View style={styles.fields}>
              <View style={styles.field}>
                <TextField label="Every Nth door" value={every} onChangeText={(v) => { setEvery(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={styles.field}>
                <TextField label="Low" value={low} onChangeText={(v) => { setLow(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={3} />
              </View>
              <View style={styles.field}>
                <TextField label="High" value={high} onChangeText={(v) => { setHigh(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={3} />
              </View>
            </View>
            <TextField label="Bones for finishing" value={finish} onChangeText={(v) => { setFinish(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={4} />
            {saveNote && <Text style={saveNote.ok ? styles.saved : styles.loadError}>{saveNote.text}</Text>}
            <Button label={saving ? 'Saving…' : 'Save'} variant="primary" disabled={saving} onPress={save} />
          </View>
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: {
      gap: 2,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    fields: { flexDirection: 'row', gap: 8 },
    field: { flex: 1 },
    saved: { fontSize: 12.5, color: colors.green },
  });
}
