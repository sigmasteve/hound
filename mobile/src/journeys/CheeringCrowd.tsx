import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

// A row of little people cheering you into a stop: arms up, bouncing
// and swaying out of step with each other, one of them holding a sign.
// Drawn in SVG, moved with plain Animated, so it needs nothing native.

const SHIRTS = ['#e85d75', '#f2a541', '#4ec7a0', '#5b8def', '#b56cf0', '#ff8c5a', '#39b5c6', '#f06ba6'];
const SKINS = ['#f3c9a6', '#d9a173', '#b57a4a', '#8d5a33', '#f6d9bf', '#6e4327'];
const HAIR = ['#2b1d12', '#5a3a1e', '#d9b36b', '#1a1a1a', '#8b4b2f', '#c7c2bd'];

interface Person {
  shirt: string;
  skin: string;
  hair: string;
  // Both arms up, or one up and one out: a little variety.
  arms: 'up' | 'wave';
  delay: number;
  bounce: number;
}

function Figure({ p, sign }: { p: Person; sign: string | null }) {
  const w = 34;
  const h = 46;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {sign && (
        <>
          <Rect x={2} y={0} width={30} height={14} rx={2} fill="#fff6d6" stroke="#d9b36b" strokeWidth={1} />
          <SvgText x={17} y={10.5} fontSize={sign.length > 6 ? 6 : 8} fontWeight="700" fill="#5a3a1e" textAnchor="middle">
            {sign}
          </SvgText>
          <Line x1={17} y1={14} x2={17} y2={24} stroke="#8d6b3a" strokeWidth={1.5} />
        </>
      )}
      {/* arms */}
      {p.arms === 'up' || sign ? (
        <>
          <Line x1={11} y1={28} x2={5} y2={14} stroke={p.skin} strokeWidth={3} strokeLinecap="round" />
          <Line x1={23} y1={28} x2={29} y2={14} stroke={p.skin} strokeWidth={3} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Line x1={11} y1={28} x2={3} y2={16} stroke={p.skin} strokeWidth={3} strokeLinecap="round" />
          <Line x1={23} y1={28} x2={31} y2={24} stroke={p.skin} strokeWidth={3} strokeLinecap="round" />
        </>
      )}
      {/* body */}
      <Path d={`M10 27 h14 a2 2 0 0 1 2 2 v10 h-18 v-10 a2 2 0 0 1 2 -2 z`} fill={p.shirt} />
      {/* legs */}
      <Rect x={12} y={39} width={4} height={7} rx={1.5} fill="#3b3f57" />
      <Rect x={18} y={39} width={4} height={7} rx={1.5} fill="#3b3f57" />
      {/* head and hair */}
      <Circle cx={17} cy={20} r={6.5} fill={p.skin} />
      <Path d="M10.5 19 a6.5 6.5 0 0 1 13 0 a9 4 0 0 0 -13 0 z" fill={p.hair} />
    </Svg>
  );
}

export function CheeringCrowd({ count = 9, sign = null }: { count?: number; sign?: string | null }) {
  const people = useMemo<Person[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        shirt: SHIRTS[(i * 3) % SHIRTS.length],
        skin: SKINS[(i * 5) % SKINS.length],
        hair: HAIR[(i * 7) % HAIR.length],
        arms: i % 3 === 1 ? 'wave' : 'up',
        delay: (i * 137) % 400,
        bounce: 5 + ((i * 53) % 5),
      })),
    [count],
  );
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat]);

  const signAt = Math.floor(count / 2);
  return (
    <View style={styles.row} pointerEvents="none">
      {people.map((p, i) => {
        // Everyone on the same beat, but out of phase, so it reads as a
        // crowd and not a chorus line.
        const phase = p.delay / 400;
        const up = beat.interpolate({
          inputRange: [0, 1],
          outputRange: [-p.bounce * phase, -p.bounce * (1 - phase)],
        });
        const sway = beat.interpolate({
          inputRange: [0, 1],
          outputRange: [`${i % 2 ? -4 : 4}deg`, `${i % 2 ? 4 : -4}deg`],
        });
        return (
          <Animated.View key={i} style={{ transform: [{ translateY: up }, { rotate: sway }] }}>
            <Figure p={p} sign={i === signAt ? sign : null} />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 2, height: 48 },
});
