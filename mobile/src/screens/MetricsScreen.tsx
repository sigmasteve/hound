import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { DailySteps, WorkoutSample } from '../health/types';

type MetricTab = 'steps' | 'hr' | 'weight';

const CHART_W = 320;
const CHART_H = 150;

function linePath(vals: number[], close: boolean): string {
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * CHART_W,
    CHART_H - 10 - ((v - min) / span) * (CHART_H - 20),
  ]);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const cx = (px + x) / 2;
    d += ` C ${cx.toFixed(1)} ${py.toFixed(1)}, ${cx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return close ? `${d} L ${CHART_W} ${CHART_H} L 0 ${CHART_H} Z` : d;
}

export function MetricsScreen() {
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<MetricTab>('steps');
  const [weekly, setWeekly] = useState<DailySteps[]>([]);
  const [series, setSeries] = useState<number[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSample[]>([]);

  useEffect(() => {
    health.getWeeklySteps().then(setWeekly);
    health.getRecentWorkouts(5).then(setWorkouts);
  }, [health]);

  useEffect(() => {
    if (tab === 'hr') health.getHeartRateSeries(7).then(setSeries);
    else if (tab === 'weight') health.getWeightSeries(7).then(setSeries);
  }, [tab, health]);

  const maxSteps = Math.max(1, ...weekly.map((d) => d.steps));
  const headline =
    tab === 'steps'
      ? { value: `${(weekly.at(-1)?.steps ?? 0).toLocaleString()} steps`, sub: 'today' }
      : tab === 'hr'
        ? { value: series.length ? `${series.at(-1)} bpm` : '—', sub: 'resting, 7-day average' }
        : { value: series.length ? `${series.at(-1)} lb` : '—', sub: 'latest entry' };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Your data</Text>

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: 'steps', label: 'Steps & distance' },
          { value: 'hr', label: 'Heart rate' },
          { value: 'weight', label: 'Weight' },
        ]}
      />

      <Card style={{ gap: 18, padding: 18 }} elevated={false}>
        <View style={styles.headlineRow}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={styles.headlineValue}>{headline.value}</Text>
            <Text style={styles.headlineSub}>{headline.sub}</Text>
          </View>
          <Text style={styles.last7}>Last 7 days</Text>
        </View>

        {tab === 'steps' ? (
          <View style={styles.barRow}>
            {weekly.map((d, i) => {
              const isToday = i === weekly.length - 1;
              return (
                <View key={i} style={styles.barCol}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(6, (d.steps / maxSteps) * 130),
                        backgroundColor: isToday ? colors.accent400 : colors.accent600,
                      },
                      isToday && styles.barToday,
                    ]}
                  />
                  <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>{d.date}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
            <Defs>
              <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#968ae0" stopOpacity={0.35} />
                <Stop offset="1" stopColor="#968ae0" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={linePath(series, true)} fill="url(#fade)" />
            <Path d={linePath(series, false)} fill="none" stroke="#b5abfc" strokeWidth={2.5} strokeLinecap="round" />
          </Svg>
        )}

        <View style={styles.tagRow}>
          <Tag label="Apple Health" variant="neutral" />
          <Tag label="Health Connect" variant="neutral" />
          <Tag label="De-duplicated across devices" variant="outline" />
        </View>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }} elevated={false}>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 1.4 }]}>WORKOUT</Text>
          <Text style={[styles.th, { flex: 1 }]}>WHEN</Text>
          <Text style={[styles.th, styles.thRight]}>DIST</Text>
          <Text style={[styles.th, styles.thRight]}>HR</Text>
        </View>
        {workouts.map((w) => (
          <View key={w.id} style={styles.tableRow}>
            <Text style={[styles.td, { flex: 1.4 }]}>{w.name}</Text>
            <Text style={[styles.td, styles.tdMuted, { flex: 1 }]}>
              {w.when.toLocaleDateString(undefined, { weekday: 'short' })}{' '}
              {w.when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </Text>
            <Text style={[styles.td, styles.tdRight]}>{w.distanceMi ? `${w.distanceMi.toFixed(1)} mi` : '—'}</Text>
            <Text style={[styles.td, styles.tdRight]}>{w.avgHeartRate ?? '—'}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    headlineValue: { fontFamily: font.heading, fontSize: 28, color: colors.text },
    headlineSub: { fontSize: 13, color: withAlpha(colors.text, 0.55) },
    last7: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 160 },
    barCol: { flex: 1, alignItems: 'center', gap: 7, height: '100%', justifyContent: 'flex-end' },
    bar: { width: '100%', maxWidth: 40, borderRadius: 6 },
    barToday: { borderWidth: 1, borderColor: colors.accent },
    barLabel: { fontSize: 11, color: withAlpha(colors.text, 0.55) },
    // Today's bar label sits directly on the Card's own (theme-following)
    // surface, not a fixed dark chip — accentActive reads correctly on
    // either theme where a raw accent200 would go invisible on Light's
    // white surface (see tokens.ts's own comment on accentActive).
    barLabelToday: { color: colors.accentActive },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tableHeader: {
      flexDirection: 'row',
      padding: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.12),
    },
    th: { fontSize: 10.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    thRight: { flex: 0.7, textAlign: 'right' },
    tableRow: {
      flexDirection: 'row',
      padding: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.06),
    },
    td: { fontSize: 13, color: colors.text },
    tdMuted: { color: withAlpha(colors.text, 0.55) },
    tdRight: { flex: 0.7, textAlign: 'right' },
  });
}
