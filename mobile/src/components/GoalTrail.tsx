import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { BoneIcon, CheckIcon, DogIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';

export interface TrailAvatar {
  initials: string;
  frameId?: string | null;
  backgroundId?: string | null;
  iconId?: string | null;
}

const AVATAR_SIZE = 22;
// The footprint with a Locker frame on (Avatar adds a ring around it).
const AVATAR_BOX = AVATAR_SIZE + 6;
const TRACK_HEIGHT = 8;
const HOUND_SIZE = 16;
const TICKS = [25, 50, 75];

// One goal's progress as a trail: your avatar runs along it toward the
// bone at the finish, and the Hound runs behind at the pace you should
// be at by now (pacePct, goals.ts). Fall behind and it catches you, and
// turns amber. Purple while you're going, green once it's done, when
// your avatar sits on the finish and gives a little hop. Slides into
// place each time it's shown.
export function GoalTrail({
  pct,
  done,
  pace,
  avatar,
}: {
  pct: number;
  done: boolean;
  // Null hides the Hound (nothing to chase once it's done).
  pace: number | null;
  avatar: TrailAvatar;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const shown = done ? 100 : Math.max(0, Math.min(100, pct));
  const fill = done ? colors.green : colors.accent;
  const houndOnYou = pace !== null && !done && pace > shown;

  useEffect(() => {
    if (width === 0) return;
    Animated.timing(progress, {
      toValue: shown,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished || !done) return;
      Animated.sequence([
        Animated.timing(hop, { toValue: -7, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 220, easing: Easing.bounce, useNativeDriver: true }),
      ]).start();
    });
  }, [width, shown, done, progress, hop]);

  const travel = Math.max(0, width - AVATAR_BOX);
  const avatarLeft = progress.interpolate({ inputRange: [0, 100], outputRange: [0, travel] });
  // The line runs between the middle of your avatar at the start and at
  // the finish, so both ends tuck under it; it fills up to where you are.
  const fillWidth = progress.interpolate({ inputRange: [0, 100], outputRange: [0, travel] });
  const houndLeft = pace === null ? 0 : (pace / 100) * travel + (AVATAR_BOX - HOUND_SIZE - 4) / 2;

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.track}>
        {TICKS.map((t) => (
          <View key={t} style={[styles.tick, { left: `${t}%` }]} />
        ))}
        {width > 0 && (
          <Animated.View
            style={[
              styles.fill,
              { width: fillWidth, backgroundColor: fill, shadowColor: fill },
            ]}
          />
        )}
      </View>

      {!done && (
        <View style={styles.finish} pointerEvents="none">
          <BoneIcon size={16} color={withAlpha(colors.text, 0.45)} weight="fill" />
        </View>
      )}

      {width > 0 && pace !== null && !done && (
        <View style={[styles.hound, { left: houndLeft }]} pointerEvents="none">
          <View style={[styles.houndBadge, houndOnYou && { borderColor: colors.amber }]}>
            <DogIcon size={HOUND_SIZE - 4} color={houndOnYou ? colors.amber : withAlpha(colors.text, 0.55)} weight="fill" />
          </View>
        </View>
      )}

      {width > 0 && (
        <Animated.View style={[styles.runner, { left: avatarLeft }]} pointerEvents="none">
          <Animated.View style={{ transform: [{ translateY: hop }] }}>
            <Avatar
              initials={avatar.initials}
              tint={colors.accent800}
              size={AVATAR_SIZE}
              fontSize={9}
              frameId={avatar.frameId}
              backgroundId={avatar.backgroundId}
              iconId={avatar.iconId}
            />
            {done && (
              <View style={styles.check}>
                <CheckIcon size={8} color="#fff" weight="bold" />
              </View>
            )}
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { height: AVATAR_BOX + 4, justifyContent: 'center' },
    track: {
      height: TRACK_HEIGHT,
      borderRadius: TRACK_HEIGHT / 2,
      backgroundColor: colors.ring.md,
      marginHorizontal: AVATAR_BOX / 2,
    },
    tick: {
      position: 'absolute',
      top: TRACK_HEIGHT / 2 - 1.5,
      width: 3,
      height: 3,
      marginLeft: -1.5,
      borderRadius: 1.5,
      backgroundColor: withAlpha(colors.text, 0.25),
    },
    fill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      borderRadius: TRACK_HEIGHT / 2,
      shadowOpacity: 0.7,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    },
    finish: { position: 'absolute', right: (AVATAR_BOX - 16) / 2, top: (AVATAR_BOX + 4 - 16) / 2 },
    hound: { position: 'absolute', top: (AVATAR_BOX + 4 - HOUND_SIZE - 4) / 2 },
    houndBadge: {
      width: HOUND_SIZE + 4,
      height: HOUND_SIZE + 4,
      borderRadius: (HOUND_SIZE + 4) / 2,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.text, 0.15),
      alignItems: 'center',
      justifyContent: 'center',
    },
    runner: { position: 'absolute', top: 2, width: AVATAR_BOX, alignItems: 'center' },
    check: {
      position: 'absolute',
      right: -3,
      bottom: -3,
      width: 13,
      height: 13,
      borderRadius: 6.5,
      backgroundColor: colors.green,
      borderWidth: 1.5,
      borderColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
