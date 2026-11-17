import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getKennelUnlocksOverview, type KennelUnlocksOverview } from '../admin/kennelUnlocksOverview';

// Admin → Kennel unlocks: the Kennel opens up level by level (0216). For
// each step, how many active people have reached it and how many use it.
// Reloads each time Admin comes into view.
export function KennelUnlocksAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<KennelUnlocksOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getKennelUnlocksOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_kennel_unlocks_overview/.test(e.message)
              ? 'Run 0216_kennel_unlocks.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Kennel numbers.',
          ),
        );
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Kennel unlocks</Text>
      <Text style={styles.footNote}>
        People active in the last 30 days. Reached: at that level or past it. Using: has bought, planted, baked or
        gifted it (including anyone who had it before the ladder).
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Active, last 30 days</Text>
            <Text style={styles.value}>
              {data.active30d} · {data.justStarting} still on level 0 or 1
            </Text>
          </View>
          {data.unlocks.map((u) => (
            <View key={u.key} style={styles.row}>
              <Text style={styles.label}>
                Level {u.level} · {u.name}
              </Text>
              <Text style={styles.value}>
                {u.reached} reached · {u.using} using
              </Text>
            </View>
          ))}
        </>
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
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
