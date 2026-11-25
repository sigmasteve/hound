import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getHoundClubsOverview, type HoundClubNumbers } from '../clubs/clubsApi';

// Admin → Overview → Fitness → Hound clubs (0262): each Hound club's
// members, joins this week, and for a Fasting one who fasts there.
export function houndClubsSummary(list: HoundClubNumbers[]): string {
  if (list.length === 0) return 'None yet: make one from a public club’s page (⋯)';
  const members = list.reduce((n, c) => n + c.members, 0);
  return `${list.length} ${list.length === 1 ? 'club' : 'clubs'} · ${members} ${members === 1 ? 'member' : 'members'}`;
}

export function HoundClubsAdminCard({ onLoaded }: { onLoaded?: (l: HoundClubNumbers[]) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [list, setList] = useState<HoundClubNumbers[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useFocusEffect(
    useCallback(() => {
      getHoundClubsOverview()
        .then((l) => {
          setList(l);
          setError(null);
          loaded.current?.(l);
        })
        .catch((e) =>
          setError(e instanceof Error && /admin_hound_clubs_overview/.test(e.message) ? 'Run 0262_hound_clubs.sql to see these.' : 'Could not load the Hound clubs.'),
        );
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hound clubs</Text>
      <Text style={styles.note}>
        Open to everyone, no member cap, featured on the Clubs tab. Make a public club one from its page: ⋯ → Make it a Hound club.
      </Text>
      {error ? (
        <Text style={styles.warn}>{error}</Text>
      ) : !list ? (
        <ActivityIndicator color={colors.accent} />
      ) : list.length === 0 ? (
        <Text style={styles.note}>None yet.</Text>
      ) : (
        list.map((c) => (
          <View key={c.id} style={styles.row}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={styles.label}>
              {c.members} members · {c.joined7d} joined this week
            </Text>
            {(c.sport === 'fasting' || c.fasters > 0) && (
              <Text style={styles.label}>
                {c.fasters} have fasted · {c.fasted7d} this week · {c.fastingNow} fasting now
              </Text>
            )}
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
    name: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
  });
}
