import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { getChallengesOverview, type ChallengesOverview } from '../admin/challengesOverview';

const kindName = (kind: string) => CHALLENGE_TYPES.find((t) => t.id === kind)?.name ?? kind;

// "11/2": short, so eight weeks fit on a phone.
const weekLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });

// Admin → Challenges (0180): what's running on Hound, of which kinds, who
// made it, and how many are made each week.
export function ChallengesAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ChallengesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getChallengesOverview()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_challenges_overview/.test(e.message)
              ? 'Run 0180_admin_challenges_overview.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the challenge numbers.',
          ),
        );
    }, []),
  );

  const played = data ? data.byKind.filter((k) => k.allTime > 0) : [];
  const neverPlayed = data ? data.byKind.filter((k) => k.allTime === 0) : [];
  const maxWeek = data ? Math.max(1, ...data.weekly.map((w) => w.created)) : 1;
  const s = data?.bySource;
  const rows: [string, string][] = data
    ? [
        [
          'Running now',
          `${data.running} · ${data.peopleRunning} ${data.peopleRunning === 1 ? 'person' : 'people'} taking part, about ${data.avgPeopleRunning} each · ${data.upcoming} coming up`,
        ],
        ['Made', `${data.created7d} this week · ${data.created30d} in 30 days, by ${data.creators30d} ${data.creators30d === 1 ? 'person' : 'people'}`],
        [
          'Who made them (running · 30 days · all)',
          `Friends ${s!.friends.running} · ${s!.friends.created30d} · ${s!.friends.all}\n` +
            `Community ${s!.community.running} · ${s!.community.created30d} · ${s!.community.all}\n` +
            `Global ${s!.global.running} · ${s!.global.created30d} · ${s!.global.all}`,
        ],
        ['Finished', `${data.finished30d} in the last 30 days · ${data.all} challenges in all`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Challenges</Text>
      <Text style={styles.footNote}>
        Every challenge on Hound: friends&rsquo; ones, community codes and global ones. Running means started and not
        ended. Community challenges taken down aren&rsquo;t counted.
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

          <View style={[styles.row, { gap: 6 }]}>
            <Text style={styles.label}>By game</Text>
            <View style={styles.tableRow}>
              <Text style={[styles.th, styles.nameCol]}>Game</Text>
              <Text style={styles.th}>Running</Text>
              <Text style={styles.th}>In them</Text>
              <Text style={styles.th}>30 days</Text>
              <Text style={styles.th}>All</Text>
            </View>
            {played.map((k) => (
              <View key={k.kind} style={styles.tableRow}>
                <Text style={[styles.td, styles.nameCol]} numberOfLines={1}>
                  {kindName(k.kind)}
                </Text>
                <Text style={styles.td}>{k.running}</Text>
                <Text style={styles.td}>{k.peopleRunning}</Text>
                <Text style={styles.td}>{k.created30d}</Text>
                <Text style={styles.td}>{k.allTime}</Text>
              </View>
            ))}
            {neverPlayed.length > 0 && (
              <Text style={styles.footNote}>Not played yet: {neverPlayed.map((k) => kindName(k.kind)).join(', ')}.</Text>
            )}
          </View>

          <View style={[styles.row, { gap: 6 }]}>
            <Text style={styles.label}>Made each week (last 8, by the Monday it starts)</Text>
            <View style={styles.bars}>
              {data.weekly.map((w) => (
                <View key={w.week} style={styles.barCol}>
                  <Text style={styles.barNum}>{w.created}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { height: `${Math.max(4, (w.created / maxWeek) * 100)}%` }]} />
                  </View>
                  <Text style={styles.barLabel} numberOfLines={1}>
                    {weekLabel(w.week)}
                  </Text>
                </View>
              ))}
            </View>
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
    tableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    nameCol: { flex: 2.4, textAlign: 'left' },
    th: { flex: 1, fontSize: 11.5, color: withAlpha(colors.text, 0.5), textAlign: 'right' },
    td: { flex: 1, fontFamily: font.heading, fontSize: 14, color: colors.text, textAlign: 'right' },
    bars: { flexDirection: 'row', gap: 6, height: 110, alignItems: 'flex-end' },
    barCol: { flex: 1, alignItems: 'center', gap: 3, height: '100%' },
    barNum: { fontSize: 11, fontFamily: font.heading, color: colors.text },
    barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
    bar: { width: '100%', borderRadius: 4, backgroundColor: colors.accent },
    barLabel: { fontSize: 10, color: withAlpha(colors.text, 0.5) },
  });
}
