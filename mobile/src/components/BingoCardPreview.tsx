import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CARD_COLUMNS, SQUARES, type CardCell } from '../challenges/houndBingo';

// A hound Bingo card to look at, nothing to tap: the creator's own card
// on the Create screen (0179), before the challenge is made. Drawn like
// HoundBingoCard's grid, without marks.
export function BingoCardPreview({ card }: { card: CardCell[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const size = Math.round(Math.sqrt(card.length));
  const columns = size === 4 || size === 5 ? CARD_COLUMNS[size] : null;
  const gap = size === 5 ? 5 : 7;

  return (
    <View style={{ gap }} accessibilityLabel={`Your ${size} by ${size} card`}>
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
          {card.slice(r * size, r * size + size).map((cell, c) => {
            const i = r * size + c;
            if (cell === 'free') {
              return (
                <View key={i} style={[styles.cell, styles.free]}>
                  <Text style={styles.freeText}>FREE</Text>
                </View>
              );
            }
            const sq = SQUARES[cell];
            return (
              <View key={i} style={styles.cell}>
                <Text style={[styles.emoji, size === 5 && { fontSize: 15 }]}>{sq?.emoji ?? '⬜️'}</Text>
                <Text
                  style={[styles.label, size === 5 && styles.labelSmall]}
                  numberOfLines={3}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {sq?.label ?? cell}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row' },
    letter: { flex: 1, textAlign: 'center', fontSize: 20, fontFamily: font.headingSemibold, color: colors.accent400 },
    cell: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.text, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
      padding: 3,
    },
    free: { backgroundColor: colors.accent800 },
    freeText: { fontSize: 12, fontFamily: font.headingSemibold, color: colors.accent400 },
    emoji: { fontSize: 18, marginBottom: 2 },
    label: { fontSize: 10.5, lineHeight: 12.5, textAlign: 'center', color: withAlpha(colors.text, 0.75) },
    labelSmall: { fontSize: 9, lineHeight: 10.5 },
  });
}
