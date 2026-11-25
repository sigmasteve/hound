import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getMoonOverview, type MoonOverview } from '../kennel/moonApi';
import { MOON_FORMS } from '../kennel/moonForms';

// Admin → Overview → Hound → Moon forms (0264): who watches the rank
// transformations, how (at a rank up, the catch-up, again from the
// Kennel), how many skip, and who switched the moon look off.
export function moonSummary(d: MoonOverview): string {
  return `${d.watchers} watched · ${d.views7d} scenes this week`;
}

export function MoonAdminCard({ onLoaded }: { onLoaded?: (d: MoonOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<MoonOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useFocusEffect(
    useCallback(() => {
      getMoonOverview()
        .then((d) => {
          setData(d);
          setError(null);
          loaded.current?.(d);
        })
        .catch((e) => setError(e instanceof Error && /admin_moon_overview/.test(e.message) ? 'Run 0264_moon_forms.sql to see these.' : 'Could not load the moon forms.'));
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Have watched a scene', `${data.watchers} · ${data.watchers7d} this week`],
        ['Scenes this week', `${data.views7d} · rank ups ${data.byHow7d.rankup ?? 0} · catch-up ${data.byHow7d.catchup ?? 0} · again ${data.byHow7d.replay ?? 0}`],
        ['Skipped this week', `${data.skipped7d}${data.views7d ? ` (${Math.round((100 * data.skipped7d) / data.views7d)}%)` : ''}`],
        ['Watched again from the Kennel', `${data.replayers} people`],
        ['Catch-up', `${data.catchupOffered} offered · ${data.catchupWatched} watched`],
        ['Watched, by form', MOON_FORMS.map((f) => `${f.form} ${data.byRank[f.rank] ?? 0}`).join(' · ')],
        ['Reached, by form', MOON_FORMS.map((f) => `${f.form} ${data.reached[f.rank] ?? 0}`).join(' · ')],
        ['Switched the moon look off', `${data.switchedOff}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Moon forms</Text>
      <Text style={styles.note}>The cut scene at each new rank (Tracker, Hunter, Alpha, Legend) and the hound’s moon look.</Text>
      {error ? (
        <Text style={styles.warn}>{error}</Text>
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

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    warn: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
