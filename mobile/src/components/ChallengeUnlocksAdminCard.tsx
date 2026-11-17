import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { getChallengeUnlocksOverview, type ChallengeUnlocksOverview } from '../admin/challengeUnlocksOverview';

// Admin → Game unlocks: for each locked game (set under Challenge
// unlocks), how many active people have earned enough by playing to make
// one, and how many were made in the last 30 days. Reloads each time
// Admin comes into view.
export function ChallengeUnlocksAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ChallengeUnlocksOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getChallengeUnlocksOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_challenge_unlocks_overview/.test(e.message)
              ? 'Run 0217_bones_earned_by_play.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the unlock numbers.',
          ),
        );
    }, []),
  );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Game unlocks</Text>
      <Text style={styles.footNote}>
        People active in the last 30 days. Earned means by playing: goal days and weeks, the daily bonus, Bone Dig,
        badges, challenges and level ups. Bought Bones, ads, bounties and pots don&rsquo;t count.
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
              {data.active30d} · half have earned {data.medianEarned.toLocaleString()} or more
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Can make every game</Text>
            <Text style={styles.value}>{data.openAll}</Text>
          </View>
          {data.gates.length === 0 ? (
            <Text style={styles.footNote}>No games are locked. Lock some under Challenge unlocks.</Text>
          ) : (
            data.gates.map((g) => (
              <View key={g.kind} style={styles.row}>
                <Text style={styles.label}>
                  {CHALLENGE_TYPES.find((t) => t.id === g.kind)?.name ?? g.kind} · {g.bones.toLocaleString()} earned
                </Text>
                <Text style={styles.value}>
                  {g.reached} can make it · {g.made30d} made in 30 days
                </Text>
              </View>
            ))
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
