import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { type TrackRunner } from '../components/ChaseTrack';
import { RaceCourse, type RaceScene } from '../components/RaceCourse';
import { SegmentedControl } from '../components/SegmentedControl';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { HuntLabels } from '../labels/types';

// Chase (kind 'hunt') on its scene (0182, the track or a trail): the
// Foxes run ahead with their head start, the Chaser closes in on logged
// miles (or steps), and a Fox is Out once the Chaser's total reaches
// theirs.

export interface HuntRunner {
  id: string;
  name: string;
  hound: TrackRunner['hound'];
  me?: boolean;
  // Their total so far, and how much of it came in the head start.
  total: number;
  headStart: number;
  // Their last few days, for the pace line.
  pace: number;
  // Where they were when today began, for the Today view (null when
  // yesterday's totals aren't known).
  todayStart?: number | null;
  // Caught: Out (the day, when it's known).
  out?: boolean;
  outDay?: number;
}

const CHASER_RED = '#e5484d';

// "Foxes", "Roadrunners": the labels are the org's own words.
export function plural(word: string): string {
  return /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
}

const fmt = (v: number, unit: 'mi' | 'steps') =>
  unit === 'mi' ? `${v.toFixed(1)} mi` : `${Math.round(v).toLocaleString()} steps`;

// Where the Chaser stands against each Fox, and how it's going.
export function HuntStatusCard({
  labels,
  day,
  days,
  chaser,
  foxes,
  unit,
}: {
  labels: HuntLabels;
  day: number;
  days: number;
  chaser: HuntRunner;
  foxes: HuntRunner[];
  unit: 'mi' | 'steps';
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const left = foxes.filter((f) => !f.out && f.outDay === undefined);
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={styles.kicker}>
          DAY {day} OF {days}
        </Text>
        <Text style={styles.kicker}>
          {left.length} {left.length === 1 ? labels.hunted : plural(labels.hunted)} left
        </Text>
      </View>
      <View style={styles.heroRow}>
        <HoundArt {...chaser.hound} neckId="bandana_red" mood="happy" size={84} animate />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={text.h2}>{chaser.me ? `You’re the ${labels.hunter}` : `${chaser.name} is the ${labels.hunter}`}</Text>
          <Text style={styles.note}>
            {fmt(chaser.total, unit)} since the head start ended. Reach a {labels.hunted}&rsquo;s total and they&rsquo;re {labels.zombie}.
          </Text>
        </View>
      </View>
      {foxes.map((f) => {
        const out = !!f.out || f.outDay !== undefined;
        const gap = f.total - chaser.total;
        const closing = chaser.pace - f.pace;
        const daysToCatch = closing > 0 ? Math.ceil(gap / closing) : null;
        return (
          <View key={f.id} style={[styles.foxRow, out && { opacity: 0.6 }]}>
            <View style={[styles.face, { borderColor: out ? '#8a8f9c' : f.me ? '#ffd23f' : withAlpha(colors.text, 0.12) }]}>
              <HoundArt {...f.hound} mood="happy" variant="avatar" size={32} animate={false} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.foxName}>{f.me ? 'You' : f.name}</Text>
                <Text style={[styles.gap, { color: out ? withAlpha(colors.text, 0.5) : gap < unitStep(unit) * 3 ? CHASER_RED : colors.green }]}>
                  {out ? (f.outDay !== undefined ? `${labels.zombie} on day ${f.outDay}` : labels.zombie) : `${fmt(gap, unit)} ahead`}
                </Text>
              </View>
              {!out && (
                <>
                  <View style={styles.meter}>
                    <View
                      style={[
                        styles.meterFill,
                        { width: `${Math.max(4, Math.min(100, (chaser.total / f.total) * 100))}%`, backgroundColor: gap < unitStep(unit) * 3 ? CHASER_RED : colors.accent },
                      ]}
                    />
                  </View>
                  <Text style={styles.note}>
                    {daysToCatch !== null
                      ? `At this pace the ${labels.hunter} catches ${f.me ? 'you' : 'them'} in about ${daysToCatch} ${daysToCatch === 1 ? 'day' : 'days'}${daysToCatch > days - day ? ', after it ends' : ''}.`
                      : `${f.me ? 'You’re' : 'They’re'} pulling away: ${fmt(f.pace, unit)} a day to the ${labels.hunter}’s ${fmt(chaser.pace, unit)}.`}
                  </Text>
                </>
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

// "Close" is a few of these: a mile, or 2,000 steps.
const unitStep = (unit: 'mi' | 'steps') => (unit === 'mi' ? 1 : 2000);

// The chase on the game's scene (0182): the whole thing so far, or just
// today (everyone from where they were at midnight). Before it starts,
// or before anyone else joins, the trail is there with the chaser at the
// start, waiting.
export function HuntReplayCard({
  labels,
  chaser,
  foxes,
  day,
  scene = 'woods',
  startsAt,
  headStartDays,
}: {
  labels: HuntLabels;
  chaser: HuntRunner;
  foxes: HuntRunner[];
  day: number;
  scene?: RaceScene;
  // Set while it hasn't started.
  startsAt?: Date | null;
  headStartDays?: number | null;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const canToday = !startsAt && day > 1 && [chaser, ...foxes].every((r) => r.todayStart != null);
  const [view, setView] = useState<'all' | 'today'>('all');
  const today = canToday && view === 'today';
  // Today: just today's stretch of the trail, from whoever was furthest
  // back at midnight, so the gaps between everyone show.
  const base = today ? Math.min(...[chaser, ...foxes].map((r) => r.todayStart ?? 0)) : 0;
  const runner = (r: HuntRunner, isChaser: boolean): TrackRunner => {
    const from = today ? (r.todayStart ?? 0) : isChaser ? 0 : r.headStart;
    return { id: r.id, name: r.name, hound: r.hound, startSteps: from - base, daySteps: Math.max(0, r.total - from), it: isChaser, me: r.me };
  };
  const runners: TrackRunner[] = [runner(chaser, true), ...foxes.map((f) => runner(f, false))];
  const start = scene === 'track' ? 'the line' : 'the trailhead';
  const waiting = !!startsAt || foxes.length === 0;
  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={text.h4}>{startsAt ? 'The trail' : today ? 'Today so far' : 'The chase so far'}</Text>
        <Text style={styles.kicker}>{startsAt ? 'STARTS SOON' : today ? 'LIVE' : day > 1 ? `DAYS 1–${day}` : 'DAY 1'}</Text>
      </View>
      {canToday && (
        <SegmentedControl
          options={[
            { value: 'all', label: 'So far' },
            { value: 'today', label: 'Today' },
          ]}
          value={view}
          onChange={(v) => setView(v as 'all' | 'today')}
        />
      )}
      <RaceCourse
        key={view}
        scene={scene}
        runners={runners}
        width={Math.min(width, 520) - 64}
        chaserLabel={labels.hunter}
        catchWord={`${labels.zombie.toUpperCase()}!`}
        autoPlay={!waiting}
      />
      <Text style={styles.note}>
        {startsAt
          ? `It starts ${startsAt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}. ${
              headStartDays ? `The ${plural(labels.hunted)} get a ${headStartDays}-day head start, then the ${labels.hunter} sets off from ${start}.` : `The ${labels.hunter} sets off from ${start}.`
            }${foxes.length === 0 ? ` The ${plural(labels.hunted)} show up here once they join.` : ''}`
          : foxes.length === 0
            ? `The ${plural(labels.hunted)} show up here once they join.`
            : today
              ? `Everyone from where they were at midnight, on today’s synced steps.`
              : `The ${plural(labels.hunted)} start where their head start left them; the ${labels.hunter} starts at ${start}. Tap Replay to watch it again.`}
      </Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kicker: { fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55), fontFamily: font.heading },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    foxRow: {
      flexDirection: 'row',
      gap: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    face: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff6e8' },
    foxName: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    gap: { fontSize: 14, fontFamily: font.headingSemibold },
    meter: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    meterFill: { height: '100%', borderRadius: 4 },
  });
}
