import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { GROUP_COLORS, HOUNDOPOLY_BOARD, type HoundopolyDeed } from '../challenges/houndopoly';

export interface BoardPlayer {
  userId: string;
  position: number;
  initials: string;
  frameId?: string | null;
  backgroundId?: string | null;
  iconId?: string | null;
  // The colour of their owner dot on squares they hold.
  color: string;
}

// Ring positions on a 7×7 grid: Start bottom-right, then along the
// bottom to the left, up the left side, along the top, down the right.
const RING: [number, number][] = [];
for (let c = 6; c >= 0; c--) RING.push([6, c]);
for (let r = 5; r >= 0; r--) RING.push([r, 0]);
for (let c = 1; c <= 6; c++) RING.push([0, c]);
for (let r = 1; r <= 5; r++) RING.push([r, 6]);

const GAP = 3;

// The 24-square loop. Each square shows its colour band, its name, a
// dot for its owner and the avatars standing on it. The middle is
// whatever the caller puts there (cash and worth). Laid out by hand
// from the measured width: a 7×7 ring of equal squares, the centre
// spanning the inner 5×5.
export function HoundopolyBoard({
  players,
  deeds,
  myUserId,
  onPressSquare,
  children,
}: {
  players: BoardPlayer[];
  deeds: HoundopolyDeed[];
  myUserId: string | null;
  onPressSquare: (idx: number) => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const colorOf = useMemo(() => new Map(players.map((p) => [p.userId, p.color])), [players]);
  const [size, setSize] = useState(0);
  const cell = size > 0 ? (size - GAP * 6) / 7 : 0;

  return (
    <View style={styles.board} onLayout={(e) => setSize(e.nativeEvent.layout.width)}>
      {cell > 0 &&
        HOUNDOPOLY_BOARD.map((sq) => {
          const [r, c] = RING[sq.idx];
          const owner = deeds.find((d) => d.idx === sq.idx)?.ownerId ?? null;
          const here = players.filter((p) => p.position === sq.idx);
          const corner = sq.kind !== 'property' && sq.kind !== 'fetch' && sq.kind !== 'water_bowl';
          const event = sq.kind === 'fetch' || sq.kind === 'water_bowl';
          return (
      <Pressable
        key={sq.idx}
        onPress={() => onPressSquare(sq.idx)}
        style={({ pressed }) => [
          styles.square,
          { left: c * (cell + GAP), top: r * (cell + GAP), width: cell, height: cell },
          corner && styles.corner,
          event && styles.event,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${sq.name}${sq.price ? `, ${sq.price}` : ''}${owner ? ', owned' : ''}`}
      >
        {sq.group && <View style={[styles.band, { backgroundColor: GROUP_COLORS[sq.group] }]} />}
        {owner && <View style={[styles.ownerDot, { backgroundColor: colorOf.get(owner) ?? colors.accent }]} />}
        <Text style={[styles.name, corner && styles.cornerName, event && styles.eventName]} numberOfLines={2}>
          {corner || event ? sq.name.toUpperCase() : sq.name}
        </Text>
        {here.length > 0 && (
          <View style={styles.pieces}>
            {here.slice(0, 3).map((p, i) => (
              <View key={p.userId} style={[styles.piece, i > 0 && { marginLeft: -6 }, p.userId === myUserId && styles.me]}>
                <Avatar
                  initials={p.initials}
                  tint={p.color}
                  size={16}
                  fontSize={7}
                  frameId={p.frameId}
                  backgroundId={p.backgroundId}
                  iconId={p.iconId}
                />
              </View>
            ))}
            {here.length > 3 && <Text style={styles.more}>+{here.length - 3}</Text>}
          </View>
        )}
      </Pressable>
          );
        })}
      {cell > 0 && (
        <View style={[styles.centre, { left: cell + GAP, top: cell + GAP, width: cell * 5 + GAP * 4, height: cell * 5 + GAP * 4 }]}>
          {children}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    board: { width: '100%', aspectRatio: 1 },
    square: {
      position: 'absolute',
      borderRadius: 6,
      backgroundColor: withAlpha(colors.text, 0.08),
      padding: 3,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    corner: { backgroundColor: withAlpha(colors.text, 0.04), justifyContent: 'center' },
    event: { backgroundColor: withAlpha(colors.accent, 0.16), justifyContent: 'center' },
    band: { position: 'absolute', left: 0, right: 0, top: 0, height: 5 },
    ownerDot: { position: 'absolute', right: 2, top: 7, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.surface },
    name: { fontSize: 7, lineHeight: 8.5, color: withAlpha(colors.text, 0.8) },
    cornerName: { fontFamily: font.heading, fontSize: 7, textAlign: 'center', color: colors.accentActive },
    eventName: { fontFamily: font.heading, textAlign: 'center', color: colors.accentActive },
    pieces: { position: 'absolute', left: 2, top: 7, flexDirection: 'row', alignItems: 'center' },
    piece: { borderRadius: 10, borderWidth: 1.5, borderColor: colors.surface },
    me: { borderColor: colors.amber },
    more: { fontSize: 7, color: withAlpha(colors.text, 0.7), marginLeft: 2 },
    centre: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 8 },
  });
}
