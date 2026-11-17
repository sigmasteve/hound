import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getBonesGrantsOverview, type BonesGrantsOverview } from '../admin/adminApi';

// Admin → Overview → Hound → Bones given (0218): what admins have given
// members, and the latest grants. Give them from a member's page.
export function BonesGivenAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<BonesGrantsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      getBonesGrantsOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_bones_grants_overview/.test(e.message)
              ? 'Run 0218_admin_give_bones.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load Bones given.',
          ),
        );
    }, []),
  );
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Bones given</Text>
      <Text style={styles.foot}>Give Bones from a member&rsquo;s page (People → search → their name). They&rsquo;re for spending, never earned.</Text>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Last 30 days</Text>
            <Text style={styles.value}>
              {data.bones30d.toLocaleString()} Bones · {data.grants30d} {data.grants30d === 1 ? 'grant' : 'grants'} to {data.people30d}{' '}
              {data.people30d === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>All time</Text>
            <Text style={styles.value}>
              {data.bonesAll.toLocaleString()} Bones to {data.peopleAll} {data.peopleAll === 1 ? 'person' : 'people'}
            </Text>
          </View>
          {data.recent.length > 0 && (
            <View style={styles.row}>
              <Text style={styles.label}>Latest</Text>
              {data.recent.map((g, i) => (
                <Text key={i} style={styles.item}>
                  {g.name} · {g.bones.toLocaleString()}
                  <Text style={styles.label}>
                    {' '}
                    by {g.by.split(' ')[0]}, {new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {g.note ? ` · ${g.note}` : ''}
                  </Text>
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
    foot: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    error: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    item: { fontFamily: font.heading, fontSize: 14, color: colors.text },
  });
}
