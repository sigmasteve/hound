import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getGardenOverview, type GardenOverview } from '../garden/garden';

function pct(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}

// Admin → Garden (0162): who's planting, what blooms, free seeds and
// seed packs. Reloads each time Admin comes into view.
export function GardenAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<GardenOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getGardenOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_garden_overview/.test(e.message)
              ? 'Run 0162_garden.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the garden numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Have planted something', `${data.gardenersEver}`],
        ['Something growing now', `${data.growingNow}${pct(data.growingNow, data.gardenersEver)}`],
        ['Planted, last 7 days', `${data.planted7d}`],
        ['Bloomed', `${data.bloomed7d} in the last 7 days · ${data.bloomedEver} ever`],
        ['Picked · dug up early', `${data.pickedEver} · ${data.dugUpEver}`],
        ['Free seeds claimed, last 7 days', `${data.freeSeeds7d}`],
        ['Seed packs, last 7 days', `${data.packs7d} · ${data.bones7d.toLocaleString()} Bones`],
        ['Have bought a pack', `${data.packBuyersEver} · ${data.bonesEver.toLocaleString()} Bones in all`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Garden</Text>
      <Text style={styles.footNote}>
        Plants grow with steps after planting: 20,000 for a daisy up to 70,000 for a giant sunflower. One free seed a week;
        packs are bought with Bones (not counted in the Shop fold).
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
          {data.bySeed.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>By seed: planted · bloomed · packs</Text>
              {data.bySeed.map((s) => (
                <Text key={s.id} style={styles.person}>
                  {s.name} <Text style={styles.label}>· {s.planted} · {s.bloomed} · {s.packs}</Text>
                </Text>
              ))}
            </View>
          )}
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
