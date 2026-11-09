import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { type TrackRunner } from '../components/ChaseTrack';
import { RaceCourse, type RaceScene } from '../components/RaceCourse';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Game of Tag, the daily chase (the mockup for the redo): one hound is
// IT each day, in a red bandana. Everyone else starts the day with a
// head start; whoever IT out-walks by the end of the day is tagged. The
// slowest tagged hound is IT tomorrow; if nobody's tagged, IT stays IT.
// Points: +3 a tag, +1 a day you get away, and nothing for a day as IT.

export type TagHound = TrackRunner['hound'];

export interface TagPlayer {
  id: string;
  name: string;
  hound: TagHound;
  me?: boolean;
}

const IT_RED = '#e5484d';

// Today: who's IT, and where you stand against them so far.
export function TagTodayCard({
  day,
  days,
  it,
  headStart,
  itSteps,
  mySteps,
  meIsIt,
}: {
  day: number;
  days: number;
  it: TagPlayer;
  headStart: number;
  itSteps: number;
  mySteps: number;
  meIsIt: boolean;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lead = mySteps + headStart - itSteps;
  const safe = lead > 0;
  const fill = Math.max(0.04, Math.min(1, itSteps / Math.max(1, mySteps + headStart)));
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={styles.kicker}>
          DAY {day} OF {days}
        </Text>
        <Text style={styles.kicker}>Settles at 6am</Text>
      </View>
      <View style={styles.heroRow}>
        <View style={styles.heroHound}>
          <HoundArt {...it.hound} neckId="bandana_red" mood="happy" size={92} animate />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={text.h2}>{meIsIt ? 'You’re IT' : `${it.name} is IT`}</Text>
          <Text style={styles.note}>
            {meIsIt
              ? `Out-walk anyone by more than their ${headStart.toLocaleString()}-step head start today and they’re tagged.`
              : `You start ${headStart.toLocaleString()} steps ahead. Stay ahead of ${it.name} today and you get away.`}
          </Text>
        </View>
      </View>
      {!meIsIt && (
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Text style={[styles.status, { color: safe ? colors.green : IT_RED }]}>
              {safe ? `${lead.toLocaleString()} steps clear` : `${(-lead).toLocaleString()} steps behind: you’d be tagged`}
            </Text>
            <Text style={styles.note}>
              You {mySteps.toLocaleString()} · {it.name} {itSteps.toLocaleString()}
            </Text>
          </View>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${fill * 100}%`, backgroundColor: safe ? colors.accent : IT_RED }]} />
          </View>
          <Text style={styles.note}>The bar is how close {it.name} is to catching you, counting your head start.</Text>
        </View>
      )}
    </Card>
  );
}

// Last night: the chase on the track, then what happened.
export function TagReplayCard({
  day,
  players,
  itId,
  headStart,
  steps,
  last = false,
  scene = 'track',
}: {
  day: number;
  // Where it's drawn (0182): the track or a trail.
  scene?: RaceScene;
  // The game's last day: nobody's IT next.
  last?: boolean;
  players: TagPlayer[];
  itId: string;
  headStart: number;
  // Each player's steps that day.
  steps: Record<string, number>;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const trackW = Math.min(width, 520) - 64;
  const it = players.find((p) => p.id === itId)!;
  const itSteps = steps[itId] ?? 0;
  // IT in the inside lane, then everyone else.
  const runners: TrackRunner[] = [it, ...players.filter((p) => p.id !== itId)].map((p) => ({
    id: p.id,
    name: p.name,
    hound: p.hound,
    startSteps: p.id === itId ? 0 : headStart,
    daySteps: steps[p.id] ?? 0,
    it: p.id === itId,
    me: p.me,
  }));
  const results = players
    .filter((p) => p.id !== itId)
    .map((p) => ({ p, margin: (steps[p.id] ?? 0) + headStart - itSteps }))
    .sort((a, b) => a.margin - b.margin);
  const tagged = results.filter((r) => r.margin < 0);
  const nextIt = tagged.length
    ? tagged.reduce((a, b) => ((steps[a.p.id] ?? 0) <= (steps[b.p.id] ?? 0) ? a : b)).p
    : it;
  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.rowBetween}>
        <Text style={text.h4}>{last ? 'The last chase' : 'Last night’s chase'}</Text>
        <Text style={styles.kicker}>DAY {day}</Text>
      </View>
      <RaceCourse scene={scene} runners={runners} width={trackW} catchWord="TAG!" />
      <View style={{ gap: 6 }}>
        {results.map(({ p, margin }) => (
          <View key={p.id} style={styles.resultRow}>
            <View style={[styles.dot, { backgroundColor: margin < 0 ? IT_RED : colors.green }]} />
            <Text style={styles.resultText}>
              {margin < 0
                ? `${it.name} tagged ${p.me ? 'you' : p.name} by ${(-margin).toLocaleString()}`
                : `${p.me ? 'You' : p.name} got away by ${margin.toLocaleString()}`}
            </Text>
            <Text style={styles.points}>{margin < 0 ? '' : '+1'}</Text>
          </View>
        ))}
        <View style={styles.resultRow}>
          <View style={[styles.dot, { backgroundColor: colors.gold }]} />
          <Text style={styles.resultText}>
            {it.name} {tagged.length ? `made ${tagged.length} ${tagged.length === 1 ? 'tag' : 'tags'}` : 'tagged nobody'}
          </Text>
          <Text style={styles.points}>{tagged.length ? `+${tagged.length * 3}` : ''}</Text>
        </View>
      </View>
      {!last && <View style={styles.nextIt}>
        <HoundArt {...nextIt.hound} neckId="bandana_red" mood="happy" variant="avatar" size={34} animate={false} />
        <Text style={styles.nextItText}>
          {nextIt.id === it.id
            ? `Nobody tagged, so ${it.name} stays IT today.`
            : `${nextIt.me ? 'You were' : `${nextIt.name} was`} the slowest tagged: ${nextIt.me ? 'you’re' : 'they’re'} IT today.`}
        </Text>
      </View>}
    </Card>
  );
}

export interface TagStanding {
  player: TagPlayer;
  tags: number;
  escapes: number;
  daysIt: number;
}

// Who's winning: +3 a tag, +1 a day got away.
export function TagStandingsCard({ rows }: { rows: TagStanding[] }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const scored = rows
    .map((r) => ({ ...r, points: r.tags * 3 + r.escapes }))
    .sort((a, b) => b.points - a.points || a.daysIt - b.daysIt);
  return (
    <Card style={{ gap: 8 }} elevated={false}>
      <Text style={text.h4}>Standings</Text>
      <View style={styles.tableRow}>
        <Text style={[styles.th, { flex: 3, textAlign: 'left' }]}>Hound</Text>
        <Text style={styles.th}>Tags</Text>
        <Text style={styles.th}>Away</Text>
        <Text style={styles.th}>IT</Text>
        <Text style={styles.th}>Pts</Text>
      </View>
      {scored.map((r, i) => (
        <View key={r.player.id} style={[styles.tableRow, r.player.me && styles.meRow]}>
          <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.rank}>{i + 1}</Text>
            <HoundArt {...r.player.hound} mood="happy" variant="avatar" size={26} animate={false} />
            <Text style={styles.name} numberOfLines={1}>
              {r.player.me ? 'You' : r.player.name}
            </Text>
          </View>
          <Text style={styles.td}>{r.tags}</Text>
          <Text style={styles.td}>{r.escapes}</Text>
          <Text style={styles.td}>{r.daysIt}</Text>
          <Text style={[styles.td, styles.pts]}>{r.points}</Text>
        </View>
      ))}
      <Text style={styles.note}>+3 for each tag, +1 for each day you get away. Most points when it ends wins.</Text>
    </Card>
  );
}

// Who's been IT, day by day.
export function ItTimeline({ days, its }: { days: number; its: (TagPlayer | null)[] }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={text.h4}>Who&rsquo;s been IT</Text>
      <View style={styles.timeline}>
        {Array.from({ length: days }, (_, i) => {
          const p = its[i];
          return (
            <View key={i} style={styles.dayCol}>
              <View style={[styles.dayFace, p ? { borderColor: IT_RED } : styles.dayFaceEmpty]}>
                {p ? (
                  <HoundArt {...p.hound} neckId="bandana_red" mood="happy" variant="avatar" size={30} animate={false} />
                ) : (
                  <Text style={styles.q}>?</Text>
                )}
              </View>
              <Text style={styles.dayLabel}>Day {i + 1}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kicker: { fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55), fontFamily: font.heading },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heroHound: { width: 92, alignItems: 'center' },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    status: { fontFamily: font.headingSemibold, fontSize: 15 },
    meter: { height: 10, borderRadius: 5, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    meterFill: { height: '100%', borderRadius: 5 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    resultText: { flex: 1, fontSize: 14, color: colors.text },
    points: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.green },
    nextIt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 12,
      backgroundColor: withAlpha(IT_RED, 0.1),
    },
    nextItText: { flex: 1, fontSize: 13.5, color: colors.text, fontFamily: font.heading },
    tableRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 8 },
    meRow: { backgroundColor: withAlpha(colors.accent, 0.12) },
    th: { flex: 1, fontSize: 11.5, color: withAlpha(colors.text, 0.5), textAlign: 'right' },
    td: { flex: 1, fontSize: 14, color: colors.text, textAlign: 'right', fontFamily: font.heading },
    pts: { fontFamily: font.headingSemibold, color: colors.accentActive },
    rank: { width: 14, fontSize: 13, color: withAlpha(colors.text, 0.5) },
    name: { flex: 1, fontSize: 14, color: colors.text },
    timeline: { flexDirection: 'row', justifyContent: 'space-between' },
    dayCol: { alignItems: 'center', gap: 4 },
    dayFace: { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff6e8' },
    dayFaceEmpty: { borderColor: withAlpha(colors.text, 0.15), borderStyle: 'dashed', backgroundColor: 'transparent' },
    q: { fontSize: 15, color: withAlpha(colors.text, 0.35), fontFamily: font.heading },
    dayLabel: { fontSize: 10.5, color: withAlpha(colors.text, 0.55) },
  });
}
