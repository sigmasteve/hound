import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretRightIcon, HeartIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { HoundArt } from '../kennel/HoundArt';
import { moodLine, type Kennel } from '../kennel/kennelApi';

// Today: your hound, how they're doing, and the way into the Kennel.
export function KennelCard({ kennel, onOpen }: { kennel: Kennel; onOpen: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level);

  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open the Kennel: ${moodLine(kennel)}`}>
      <Card style={styles.card} elevated={false}>
        <View style={styles.art}>
          <HoundArt rank={rank.id} mood={kennel.mood} neckId={kennel.neckId} headId={kennel.headId} faceId={kennel.faceId} size={62} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.title}>Kennel</Text>
          <Text style={styles.line}>{moodLine(kennel)}</Text>
          {kennel.hearts !== null && (
            <View style={styles.hearts}>
              {[0, 1, 2].map((i) => (
                <HeartIcon key={i} size={13} color="#e04f6a" weight={i < (kennel.hearts ?? 0) ? 'fill' : 'regular'} />
              ))}
            </View>
          )}
        </View>
        <CaretRightIcon size={16} color={withAlpha(colors.text, 0.45)} />
      </Card>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    art: {
      width: 68,
      height: 76,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.08),
      overflow: 'hidden',
    },
    title: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    line: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    hearts: { flexDirection: 'row', gap: 3 },
  });
}
