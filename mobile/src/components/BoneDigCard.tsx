import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ShovelIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { ProgressBar } from './ProgressBar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { nextDigItem, type BoneDigState } from '../goals/boneDigApi';

// Today: once every daily goal is done, one dig a day for a free
// surprise (0103_bone_dig.sql). Before that it says what finishing gets
// you; once dug, it shrinks to one line with today's find.
export function BoneDigCard({
  dig,
  goalsDone,
  currencyName,
  onDig,
}: {
  dig: BoneDigState;
  goalsDone: boolean;
  currencyName: string;
  onDig: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ready = goalsDone && !dig.dugToday;
  const next = nextDigItem(dig.pieces);

  if (dig.dugToday) {
    return (
      <Card style={styles.card} elevated={false}>
        <View style={styles.row}>
          <ShovelIcon size={16} color={withAlpha(colors.text, 0.6)} weight="fill" />
          <Text style={styles.compactText} numberOfLines={1}>
            Dug today: {dig.prize === 'piece' ? 'a piece' : `+${dig.bones} ${currencyName}`}
          </Text>
          {next && (
            <Text style={styles.piecesText} numberOfLines={1}>
              {next.have}/{next.need} to {next.item.name}
            </Text>
          )}
        </View>
      </Card>
    );
  }

  const line = ready ? 'Your goals are done. Dig for today’s surprise!' : 'Finish today’s goals to dig for a surprise.';

  return (
    <Card style={ready ? [styles.card, styles.ready] : styles.card} elevated={false}>
      <View style={styles.row}>
        <ShovelIcon size={20} color={ready ? colors.amber : withAlpha(colors.text, 0.7)} weight="fill" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Bone Dig</Text>
          <Text style={styles.line}>{line}</Text>
        </View>
        {ready && <Button label="Dig" variant="primary" small onPress={onDig} />}
      </View>
      {next && (
        <View style={styles.pieces}>
          <ProgressBar pct={(next.have / next.need) * 100} height={4} fillColor={colors.amber} />
          <Text style={styles.piecesText}>
            {next.have} of {next.need} pieces toward the {next.item.name}
          </Text>
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { gap: 10 },
    ready: {
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.6),
      backgroundColor: withAlpha(colors.amber, 0.08),
    },
    compactText: { flex: 1, fontFamily: font.heading, fontSize: 13.5, color: withAlpha(colors.text, 0.8) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    line: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    pieces: { gap: 5 },
    piecesText: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
  });
}
