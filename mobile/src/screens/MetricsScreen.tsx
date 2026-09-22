import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { CaretRightIcon, SunIcon } from 'phosphor-react-native';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { font, toneColor, withAlpha, type Palette } from '../theme/tokens';
import { useHealthProvider } from '../health/HealthContext';
import type { DailySteps, WorkoutSample } from '../health/types';
import { computeReadiness, READINESS_COPY, SAMPLE_READINESS, type ReadinessResult } from '../health/readiness';

type MetricTab = 'steps' | 'distance' | 'workouts' | 'hr' | 'weight';

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

export interface ActivityTotal {
  name: string;
  totalMinutes: number;
  // True when at least one workout behind this row was confirmed outdoor
  // (WorkoutSample.isOutdoor === true — see health/types.ts). A named
  // group like "Running" can mix outdoor and treadmill sessions, or
  // sessions with no signal at all, so this is "outdoor data exists for
  // this activity," not "every session was outdoor."
  hasOutdoor: boolean;
}

// The Workouts tab's own summary — grouped by each workout's raw name
// ("Running", "Cricket", ...) rather than bucketed by day like the
// Steps/Distance tabs' charts, which is deliberately a different shape
// (a day-by-day chart here would just look like a second Distance tab).
// Sorted by total duration descending so the biggest chunk of the week
// leads. A workout with no readable duration contributes 0 rather than
// being dropped, same "missing means missing, not zero" convention
// distanceMi's own `?? 0` uses elsewhere in this file.
function groupWorkoutsByActivity(workouts: WorkoutSample[], days: number): ActivityTotal[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days - 1));

  const totals = new Map<string, number>();
  const outdoor = new Map<string, boolean>();
  for (const w of workouts) {
    const day = new Date(w.when);
    day.setHours(0, 0, 0, 0);
    if (day.getTime() < windowStart.getTime() || day.getTime() > today.getTime()) continue;
    totals.set(w.name, (totals.get(w.name) ?? 0) + (w.durationMin ?? 0));
    if (w.isOutdoor) outdoor.set(w.name, true);
  }
  return [...totals.entries()]
    .map(([name, totalMinutes]) => ({ name, totalMinutes, hasOutdoor: outdoor.get(name) ?? false }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

// "4 hrs", "30 min", "1 hr 20 min" — matches how a person would actually
// say it rather than a bare minute count once it crosses an hour.
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hrLabel = `${hrs} hr${hrs === 1 ? '' : 's'}`;
  return mins === 0 ? hrLabel : `${hrLabel} ${mins} min`;
}

function countWorkoutsInWindow(workouts: WorkoutSample[], days: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - (days - 1));
  return workouts.filter((w) => w.when.getTime() >= windowStart.getTime()).length;
}

function isToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

type WorkoutCategory = 'distance' | 'functional';

// Neither platform hands back a clean "is this a distance sport" flag —
// workoutActivityName's source enum runs to 70+ activity types (iOS) or
// its own separate set (Android's Health Connect), too many to hand-
// maintain a name-keyword list for and keep in sync with either one.
// distanceMi is the one signal both providers already agree on: it's
// only ever populated from a real recorded distance (currently just
// HealthKit's DistanceWalkingRunning stat — see getRecentWorkouts), so
// it lines up with "Walking/Running/Jogging" almost exactly as asked
// for, and everything else (strength, stretching, games, ...) falls out
// naturally as "no distance" rather than needing its own list.
function categoryOf(w: WorkoutSample): WorkoutCategory {
  return w.distanceMi != null && w.distanceMi > 0 ? 'distance' : 'functional';
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
  const activitySummary = useMemo(() => groupWorkoutsByActivity(workouts, days), [workouts, days]);
  const totalSteps = useMemo(() => weekly.reduce((sum, d) => sum + d.steps, 0), [weekly]);
  const totalDistanceMi = useMemo(() => distanceByDay.reduce((sum, v) => sum + v, 0), [distanceByDay]);
  const avgSteps = weekly.length ? Math.round(totalSteps / weekly.length) : 0;
  const workoutCount = useMemo(() => countWorkoutsInWindow(workouts, days), [workouts, days]);
  const totalWorkoutMinutes = useMemo(
    () => activitySummary.reduce((sum, a) => sum + a.totalMinutes, 0),
    [activitySummary],
  );

  const readiness = useMemo(() => computeReadiness(workouts), [workouts]);

  const todaysWorkouts = useMemo(() => workouts.filter((w) => isToday(w.when)), [workouts]);
  const distanceWorkouts = useMemo(() => todaysWorkouts.filter((w) => categoryOf(w) === 'distance'), [todaysWorkouts]);
  const functionalWorkouts = useMemo(
    () => todaysWorkouts.filter((w) => categoryOf(w) === 'functional'),
    [todaysWorkouts],
  );

  const headline =
    tab === 'steps'
      ? { value: `${(weekly.at(-1)?.steps ?? 0).toLocaleString()} steps`, sub: 'today' }
      : tab === 'distance'
        ? { value: `${(distanceByDay.at(-1) ?? 0).toFixed(1)} mi`, sub: 'today' }
        : tab === 'workouts'
          ? { value: formatDuration(totalWorkoutMinutes), sub: `${workoutCount} workouts · last 7 days` }
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
          { value: 'workouts', label: 'Workouts' },
          // Heart rate (and Weight, hidden earlier) removed from the
          // options a viewer can actually pick — everything that reads/
          // renders it below (the fetch effect, headline, chart) is
          // untouched, so either comes back by just re-adding its option
          // here.
        ]}
      />

      <Card style={{ gap: 18, padding: 18 }} elevated={false}>
        {tab === 'workouts' ? (
          // Stacked, not the baseline row below — "9 workouts · last 7
          // days" is long enough on its own to collide with the separate
          // "Last 7 days" label (which would also just repeat what this
          // sub already says), so this tab skips that label entirely.
          <View style={{ gap: 2 }}>
            <Text style={styles.headlineValue}>{headline.value}</Text>
            <Text style={styles.headlineSub}>{headline.sub}</Text>
          </View>
        ) : (
          <View style={styles.headlineRow}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={styles.headlineValue}>{headline.value}</Text>
              <Text style={styles.headlineSub}>{headline.sub}</Text>
            </View>
            <Text style={styles.last7}>Last 7 days</Text>
          </View>
        )}

        {tab === 'steps' ? (
          <BarChart
            values={weekly.map((d) => d.steps)}
            labels={weekly.map((d) => d.date)}
            colors={colors}
            styles={styles}
            showTrend
            formatValue={(v) => `${Math.round(v).toLocaleString()} steps`}
          />
        ) : tab === 'distance' ? (
          <BarChart
            values={distanceByDay}
            labels={weekly.map((d) => d.date)}
            colors={colors}
            styles={styles}
            showTrend
            formatValue={(v) => `${v.toFixed(1)} mi`}
          />
        ) : tab === 'workouts' ? (
          // A ranked list by activity, not a day-by-day chart — a second
          // 7-bars-per-week chart here would just read as another
          // Distance tab. This answers a different question (what did
          // you actually do this week, and how much of it), same shape
          // as the plain-language summary asked for: "Running — 4 hrs".
          <ActivitySummaryList activities={activitySummary} colors={colors} styles={styles} />
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
          <Text style={styles.workoutsTitle}>Today&rsquo;s Workouts</Text>
          <Text style={styles.workoutsCount}>{todaysWorkouts.length}</Text>
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
              <Text style={[styles.th, styles.thRight]}>DUR</Text>
            </View>
            {todaysWorkouts.length === 0 ? (
              <Text style={styles.emptyNote}>Nothing logged yet today.</Text>
            ) : (
              // Bounded rather than growing with the list — a busy day's
              // worth of workouts scrolls inside its own space instead of
              // pushing everything below it (the rest of the screen) down
              // an unpredictable amount.
              <ScrollView style={styles.workoutsScroll} nestedScrollEnabled>
                <WorkoutGroup label="Distance" workouts={distanceWorkouts} colors={colors} styles={styles} />
                <WorkoutGroup label="Functional" workouts={functionalWorkouts} colors={colors} styles={styles} />
              </ScrollView>
            )}
          </>
        )}
      </Card>

      {/* Last on the tab, on purpose — Phase 1 only (training load, no
          recovery signal yet — see the readiness plan doc), so it's not
          the polished, load-bearing feature the cards above it are. */}
      <Card style={{ gap: 10, padding: 18 }} elevated={false}>
        <Text style={text.h4}>Readiness</Text>
        <ReadinessSummary result={readiness} colors={colors} styles={styles} />
        {readiness.label === 'insufficient_data' && (
          <View style={styles.readinessPreview}>
            <View style={styles.readinessPreviewTag}>
              <Text style={styles.readinessPreviewTagText}>EXAMPLE</Text>
            </View>
            <Text style={styles.readinessPreviewLead}>What this card looks like once it has enough history:</Text>
            <ReadinessSummary result={SAMPLE_READINESS} colors={colors} styles={styles} />
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

// Badge + reason + this-week/4-week-avg tiles — shared by the real
// result and, when there's not enough history yet, the hardcoded
// SAMPLE_READINESS preview shown alongside it (see the Readiness card
// above), so the two always render identically apart from their data.
function ReadinessSummary({ result, colors, styles }: { result: ReadinessResult; colors: Palette; styles: MetricsStyles }) {
  const tone = toneColor(READINESS_COPY[result.label].tone, colors);
  return (
    <>
      <View style={[styles.readinessBadge, { backgroundColor: withAlpha(tone, 0.14), borderColor: withAlpha(tone, 0.4) }]}>
        <Text style={[styles.readinessBadgeText, { color: tone }]}>{READINESS_COPY[result.label].title}</Text>
      </View>
      <Text style={styles.footNote}>{result.reason}</Text>
      {result.acwr != null && (
        <View style={styles.weekGrid}>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>THIS WEEK</Text>
            <Text style={styles.weekTileValue}>{Math.round(result.acuteMinutes)} min</Text>
          </View>
          <View style={styles.weekTile}>
            <Text style={styles.weekTileLabel}>LAST 4-WK AVG</Text>
            <Text style={styles.weekTileValue}>{Math.round(result.chronicWeeklyAvgMinutes ?? 0)} min/wk</Text>
          </View>
        </View>
      )}
    </>
  );
}

// One labeled section of today's list — Distance (a real recorded
// distance: Walking, Running, Jogging, ...) or Functional (everything
// else: strength, stretching, games, ...), see categoryOf's own comment.
// Renders nothing at all when this category is empty today, rather than
// an empty section with just a label and no rows.
function WorkoutGroup({
  label,
  workouts,
  colors,
  styles,
}: {
  label: string;
  workouts: WorkoutSample[];
  colors: Palette;
  styles: MetricsStyles;
}) {
  if (workouts.length === 0) return null;
  return (
    <>
      <Text style={styles.groupLabel}>{label}</Text>
      {workouts.map((w) => (
        <View key={w.id} style={styles.tableRow}>
          <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.td}>{w.name}</Text>
            {w.isOutdoor && <SunIcon size={12} color={colors.amber} weight="fill" />}
          </View>
          <Text style={[styles.td, styles.tdMuted, { flex: 1 }]}>
            {w.when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <Text style={[styles.td, styles.tdRight]}>{w.distanceMi ? `${w.distanceMi.toFixed(1)} mi` : '—'}</Text>
          <Text style={[styles.td, styles.tdRight]}>{w.durationMin ? `${w.durationMin} min` : '—'}</Text>
        </View>
      ))}
    </>
  );
}

// The Workouts tab's own view — a ranked list ("Running — 4 hrs") with a
// horizontal bar sized relative to the week's biggest chunk, rather than
// the Steps/Distance tabs' day-by-day vertical bars. Deliberately a
// different shape from those (see the tab's own comment on why).
function ActivitySummaryList({
  activities,
  colors,
  styles,
}: {
  activities: ActivityTotal[];
  colors: Palette;
  styles: MetricsStyles;
}) {
  if (activities.length === 0) {
    return <Text style={styles.emptyNote}>No workouts in the last 7 days.</Text>;
  }
  const maxMinutes = activities[0].totalMinutes || 1;
  return (
    <View style={{ gap: 16 }}>
      {activities.map((a) => (
        <View key={a.name} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.activityName}>{a.name}</Text>
              {a.hasOutdoor && <SunIcon size={13} color={colors.amber} weight="fill" />}
            </View>
            <Text style={styles.activityDuration}>{formatDuration(a.totalMinutes)}</Text>
          </View>
          <View style={styles.activityBarTrack}>
            <View
              style={[
                styles.activityBarFill,
                { width: `${Math.max(4, (a.totalMinutes / maxMinutes) * 100)}%`, backgroundColor: colors.accent },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// A fixed pixel width rather than a percentage of the chart — its exact
// left position (calloutLeft below) is computed in real screen pixels
// off onLayout, since RN has no percentage-based translateX to center a
// floating element over an arbitrary column otherwise.
const CALLOUT_WIDTH = 76;

// Shared by the Steps and Distance tabs — both are the same shape (one
// bar per day, most recent on the right), just fed different values, and
// only Steps asks for a trend line overlaid on top. Bar height alone
// never told you the exact number for a day, only how it compares to the
// others — tapping a bar (or its column, same touch target) reveals that
// in a small callout above the chart and highlights the bar itself.
function BarChart({
  values,
  labels,
  colors,
  styles,
  showTrend,
  formatValue,
}: {
  values: number[];
  labels: string[];
  colors: Palette;
  styles: MetricsStyles;
  showTrend?: boolean;
  formatValue: (v: number) => string;
}) {
  const n = values.length;
  const maxVal = Math.max(1, ...values);
  const colW = CHART_W / Math.max(1, n);
  const barW = Math.min(28, colW * 0.55);
  const yFor = (v: number) => CHART_H - CHART_BOTTOM_PAD - (Math.max(0, v) / maxVal) * (CHART_H - CHART_BOTTOM_PAD - CHART_TOP_PAD);
  const trend = showTrend ? linearTrend(values) : null;

  const [selected, setSelected] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(CHART_W);
  const colWpx = chartWidth / Math.max(1, n);
  const calloutLeft =
    selected != null
      ? Math.max(0, Math.min(chartWidth - CALLOUT_WIDTH, colWpx * selected + colWpx / 2 - CALLOUT_WIDTH / 2))
      : 0;

  return (
    <View>
      <View style={styles.chartCalloutSlot}>
        {selected != null && (
          <View style={[styles.chartCallout, { left: calloutLeft, width: CALLOUT_WIDTH }]}>
            <Text style={styles.chartCalloutLabel} numberOfLines={1}>
              {labels[selected]}
            </Text>
            <Text style={styles.chartCalloutValue} numberOfLines={1}>
              {formatValue(values[selected])}
            </Text>
          </View>
        )}
      </View>
      <View style={{ position: 'relative' }} onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}>
        <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          {values.map((v, i) => {
            const isLast = i === n - 1;
            const isSelected = i === selected;
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
                fill={isSelected ? colors.accent : isLast ? colors.accent400 : colors.accent600}
                stroke={isSelected || isLast ? colors.accent : 'none'}
                strokeWidth={isSelected ? 2 : isLast ? 1 : 0}
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
        {/* Invisible equal-width touch targets, one per bar column —
            simpler and more reliable across platforms than attaching
            touch handlers to the SVG shapes themselves. */}
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          {values.map((_, i) => (
            <Pressable key={i} style={{ flex: 1 }} onPress={() => setSelected((cur) => (cur === i ? null : i))} />
          ))}
        </View>
      </View>
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
    activityName: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    activityDuration: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    activityBarTrack: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.08) },
    activityBarFill: { height: 8, borderRadius: 4 },
    barLabelRow: { flexDirection: 'row' },
    barLabel: { fontSize: 11, color: withAlpha(colors.text, 0.55), textAlign: 'center' },
    // Today's bar label sits directly on the Card's own (theme-following)
    // surface, not a fixed dark chip — accentActive reads correctly on
    // either theme where a raw accent200 would go invisible on Light's
    // white surface (see tokens.ts's own comment on accentActive).
    barLabelToday: { color: colors.accentActive },
    // Fixed height, always reserved (whether or not a bar's selected) so
    // tapping a bar never shifts the chart itself down by however tall
    // the callout happens to be.
    chartCalloutSlot: { height: 34, position: 'relative' },
    chartCallout: {
      position: 'absolute',
      top: 0,
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 8,
      backgroundColor: withAlpha(colors.accent, 0.14),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    chartCalloutLabel: { fontSize: 10, color: withAlpha(colors.text, 0.6) },
    chartCalloutValue: { fontSize: 12.5, fontFamily: font.heading, color: colors.text },
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
    footNote: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    readinessBadge: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
    readinessBadgeText: { fontSize: 12, fontFamily: font.heading },
    // Dashed border + a muted "EXAMPLE" tag — visually distinct from the
    // real card above it (solid border, no tag), so it never reads as
    // this account's own data.
    readinessPreview: {
      gap: 10,
      marginTop: 4,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: withAlpha(colors.text, 0.2),
    },
    readinessPreviewTag: {
      alignSelf: 'flex-start',
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.text, 0.1),
    },
    readinessPreviewTagText: { fontSize: 10, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    readinessPreviewLead: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    // ~4 rows before it starts scrolling — enough to show a typical
    // day's list without the card dominating the screen.
    workoutsScroll: { maxHeight: 220 },
    groupLabel: {
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 4,
      fontSize: 11,
      letterSpacing: 0.6,
      color: withAlpha(colors.text, 0.5),
    },
    emptyNote: { padding: 16, fontSize: 13, color: withAlpha(colors.text, 0.55) },
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
