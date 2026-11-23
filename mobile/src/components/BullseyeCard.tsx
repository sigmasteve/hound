import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { usePinnedAction } from './PinnedAction';
import { BullseyeFieldArt } from './BullseyeField';
import { bullseyeWaiting, type BullseyeGame } from '../challenges/bullseyeApi';

// Bullseye (0249) on the challenge page: today's field in miniature, the
// gold balloon, the standings (points and best end), Robin Hoods, the
// prizes. "To the field" is pinned when there are arrows to shoot.

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function BullseyeCard({ game, onPlay }: { game: BullseyeGame | null; onPlay: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ready = bullseyeWaiting(game);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const pinned = usePinnedAction(ready > 0 ? { label: `To the field · ${ready} ${ready === 1 ? 'arrow' : 'arrows'}`, onPress: onPlay } : null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Bullseye</Text>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const c = game.conditions;
  const moon = c.world === 'moon';
  const live = !game.over && game.dayNo >= 1 && game.dayNo <= game.days;
  const p = game.prizes.places;
  const robin = game.feed.find((f) => f.robin);

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.mini}>
          <BullseyeFieldArt width={124} height={96} conditions={c} targets={game.targets} now={now} showHound={false} labels={false} showSocks={false} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.h}>
            {game.over ? 'The field is closed' : moon ? 'Today: the Moon field' : c.balloons ? 'Today: Balloon day!' : `Today: ${c.tempF}°F, a breeze from the ${c.wind.from}`}
          </Text>
          <Text style={styles.small}>the same field for everyone{c.helper ? ' · aim helper on' : ''}</Text>
          {c.bounty && live && (
            <Text style={[styles.small, { color: '#ffd23f', fontFamily: font.headingSemibold }]}>
              {game.goldTaker
                ? `Gold balloon popped by ${game.goldTaker.me ? 'you' : game.goldTaker.name} (${game.goldTaker.bones} Bones)`
                : `Gold balloon: ${game.settings.bountyBones} Bones, still up`}
            </Text>
          )}
        </View>
      </View>

      {game.me.joined && (
        <Text style={styles.line}>
          You: {fmt(game.me.points)} points, {ord(game.me.rank)} of {fmt(game.players)}
          {game.me.bestEnd ? ` · best round ${game.me.bestEnd}` : ''}
          {live ? ` · ${ready} ${ready === 1 ? 'arrow' : 'arrows'} ready` : ''}
        </Text>
      )}

      <View style={{ gap: 6 }}>
        <View style={styles.row}>
          <Text style={styles.head}>STANDINGS</Text>
          <Text style={styles.head}>POINTS · BEST ROUND</Text>
        </View>
        {game.board.length === 0 && <Text style={styles.small}>Nobody’s shot yet.</Text>}
        {game.board.map((r) => (
          <View key={r.userId} style={[styles.row, r.me && styles.meRow]}>
            <Text style={[styles.rank, r.rank === 1 && { color: '#ffd23f' }]}>{r.rank}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {r.me ? 'You' : r.name}
            </Text>
            <Text style={styles.pts}>{fmt(r.points)}</Text>
            <Text style={styles.best}>{r.bestEnd || '–'}</Text>
          </View>
        ))}
        {robin && <Text style={[styles.small, { color: '#f0c27a' }]}>Robin Hood! {robin.name} split their own arrow at {robin.dist} m.</Text>}
      </View>

      <View style={styles.prizes}>
        <Text style={styles.head}>PRIZES · {fmt(game.pool)} BONES, PAID BY POINTS</Text>
        <Text style={styles.line}>
          {p.length > 0 ? `1st ${fmt(p[0])}` : ''}
          {p.length > 1 ? ` · 2nd ${fmt(p[1])}` : ''}
          {p.length > 2 ? ` · 3rd ${fmt(p[2])}` : ''}
          {p.length > 3 ? ` · 4th to ${ord(p.length)} ${fmt(p[3])} each` : ''}
        </Text>
        <Text style={styles.small}>{c.bounty ? `Plus the gold balloon each day: ${game.settings.bountyBones} Bones to the first to pop it. ` : ''}No entry fee.</Text>
      </View>

      <Text style={styles.small}>
        A round of {game.settings.arrowsPerEnd} arrows for every {fmt(game.settings.stepsPerEnd)} steps, up to {game.settings.maxEnds} a day. A {game.settings.workoutMin}-minute
        workout steadies your hold.
      </Text>

      {!pinned && live && game.me.joined && (
        <Pressable onPress={onPlay} style={[styles.act, ready > 0 ? { backgroundColor: colors.green } : styles.actOff]} accessibilityRole="button">
          <Text style={[styles.actText, ready === 0 && { color: withAlpha(colors.text, 0.75) }]}>
            {ready > 0 ? `To the field · ${ready} ${ready === 1 ? 'arrow' : 'arrows'}` : 'See the field'}
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
    best: { width: 56, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    prizes: { gap: 4, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    act: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#0e1a12' },
  });
}
