import React, { useEffect, useRef, useState } from 'react';
import { AppState, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, LinearGradient, Path, Rect, Stop, Defs, Text as SvgText } from 'react-native-svg';
import { HoundArt } from './HoundArt';
import { yardSeason, yardTime, type YardHound, type YardTime } from './YardArt';
import { YARD_ASPECT } from './YardArt';

// The Porch (0157, issue #476): the second zone you swipe to from the
// Yard. The back of the house with its door, a deck, and six things you
// can put on it, each in its own place: the Hot Tub, a Lounge Chair, a
// Porch Swing, a Fire Pit, a Patio Umbrella and a Grill.
//
// Where the hound is: in the hot tub when it's up and about (bubbles, and
// steam at night and in winter), by the fire pit at night, on the lounge
// chair or the swing when sleepy, and on the welcome mat otherwise.

const W = 400;
const H = W * YARD_ASPECT;
const FLOOR_Y = 168;

const AT = {
  grill: { x: 372, y: 214 },
  swing: { x: 140, y: 214 },
  door: { x: 214, y: FLOOR_Y },
  mat: { x: 214, y: 236 },
  umbrella: { x: 40, y: 290 },
  lounge: { x: 92, y: 288 },
  firepit: { x: 206, y: 290 },
  tub: { x: 316, y: 284 },
};

// Where a porch item is, in pixels, for a scene this wide (the Kennel's
// zoom while you pick).
export function porchFocusPoint(itemId: string, width: number): { x: number; y: number; height: number } {
  const k = width / W;
  const at =
    itemId === 'porch_hottub'
      ? { x: AT.tub.x, y: AT.tub.y - 30 }
      : itemId === 'porch_lounge'
        ? { x: AT.lounge.x, y: AT.lounge.y - 24 }
        : itemId === 'porch_swing'
          ? { x: AT.swing.x, y: AT.swing.y - 40 }
          : itemId === 'porch_firepit'
            ? { x: AT.firepit.x, y: AT.firepit.y - 20 }
            : itemId === 'porch_umbrella'
              ? { x: AT.umbrella.x, y: AT.umbrella.y - 90 }
              : itemId === 'porch_grill'
                ? { x: AT.grill.x, y: AT.grill.y - 30 }
                : { x: W / 2, y: H / 2 };
  return { x: at.x * k, y: at.y * k, height: H * k };
}

type Spot = 'tub' | 'fire' | 'lounge' | 'swing' | 'mat' | 'grill';

export function PorchScene({
  items,
  hound,
  width,
  animate = true,
  time,
  locked = false,
}: {
  // The porch items owned (porch_hottub, …).
  items: string[];
  hound: YardHound;
  width: number;
  animate?: boolean;
  time?: YardTime;
  // Not unlocked yet: drawn dim, with nothing on it, as a preview.
  locked?: boolean;
}) {
  const k = width / W;
  const t = time ?? yardTime();
  const night = t === 'night';
  const winter = yardSeason() === 'winter';
  const has = (id: string) => items.includes(id);

  const [awake, setAwake] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAwake(st === 'active'));
    return () => sub.remove();
  }, []);
  const moving = animate && awake && !locked;

  const sleepy = night || hound.mood === 'sleepy';
  const spot: Spot = night
    ? has('porch_firepit')
      ? 'fire'
      : has('porch_lounge')
        ? 'lounge'
        : has('porch_swing')
          ? 'swing'
          : 'mat'
    : sleepy
      ? has('porch_lounge')
        ? 'lounge'
        : has('porch_swing')
          ? 'swing'
          : 'mat'
      : has('porch_hottub')
        ? 'tub'
        : hound.mood === 'hungry' && has('porch_grill')
          ? 'grill'
          : 'mat';
  const lying = spot === 'lounge' || spot === 'swing' || spot === 'fire';

  // The hound's box: feet at (x, y) in world units, like the Yard's.
  const size = 104;
  const place = {
    tub: { x: AT.tub.x - 6, y: AT.tub.y + 22 },
    fire: { x: AT.firepit.x - 4, y: AT.firepit.y - 38 },
    lounge: { x: AT.lounge.x + 4, y: AT.lounge.y - 16 },
    swing: { x: AT.swing.x, y: AT.swing.y - 20 },
    mat: { x: AT.mat.x, y: AT.mat.y + 4 },
    grill: { x: AT.grill.x - 52, y: AT.grill.y + 6 },
  }[spot];
  const houndW = size * k;
  const houndLeft = place.x * k - houndW / 2;
  const houndTop = place.y * k - houndW * 1.2 * 0.98;

  // The swing sways; the tub bubbles; steam rises.
  const sway = useRef(new Animated.Value(0)).current;
  const fizz = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (!moving) {
      sway.setValue(0);
      fizz.forEach((f) => f.setValue(0));
      return;
    }
    const swingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const bubbleLoops = fizz.map((f, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 380),
          Animated.timing(f, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(f, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    swingLoop.start();
    bubbleLoops.forEach((l) => l.start());
    return () => {
      swingLoop.stop();
      bubbleLoops.forEach((l) => l.stop());
    };
  }, [moving, sway, fizz]);

  const swayX = sway.interpolate({ inputRange: [-1, 1], outputRange: [-5 * k, 5 * k] });
  const steam = night || winter;

  return (
    <View style={{ width, height: H * k, overflow: 'hidden', borderRadius: 14 }}>
      <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`} opacity={locked ? 0.55 : 1}>
        <Defs>
          <LinearGradient id="porchWall" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? '#4a4f6a' : '#e9dcc4'} />
            <Stop offset="1" stopColor={night ? '#3a3e56' : '#d9c8a8'} />
          </LinearGradient>
        </Defs>
        {/* The back wall: siding, a window either side of the door. */}
        <Rect x={0} y={0} width={W} height={FLOOR_Y + 2} fill="url(#porchWall)" />
        {Array.from({ length: 9 }, (_, i) => (
          <Line key={i} x1={0} y1={18 + i * 17} x2={W} y2={18 + i * 17} stroke={night ? '#33374c' : '#cdbb99'} strokeWidth={1.5} />
        ))}
        <Rect x={0} y={0} width={W} height={10} fill={night ? '#2b2e40' : '#a8916b'} />
        {[110, 318].map((x) => (
          <G key={x}>
            <Rect x={x - 30} y={58} width={60} height={56} rx={3} fill={night ? '#ffd98a' : '#bfe3f5'} />
            <Path d={`M ${x} 58 V 114 M ${x - 30} 86 H ${x + 30}`} stroke="#ffffff" strokeWidth={3} />
            <Rect x={x - 34} y={112} width={68} height={6} rx={2} fill="#ffffff" />
          </G>
        ))}
        <Rect x={AT.door.x - 26} y={FLOOR_Y - 96} width={52} height={96} rx={3} fill="#5d5294" />
        <Rect x={AT.door.x - 18} y={FLOOR_Y - 86} width={36} height={30} rx={3} fill={night ? '#ffd98a' : '#bfe3f5'} opacity={0.8} />
        <Circle cx={AT.door.x + 17} cy={FLOOR_Y - 44} r={3} fill="#e0b84f" />
        {/* The porch light. */}
        <Rect x={AT.door.x + 34} y={FLOOR_Y - 92} width={10} height={16} rx={3} fill={night ? '#ffd23f' : '#e8c26b'} />
        {night && <Circle cx={AT.door.x + 39} cy={FLOOR_Y - 84} r={22} fill="#ffd23f" opacity={0.22} />}

        {/* The deck. */}
        <Rect x={0} y={FLOOR_Y} width={W} height={H - FLOOR_Y} fill={night ? '#5a4632' : '#b98a5a'} />
        {Array.from({ length: 7 }, (_, i) => {
          const y = FLOOR_Y + 14 + i * i * 2.6 + i * 4;
          return <Line key={i} x1={0} y1={y} x2={W} y2={y} stroke={night ? '#4a3a28' : '#9a7048'} strokeWidth={1.5} />;
        })}
        {/* The welcome mat, with the hound's name. */}
        <Rect x={AT.mat.x - 34} y={AT.mat.y - 16} width={68} height={20} rx={4} fill="#8a4a2a" />
        <SvgText x={AT.mat.x} y={AT.mat.y - 2} fontSize={9} fontWeight="bold" textAnchor="middle" fill="#f1d7b0">
          {(hound.name || 'WELCOME').toUpperCase().slice(0, 10)}
        </SvgText>

        {!locked && has('porch_grill') && <Grill x={AT.grill.x} y={AT.grill.y} />}
        {!locked && has('porch_umbrella') && <Umbrella x={AT.umbrella.x} y={AT.umbrella.y} />}
        {!locked && has('porch_lounge') && <Lounge x={AT.lounge.x} y={AT.lounge.y} />}
        {!locked && has('porch_firepit') && <FirePit x={AT.firepit.x} y={AT.firepit.y} lit={t !== 'day'} />}
        {!locked && has('porch_hottub') && <TubBack x={AT.tub.x} y={AT.tub.y} />}
        {/* Snow on the rail in winter. */}
        {winter && <Rect x={0} y={FLOOR_Y - 3} width={W} height={4} fill="#ffffff" opacity={0.8} />}
      </Svg>

      {/* The swing hangs from the eaves, and sways. */}
      {!locked && has('porch_swing') && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: swayX }] }]}>
          <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`}>
            <Swing x={AT.swing.x} y={AT.swing.y} />
          </Svg>
        </Animated.View>
      )}

      {!locked && (
        <Animated.View
          style={{
            position: 'absolute',
            left: houndLeft,
            top: houndTop,
            width: houndW,
            height: houndW * 1.2,
            transform: spot === 'swing' ? [{ translateX: swayX }] : [],
          }}
        >
          <Pressable accessibilityRole="image" accessibilityLabel={`${hound.name} on the porch`}>
            <HoundArt
              rank={hound.rank}
              mood={night ? 'sleepy' : hound.mood}
              neckId={hound.neckId}
              headId={hound.headId}
              faceId={hound.faceId}
              coatId={hound.coatId}
              breedId={hound.breedId}
              bodyId={hound.bodyId}
              feetId={hound.feetId}
              pose={lying ? 'lie' : 'sit'}
              ears={hound.ears}
              tail={hound.tail}
              markings={hound.markings}
              size={houndW}
              animate={moving}
            />
          </Pressable>
        </Animated.View>
      )}

      {/* The tub's water and front over the hound, so it's sitting in it,
          with bubbles and steam. */}
      {!locked && has('porch_hottub') && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`}>
            <TubFront x={AT.tub.x} y={AT.tub.y} />
          </Svg>
          {fizz.map((f, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: (AT.tub.x - 44 + i * 28) * k,
                top: (AT.tub.y - 26) * k,
                width: 6 * k,
                height: 6 * k,
                borderRadius: 3 * k,
                backgroundColor: 'rgba(255,255,255,0.85)',
                opacity: f.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
                transform: [{ translateY: f.interpolate({ inputRange: [0, 1], outputRange: [0, -12 * k] }) }],
              }}
            />
          ))}
          {steam &&
            [0, 1].map((i) => (
              <Animated.View
                key={`s${i}`}
                style={{
                  position: 'absolute',
                  left: (AT.tub.x - 30 + i * 40) * k,
                  top: (AT.tub.y - 64) * k,
                  width: 26 * k,
                  height: 18 * k,
                  borderRadius: 13 * k,
                  backgroundColor: 'rgba(255,255,255,0.35)',
                  opacity: fizz[i * 2].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.6, 0] }),
                  transform: [{ translateY: fizz[i * 2].interpolate({ inputRange: [0, 1], outputRange: [8 * k, -18 * k] }) }],
                }}
              />
            ))}
        </View>
      )}
    </View>
  );
}

function Grill({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Path d="M-16 0 L-10 -24 M16 0 L10 -24" stroke="#2b2b33" strokeWidth={3} />
      <Path d="M-20 -24 Q0 -10 20 -24 Z" fill="#2b2b33" />
      <Path d="M-20 -26 Q0 -50 20 -26 Z" fill="#3a3a44" />
      <Rect x={-3} y={-50} width={6} height={4} rx={2} fill="#9aa0ab" />
      <Path d="M-6 -56 Q-2 -62 -6 -68 M4 -56 Q8 -62 4 -68" stroke="#ffffff" strokeWidth={1.5} fill="none" opacity={0.6} />
    </G>
  );
}

function Swing({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Path d={`M-40 ${-y + 10} L-38 -26 M40 ${-y + 10} L38 -26`} stroke="#6f5a3f" strokeWidth={1.5} />
      <Rect x={-44} y={-30} width={88} height={8} rx={2} fill="#a8742f" />
      <Rect x={-44} y={-56} width={88} height={6} rx={2} fill="#a8742f" />
      <Path d="M-40 -50 V-30 M-20 -50 V-30 M0 -50 V-30 M20 -50 V-30 M40 -50 V-30" stroke="#8f5a2c" strokeWidth={3} />
    </G>
  );
}

function Umbrella({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Path d="M0 0 V-118" stroke="#e9e9ed" strokeWidth={3} />
      <Path d="M-46 -104 Q0 -142 46 -104 Z" fill="#e8737a" />
      <Path d="M-46 -104 Q-23 -97 0 -104 Q23 -97 46 -104" stroke="#ffffff" strokeWidth={3} fill="none" />
      <Path d="M-15 -109 Q0 -136 0 -136 Q0 -136 15 -109" stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.6} />
    </G>
  );
}

function Lounge({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Path d="M-52 0 L-46 -12 M46 0 L40 -12" stroke="#e9e9ed" strokeWidth={3} />
      <Path d="M-52 -12 L34 -12 L56 -40 L50 -44 L28 -20 L-52 -20 Z" fill="#4f9fe0" />
      <Path d="M-50 -16 H30" stroke="#ffffff" strokeWidth={2} opacity={0.6} />
    </G>
  );
}

function FirePit({ x, y, lit }: { x: number; y: number; lit: boolean }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Ellipse cx={0} cy={-6} rx={30} ry={9} fill="#6f7686" />
      <Ellipse cx={0} cy={-9} rx={24} ry={6} fill="#2b2b33" />
      <Path d="M-14 -10 L12 -16 M-10 -16 L14 -9" stroke="#7a4a24" strokeWidth={4} strokeLinecap="round" />
      {lit && (
        <G>
          <Circle cx={0} cy={-26} r={30} fill="#ffb347" opacity={0.2} />
          <Path d="M-10 -12 Q-14 -28 -2 -40 Q-4 -26 4 -22 Q6 -32 12 -36 Q16 -20 8 -12 Z" fill="#f08a24" />
          <Path d="M-4 -12 Q-6 -22 2 -30 Q2 -20 6 -16 Q8 -14 4 -12 Z" fill="#ffd23f" />
        </G>
      )}
    </G>
  );
}

// The tub in two halves: the back rim behind the hound, the water and
// front wall over it.
function TubBack({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Ellipse cx={0} cy={-20} rx={72} ry={20} fill="#8f5a2c" />
      <Ellipse cx={0} cy={-20} rx={64} ry={15} fill="#5fb8d9" />
    </G>
  );
}

function TubFront({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Path d="M-64 -20 Q0 -4 64 -20 Q0 -10 -64 -20 Z" fill="#7fd0f6" opacity={0.85} />
      <Path d="M-72 -20 Q0 2 72 -20 L72 14 Q0 34 -72 14 Z" fill="#a8742f" />
      {[-48, -24, 0, 24, 48].map((dx) => (
        <Line key={dx} x1={dx} y1={-12 + Math.abs(dx) * 0.08} x2={dx} y2={22 - Math.abs(dx) * 0.1} stroke="#8f5a2c" strokeWidth={2} />
      ))}
      <Path d="M-72 -20 Q0 2 72 -20" stroke="#c98a4b" strokeWidth={4} fill="none" />
    </G>
  );
}
