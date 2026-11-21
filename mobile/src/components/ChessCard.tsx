import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { usePinnedAction } from './PinnedAction';
import { BOT_NAME, moveLine, resultLine } from '../challenges/chess';
import type { ChessGame } from '../challenges/chessApi';

// Hound Chess on the challenge page (0238): whose move, both sides' steps
// and the pieces they've freed today, the last few moves, and the puzzle
// of the day. "Your move" pins to the bottom of the page; the board is
// ChessScreen.
export function ChessCard({ game, onPlay, onPuzzle }: { game: ChessGame | null; onPlay: () => void; onPuzzle: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pinned = usePinnedAction(game?.myTurn ? { label: game.inCheck ? 'You’re in check: your move' : 'Your move', onPress: onPlay } : null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Hound Chess</Text>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }
  const them = game.me === 'w' ? game.black : game.white;
  const themName = game.bot ? `Hound bot (${BOT_NAME[game.bot]})` : (them?.name ?? 'your opponent');
  const first = game.bot ? 'Hound bot' : themName.split(' ')[0];
  const hoursLeft = game.deadline ? Math.max(0, Math.round((new Date(game.deadline).getTime() - Date.now()) / 3600000)) : null;
  const pieces = (free: string) =>
    ['knights and bishops', 'rooks', 'the queen'].filter((_, i) => free.includes(['N', 'R', 'Q'][i])).join(', ') || 'pawns and king only';
  const recent = game.history.slice(-3).reverse();
  const myMisses = game.me === 'w' ? game.misses.w : game.misses.b;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={text.h4}>Hound Chess</Text>
          <Text style={styles.small}>
            You’re {game.me === 'b' ? 'Black' : 'White'} against {themName}
          </Text>
        </View>
        <Text style={styles.status}>
          {game.status === 'waiting'
            ? 'Waiting'
            : game.status === 'final'
              ? 'Over'
              : game.myTurn
                ? 'Your move'
                : `${first}’s move${hoursLeft != null ? ` · ${hoursLeft}h` : ''}`}
        </Text>
      </View>

      {game.status === 'waiting' && <Text style={styles.line}>Waiting for your opponent to accept. You’re White, so you move first once they’re in.</Text>}
      {game.status === 'final' && <Text style={styles.result}>{resultLine(game.result, game.method, game.me)}</Text>}
      {myMisses > 0 && game.status === 'active' && (
        <Text style={styles.warn}>Hound moved for you once when your 24 hours ran out. Miss the next one and the game’s lost.</Text>
      )}

      {game.status !== 'waiting' && (
        <View style={styles.sides}>
          <View style={styles.side}>
            <Text style={styles.sideLabel}>YOU · {game.steps.toLocaleString('en-US')} STEPS</Text>
            <Text style={styles.sideValue}>{pieces(game.free)}</Text>
          </View>
          <View style={styles.side}>
            <Text style={styles.sideLabel} numberOfLines={1}>
              {first.toUpperCase()}
              {game.theirSteps != null ? ` · ${game.theirSteps.toLocaleString('en-US')} STEPS` : ''}
            </Text>
            <Text style={styles.sideValue}>{pieces(game.theirFree)}</Text>
          </View>
        </View>
      )}

      {recent.length > 0 && (
        <View style={styles.box}>
          {recent.map((m) => (
            <Text key={m.ply} style={styles.line}>
              {moveLine(m, m.side === game.me, first)}
            </Text>
          ))}
        </View>
      )}

      {!pinned && game.status !== 'waiting' && (
        <Pressable onPress={onPlay} style={[styles.btn, game.myTurn ? styles.btnGo : styles.btnQuiet]} accessibilityRole="button">
          <Text style={game.myTurn ? styles.btnGoText : styles.btnQuietText}>{game.myTurn ? 'Your move' : 'See the board'}</Text>
        </Pressable>
      )}
      <Pressable onPress={onPuzzle} style={[styles.btn, styles.btnQuiet]} accessibilityRole="button">
        <Text style={styles.btnQuietText}>Puzzle of the day</Text>
      </Pressable>

      <Text style={styles.small}>
        Your steps today free your pieces: knights and bishops at {game.needs.knightBishop.toLocaleString('en-US')}, rooks at{' '}
        {game.needs.rook.toLocaleString('en-US')}, the queen at {game.needs.queen.toLocaleString('en-US')} or after a {game.needs.queenWorkout}-minute workout.
        In check, everything’s free. {game.needs.moveHours} hours a move: miss it and Hound moves for you; miss two in a row and the game’s lost.
      </Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.62) },
    status: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    result: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    warn: { fontSize: 13, color: colors.amber },
    sides: { flexDirection: 'row', gap: 8 },
    side: { flex: 1, borderRadius: 12, padding: 10, gap: 3, backgroundColor: withAlpha(colors.text, 0.05) },
    sideLabel: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.5, color: withAlpha(colors.text, 0.6) },
    sideValue: { fontSize: 13, color: colors.text },
    box: { gap: 6, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    line: { fontSize: 13, lineHeight: 18, color: colors.text },
    btn: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    btnGo: { backgroundColor: '#f08a24' },
    btnGoText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826' },
    btnQuiet: { backgroundColor: withAlpha(colors.text, 0.08) },
    btnQuietText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
  });
}
