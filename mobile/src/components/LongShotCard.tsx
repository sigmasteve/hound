import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { usePinnedAction } from './PinnedAction';
import { LongShotRangeArt } from './LongShotRange';
import { longshotWaiting, PLACE_NAMES, yd, type LongShotGame } from '../challenges/longshotApi';

// Long Shot (0247) on the challenge page: today's range in miniature and
// its conditions, the gold plate, the standings, the prizes. "To the
// range" is pinned to the bottom when there are rounds to fire.

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function LongShotCard({ game, onPlay }: { game: LongShotGame | null; onPlay: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ready = longshotWaiting(game);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const pinned = usePinnedAction(ready > 0 ? { label: `To the range · ${ready} ${ready === 1 ? 'round' : 'rounds'}`, onPress: onPlay } : null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Long Shot</Text>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const c = game.conditions;
  const moon = c.world === 'moon';
  const live = !game.over && game.dayNo >= 1 && game.dayNo <= game.days;
  const p = game.prizes.places;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.mini}>
          <LongShotRangeArt width={124} height={96} conditions={c} plates={game.plates} now={now} showHound={false} labels={false} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.h}>
            {game.over ? 'The range is closed' : moon ? 'Today: the Moon range' : `Today: ${PLACE_NAMES[c.place].toLowerCase()}, ${c.tempF}°F`}
          </Text>
          <Text style={styles.small}>
            {moon ? '⅙ gravity, no air, no wind' : `wind ${Math.round(c.wind.mph * 0.85)}–${Math.round(c.wind.mph * 1.25)} mph from the ${c.wind.from}`} · the same for everyone
          </Text>
          {c.bounty && live && (
            <Text style={[styles.small, { color: '#ffd34d', fontFamily: font.headingSemibold }]}>
              {game.goldTaker
                ? `Gold plate rung by ${game.goldTaker.me ? 'you' : game.goldTaker.name} (${game.goldTaker.bones} Bones)`
                : `Gold plate at ${yd(c.gold)}: ${game.settings.bountyBones} Bones, still up`}
            </Text>
          )}
        </View>
      </View>

      {game.me.joined && (
        <Text style={styles.line}>
          You: {fmt(game.me.points)} points, {ord(game.me.rank)} of {fmt(game.players)}
          {game.me.longest ? ` · longest hit ${yd(game.me.longest)}` : ''}
          {live ? ` · ${ready} ${ready === 1 ? 'round' : 'rounds'} ready` : ''}
        </Text>
      )}

      <View style={{ gap: 6 }}>
        <View style={styles.row}>
          <Text style={styles.head}>STANDINGS</Text>
          <Text style={styles.head}>POINTS · LONGEST</Text>
        </View>
        {game.board.length === 0 && <Text style={styles.small}>Nobody’s fired yet.</Text>}
        {game.board.map((r) => (
          <View key={r.userId} style={[styles.row, r.me && styles.meRow]}>
            <Text style={[styles.rank, r.rank === 1 && { color: '#ffd34d' }]}>{r.rank}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {r.me ? 'You' : r.name}
            </Text>
            <Text style={styles.pts}>{fmt(r.points)}</Text>
            <Text style={styles.longest}>{r.longest ? yd(r.longest) : '–'}</Text>
          </View>
        ))}
      </View>

      <View style={styles.prizes}>
        <Text style={styles.head}>PRIZES · {fmt(game.pool)} BONES, PAID BY POINTS</Text>
        <Text style={styles.line}>
          {p.length > 0 ? `1st ${fmt(p[0])}` : ''}
          {p.length > 1 ? ` · 2nd ${fmt(p[1])}` : ''}
          {p.length > 2 ? ` · 3rd ${fmt(p[2])}` : ''}
          {p.length > 3 ? ` · 4th to ${ord(p.length)} ${fmt(p[3])} each` : ''}
        </Text>
        <Text style={styles.small}>
          {c.bounty ? `Plus each day’s gold plate: ${game.settings.bountyBones} Bones to the first to ring it. ` : ''}No entry fee.
        </Text>
      </View>

      {game.feed.length > 0 && (
        <View style={{ gap: 3 }}>
          <Text style={styles.head}>LONG ONES TODAY</Text>
          {game.feed.map((f, i) => (
            <Text key={i} style={styles.small}>
              {f.name} rang {yd(f.dist)}
              {f.gold ? ', the gold plate' : f.center ? ', dead center' : ''} (+{f.points})
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.small}>
        Rounds: 1 per {fmt(game.settings.stepsPerRound)} steps, up to {game.settings.maxRounds} a day, plus 1 for every {game.settings.workoutRoundMin} minutes of
        workouts (up to {Math.floor(game.settings.workoutMaxMin / game.settings.workoutRoundMin)} more). A {game.settings.workoutMin}-minute workout also steadies your hold.
        {moon ? '' : ' Moon days have ⅙ gravity.'}
      </Text>

      {!pinned && live && game.me.joined && (
        <Pressable onPress={onPlay} style={[styles.act, ready > 0 ? { backgroundColor: colors.green } : styles.actOff]} accessibilityRole="button">
          <Text style={[styles.actText, ready === 0 && { color: withAlpha(colors.text, 0.75) }]}>
            {ready > 0 ? `To the range · ${ready} ${ready === 1 ? 'round' : 'rounds'}` : 'See the range'}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    mini: { width: 124, height: 96, borderRadius: 10, overflow: 'hidden' },
    h: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    small: { fontSize: 12, lineHeight: 16, color: withAlpha(colors.text, 0.68) },
    line: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.9) },
    head: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    meRow: { backgroundColor: withAlpha('#7fd39b', 0.16), borderRadius: 8, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3 },
    rank: { minWidth: 22, fontFamily: font.headingSemibold, fontSize: 14, color: withAlpha(colors.text, 0.7) },
    name: { flex: 1, fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    pts: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text, minWidth: 36, textAlign: 'right' },
    longest: { width: 74, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    prizes: { gap: 4, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    act: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#0e1a12' },
  });
}
