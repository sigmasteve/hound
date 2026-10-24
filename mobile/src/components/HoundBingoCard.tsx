import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon, PawPrintIcon, XIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { BingoProgressRow } from '../challenges/bingo';
import {
  CARD_COLUMNS,
  canLinkAnyWorkout,
  SQUARES,
  workoutFits,
  type HoundCardState,
  type HoundSquare,
} from '../challenges/houndBingo';
import type { WorkoutSample } from '../health/types';
import { ordinal } from '../challenges/shareResult';

// Your hound Bingo card (houndBingo.ts): the column letters, the grid, a
// banner once you have a BINGO, and what a tapped square takes, with any
// workout from the challenge to link to it by hand.
export function HoundBingoCard({
  me,
  entries,
  selected,
  onSelect,
  workouts,
  usedBy,
  linkingId,
  removing,
  error,
  onLink,
  onUnlink,
  formatWhen,
}: {
  me: HoundCardState;
  // Your marks, by square.
  entries: Map<string, BingoProgressRow>;
  selected: HoundSquare | null;
  onSelect: (square: HoundSquare | null) => void;
  // The challenge's workouts on this phone, newest first; null while
  // loading.
  workouts: WorkoutSample[] | null;
  // Which square each workout already marks, by workout id.
  usedBy: Map<string, string>;
  linkingId: string | null;
  removing: boolean;
  error: string | null;
  onLink: (square: HoundSquare, w: WorkoutSample) => void;
  onUnlink: (square: HoundSquare) => void;
  formatWhen: (d: Date) => string;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const size = Math.round(Math.sqrt(me.card.length));
  const columns = size === 4 || size === 5 ? CARD_COLUMNS[size] : null;
  const inLine = new Set(me.lines.done.flat());
  const gap = size === 5 ? 5 : 7;

  const banner = me.blackout
    ? 'Blackout! Every square on your card.'
    : me.place
      ? `${ordinal(me.place)} to BINGO. Keep going for the full card.`
      : me.lines.away === 1
        ? 'One square away from BINGO.'
        : `${me.lines.away} squares away from your closest BINGO.`;

  const entry = selected ? entries.get(selected) : undefined;
  const info = selected ? SQUARES[selected] : null;
  const linkable =
    selected && info?.source === 'workout'
      ? (workouts ?? []).filter((w) => canLinkAnyWorkout(selected) || workoutFits(w).includes(selected))
      : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Your card</Text>
      <View style={[styles.banner, me.place !== null && styles.bannerWin]}>
        {me.place !== null && <Text style={styles.bannerBig}>BINGO!</Text>}
        <Text style={styles.bannerText}>{banner}</Text>
      </View>

      <View style={{ gap }}>
        {columns && (
          <View style={[styles.row, { gap }]}>
            {columns.map((c) => (
              <Text key={c.letter} style={styles.letter}>
                {c.letter}
              </Text>
            ))}
          </View>
        )}
        {Array.from({ length: size }, (_, r) => (
          <View key={r} style={[styles.row, { gap }]}>
            {me.card.slice(r * size, r * size + size).map((cell, c) => {
              const i = r * size + c;
              if (cell === 'free') {
                return (
                  <View key={i} style={[styles.cell, styles.free, inLine.has(i) && styles.line]}>
                    <Text style={styles.freeText}>FREE</Text>
                  </View>
                );
              }
              const sq = SQUARES[cell];
              const on = me.marked.has(cell);
              return (
                <Pressable
                  key={i}
                  onPress={() => onSelect(selected === cell ? null : cell)}
                  style={[
                    styles.cell,
                    on && styles.on,
                    inLine.has(i) && styles.line,
                    selected === cell && styles.picked,
                  ]}
                >
                  {on && (
                    <PawPrintIcon size={size === 5 ? 9 : 11} color={colors.accent400} weight="fill" style={styles.paw} />
                  )}
                  <Text style={[styles.emoji, size === 5 && { fontSize: 15 }]}>{sq.emoji}</Text>
                  <Text
                    style={[styles.label, size === 5 && styles.labelSmall, on && styles.labelOn]}
                    numberOfLines={3}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {sq.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <Text style={styles.note}>
        {me.squaresMarked} of {me.card.filter((c) => c !== 'free').length} squares. Any row, column or diagonal is a
        BINGO. Each workout you log marks one square (steps alone don&rsquo;t), and a day&rsquo;s steps mark one step
        square. Tap a square for what it takes, or to move a workout onto it.
      </Text>

      {selected && info && (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>
              {info.emoji} {info.label}
            </Text>
            <Pressable onPress={() => onSelect(null)} hitSlop={8}>
              <XIcon size={16} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>
          <Text style={styles.note}>{info.hint}</Text>
          {entry ? (
            <View style={styles.marked}>
              <Text style={styles.markedText}>
                Marked: {entry.workoutName ?? 'done'}
                {entry.source === 'manual' ? ' (linked by you)' : ''}
              </Text>
              {entry.source === 'manual' && (
                <Pressable onPress={() => onUnlink(selected)} disabled={removing} hitSlop={4}>
                  <Text style={styles.remove}>{removing ? 'Removing…' : 'Remove'}</Text>
                </Pressable>
              )}
            </View>
          ) : info.source === 'workout' ? (
            <Text style={styles.note}>Hound marks it from workouts you log, or pick one below to move it here.</Text>
          ) : (
            <Text style={styles.note}>Hound marks it on its own when a day does it.</Text>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          {info.source === 'workout' &&
            !entry &&
            (workouts === null ? (
              <ActivityIndicator color={colors.accent} />
            ) : linkable.length === 0 ? (
              <Text style={styles.note}>No workouts from this challenge fit this square yet.</Text>
            ) : (
              linkable.map((w) => {
                const taken = usedBy.get(w.id);
                return (
                  <Pressable
                    key={w.id}
                    onPress={() => onLink(selected, w)}
                    disabled={linkingId !== null || !!taken}
                    style={[styles.workoutRow, !!taken && { opacity: 0.45 }]}
                  >
                    <View style={{ flex: 1, gap: 1 }}>
                      <Text style={styles.workoutName}>{w.name}</Text>
                      <Text style={styles.note}>
                        {formatWhen(w.when)}
                        {w.durationMin ? ` · ${Math.round(w.durationMin)} min` : ''}
                        {w.distanceMi ? ` · ${w.distanceMi.toFixed(1)} mi` : ''}
                        {taken ? ` · on ${SQUARES[taken as HoundSquare]?.label ?? 'another square'}` : ''}
                      </Text>
                    </View>
                    {linkingId === w.id ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      !taken && <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                    )}
                  </Pressable>
                );
              })
            ))}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    banner: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.accent, 0.12),
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    bannerWin: {
      backgroundColor: withAlpha(colors.gold, 0.16),
      borderWidth: 1.5,
      borderColor: withAlpha(colors.gold, 0.55),
    },
    bannerBig: { fontSize: 17, fontFamily: font.headingSemibold, color: colors.gold, letterSpacing: 0.5 },
    bannerText: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.85) },
    row: { flexDirection: 'row' },
    letter: {
      flex: 1,
      textAlign: 'center',
      fontSize: 22,
      fontFamily: font.headingSemibold,
      color: colors.accent400,
    },
    cell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.text, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
      padding: 3,
      // Every square has the same border, so marked ones stay the same size.
      borderWidth: 2,
      borderColor: 'transparent',
    },
    on: {
      backgroundColor: withAlpha(colors.accent, 0.35),
      borderColor: withAlpha(colors.accent400, 0.7),
    },
    line: {
      backgroundColor: withAlpha(colors.gold, 0.3),
      borderColor: colors.gold,
    },
    picked: { borderColor: colors.text },
    free: { backgroundColor: colors.accent800 },
    freeText: { fontSize: 12, fontFamily: font.headingSemibold, color: colors.accent400 },
    paw: { position: 'absolute', top: 3, right: 3 },
    emoji: { fontSize: 18, marginBottom: 2 },
    label: { fontSize: 10.5, lineHeight: 12.5, textAlign: 'center', color: withAlpha(colors.text, 0.75) },
    labelSmall: { fontSize: 9, lineHeight: 10.5 },
    labelOn: { color: colors.text, fontFamily: font.heading },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    panel: {
      gap: 8,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    panelTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    marked: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    markedText: { fontSize: 13, color: colors.green, fontFamily: font.heading },
    remove: { fontSize: 13, color: colors.amber, fontFamily: font.heading },
    error: { fontSize: 12.5, color: colors.amber },
    workoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    workoutName: { fontSize: 14, color: colors.text, fontFamily: font.body },
  });
}
