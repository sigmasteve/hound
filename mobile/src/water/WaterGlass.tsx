import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { buzz } from '../celebrate/feedback';

// A glass of water that fills as you drink (the water design's "How
// adding water looks"). Each pour drops a drop in from above: it lands
// with a ripple and a few splash droplets, the surface sloshes and
// settles, and the level rises with a soft spring. Full, it fizzes.
//
// Everything moves on the native driver: the level is a translate, the
// surface is one long wave sliding sideways, so nothing redraws per frame.

export function waterColors(mode: 'light' | 'dark') {
  return mode === 'dark'
    ? { water: '#45b4ec', top: '#9be1ff', back: 'rgba(69,180,236,0.38)', wash: 'rgba(69,180,236,0.14)', on: '#0d1a26' }
    : { water: '#2f9fdc', top: '#7fd0f6', back: 'rgba(47,159,220,0.35)', wash: 'rgba(47,159,220,0.12)', on: '#ffffff' };
}

// The glass fills to 92% of its height when the goal is met.
const FULL = 0.92;

function wavePath(width: number, height: number, amp: number, phase: number): string {
  // Two periods across `width`, so sliding by half of it loops seamlessly.
  const mid = height / 2;
  let d = `M0 ${height}`;
  for (let x = 0; x <= width; x += 2) {
    const y = mid + amp * Math.sin((x / width) * Math.PI * 4 + phase);
    d += ` L${x} ${y.toFixed(2)}`;
  }
  return `${d} L${width} ${height} Z`;
}

export function WaterGlass({
  width,
  height,
  fraction,
  pours,
  met,
  marks = 0,
  haptics = false,
}: {
  width: number;
  height: number;
  // Today's water as a share of the goal; above 1 shows full.
  fraction: number;
  // Goes up by one on every glass logged: this glass pours a drop.
  pours: number;
  met: boolean;
  // Cup marks up the side (the sheet's big glass): how many steps.
  marks?: number;
  // Only one glass on screen buzzes.
  haptics?: boolean;
}) {
  const { mode } = useTheme();
  const c = waterColors(mode);
  const big = width >= 80;
  const stroke = big ? 2.5 : 1.6;
  const innerW = width - stroke * 2;
  const innerH = height - stroke * 2;
  const dropSpace = big ? 42 : 26;
  const waveH = big ? 14 : 8;
  const amp = big ? 2.6 : 1.4;

  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);

  const target = Math.max(0, Math.min(1, fraction)) * FULL;
  const level = useRef(new Animated.Value(target)).current;
  const shown = useRef(target);
  const slide = useRef(new Animated.Value(0)).current;
  const slosh = useRef(new Animated.Value(1)).current;
  const drop = useRef(new Animated.Value(0)).current;
  const dropOn = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const splash = useRef(new Animated.Value(0)).current;
  const fizz = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  // The surface: always drifting.
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(slide, { toValue: 1, duration: big ? 3200 : 2600, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, big, slide]);

  // Bubbles once the goal is met.
  useEffect(() => {
    if (!met || reduce) {
      fizz.forEach((f) => f.setValue(0));
      return;
    }
    const loops = fizz.map((f, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 520),
          Animated.timing(f, { toValue: 1, duration: 1500, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(f, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [met, reduce, fizz]);

  const rise = (to: number) => {
    shown.current = to;
    if (reduce) {
      level.setValue(to);
      return;
    }
    Animated.spring(level, { toValue: to, friction: 6, tension: 60, useNativeDriver: true }).start();
  };

  // A pour drops a drop in first; any other change (a glass removed, a
  // new day, water from Health) just moves the level.
  const lastPours = useRef(pours);
  const wasMet = useRef(met);
  useEffect(() => {
    const poured = pours > lastPours.current;
    lastPours.current = pours;
    const justMet = met && !wasMet.current;
    wasMet.current = met;
    if (!poured || reduce) {
      rise(target);
      if (poured && haptics) buzz(justMet ? 'success' : 'light');
      return;
    }
    drop.setValue(0);
    dropOn.setValue(1);
    Animated.timing(drop, { toValue: 1, duration: 340, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      dropOn.setValue(0);
      if (haptics) buzz(justMet ? 'success' : 'light');
      ripple.setValue(0);
      splash.setValue(0);
      slosh.setValue(justMet ? 3.4 : 2.4);
      Animated.parallel([
        Animated.timing(ripple, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(splash, { toValue: 1, duration: justMet ? 700 : 520, easing: Easing.linear, useNativeDriver: true }),
        Animated.spring(slosh, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true }),
      ]).start();
      rise(target);
    });
    // Only a new pour or a new target starts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pours, target, met, reduce]);

  // Where the surface is, in the glass's own coordinates, as the level moves.
  const surfaceY = level.interpolate({ inputRange: [0, 1], outputRange: [innerH, 0] });
  // Where the drop lands: the surface it's falling toward.
  const landAt = dropSpace + stroke + innerH * (1 - target);

  const front = useMemo(() => wavePath(innerW * 2, waveH, amp, 0), [innerW, waveH, amp]);
  const back = useMemo(() => wavePath(innerW * 2, waveH, amp * 1.2, 1.9), [innerW, waveH, amp]);
  const gradId = `wg${Math.round(width)}x${Math.round(height)}`;

  const sprayDots = big
    ? [
        [-18, -26],
        [-8, -34],
        [9, -30],
        [19, -22],
        [-26, -14],
        [27, -12],
      ]
    : [
        [-9, -14],
        [-3, -18],
        [5, -16],
        [10, -11],
      ];

  return (
    <View style={{ width, height: height + dropSpace }} pointerEvents="none">
      {/* The glass */}
      <View
        style={[
          styles.glass,
          {
            top: dropSpace,
            width,
            height,
            borderWidth: stroke,
            borderColor: mode === 'dark' ? 'rgba(233,233,237,0.35)' : 'rgba(27,29,41,0.3)',
            backgroundColor: mode === 'dark' ? 'rgba(233,233,237,0.05)' : 'rgba(27,29,41,0.04)',
            borderBottomLeftRadius: width * 0.2,
            borderBottomRightRadius: width * 0.2,
            borderTopLeftRadius: big ? 4 : 3,
            borderTopRightRadius: big ? 4 : 3,
          },
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: surfaceY }] }]}>
          {/* The surface: a back wave and a front one, sliding apart. */}
          <Animated.View style={{ position: 'absolute', top: -waveH + 1, left: 0, height: waveH, width: innerW, transform: [{ scaleY: slosh }] }}>
            <Animated.View
              style={{
                position: 'absolute',
                top: -2,
                width: innerW * 2,
                height: waveH,
                transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-innerW, 0] }) }],
              }}
            >
              <Svg width={innerW * 2} height={waveH}>
                <Path d={back} fill={c.back} />
              </Svg>
            </Animated.View>
            <Animated.View
              style={{
                position: 'absolute',
                width: innerW * 2,
                height: waveH,
                transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -innerW] }) }],
              }}
            >
              <Svg width={innerW * 2} height={waveH}>
                <Path d={front} fill={c.top} />
              </Svg>
            </Animated.View>
          </Animated.View>
          <Svg width={innerW} height={innerH + 2}>
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={c.top} />
                <Stop offset="0.6" stopColor={c.water} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={innerW} height={innerH + 2} fill={`url(#${gradId})`} />
          </Svg>
          {/* Bubbles, rising from the bottom to the surface. */}
          {fizz.map((f, i) => (
            <Animated.View
              key={i}
              style={[
                styles.bubble,
                {
                  width: big ? 5 : 3,
                  height: big ? 5 : 3,
                  left: innerW * (0.3 + i * 0.2),
                  top: innerH * (1 - FULL) + innerH * FULL - 6,
                  opacity: f.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 0.8, 0.8, 0] }),
                  transform: [{ translateY: f.interpolate({ inputRange: [0, 1], outputRange: [0, -innerH * FULL + 8] }) }],
                },
              ]}
            />
          ))}
        </Animated.View>
        {/* Cup marks up the side. */}
        {marks > 1 &&
          Array.from({ length: marks - 1 }, (_, i) => (
            <View
              key={i}
              style={[
                styles.mark,
                {
                  top: innerH - innerH * FULL * ((i + 1) / marks),
                  backgroundColor: mode === 'dark' ? 'rgba(233,233,237,0.35)' : 'rgba(27,29,41,0.28)',
                },
              ]}
            />
          ))}
        {/* The shine down the glass. */}
        <View
          style={[
            styles.shine,
            { left: width * 0.14, top: height * 0.1, width: stroke * 1.6, height: height * 0.68, borderRadius: stroke },
            { backgroundColor: mode === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.75)' },
          ]}
        />
      </View>

      {/* The drop, falling from above the rim to the surface. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: width / 2 - (big ? 6 : 4),
          top: 0,
          opacity: dropOn,
          transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, landAt - (big ? 14 : 10)] }) }],
        }}
      >
        <Svg width={big ? 12 : 8} height={big ? 16 : 11} viewBox="0 0 12 16">
          <Path d="M6 0 C 8.5 4 12 7 12 10 A 6 6 0 0 1 0 10 C 0 7 3.5 4 6 0 Z" fill={c.water} />
        </Svg>
      </Animated.View>

      {/* Where it lands: a ripple ring and a few splash droplets. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: width / 2 - innerW * 0.42,
          top: landAt - (big ? 5 : 3),
          width: innerW * 0.84,
          height: big ? 10 : 6,
          borderRadius: innerW,
          borderWidth: stroke,
          borderColor: c.top,
          opacity: ripple.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.9, 0] }),
          transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] }) }],
        }}
      />
      {sprayDots.map(([dx, dy], i) => (
        <Animated.View
          key={i}
          style={[
            styles.spray,
            {
              backgroundColor: c.water,
              width: big ? 5 : 3,
              height: big ? 5 : 3,
              left: width / 2 - (big ? 2.5 : 1.5),
              top: landAt - 2,
              opacity: splash.interpolate({ inputRange: [0, 0.05, 0.7, 1], outputRange: [0, 1, 0.8, 0] }),
              transform: [
                { translateX: splash.interpolate({ inputRange: [0, 1], outputRange: [0, dx * (met ? 1.4 : 1)] }) },
                {
                  translateY: splash.interpolate({
                    inputRange: [0, 0.45, 1],
                    outputRange: [0, dy * (met ? 1.4 : 1), dy * 0.2 + 10],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { position: 'absolute', left: 0, overflow: 'hidden' },
  bubble: { position: 'absolute', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.75)' },
  mark: { position: 'absolute', right: 3, width: 8, height: 1.5, borderRadius: 1 },
  shine: { position: 'absolute' },
  spray: { position: 'absolute', borderRadius: 3 },
});
