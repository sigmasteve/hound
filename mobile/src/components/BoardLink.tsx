import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font } from '../theme/tokens';
import type { RootStackParamList } from '../navigation/types';

// The kicker over a game's own screen (the field, the ring, the plate)
// with "BOARD ›" at its end: the challenge page, with the leaderboard
// (Steve, Nov 2026: from Today's Needs you there was no way there). If
// the challenge page is the screen underneath, it goes back to it;
// otherwise it opens it, and back returns to the game.
export function BoardLink({ challengeId, children }: { challengeId?: string | null; children: React.ReactNode }) {
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!challengeId) return <>{children}</>;
  const open = () => {
    const state = navigation.getState();
    const prev = state?.routes[state.routes.length - 2];
    if (prev?.name === 'ChallengeDetail' && (prev.params as { challengeId?: string } | undefined)?.challengeId === challengeId) {
      navigation.goBack();
    } else {
      navigation.push('ChallengeDetail', { challengeId });
    }
  };
  return (
    <Pressable onPress={open} hitSlop={8} style={styles.row} accessibilityRole="link" accessibilityLabel="The challenge’s page and leaderboard">
      <View style={styles.text}>{children}</View>
      <Text style={[styles.board, { color: colors.accent }]} numberOfLines={1}>
        BOARD ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flexShrink: 1 },
  // Never wraps: the kicker beside it shortens instead.
  board: { flexShrink: 0, fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8 },
});
