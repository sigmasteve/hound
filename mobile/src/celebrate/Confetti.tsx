import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { color as C } from '../theme/tokens';

// Party poppers: confetti shot up from both bottom corners, falling back
// down across the screen. Plain Animated, so it needs nothing native.
// "big" for every goal done, small for one goal.

const COLORS = [C.accent, C.accent400, C.amber, C.green, C.gold, '#f27aa8', '#5fc4f2'];

interface Piece {
  fromLeft: boolean;
  x: number; // where it lands, across the screen
  peak: number; // how high it flies
  size: number;
  round: boolean;
  color: string;
  spin: number;
  delay: number;
}

export function Confetti({ big, onDone }: { big: boolean; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: big ? 90 : 28 }, (_, i) => ({
        fromLeft: i % 2 === 0,
        x: Math.random(),
        peak: (big ? 0.55 : 0.35) + Math.random() * 0.3,
        size: 6 + Math.random() * 6,
        round: Math.random() < 0.3,
        color: COLORS[i % COLORS.length],
        spin: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4),
        delay: Math.random() * 0.15,
      })),
    [big],
  );

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: big ? 2600 : 1600,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => onDone());
  }, [progress, big, onDone]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => {
        const startX = p.fromLeft ? 0 : width;
        const endX = p.x * width;
        // 0→d: waiting; then up to the peak by 35%, and falling past the
        // bottom by the end.
        const d = p.delay;
        const translateX = progress.interpolate({
          inputRange: [0, d, 1],
          outputRange: [startX, startX, endX + (p.fromLeft ? 40 : -40)],
        });
        const translateY = progress.interpolate({
          inputRange: [0, d, d + 0.35 * (1 - d), 1],
          outputRange: [height, height, height * (1 - p.peak), height + 40],
          easing: Easing.out(Easing.quad),
        });
        const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.spin * 360}deg`] });
        const opacity = progress.interpolate({ inputRange: [0, d, d + 0.01, 0.85, 1], outputRange: [0, 0, 1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              borderRadius: p.round ? p.size / 2 : 1.5,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
