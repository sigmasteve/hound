import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getCareOverview, type CareOverview } from '../care/care';

// Admin → Bath and treats (0169): baths given, treats baked, fed and
// sent to friends. Reloads each time Admin comes into view.
export function CareAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<CareOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getCareOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_care_overview/.test(e.message)
              ? 'Run 0169_care_and_home.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the bath and treat numbers.',
          ),
        );
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['Baths, last 7 days', `${data.baths7d} · ${data.bathers7d} ${data.bathers7d === 1 ? 'person' : 'people'}`],
        ['Baths ever', `${data.bathsAll} · ${data.bathersAll} ${data.bathersAll === 1 ? 'person' : 'people'}`],
        ['Treats baked, last 7 days', `${data.made7d} · ${data.bakers7d} ${data.bakers7d === 1 ? 'baker' : 'bakers'} · ${data.bones7d.toLocaleString()} Bones`],
        ['Treats baked ever', `${data.madeAll} · ${data.bakersAll} ${data.bakersAll === 1 ? 'baker' : 'bakers'}`],
        ['Fed, last 7 days', `${data.fed7d}`],
        ['Sent to friends', `${data.gifted7d} in the last 7 days · ${data.giftedAll} ever`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Bath and treats</Text>
      <Text style={styles.footNote}>
        A long walk (30 minutes or 3,000 steps) makes the hound muddy; a bath is earned by that walk, 8,000 steps or goals
        done, once a day. Treats are baked from spare walk finds plus Bones (not counted in the Shop fold).
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
          <View style={styles.row}>
            <Text style={styles.label}>Baked, by recipe</Text>
            {data.byRecipe.map((r) => (
              <Text key={r.id} style={styles.person}>
                {r.name} <Text style={styles.label}>· {r.made}</Text>
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
