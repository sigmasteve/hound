import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getPacksAdminOverview, setPackSettings, type PacksAdminOverview } from '../challenges/packWarsApi';
import { PACKS } from '../challenges/packWars';

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}

// Admin → Pack Wars (0174): who's joined, who votes each day, how each
// live game's map stands, and the Bones it pays.
export function PacksAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<PacksAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The settings, as typed.
  const [win, setWin] = useState('');
  const [finish, setFinish] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPacksAdminOverview()
        .then((d) => {
          setData(d);
          setError(null);
          setWin(String(d.settings.winBones));
          setFinish(String(d.settings.finishBones));
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_packs_overview/.test(e.message)
              ? 'Run 0173 and 0174_pack_wars.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Pack Wars numbers.',
          ),
        );
    }, []),
  );

  const save = async () => {
    const [w, fin] = [win, finish].map(Number);
    if (![w, fin].every((x) => Number.isInteger(x) && x >= 0 && x <= 1000)) {
      setSaveNote({ ok: false, text: 'Whole numbers from 0 to 1,000.' });
      return;
    }
    setSaving(true);
    setSaveNote(null);
    try {
      await setPackSettings({ winBones: w, finishBones: fin });
      setSaveNote({ ok: true, text: 'Saved. Games that end from now on pay these.' });
    } catch (err) {
      setSaveNote({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const rows: [string, string][] = data
    ? [
        ['Challenges', `${data.live} on now · ${data.challenges} in all`],
        ['Joined', `${data.joined} · ${data.everVoted} have voted`],
        ['Voted today', `${data.votedToday} · ${pct(data.holds, data.votes)} of all votes are Hold`],
        ...data.games.map((g): [string, string] => [
          `${g.name} · day ${Math.max(0, Math.min(g.day, g.days))} of ${g.days}`,
          PACKS.map((p) => {
            const x = g.packs[p.id];
            return x ? `${p.name.split(' ')[0]}: ${x.held} held, ${x.votedToday}/${x.members} voted` : '';
          })
            .filter(Boolean)
            .join(' · '),
        ]),
        ['Last 14 days (voted)', data.days.length ? data.days.map((d) => `${d.day.slice(5)}: ${d.voted}`).join(' · ') : 'No votes yet'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Pack Wars</Text>
      <Text style={styles.footNote}>
        Four packs, one map. Voting is the daily check-in: voted against joined is how many come back each day.
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
              Paid when a game ends, on top of the usual 5: everyone in the winning pack (or packs, on a tie), and everyone else.
            </Text>
            <View style={styles.fields}>
              <View style={styles.field}>
                <TextField label="Winning pack" value={win} onChangeText={(v) => { setWin(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={4} />
              </View>
              <View style={styles.field}>
                <TextField label="Everyone else" value={finish} onChangeText={(v) => { setFinish(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={4} />
              </View>
            </View>
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
