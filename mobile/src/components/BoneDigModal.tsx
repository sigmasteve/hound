import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { BoneIcon, PuzzlePieceIcon, ShovelIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { Button } from './Button';
import type { TrailAvatar } from './GoalTrail';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { DIG_ITEMS } from '../cosmetics/catalog';
import { nextDigItem, type BoneDigResult } from '../goals/boneDigApi';

// The dig itself: the shovel digs for a moment (at least as long as the
// server takes to roll), then today's find pops up.
export function BoneDigModal({
  result,
  avatar,
  currencyName,
  onClose,
}: {
  // Null while the server is still digging.
  result: BoneDigResult | null;
  avatar: TrailAvatar;
  currencyName: string;
  onClose: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const [minDone, setMinDone] = useState(false);
  const revealed = minDone && result !== null;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 120, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 120, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    loop.start();
    const t = setTimeout(() => setMinDone(true), 1100);
    return () => {
      loop.stop();
      clearTimeout(t);
    };
  }, [shake]);

  useEffect(() => {
    if (revealed) Animated.spring(pop, { toValue: 1, friction: 4, tension: 70, useNativeDriver: true }).start();
  }, [revealed, pop]);

  const unlocked = result?.unlockedItemId ? (DIG_ITEMS.find((i) => i.id === result.unlockedItemId) ?? null) : null;
  const next = result ? nextDigItem(result.pieces) : null;
  const popStyle = {
    opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={revealed ? onClose : undefined}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {!revealed ? (
            <>
              <Animated.View
                style={{
                  transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] }) }],
                }}
              >
                <ShovelIcon size={64} color={colors.amber} weight="fill" />
              </Animated.View>
              <Text style={styles.sub}>Digging…</Text>
            </>
          ) : (
            <>
              <Animated.View style={[styles.hero, popStyle]}>
                {unlocked ? (
                  <Avatar
                    initials={avatar.initials}
                    tint={colors.accent800}
                    size={76}
                    fontSize={26}
                    frameId={unlocked.slot === 'frame' ? unlocked.id : avatar.frameId}
                    backgroundId={unlocked.slot === 'background' ? unlocked.id : avatar.backgroundId}
                    iconId={unlocked.slot === 'icon' ? unlocked.id : avatar.iconId}
                  />
                ) : result!.prize === 'piece' ? (
                  <PuzzlePieceIcon size={64} color={colors.amber} weight="fill" />
                ) : (
                  <BoneIcon size={64} color={colors.amber} weight="fill" />
                )}
              </Animated.View>
              <Text style={text.eyebrow}>TODAY’S DIG</Text>
              <Text style={styles.title}>
                {unlocked
                  ? `You found the ${unlocked.name}!`
                  : result!.prize === 'piece'
                    ? 'A piece!'
                    : `+${result!.bones} ${currencyName}`}
              </Text>
              <Text style={styles.sub}>
                {unlocked
                  ? 'It’s in Your look now, ready to wear.'
                  : result!.prize === 'piece' && next
                    ? `${next.have} of ${next.need} pieces toward the ${next.item.name}.`
                    : 'Back tomorrow for another dig.'}
              </Text>
              <View style={styles.buttons}>
                <Button label="Nice!" variant="primary" onPress={onClose} />
              </View>
            </>
          )}
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
      maxWidth: 340,
      minHeight: 260,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: 24,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    hero: {
      padding: 14,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.amber, 0.14),
      marginBottom: 4,
    },
    title: { fontFamily: font.headingSemibold, fontSize: 26, color: colors.text, textAlign: 'center' },
    sub: { fontSize: 14, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  });
}
