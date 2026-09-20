import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CaretRightIcon } from 'phosphor-react-native';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { DailySteps, WorkoutSample } from '../health/types';

type MetricTab = 'steps' | 'distance' | 'hr' | 'weight';

const CHART_W = 320;
const CHART_H = 150;
// Bars (and the trend line drawn against them) leave this much clearance
// at the bottom for the day-label row below the Svg, and this much at the
// top so the tallest bar doesn't touch the chart's edge.
const CHART_BOTTOM_PAD = 20;
const CHART_TOP_PAD = 10;

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

// Least-squares line through (0, vals[0]), (1, vals[1])... — just the
// fitted value at the first and last day, which is all a straight trend
// line needs (everything in between is a straight line between those two
// points by construction). Returns null when there's nothing to fit a
// direction to.
function linearTrend(vals: number[]): { start: number; end: number } | null {
  const n = vals.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = vals.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (vals[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { start: intercept, end: slope * (n - 1) + intercept };
}

// Every real workout's own day, bucketed into the same trailing N-day
// window getWeeklySteps() covers (today and the N-1 days before it) —
// this is "distance sourced from workouts," deliberately not the
// passive/all-day walking-distance total getDailyStepsSince returns for
// other callers (see ChallengeDetailScreen's own syncFromDevice, which
// makes the same distinction for a hunt scored on gps_distance/
// any_workout vs. one scored on device_steps). Returns exactly `days`
// entries, oldest first, so it lines up positionally with weekly's own
// (separately fetched) day labels without needing to recompute or match
// them itself.
function bucketWorkoutDistanceByDay(workouts: WorkoutSample[], days: number): number[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const buckets = new Array(days).fill(0);
  for (const w of workouts) {
    const day = new Date(w.when);
    day.setHours(0, 0, 0, 0);
    const idx = Math.round((day.getTime() - windowStart.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx] += w.distanceMi ?? 0;
  }
  return buckets.map((v) => Math.round(v * 10) / 10);
}

function countWorkoutsInWindow(workouts: WorkoutSample[], days: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days - 1));
  return workouts.filter((w) => w.when.getTime() >= windowStart.getTime()).length;
}

export function MetricsScreen() {
  const health = useHealthProvider();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState<MetricTab>('steps');
  const [weekly, setWeekly] = useState<DailySteps[]>([]);
  const [series, setSeries] = useState<number[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSample[]>([]);
  const [workoutsOpen, setWorkoutsOpen] = useState(false);

  useEffect(() => {
    health.getWeeklySteps().then(setWeekly);
    // A bigger fetch than the table at the bottom needs on its own — this
    // same list also feeds the weekly distance bucketing and workout
    // count below, which need a full week's worth, not just the 5 most
    // recent rows the table shows.
    health.getRecentWorkouts(50).then(setWorkouts);
  }, [health]);

  useEffect(() => {
    if (tab === 'hr') health.getHeartRateSeries(7).then(setSeries);
    else if (tab === 'weight') health.getWeightSeries(7).then(setSeries);
  }, [tab, health]);

  const days = weekly.length || 7;
  const distanceByDay = useMemo(() => bucketWorkoutDistanceByDay(workouts, days), [workouts, days]);
  const totalSteps = useMemo(() => weekly.reduce((sum, d) => sum + d.steps, 0), [weekly]);
  const totalDistanceMi = useMemo(() => distanceByDay.reduce((sum, v) => sum + v, 0), [distanceByDay]);
  const avgSteps = weekly.length ? Math.round(totalSteps / weekly.length) : 0;
  const workoutCount = useMemo(() => countWorkoutsInWindow(workouts, days), [workouts, days]);

  const headline =
    tab === 'steps'
      ? { value: `${(weekly.at(-1)?.steps ?? 0).toLocaleString()} steps`, sub: 'today' }
      : tab === 'distance'
        ? { value: `${(distanceByDay.at(-1) ?? 0).toFixed(1)} mi`, sub: 'today' }
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
          { value: 'steps', label: 'Steps' },
          { value: 'distance', label: 'Distance' },
          // Heart rate (and Weight, hidden earlier) removed from the
          // options a viewer can actually pick — everything that reads/
          // renders it below (the fetch effect, headline, chart) is
          // untouched, so either comes back by just re-adding its option
          // here.
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
          <BarChart
            values={weekly.map((d) => d.steps)}
            labels={weekly.map((d) => d.date)}
            colors={colors}
            styles={styles}
            showTrend
          />
        ) : tab === 'distance' ? (
          <BarChart values={distanceByDay} labels={weekly.map((d) => d.date)} colors={colors} styles={styles} />
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

        {tab === 'steps' && (
          <View style={styles.tagRow}>
            <Tag label="↗ Trend" variant="amber" />
          </View>
        )}
      </Card>

      <Card style={{ gap: 14, padding: 18 }} elevated={false}>
        <Text style={text.h4}>This week</Text>
        <View style={styles.weekGrid}>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>TOTAL STEPS</Text>
            <Text style={styles.weekTileValue}>{totalSteps.toLocaleString()}</Text>
          </View>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>TOTAL DISTANCE</Text>
            <Text style={styles.weekTileValue}>{totalDistanceMi.toFixed(1)} mi</Text>
          </View>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>DAILY AVG</Text>
            <Text style={styles.weekTileValue}>{avgSteps.toLocaleString()}</Text>
          </View>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>WORKOUTS</Text>
            <Text style={styles.weekTileValue}>{workoutCount}</Text>
          </View>
        </View>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }} elevated={false}>
        <Pressable
          style={[styles.workoutsHeader, workoutsOpen && styles.workoutsHeaderOpen]}
          onPress={() => setWorkoutsOpen((open) => !open)}
        >
          <Text style={styles.workoutsTitle}>Workouts</Text>
          <Text style={styles.workoutsCount}>{workouts.slice(0, 5).length}</Text>
          <CaretRightIcon
            size={16}
            color={withAlpha(colors.text, 0.5)}
            style={workoutsOpen ? styles.workoutsCaretOpen : undefined}
          />
        </Pressable>
        {workoutsOpen && (
          <>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 1.4 }]}>WORKOUT</Text>
              <Text style={[styles.th, { flex: 1 }]}>WHEN</Text>
              <Text style={[styles.th, styles.thRight]}>DIST</Text>
              <Text style={[styles.th, styles.thRight]}>HR</Text>
            </View>
            {workouts.slice(0, 5).map((w) => (
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
          </>
        )}
      </Card>
    </ScrollView>
  );
}

// Shared by the Steps and Distance tabs — both are the same shape (one
// bar per day, most recent on the right), just fed different values, and
// only Steps asks for a trend line overlaid on top.
function BarChart({
  values,
  labels,
  colors,
  styles,
  showTrend,
}: {
  values: number[];
  labels: string[];
  colors: Palette;
  styles: MetricsStyles;
  showTrend?: boolean;
}) {
  const n = values.length;
  const maxVal = Math.max(1, ...values);
  const colW = CHART_W / Math.max(1, n);
  const barW = Math.min(28, colW * 0.55);
  const yFor = (v: number) => CHART_H - CHART_BOTTOM_PAD - (Math.max(0, v) / maxVal) * (CHART_H - CHART_BOTTOM_PAD - CHART_TOP_PAD);
  const trend = showTrend ? linearTrend(values) : null;

  return (
    <View>
      <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        {values.map((v, i) => {
          const isLast = i === n - 1;
          const barH = Math.max(4, (v / maxVal) * (CHART_H - CHART_BOTTOM_PAD - CHART_TOP_PAD));
          const cx = colW * i + colW / 2;
          return (
            <Rect
              key={i}
              x={cx - barW / 2}
              y={CHART_H - CHART_BOTTOM_PAD - barH}
              width={barW}
              height={barH}
              rx={4}
              fill={isLast ? colors.accent400 : colors.accent600}
              stroke={isLast ? colors.accent : 'none'}
              strokeWidth={isLast ? 1 : 0}
            />
          );
        })}
        {trend && n > 1 && (
          <Path
            d={`M ${colW / 2} ${yFor(trend.start)} L ${colW * (n - 1) + colW / 2} ${yFor(trend.end)}`}
            stroke={colors.amber}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </Svg>
      <View style={styles.barLabelRow}>
        {labels.map((label, i) => (
          <Text key={i} style={[styles.barLabel, i === n - 1 && styles.barLabelToday, { width: colW }]} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    headlineValue: { fontFamily: font.heading, fontSize: 28, color: colors.text },
    headlineSub: { fontSize: 13, color: withAlpha(colors.text, 0.55) },
    last7: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    weekGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    weekTile: {
      flexBasis: '47%',
      flexGrow: 1,
      gap: 4,
      padding: 12,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    weekTileLabel: { fontSize: 10.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    weekTileValue: { fontFamily: font.heading, fontSize: 20, color: colors.text },
    barLabelRow: { flexDirection: 'row' },
    barLabel: { fontSize: 11, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
    // Today's bar label sits directly on the Card's own (theme-following)
    // surface, not a fixed dark chip — accentActive reads correctly on
    // either theme where a raw accent200 would go invisible on Light's
    // white surface (see tokens.ts's own comment on accentActive).
    barLabelToday: { color: colors.accentActive },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    workoutsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 16,
    },
    // Only a real border while open, separating the header from the table
    // below — collapsed, the header is the whole card, so a border here
    // would just be a stray line under empty space.
    workoutsHeaderOpen: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.08),
    },
    workoutsTitle: { flex: 1, fontFamily: font.heading, fontSize: 16, color: colors.text },
    workoutsCount: { fontSize: 13, color: withAlpha(colors.text, 0.5) },
    workoutsCaretOpen: { transform: [{ rotate: '90deg' }] },
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

type MetricsStyles = ReturnType<typeof makeStyles>;
