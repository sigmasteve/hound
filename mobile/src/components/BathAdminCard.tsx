import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBathOverview, saveBathSettings, type BathEarned, type BathOverview } from '../care/care';
import { HAIRDOS } from '../kennel/HoundArt';

const EARNED_NAMES: Record<BathEarned, string> = {
  walk: 'Long walk',
  steps: '6,000 steps',
  goal: 'Goals done',
  pack: 'Bones pack',
};

// Admin → Bath time (0177): who plays the bath game, how it goes, the
// Bones it pays, and its numbers (bubbles a bath, the golden one).
export function BathAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<BathOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState('');
  const [golden, setGolden] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      getBathOverview()
        .then((d) => {
          setData(d);
          setError(null);
          setBubbles(String(d.bubbles));
          setGolden(String(d.goldenBones));
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_bath_overview/.test(e.message)
              ? 'Run 0177_bath_play.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the bath numbers.',
          ),
        );
    }, []),
  );

  const save = async () => {
    const b = Number(bubbles);
    const g = Number(golden);
    if (![b, g].every((x) => Number.isInteger(x) && x >= 0)) {
      setSaveNote({ ok: false, text: 'Whole numbers only.' });
      return;
    }
    if (b > 30 || g > 100) {
      setSaveNote({ ok: false, text: 'At most 30 bubbles, and 100 Bones for the golden one.' });
      return;
    }
    setSaving(true);
    setSaveNote(null);
    try {
      await saveBathSettings(b, g);
      setSaveNote({ ok: true, text: `Saved. Baths from now on pay up to ${b + g} Bones.` });
    } catch (err) {
      setSaveNote({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const baths7d = data ? data.played7d + data.quick7d : 0;
  const rows: [string, string][] = data
    ? [
        ['This week', `${data.played7d} played by ${data.players7d} · ${data.quick7d} quick baths`],
        [
          'Bubbles this week',
          `${data.bubbles7d} popped · ${data.golden7d} golden found · ${data.allBubbles7d} ${data.allBubbles7d === 1 ? 'bath' : 'baths'} with every bubble`,
        ],
        ['Bones paid', `${data.bones7d} this week · ${data.bonesAll} in all`],
        [
          'Styled this week',
          data.styled7d
            ? `${data.styled7d} of ${data.played7d} played · ` +
              HAIRDOS.map((h) => `${h.name} ${data.hairdos7d[h.id] ?? 0}`).join(' · ')
            : 'No ’dos picked yet this week',
        ],
        ['All time', `${data.playedAll} played by ${data.playersAll} ${data.playersAll === 1 ? 'person' : 'people'}`],
        [
          'Earned by (this week)',
          baths7d
            ? (Object.keys(EARNED_NAMES) as BathEarned[]).map((k) => `${EARNED_NAMES[k]} ${data.byEarned7d[k] ?? 0}`).join(' · ')
            : 'No baths yet this week',
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Bath time</Text>
      <Text style={styles.footNote}>
        One bath a day, earned by a long walk, 6,000 steps, goals done or a Bones pack that day. Played: scrub, pop the bubbles
        for Bones, rinse, dry, then pick a ’do (kept until the next long walk). Quick: no game, no Bones.
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
            <Text style={text.h4}>Bones a bath</Text>
            <Text style={styles.footNote}>
              Each bubble popped is +1. The golden bubble pays its own amount (0 leaves it out). The server caps a bath at these
              numbers, whatever the phone says.
            </Text>
            <View style={styles.fields}>
              <View style={styles.field}>
                <TextField label="Bubbles" value={bubbles} onChangeText={(v) => { setBubbles(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={2} />
              </View>
              <View style={styles.field}>
                <TextField label="Golden bubble" value={golden} onChangeText={(v) => { setGolden(v); setSaveNote(null); }} keyboardType="number-pad" maxLength={3} />
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
