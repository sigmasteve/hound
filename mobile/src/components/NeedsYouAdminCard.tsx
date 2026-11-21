import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getNeedsYouOverview, type NeedsYouOverview } from '../home/needsYouMute';

// Admin → Status → Needs you (0240): who mutes Today's Needs you, for how
// long, and how often they unmute early. A lot of muting means it nags.
export function NeedsYouAdminCard({ onChanged }: { onChanged?: (o: NeedsYouOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<NeedsYouOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getNeedsYouOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_needs_you_overview/.test(e.message)
              ? 'Run 0240_needs_you_mute.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Needs you numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Muted right now', `${data.mutedNow} ${data.mutedNow === 1 ? 'person' : 'people'}`],
        ['This week', `${data.muters7d} ${data.muters7d === 1 ? 'person' : 'people'} muted it ${data.mutes7d} ${data.mutes7d === 1 ? 'time' : 'times'} · ${data.everMuted} ever`],
        ['For how long', `2 hours ${data.byLength7d.h2} · 4 hours ${data.byLength7d.h4} · half a day ${data.byLength7d.h12} · till morning ${data.byLength7d.morning}`],
        ['Unmuted early', `${data.unmutedEarly7d} of ${data.mutes7d}`],
        ['Waiting when muted', data.avgWaiting7d == null ? '–' : `${data.avgWaiting7d} on average`],
        ['Mutes most', data.topMuters.length ? data.topMuters.map((m) => `${m.name.split(' ')[0]} ${m.mutes}`).join(' · ') : '–'],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Needs you</Text>
      <Text style={styles.footNote}>People can mute Today’s Needs you for 2 hours, 4 hours, half a day or till morning. If many do, it’s asking too much.</Text>
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

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
