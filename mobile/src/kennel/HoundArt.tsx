import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import type { Rank } from '../challenges/ranks';
import {
  breedCoatColors,
  breedForItem,
  kennelItemById,
  type CoatColors,
  type HoundBreed,
  type HoundEars,
  type HoundMarkings,
  type HoundTail,
  type KennelItem,
} from './kennelItems';

// The Kennel's hound, drawn in code (issue #344 tracks better art). A
// sitting hound facing you: how big it is comes from your rank, its face
// from its mood, its coat, ears, tail and markings from its look, and
// accessories layer on top. Happy hounds bounce; sleepy ones breathe
// slowly. With a breed on (0132_kennel_breeds.sql) it's a different dog,
// BreedBody below, with its own ears and tail; coats still apply.

export type HoundMood = 'happy' | 'okay' | 'sleepy' | 'hungry';

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
  coatId,
  breedId,
  ears = 'floppy',
  tail = 'wavy',
  markings = 'none',
  size = 160,
  animate = true,
  variant = 'full',
}: {
  rank: Rank['id'];
  mood: HoundMood;
  neckId?: string | null;
  headId?: string | null;
  faceId?: string | null;
  coatId?: string | null;
  // A breed item; its own ears and tail replace the look's.
  breedId?: string | null;
  ears?: HoundEars;
  tail?: HoundTail;
  markings?: HoundMarkings;
  size?: number;
  animate?: boolean;
  // 'avatar': just the head and shoulders, square, still, for an avatar
  // circle (see Avatar and houndAvatar.ts).
  variant?: 'full' | 'avatar';
}) {
  const asAvatar = variant === 'avatar';
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate || asAvatar || mood === 'hungry') return;
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

  const s = STAGES[asAvatar ? 'alpha' : rank];
  const breed = breedForItem(breedId);
  const g = breed ? breedGeometry(breed, s) : houndGeometry(s);
  const { bodyCy, headCy, eyeY, neckY, headR } = g;
  const neck = kennelItemById(neckId);
  const head = kennelItemById(headId);
  const face = kennelItemById(faceId);
  const palette = breedCoatColors(breed, coatId);
  const { coat: COAT, dark: COAT_DARK, light: LIGHT, eyeSpots } = palette;
  const tailX = 100 + s.bodyRx - 10;
  const tailY = bodyCy + 14;

  return (
    <Animated.View style={{ width: size, height: asAvatar ? size : size * 1.2, transform }}>
      <Svg width={size} height={asAvatar ? size : size * 1.2} viewBox={asAvatar ? `38 ${headCy - 52} 124 124` : '0 -30 200 240'}>
        <Defs>
          <RadialGradient id="aura" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#e0b84f" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#e0b84f" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {!asAvatar && rank === 'legend' && <Circle cx={100} cy={115} r={100} fill="url(#aura)" />}
        {!asAvatar && <Ellipse cx={100} cy={204} rx={(g.bodyRx + 12) * s.scale} ry={6} fill="#000" opacity={0.15} />}
        <G transform={`translate(${100 * (1 - s.scale)} ${200 * (1 - s.scale)}) scale(${s.scale})`}>
          {breed ? (
            <BreedBody breed={breed} g={g} palette={palette} />
          ) : (
            <>
              {/* Tail, behind the body. */}
              <Path
                d={
                  tail === 'curly'
                    ? `M ${tailX} ${tailY} Q ${tailX + 34} ${tailY - 4} ${tailX + 30} ${tailY - 30} Q ${tailX + 26} ${tailY - 48} ${tailX + 12} ${tailY - 38} Q ${tailX + 4} ${tailY - 28} ${tailX + 18} ${tailY - 24}`
                    : tail === 'stubby'
                      ? `M ${tailX} ${tailY} L ${tailX + 18} ${tailY - 8}`
                      : `M ${tailX} ${tailY} Q ${tailX + 40} ${tailY - 8} ${tailX + 36} ${tailY - 44}`
                }
                stroke={COAT}
                strokeWidth={tail === 'stubby' ? 13 : 11}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />

              {/* Body, haunches, chest, front legs. */}
              <Ellipse cx={100 - s.bodyRx * 0.62} cy={bodyCy + s.bodyRy * 0.5} rx={s.bodyRx * 0.45} ry={s.bodyRy * 0.4} fill={COAT_DARK} />
              <Ellipse cx={100 + s.bodyRx * 0.62} cy={bodyCy + s.bodyRy * 0.5} rx={s.bodyRx * 0.45} ry={s.bodyRy * 0.4} fill={COAT_DARK} />
              <Ellipse cx={100} cy={bodyCy} rx={s.bodyRx} ry={s.bodyRy} fill={COAT} />
              {(rank === 'alpha' || rank === 'legend') && (
                <Ellipse cx={100} cy={bodyCy - s.bodyRy * 0.55} rx={s.bodyRx * 0.85} ry={s.bodyRy * 0.35} fill={COAT_DARK} opacity={0.55} />
              )}
              {markings === 'spots' && (
                <>
                  <Circle cx={100 - s.bodyRx * 0.68} cy={bodyCy - s.bodyRy * 0.15} r={7} fill={COAT_DARK} />
                  <Circle cx={100 - s.bodyRx * 0.6} cy={bodyCy + s.bodyRy * 0.22} r={5} fill={COAT_DARK} />
                  <Circle cx={100 + s.bodyRx * 0.7} cy={bodyCy + s.bodyRy * 0.05} r={8} fill={COAT_DARK} />
                  <Circle cx={100 + s.bodyRx * 0.55} cy={bodyCy - s.bodyRy * 0.4} r={4.5} fill={COAT_DARK} />
            </>
          )}
          <Ellipse cx={100} cy={bodyCy + 6} rx={s.bodyRx * 0.5} ry={s.bodyRy * 0.68} fill={LIGHT} />
          <Rect x={100 - 30} y={bodyCy + s.bodyRy * 0.35} width={20} height={s.bodyRy * 0.62} rx={10} fill={COAT} />
          <Rect x={100 + 10} y={bodyCy + s.bodyRy * 0.35} width={20} height={s.bodyRy * 0.62} rx={10} fill={COAT} />
          <Ellipse cx={100 - 20} cy={198} rx={13} ry={7} fill={LIGHT} />
          <Ellipse cx={100 + 20} cy={198} rx={13} ry={7} fill={LIGHT} />

          {/* Head, with its ears: long and floppy over its sides, short,
              or perked up on top. */}
          {ears === 'perky' &&
            [-1, 1].map((side) => (
              <G key={side}>
                <Path
                  d={`M ${100 + side * s.headR * 0.2} ${headCy - s.headR * 0.85} L ${100 + side * s.headR * 0.95} ${headCy - s.headR * 1.45} L ${100 + side * s.headR * 0.92} ${headCy - s.headR * 0.35} Z`}
                  fill={COAT_DARK}
                  strokeLinejoin="round"
                />
                <Path
                  d={`M ${100 + side * s.headR * 0.42} ${headCy - s.headR * 0.8} L ${100 + side * s.headR * 0.86} ${headCy - s.headR * 1.2} L ${100 + side * s.headR * 0.82} ${headCy - s.headR * 0.55} Z`}
                  fill={LIGHT}
                  opacity={0.7}
                />
              </G>
            ))}
          <Circle cx={100} cy={headCy} r={s.headR} fill={COAT} />
          {ears !== 'perky' &&
            [-1, 1].map((side) => {
              const len = ears === 'short' ? s.ear * 0.55 : s.ear;
              const cx = 100 + side * s.headR * 0.9;
              const cy = ears === 'short' ? headCy - s.headR * 0.25 + len * 0.28 : headCy + len * 0.28;
              return (
                <Ellipse
                  key={side}
                  cx={cx}
                  cy={cy}
                  rx={ears === 'short' ? 13 : 15}
                  ry={len * 0.56}
                  fill={COAT_DARK}
                  transform={`rotate(${-side * (ears === 'short' ? 30 : 14)} ${cx} ${cy})`}
                />
              );
            })}
          {markings === 'eye_patch' && <Ellipse cx={83} cy={eyeY + 1} rx={15} ry={13} fill={COAT_DARK} />}
          {eyeSpots && (
            <>
              <Ellipse cx={83} cy={eyeY - 10} rx={6} ry={4} fill={LIGHT} />
              <Ellipse cx={117} cy={eyeY - 10} rx={6} ry={4} fill={LIGHT} />
            </>
          )}
          <Ellipse cx={100} cy={headCy + 18} rx={27} ry={20} fill={LIGHT} />
          <Ellipse cx={100} cy={headCy + 9} rx={9.5} ry={7} fill={NOSE} />
          <Path d={`M 100 ${headCy + 15} L 100 ${headCy + 21}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
            </>
          )}
          {neck && <NeckItem item={neck} y={neckY} width={headR * 1.25} />}

          <Face mood={mood} headCy={headCy + g.faceDy} eyeY={eyeY} />
          {face && <FaceItem item={face} eyeY={eyeY} />}
          {head && <HeadItem item={head} headCy={headCy} headR={headR} />}

          {!asAvatar && mood === 'sleepy' && (
            <SvgText x={150} y={headCy - headR + 4} fontSize={22} fontWeight="bold" fill="#8a8fa3">
              z
            </SvgText>
          )}
        </G>
      </Svg>
    </Animated.View>
  );
}

// Where everything sits for this stage: the body's centre, the head's,
// the eyes, the collar line, and how far down the mouth is from the
// head's centre (faceDy; the poodle's long muzzle puts it lower).
interface Geometry {
  bodyRx: number;
  bodyRy: number;
  bodyCy: number;
  headR: number;
  headCy: number;
  eyeY: number;
  neckY: number;
  faceDy: number;
}

type Stage = (typeof STAGES)[Rank['id']];

function houndGeometry(s: Stage): Geometry {
  const bodyCy = 200 - s.bodyRy;
  const headCy = bodyCy - s.bodyRy * 0.85 - s.headR * 0.5;
  return { bodyRx: s.bodyRx, bodyRy: s.bodyRy, bodyCy, headR: s.headR, headCy, eyeY: headCy - 4, neckY: headCy + s.headR - 7, faceDy: 0 };
}

function breedGeometry(breed: HoundBreed, s: Stage): Geometry {
  switch (breed) {
    case 'corgi': {
      // Long and low, so a wider, flatter body and a slightly smaller head.
      const bodyRx = s.bodyRx * 1.18;
      const bodyRy = s.bodyRy * 0.76;
      const headR = s.headR * 0.95;
      const bodyCy = 200 - bodyRy - 4;
      const headCy = bodyCy - bodyRy * 0.8 - headR * 0.55;
      return { bodyRx, bodyRy, bodyCy, headR, headCy, eyeY: headCy - 2, neckY: headCy + headR - 6, faceDy: 0 };
    }
    case 'poodle': {
      const bodyRx = s.bodyRx * 0.96;
      const bodyRy = s.bodyRy * 0.93;
      const headR = s.headR * 0.91;
      const bodyCy = 200 - bodyRy - 2;
      const headCy = bodyCy - bodyRy * 0.85 - headR * 0.6;
      return { bodyRx, bodyRy, bodyCy, headR, headCy, eyeY: headCy - 4, neckY: headCy + headR - 4, faceDy: 6 };
    }
    case 'frenchie': {
      // Stocky, with a wide flat head.
      const bodyRx = s.bodyRx * 1.07;
      const bodyRy = s.bodyRy * 0.86;
      const headR = s.headR * 1.05;
      const bodyCy = 200 - bodyRy - 2;
      const headCy = bodyCy - bodyRy * 0.8 - headR * 0.45;
      return { bodyRx, bodyRy, bodyCy, headR, headCy, eyeY: headCy - 2, neckY: headCy + headR - 10, faceDy: 4 };
    }
  }
}

const EAR_PINK = '#f0a8a8';

// Everything but the face and accessories for a breed: tail, body, legs,
// ears, head and muzzle. Same flat shapes as the hound, same coat
// palette (a coat item recolours it), so it reads as the same family.
function BreedBody({ breed, g, palette }: { breed: HoundBreed; g: Geometry; palette: CoatColors }) {
  const { coat: COAT, dark: DARK, light: LIGHT } = palette;
  const { bodyRx, bodyRy, bodyCy, headR, headCy, eyeY } = g;

  if (breed === 'corgi') {
    return (
      <G>
        <Circle cx={100 + bodyRx - 6} cy={bodyCy + 8} r={9} fill={LIGHT} />
        <Ellipse cx={100 - bodyRx * 0.66} cy={bodyCy + bodyRy * 0.45} rx={bodyRx * 0.4} ry={bodyRy * 0.42} fill={DARK} />
        <Ellipse cx={100 + bodyRx * 0.66} cy={bodyCy + bodyRy * 0.45} rx={bodyRx * 0.4} ry={bodyRy * 0.42} fill={DARK} />
        <Ellipse cx={100} cy={bodyCy} rx={bodyRx} ry={bodyRy} fill={COAT} />
        <Ellipse cx={100} cy={bodyCy - bodyRy * 0.5} rx={bodyRx * 0.9} ry={bodyRy * 0.32} fill={DARK} opacity={0.4} />
        <Ellipse cx={100} cy={bodyCy + 10} rx={bodyRx * 0.46} ry={bodyRy * 0.7} fill={LIGHT} />
        {/* Short legs in white socks. */}
        <Rect x={70} y={bodyCy + bodyRy * 0.5} width={20} height={bodyRy * 0.5} rx={10} fill={COAT} />
        <Rect x={110} y={bodyCy + bodyRy * 0.5} width={20} height={bodyRy * 0.5} rx={10} fill={COAT} />
        <Rect x={70} y={bodyCy + bodyRy * 0.78} width={20} height={bodyRy * 0.3} rx={10} fill={LIGHT} />
        <Rect x={110} y={bodyCy + bodyRy * 0.78} width={20} height={bodyRy * 0.3} rx={10} fill={LIGHT} />
        <Ellipse cx={80} cy={198} rx={13} ry={7} fill={LIGHT} />
        <Ellipse cx={120} cy={198} rx={13} ry={7} fill={LIGHT} />
        {/* Big upright ears, pink inside. */}
        {[-1, 1].map((side) => {
          const bx = 100 + side * headR * 0.45;
          const tipx = 100 + side * headR * 1.05;
          const tipy = headCy - headR * 1.55;
          return (
            <G key={side}>
              <Path
                d={`M ${bx} ${headCy - headR * 0.7} Q ${tipx - side * 4} ${tipy + 6} ${tipx} ${tipy} Q ${100 + side * headR * 1.08} ${headCy - headR * 0.8} ${100 + side * headR * 0.98} ${headCy - headR * 0.2} Z`}
                fill={COAT}
              />
              <Path
                d={`M ${100 + side * headR * 0.6} ${headCy - headR * 0.68} Q ${tipx - side * 6} ${tipy + 16} ${tipx - side * 3} ${tipy + 10} Q ${100 + side * headR * 0.98} ${headCy - headR * 0.78} ${100 + side * headR * 0.9} ${headCy - headR * 0.32} Z`}
                fill={EAR_PINK}
                opacity={0.85}
              />
            </G>
          );
        })}
        <Ellipse cx={100} cy={headCy} rx={headR * 1.02} ry={headR * 0.94} fill={COAT} />
        {/* White blaze down the forehead into the muzzle. */}
        <Path d={`M 93 ${headCy - headR * 0.9} Q 100 ${headCy - headR} 107 ${headCy - headR * 0.9} L 112 ${headCy + 6} L 88 ${headCy + 6} Z`} fill={LIGHT} />
        <Ellipse cx={100} cy={headCy + 18} rx={30} ry={19} fill={LIGHT} />
        <Ellipse cx={100} cy={headCy + 9} rx={9} ry={6.5} fill={NOSE} />
        <Path d={`M 100 ${headCy + 15} L 100 ${headCy + 21}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
        <Ellipse cx={80} cy={eyeY - 12} rx={6} ry={3.5} fill={DARK} opacity={0.35} />
        <Ellipse cx={120} cy={eyeY - 12} rx={6} ry={3.5} fill={DARK} opacity={0.35} />
      </G>
    );
  }

  if (breed === 'poodle') {
    const curl = LIGHT;
    return (
      <G>
        {/* Tail: a stick with a pom. */}
        <Path d={`M ${100 + bodyRx - 10} ${bodyCy + 10} L ${100 + bodyRx + 16} ${bodyCy - 34}`} stroke={COAT} strokeWidth={7} strokeLinecap="round" />
        <Puff cx={100 + bodyRx + 18} cy={bodyCy - 42} r={13} base={COAT} top={curl} />
        <Puff cx={100 - bodyRx * 0.72} cy={bodyCy + bodyRy * 0.45} r={bodyRx * 0.4} base={DARK} top={COAT} opacity={0.6} />
        <Puff cx={100 + bodyRx * 0.72} cy={bodyCy + bodyRy * 0.45} r={bodyRx * 0.4} base={DARK} top={COAT} opacity={0.6} />
        <Puff cx={100} cy={bodyCy} r={bodyRx} base={COAT} top={curl} sy={bodyRy / bodyRx} />
        <Ellipse cx={100} cy={bodyCy + 8} rx={bodyRx * 0.42} ry={bodyRy * 0.6} fill={LIGHT} opacity={0.8} />
        {/* Slim legs with pom cuffs. */}
        <Rect x={73} y={bodyCy + bodyRy * 0.4} width={14} height={bodyRy * 0.55} rx={7} fill={COAT} />
        <Rect x={113} y={bodyCy + bodyRy * 0.4} width={14} height={bodyRy * 0.55} rx={7} fill={COAT} />
        <Puff cx={80} cy={193} r={12} base={COAT} top={curl} opacity={0.9} />
        <Puff cx={120} cy={193} r={12} base={COAT} top={curl} opacity={0.9} />
        {/* Long curly ears, behind the head. */}
        {[-1, 1].map((side) => (
          <Puff key={side} cx={100 + side * headR} cy={headCy + 22} r={15} base={DARK} top={COAT} opacity={0.7} sy={1.7} />
        ))}
        <Circle cx={100} cy={headCy} r={headR} fill={COAT} />
        {/* Topknot. */}
        <Puff cx={100} cy={headCy - headR * 0.95} r={24} base={COAT} top={curl} sx={1.35} sy={0.85} />
        {/* Long muzzle. */}
        <Ellipse cx={100} cy={headCy + 22} rx={19} ry={22} fill={LIGHT} />
        <Ellipse cx={100} cy={headCy + 12} rx={8.5} ry={6.5} fill={NOSE} />
        <Path d={`M 100 ${headCy + 18} L 100 ${headCy + 26}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      </G>
    );
  }

  // French bulldog.
  return (
    <G>
      <Circle cx={100 + bodyRx - 8} cy={bodyCy + 12} r={7} fill={DARK} />
      <Ellipse cx={100 - bodyRx * 0.64} cy={bodyCy + bodyRy * 0.48} rx={bodyRx * 0.44} ry={bodyRy * 0.42} fill={DARK} />
      <Ellipse cx={100 + bodyRx * 0.64} cy={bodyCy + bodyRy * 0.48} rx={bodyRx * 0.44} ry={bodyRy * 0.42} fill={DARK} />
      <Ellipse cx={100} cy={bodyCy} rx={bodyRx} ry={bodyRy} fill={COAT} />
      <Ellipse cx={100} cy={bodyCy - bodyRy * 0.5} rx={bodyRx * 0.9} ry={bodyRy * 0.35} fill={DARK} opacity={0.35} />
      <Ellipse cx={100} cy={bodyCy + 6} rx={bodyRx * 0.42} ry={bodyRy * 0.62} fill={LIGHT} />
      {/* Stout legs. */}
      <Rect x={68} y={bodyCy + bodyRy * 0.4} width={24} height={bodyRy * 0.58} rx={12} fill={COAT} />
      <Rect x={108} y={bodyCy + bodyRy * 0.4} width={24} height={bodyRy * 0.58} rx={12} fill={COAT} />
      <Ellipse cx={80} cy={198} rx={14} ry={7} fill={LIGHT} />
      <Ellipse cx={120} cy={198} rx={14} ry={7} fill={LIGHT} />
      {/* Bat ears, pink inside. */}
      {[-1, 1].map((side) => {
        const cx = 100 + side * headR * 0.78;
        const cy = headCy - headR * 0.95;
        return (
          <G key={side}>
            <Ellipse cx={cx} cy={cy} rx={15} ry={30} fill={COAT} transform={`rotate(${side * 12} ${cx} ${cy})`} />
            <Ellipse cx={cx} cy={cy + 2} rx={8.5} ry={21} fill={EAR_PINK} opacity={0.9} transform={`rotate(${side * 12} ${cx} ${cy})`} />
          </G>
        );
      })}
      <Ellipse cx={100} cy={headCy} rx={headR * 1.08} ry={headR * 0.9} fill={COAT} />
      {/* The dark mask round the muzzle, forehead wrinkles, jowls, a big short nose. */}
      <Ellipse cx={100} cy={headCy + 17} rx={31} ry={20} fill={DARK} opacity={0.85} />
      <Path d={`M 86 ${headCy - 22} Q 100 ${headCy - 27} 114 ${headCy - 22}`} stroke={DARK} strokeWidth={2.5} strokeLinecap="round" fill="none" opacity={0.7} />
      <Path d={`M 90 ${headCy - 15} Q 100 ${headCy - 19} 110 ${headCy - 15}`} stroke={DARK} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.5} />
      <Ellipse cx={88} cy={headCy + 24} rx={13} ry={10} fill={LIGHT} opacity={0.35} />
      <Ellipse cx={112} cy={headCy + 24} rx={13} ry={10} fill={LIGHT} opacity={0.35} />
      <Ellipse cx={100} cy={headCy + 10} rx={12} ry={8} fill={NOSE} />
      <Path d={`M 100 ${headCy + 17} L 100 ${headCy + 23}`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </G>
  );
}

// A puff of curly coat: a base ellipse ringed with small circles.
function Puff({ cx, cy, r, base, top, opacity = 1, sx = 1, sy = 1 }: { cx: number; cy: number; r: number; base: string; top: string; opacity?: number; sx?: number; sy?: number }) {
  const n = Math.max(6, Math.round(r / 4));
  return (
    <G opacity={opacity}>
      <Ellipse cx={cx} cy={cy} rx={r * sx} ry={r * sy} fill={base} />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return <Circle key={i} cx={cx + Math.cos(a) * r * sx * 0.82} cy={cy + Math.sin(a) * r * sy * 0.82} r={r * 0.32} fill={i % 2 ? top : base} />;
      })}
      <Ellipse cx={cx} cy={cy} rx={r * sx * 0.75} ry={r * sy * 0.75} fill={base} />
    </G>
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
        <Circle cx={88} cy={y + 8} r={2.5} fill={item.accent ?? '#fff'} opacity={0.8} />
        <Circle cx={110} cy={y + 10} r={2.5} fill={item.accent ?? '#fff'} opacity={0.8} />
        <Circle cx={100} cy={y + 22} r={2.5} fill={item.accent ?? '#fff'} opacity={0.8} />
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
  if (item.kind === 'pumpkin') {
    // A small pumpkin sitting on top, with ribs and a stem and leaf.
    const cy = top - 6;
    return (
      <G>
        <Ellipse cx={100} cy={cy} rx={30} ry={20} fill={item.color} />
        <Ellipse cx={100} cy={cy} rx={17} ry={20} fill="none" stroke="#c96a12" strokeWidth={2} />
        <Ellipse cx={100} cy={cy} rx={5} ry={20} fill="none" stroke="#c96a12" strokeWidth={2} />
        <Path d={`M 100 ${cy - 19} Q 98 ${cy - 30} 104 ${cy - 32}`} stroke="#4f7a2b" strokeWidth={5} strokeLinecap="round" fill="none" />
        <Path d={`M 103 ${cy - 26} Q 116 ${cy - 34} 120 ${cy - 24} Q 110 ${cy - 22} 103 ${cy - 26} Z`} fill="#5f9a35" />
      </G>
    );
  }
  if (item.kind === 'witch') {
    // A wide brim and a tall, crooked point, with a band.
    const brim = top + 10;
    return (
      <G>
        <Ellipse cx={100} cy={brim} rx={46} ry={9} fill={item.color} />
        <Path d={`M 78 ${brim} L 96 ${brim - 52} Q 104 ${brim - 64} 118 ${brim - 58} L 106 ${brim - 48} L 122 ${brim} Z`} fill={item.color} />
        <Path d={`M 80 ${brim - 4} L 120 ${brim - 4}`} stroke={item.accent ?? '#f08a24'} strokeWidth={7} />
        <Rect x={96} y={brim - 9} width={9} height={9} rx={1.5} fill="none" stroke="#e0b84f" strokeWidth={2} />
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
  if (item.kind === 'mask') {
    // A masquerade mask across both eyes, with eye holes and a gold trim.
    return (
      <G>
        <Path
          d={`M 66 ${eyeY - 4} Q 70 ${eyeY - 16} 88 ${eyeY - 12} Q 100 ${eyeY - 8} 112 ${eyeY - 12} Q 130 ${eyeY - 16} 134 ${eyeY - 4} Q 130 ${eyeY + 12} 112 ${eyeY + 9} Q 100 ${eyeY + 4} 88 ${eyeY + 9} Q 70 ${eyeY + 12} 66 ${eyeY - 4} Z`}
          fill={item.color}
          stroke={item.accent ?? '#e0b84f'}
          strokeWidth={2}
        />
        <Ellipse cx={84} cy={eyeY} rx={8} ry={5.5} fill="#fff" fillOpacity={0.25} />
        <Ellipse cx={116} cy={eyeY} rx={8} ry={5.5} fill="#fff" fillOpacity={0.25} />
      </G>
    );
  }
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
