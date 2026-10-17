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
// you; after, what today's dig turned up.
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

  const line = dig.dugToday
    ? dig.prize === 'piece'
      ? 'Today’s dig: a piece! Back tomorrow for another dig.'
      : `Today’s dig: +${dig.bones} ${currencyName}. Back tomorrow for another dig.`
    : ready
      ? 'Your goals are done. Dig for today’s surprise!'
      : 'Finish today’s goals to dig for a surprise.';

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
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    line: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    pieces: { gap: 5 },
    piecesText: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
  });
}
