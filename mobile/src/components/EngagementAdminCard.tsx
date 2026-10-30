import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { ChartLineUpIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getEngagement, type Engagement } from '../admin/engagement';

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Admin → Engagement (0113_admin_engagement.sql): whether people keep
// opening Hound, how far new members get through setup, who comes back,
// and what got used in the last 7 days. Reloads each time Admin comes
// into view.
export function EngagementAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<Engagement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getEngagement()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load engagement.'));
    }, []),
  );

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={styles.header}>
        <ChartLineUpIcon size={18} color={colors.accent} />
        <Text style={[text.h4, { flex: 1 }]}>Engagement</Text>
        {data && <Text style={styles.footNote}>{data.members.toLocaleString()} members</Text>}
      </View>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text style={styles.section}>OPENED THE APP</Text>
            <View style={styles.tiles}>
              {(
                [
                  ['Today', data.active.day],
                  ['Last 7 days', data.active.week],
                  ['Last 30 days', data.active.month],
                ] as const
              ).map(([label, value]) => (
                <View key={label} style={styles.tile}>
                  <Text style={styles.tileValue}>{value.toLocaleString()}</Text>
                  <Text style={styles.tileLabel}>{label}</Text>
                </View>
              ))}
            </View>
            <DailyBars daily={data.daily} styles={styles} />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.section}>NEW MEMBERS, LAST 30 DAYS · {data.newMembers.joined}</Text>
            {(
              [
                ['Connected health', data.newMembers.health],
                ['Said how they’ll use Hound', data.newMembers.uses],
                ['Set their goals', data.newMembers.goals],
                ['Allowed notifications', data.newMembers.notifications],
                ['Added a friend', data.newMembers.friend],
                ['Joined a challenge', data.newMembers.challenge],
                ['Finished setup', data.newMembers.finishedSetup],
                ['Hound as avatar', data.newMembers.houndAvatar],
              ] as const
            ).map(([label, value]) => (
              <Funnel key={label} label={label} part={value} whole={data.newMembers.joined} styles={styles} />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.section}>COMING BACK</Text>
            <Funnel
              label="Opened it the day after joining"
              part={data.cameBack.nextDay}
              whole={data.cameBack.nextDayOf}
              styles={styles}
            />
            <Funnel
              label="Opened it in their second week"
              part={data.cameBack.secondWeek}
              whole={data.cameBack.secondWeekOf}
              styles={styles}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.section}>LAST 7 DAYS</Text>
            <View style={styles.grid}>
              {(
                [
                  ['Goal days', data.week.goalDays],
                  ['Hounds treated or fed', data.week.treats],
                  ['Kennel items bought', data.week.kennelItems],
                  ['Bone Digs', data.week.boneDigs],
                  ['Bounties posted', data.week.bounties],
                  ['Challenges started', data.week.challenges],
                  ['Global challenge joins', data.week.globalJoins],
                  ['Sponsor link taps', data.week.sponsorTaps],
                ] as const
              ).map(([label, value]) => (
                <View key={label} style={styles.gridCell}>
                  <Text style={styles.cellValue}>{value.toLocaleString()}</Text>
                  <Text style={styles.cellLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Which dog people picked (0133): the plain hound, and each
              breed as wearing now / ever bought. */}
          <View style={{ gap: 6 }}>
            <Text style={styles.section}>HOUNDS · {data.kennel.kennels.toLocaleString()} KENNELS</Text>
            <View style={styles.grid}>
              <View style={styles.gridCell}>
                <Text style={styles.cellValue}>{data.kennel.hound.toLocaleString()}</Text>
                <Text style={styles.cellLabel}>Hound</Text>
              </View>
              {data.kennel.breeds.map((b) => (
                <View key={b.id} style={styles.gridCell}>
                  <Text style={styles.cellValue}>
                    {b.wearing.toLocaleString()}
                    <Text style={styles.cellLabel}> · {b.bought.toLocaleString()} bought</Text>
                  </Text>
                  <Text style={styles.cellLabel}>{b.name}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.footNote}>
            “Opened the app” counts the daily bonus, which is claimed on the first open each day (UTC days). Coming back
            counts people who joined 2–31 days ago (day after) and 2–8 weeks ago (second week).
          </Text>
        </>
      )}
    </Card>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// People who opened the app each of the last 14 days.
function DailyBars({ daily, styles }: { daily: Engagement['daily']; styles: Styles }) {
  const max = Math.max(1, ...daily.map((d) => d.people));
  if (daily.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.bars} accessibilityLabel={`Daily opens: ${daily.map((d) => d.people).join(', ')}`}>
        {daily.map((d, i) => (
          <View key={d.day} style={styles.barCol}>
            <View style={[styles.bar, i === daily.length - 1 && styles.barToday, { height: `${Math.max(4, (d.people / max) * 100)}%` }]} />
          </View>
        ))}
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.footNote}>{shortDay(daily[0].day)}</Text>
        <Text style={styles.footNote}>Most in a day: {max}</Text>
        <Text style={styles.footNote}>Today</Text>
      </View>
    </View>
  );
}

function Funnel({ label, part, whole, styles }: { label: string; part: number; whole: number; styles: Styles }) {
  const p = pct(part, whole);
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.funnelRow}>
        <Text style={styles.funnelLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.funnelValue}>
          {part} of {whole} · {p}%
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${p}%` }]} />
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    footNote: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    section: { fontSize: 11, letterSpacing: 0.8, fontFamily: font.heading, color: withAlpha(colors.text, 0.55) },
    tiles: { flexDirection: 'row', gap: 8 },
    tile: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.1), gap: 2 },
    tileValue: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] },
    tileLabel: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 56 },
    barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { borderRadius: 3, backgroundColor: withAlpha(colors.accent, 0.45) },
    barToday: { backgroundColor: colors.accent },
    barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    funnelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    funnelLabel: { flex: 1, fontSize: 13, color: colors.text },
    funnelValue: { fontSize: 12, color: withAlpha(colors.text, 0.6), fontVariant: ['tabular-nums'] },
    track: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
    gridCell: { width: '50%', gap: 1 },
    cellValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text, fontVariant: ['tabular-nums'] },
    cellLabel: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
  });
}
