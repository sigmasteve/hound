import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { Button } from './Button';
import type { TrailAvatar } from './GoalTrail';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { RANKS, rankForLevel } from '../challenges/ranks';
import { stepLabel, stepsAfter } from '../challenges/ladder';

// Shown on Today the first time it opens after you've gone up a level:
// your avatar pops in with its new level badge, and a new rank gets its
// own line. Lists any Locker items the new XP unlocked. One of Today's
// pop-ups, so it never stacks on top of another (takePopup).
export function LevelUpModal({
  fromLevel,
  toLevel,
  avatar,
  unlockedNames,
  onClose,
}: {
  fromLevel: number;
  toLevel: number;
  avatar: TrailAvatar;
  unlockedNames: string[];
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rank = rankForLevel(toLevel);
  const newRank = rankForLevel(fromLevel).id !== rank.id;
  const next = RANKS.find((r) => r.minLevel > toLevel) ?? null;
  const nextStep = stepsAfter(toLevel, 1)[0] ?? null;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 70, useNativeDriver: true }).start();
  }, [pop]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Animated.View
            style={[
              styles.hero,
              { borderColor: rank.color },
              {
                opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
              },
            ]}
          >
            <Avatar
              initials={avatar.initials}
              tint={colors.accent800}
              size={84}
              fontSize={28}
              frameId={avatar.frameId}
              backgroundId={avatar.backgroundId}
              iconId={avatar.iconId}
              level={toLevel}
            />
          </Animated.View>

          <Text style={text.eyebrow}>LEVEL UP</Text>
          <Text style={styles.title}>Level {toLevel}</Text>

          {newRank ? (
            <View style={[styles.rankChip, { backgroundColor: withAlpha(rank.color, 0.18) }]}>
              <Text style={[styles.rankText, { color: rank.color }]}>New rank: {rank.name}</Text>
            </View>
          ) : (
            <Text style={styles.sub}>
              Rank: <Text style={{ color: rank.color, fontFamily: font.heading }}>{rank.name}</Text>
            </Text>
          )}

          {next && (
            <Text style={styles.sub}>
              {next.minLevel - toLevel === 1 ? 'One more level' : `${next.minLevel - toLevel} more levels`} to{' '}
              {next.name}.
            </Text>
          )}

          {unlockedNames.length > 0 && (
            <View style={styles.unlocks}>
              <Text style={styles.unlocksTitle}>Unlocked in Your look</Text>
              <Text style={styles.unlocksList}>{unlockedNames.join(' · ')}</Text>
            </View>
          )}
          {nextStep && (
            <Text style={styles.sub}>
              Next up, at level {nextStep.level}: {stepLabel(nextStep)}.
            </Text>
          )}

          <View style={styles.buttons}>
            <Button label="Nice!" variant="primary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      alignItems: 'center',
      gap: 10,
      padding: 24,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    hero: {
      padding: 8,
      borderRadius: 999,
      borderWidth: 3,
      marginBottom: 6,
    },
    title: { fontFamily: font.headingSemibold, fontSize: 30, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 14, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    rankChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
    rankText: { fontFamily: font.headingSemibold, fontSize: 15 },
    unlocks: {
      alignSelf: 'stretch',
      gap: 4,
      marginTop: 4,
      padding: 12,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    unlocksTitle: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    unlocksList: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  });
}
