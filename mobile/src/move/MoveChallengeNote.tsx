import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { challengeCounts } from './moveApi';
import { ActivityIcon } from './MoveParts';

// On a Most steps challenge that counts Move points (0270): says so, so
// the board's numbers read right (steps plus workouts).
export function MoveChallengeNote({ challengeId }: { challengeId: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [move, setMove] = useState(false);
  useEffect(() => {
    let live = true;
    challengeCounts(challengeId)
      .then((c) => live && setMove(c === 'move'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [challengeId]);
  if (!move) return null;
  return (
    <View style={styles.card}>
      <ActivityIcon activity="strength_light" size={34} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.strong}>This one counts Move points</Text>
        <Text style={styles.small}>
          Steps plus every workout, by how hard it is: strength, yoga, classes, sports. The numbers here are Move points. Start a routine or log
          strength from Move (Goals).
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      borderRadius: 16,
      padding: 12,
      backgroundColor: withAlpha(colors.accent, 0.1),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.3),
    },
    strong: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
  });
}
