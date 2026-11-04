import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getRoomOverview, type RoomOverview } from '../care/care';

// Admin → Inside the house (0169): rooms decorated, what's in them, and
// the Bones spent. Reloads each time Admin comes into view.
export function RoomAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<RoomOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getRoomOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_room_overview/.test(e.message)
              ? 'Run 0169_care_and_home.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the room numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Rooms decorated', `${data.rooms} · ${data.rooms7d} added to in the last 7 days`],
        ['Every item in', `${data.fullRooms}`],
        ['Items placed', `${data.placed} · ${data.gifted} of them gifts`],
        ['Bones spent', `${data.bones7d.toLocaleString()} in the last 7 days · ${data.bonesAll.toLocaleString()} ever`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Inside the house</Text>
      <Text style={styles.footNote}>The room is open to everyone, with eight things to buy (also counted in the Shop fold).</Text>
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
          <View style={styles.row}>
            <Text style={styles.label}>Owned, by item</Text>
            {data.byItem.map((r) => (
              <Text key={r.id} style={styles.person}>
                {r.name} <Text style={styles.label}>· {r.owned}</Text>
              </Text>
            ))}
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
    person: { fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
