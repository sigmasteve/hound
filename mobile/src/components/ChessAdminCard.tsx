import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getChessOverview, type ChessOverview } from '../challenges/chessApi';

// Admin → Hound Chess (0238): games with friends and the bot, how they
// end, how often steps keep a piece resting, missed turns, and the puzzle
// of the day.
export function ChessAdminCard({ onChanged }: { onChanged?: (o: ChessOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<ChessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getChessOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_chess_overview/.test(e.message)
              ? 'Run 0237 and 0238 to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the Chess numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');
  const endings = data
    ? Object.entries(data.endings)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ')
    : '';
  const rows: [string, string][] = data
    ? [
        ['Games', `${data.live} live · ${data.waiting} waiting for a friend · ${data.finished} finished`],
        ['Against', `${data.vsFriend} friends · the bot ${data.vsBot.easy} easy, ${data.vsBot.medium} medium, ${data.vsBot.hard} hard`],
        ['Against the bot', `players won ${data.botRecord.won}, lost ${data.botRecord.lost}, drew ${data.botRecord.drawn}`],
        ['How games ended', endings || '–'],
        ['This week', `${data.players7d} ${data.players7d === 1 ? 'player' : 'players'} · ${data.moves7d} moves · ${data.autoMoves7d} played by Hound (missed turns)`],
        [
          'Steps at work this week',
          `${pct(data.restingMoves7d, data.moves7d)} of moves made with a piece resting · ${pct(data.queenResting7d, data.moves7d)} with the queen resting`,
        ],
        [
          'Puzzle of the day this week',
          `${data.puzzlers7d} ${data.puzzlers7d === 1 ? 'person' : 'people'} opened ${data.puzzlesOpened7d} · ${data.puzzlesSolved7d} solved (${data.puzzlesFirstTry7d} first try) · ${data.puzzleBones} Bones ever`,
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Hound Chess</Text>
      <Text style={styles.footNote}>
        Real chess where steps free the pieces. If almost no moves are made with a piece resting, the step levels are too easy; if most are, too hard.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
  });
}
