import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { Rank } from '../challenges/ranks';
import { kennelItemById, type KennelItem } from './kennelItems';

// The Kennel's hound, drawn in code (issue #344 tracks better art). A
// sitting hound facing you: how big it is comes from your rank, its face
// from its mood, and accessories layer on top. Happy hounds bounce;
// sleepy ones breathe slowly.

export type HoundMood = 'happy' | 'okay' | 'sleepy' | 'hungry';

const COAT = '#c98a4b';
const COAT_DARK = '#7a4a24';
const LIGHT = '#f1d7b0';
const NOSE = '#2b1d14';
const INK = '#2b1d14';

// Per rank: head radius, body size, ear length, and how big the whole
// hound is drawn (a pup is small and mostly head).
const STAGES: Record<Rank['id'], { headR: number; bodyRx: number; bodyRy: number; ear: number; scale: number }> = {
  pup: { headR: 46, bodyRx: 40, bodyRy: 40, ear: 40, scale: 0.78 },
  tracker: { headR: 45, bodyRx: 47, bodyRy: 48, ear: 48, scale: 0.88 },
  hunter: { headR: 44, bodyRx: 52, bodyRy: 54, ear: 56, scale: 0.95 },
  alpha: { headR: 44, bodyRx: 56, bodyRy: 58, ear: 60, scale: 1 },
  legend: { headR: 44, bodyRx: 56, bodyRy: 58, ear: 60, scale: 1 },
};

export function HoundArt({
  rank,
  mood,
  neckId,
  headId,
  faceId,
  size = 160,
  animate = true,
}: {
  rank: Rank['id'];
  mood: HoundMood;
  neckId?: string | null;
  headId?: string | null;
  faceId?: string | null;
  size?: number;
  animate?: boolean;
}) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate || mood === 'hungry') return;
    const happy = mood === 'happy';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, {
          toValue: 1,
          duration: happy ? 380 : 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(motion, {
          toValue: 0,
          duration: happy ? 380 : 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(happy ? 900 : 200),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, mood, motion]);

  const transform =
    mood === 'happy'
      ? [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.04] }) }]
      : [{ scale: motion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }];

  const s = STAGES[rank];
  const bodyCy = 200 - s.bodyRy;
  const headCy = bodyCy - s.bodyRy * 0.85 - s.headR * 0.5;
  const neckY = headCy + s.headR - 7;
  const neck = kennelItemById(neckId);
  const head = kennelItemById(headId);
  const face = kennelItemById(faceId);
  const eyeY = headCy - 4;

  return (
    <Animated.View style={{ width: size, height: size * 1.2, transform }}>
      <Svg width={size} height={size * 1.2} viewBox="0 -30 200 240">
        <Defs>
          <RadialGradient id="aura" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#e0b84f" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#e0b84f" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {rank === 'legend' && <Circle cx={100} cy={115} r={100} fill="url(#aura)" />}
        <Ellipse cx={100} cy={204} rx={(s.bodyRx + 12) * s.scale} ry={6} fill="#000" opacity={0.15} />
        <G transform={`translate(${100 * (1 - s.scale)} ${200 * (1 - s.scale)}) scale(${s.scale})`}>
          {/* Tail, behind the body. */}
          <Path
            d={`M ${100 + s.bodyRx - 10} ${bodyCy + 14} Q ${100 + s.bodyRx + 30} ${bodyCy + 6} ${100 + s.bodyRx + 26} ${bodyCy - 30}`}
            stroke={COAT}
            strokeWidth={11}
            strokeLinecap="round"
            fill="none"
          />

          {/* Body, haunches, chest, front legs. */}
          <Ellipse cx={100 - s.bodyRx * 0.62} cy={bodyCy + s.bodyRy * 0.5} rx={s.bodyRx * 0.45} ry={s.bodyRy * 0.4} fill={COAT_DARK} />
          <Ellipse cx={100 + s.bodyRx * 0.62} cy={bodyCy + s.bodyRy * 0.5} rx={s.bodyRx * 0.45} ry={s.bodyRy * 0.4} fill={COAT_DARK} />
          <Ellipse cx={100} cy={bodyCy} rx={s.bodyRx} ry={s.bodyRy} fill={COAT} />
          {(rank === 'alpha' || rank === 'legend') && (
            <Ellipse cx={100} cy={bodyCy - s.bodyRy * 0.55} rx={s.bodyRx * 0.85} ry={s.bodyRy * 0.35} fill={COAT_DARK} opacity={0.55} />
          )}
          <Ellipse cx={100} cy={bodyCy + 6} rx={s.bodyRx * 0.5} ry={s.bodyRy * 0.68} fill={LIGHT} />
          <Rect x={100 - 30} y={bodyCy + s.bodyRy * 0.35} width={20} height={s.bodyRy * 0.62} rx={10} fill={COAT} />
          <Rect x={100 + 10} y={bodyCy + s.bodyRy * 0.35} width={20} height={s.bodyRy * 0.62} rx={10} fill={COAT} />
          <Ellipse cx={100 - 20} cy={198} rx={13} ry={7} fill={LIGHT} />
          <Ellipse cx={100 + 20} cy={198} rx={13} ry={7} fill={LIGHT} />

          {/* Head, with long hound ears over its sides. */}
          <Circle cx={100} cy={headCy} r={s.headR} fill={COAT} />
          <Ellipse
            cx={100 - s.headR * 0.9}
            cy={headCy + s.ear * 0.28}
            rx={15}
            ry={s.ear * 0.56}
            fill={COAT_DARK}
            transform={`rotate(14 ${100 - s.headR * 0.9} ${headCy + s.ear * 0.28})`}
          />
          <Ellipse
            cx={100 + s.headR * 0.9}
            cy={headCy + s.ear * 0.28}
            rx={15}
            ry={s.ear * 0.56}
            fill={COAT_DARK}
            transform={`rotate(-14 ${100 + s.headR * 0.9} ${headCy + s.ear * 0.28})`}
          />
          <Ellipse cx={100} cy={headCy + 18} rx={27} ry={20} fill={LIGHT} />
          <Ellipse cx={100} cy={headCy + 9} rx={9.5} ry={7} fill={NOSE} />
          <Path d={`M 100 ${headCy + 15} L 100 ${headCy + 21}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
          {neck && <NeckItem item={neck} y={neckY} width={s.headR * 1.25} />}

          <Face mood={mood} headCy={headCy} eyeY={eyeY} />
          {face && <FaceItem item={face} eyeY={eyeY} />}
          {head && <HeadItem item={head} headCy={headCy} headR={s.headR} />}

          {mood === 'sleepy' && (
            <SvgText x={150} y={headCy - s.headR + 4} fontSize={22} fontWeight="bold" fill="#8a8fa3">
              z
            </SvgText>
          )}
        </G>
      </Svg>
    </Animated.View>
  );
}

function Face({ mood, headCy, eyeY }: { mood: HoundMood; headCy: number; eyeY: number }) {
  const eyes = [100 - 17, 100 + 17];
  const mouthY = headCy + 22;
  return (
    <G>
      {eyes.map((x) =>
        mood === 'happy' ? (
          <Path
            key={x}
            d={`M ${x - 7} ${eyeY + 2} Q ${x} ${eyeY - 7} ${x + 7} ${eyeY + 2}`}
            stroke={INK}
            strokeWidth={4}
            strokeLinecap="round"
            fill="none"
          />
        ) : mood === 'sleepy' ? (
          <Path
            key={x}
            d={`M ${x - 7} ${eyeY} Q ${x} ${eyeY + 5} ${x + 7} ${eyeY}`}
            stroke={INK}
            strokeWidth={3.5}
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <G key={x}>
            <Circle cx={x} cy={eyeY} r={6} fill={INK} />
            <Circle cx={x + 2} cy={eyeY - 2} r={2} fill="#fff" />
          </G>
        ),
      )}
      {mood === 'hungry' && (
        <>
          <Path d={`M 74 ${eyeY - 10} L 90 ${eyeY - 14}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <Path d={`M 126 ${eyeY - 10} L 110 ${eyeY - 14}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      )}
      {mood === 'happy' ? (
        <>
          <Path d={`M 88 ${mouthY} Q 100 ${mouthY + 17} 112 ${mouthY} Z`} fill="#8c2f2f" />
          <Ellipse cx={100} cy={mouthY + 9} rx={6} ry={5} fill="#f08a9a" />
          <Circle cx={72} cy={headCy + 14} r={6} fill="#f08a9a" opacity={0.45} />
          <Circle cx={128} cy={headCy + 14} r={6} fill="#f08a9a" opacity={0.45} />
        </>
      ) : mood === 'okay' ? (
        <Path d={`M 91 ${mouthY} Q 100 ${mouthY + 7} 109 ${mouthY}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      ) : mood === 'hungry' ? (
        <Path
          d={`M 91 ${mouthY + 5} Q 100 ${mouthY - 2} 109 ${mouthY + 5}`}
          stroke={INK}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <Path d={`M 94 ${mouthY + 2} L 106 ${mouthY + 2}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      )}
    </G>
  );
}

function NeckItem({ item, y, width }: { item: KennelItem; y: number; width: number }) {
  if (item.kind === 'bandana') {
    return (
      <G>
        <Path d={`M ${100 - width / 2} ${y} L ${100 + width / 2} ${y} L 100 ${y + 36} Z`} fill={item.color} />
        <Circle cx={88} cy={y + 8} r={2.5} fill="#fff" opacity={0.8} />
        <Circle cx={110} cy={y + 10} r={2.5} fill="#fff" opacity={0.8} />
        <Circle cx={100} cy={y + 22} r={2.5} fill="#fff" opacity={0.8} />
      </G>
    );
  }
  return (
    <G>
      <Rect x={100 - width / 2} y={y} width={width} height={10} rx={5} fill={item.color} />
      <Circle cx={100} cy={y + 15} r={6} fill="#e0b84f" stroke="#b8902f" strokeWidth={1.5} />
    </G>
  );
}

function HeadItem({ item, headCy, headR }: { item: KennelItem; headCy: number; headR: number }) {
  const top = headCy - headR;
  if (item.kind === 'beanie') {
    return (
      <G>
        <Path
          d={`M ${100 - headR * 0.85} ${top + headR * 0.55} Q 100 ${top - headR * 0.55} ${100 + headR * 0.85} ${top + headR * 0.55} Z`}
          fill={item.color}
        />
        <Rect x={100 - headR * 0.9} y={top + headR * 0.42} width={headR * 1.8} height={11} rx={5.5} fill="#2f8f5a" />
        <Circle cx={100} cy={top - headR * 0.08} r={8} fill="#fff" />
      </G>
    );
  }
  if (item.kind === 'party') {
    return (
      <G>
        <Path d={`M ${84} ${top + 12} L ${116} ${top + 12} L ${104} ${top - 40} Z`} fill={item.color} />
        <Path d={`M ${89} ${top - 4} L ${110} ${top - 4}`} stroke="#ffd23f" strokeWidth={4} />
        <Path d={`M ${95} ${top - 22} L ${107} ${top - 22}`} stroke="#ffd23f" strokeWidth={4} />
        <Circle cx={104} cy={top - 42} r={6} fill="#ffd23f" />
      </G>
    );
  }
  // Crown
  const y = top + 8;
  return (
    <G>
      <Path
        d={`M 76 ${y} L 76 ${y - 24} L 88 ${y - 12} L 100 ${y - 30} L 112 ${y - 12} L 124 ${y - 24} L 124 ${y} Z`}
        fill={item.color}
        stroke="#b8902f"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={100} cy={y - 8} r={3.5} fill="#e04f6a" />
      <Circle cx={86} cy={y - 6} r={2.5} fill="#4f9fe0" />
      <Circle cx={114} cy={y - 6} r={2.5} fill="#4f9fe0" />
    </G>
  );
}

function FaceItem({ item, eyeY }: { item: KennelItem; eyeY: number }) {
  if (item.kind === 'sun') {
    return (
      <G>
        <Rect x={69} y={eyeY - 9} width={26} height={17} rx={6} fill={item.color} />
        <Rect x={105} y={eyeY - 9} width={26} height={17} rx={6} fill={item.color} />
        <Path d={`M 95 ${eyeY - 3} L 105 ${eyeY - 3}`} stroke={item.color} strokeWidth={3} />
        <Path d={`M 74 ${eyeY - 4} L 80 ${eyeY - 4}`} stroke="#fff" strokeWidth={2} opacity={0.6} strokeLinecap="round" />
        <Path d={`M 110 ${eyeY - 4} L 116 ${eyeY - 4}`} stroke="#fff" strokeWidth={2} opacity={0.6} strokeLinecap="round" />
      </G>
    );
  }
  return (
    <G>
      <Circle cx={83} cy={eyeY} r={11} stroke={item.color} strokeWidth={3} fill="#fff" fillOpacity={0.12} />
      <Circle cx={117} cy={eyeY} r={11} stroke={item.color} strokeWidth={3} fill="#fff" fillOpacity={0.12} />
      <Path d={`M 94 ${eyeY - 2} L 106 ${eyeY - 2}`} stroke={item.color} strokeWidth={3} />
    </G>
  );
}
