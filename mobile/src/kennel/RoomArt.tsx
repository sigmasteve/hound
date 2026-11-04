import React, { useEffect, useRef, useState } from 'react';
import { AppState, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { HoundArt } from './HoundArt';
import { YARD_ASPECT, yardSeason, yardTime, type YardHound, type YardTime } from './YardArt';

// The room inside the house (0169, lifestyle phase 4): the third zone,
// after the Yard and the Porch, open to everyone. A wall with a window,
// a wooden floor, and eight things to buy, each in its own place: a
// bookshelf, a photo wall over a sofa, a floor lamp, a fireplace with a
// cushion in front of it, a potted fern and a rug in the middle.
//
// Where the hound is: napping on the fireside cushion (or the sofa, or
// the rug) at night or when sleepy; otherwise on the sofa, or sitting on
// the rug, or on the floor.

const W = 400;
const H = W * YARD_ASPECT;
const FLOOR_Y = 176;

const AT = {
  bookshelf: { x: 38, y: 238 },
  photos: { x: 148, y: 74 },
  sofa: { x: 148, y: 262 },
  window: { x: 246, y: 74 },
  lamp: { x: 236, y: 228 },
  fireplace: { x: 324, y: FLOOR_Y + 12 },
  cushion: { x: 322, y: 270 },
  fern: { x: 384, y: 236 },
  rug: { x: 214, y: 268 },
};

export function roomFocusPoint(itemId: string, width: number): { x: number; y: number; height: number } {
  const k = width / W;
  const at =
    itemId === 'room_bookshelf'
      ? { x: AT.bookshelf.x + 20, y: AT.bookshelf.y - 70 }
      : itemId === 'room_photos'
        ? AT.photos
        : itemId === 'room_sofa'
          ? { x: AT.sofa.x, y: AT.sofa.y - 30 }
          : itemId === 'room_lamp'
            ? { x: AT.lamp.x, y: AT.lamp.y - 60 }
            : itemId === 'room_fireplace'
              ? { x: AT.fireplace.x, y: AT.fireplace.y - 50 }
              : itemId === 'room_cushion'
                ? { x: AT.cushion.x, y: AT.cushion.y - 14 }
                : itemId === 'room_fern'
                  ? { x: AT.fern.x - 24, y: AT.fern.y - 40 }
                  : itemId === 'room_rug'
                    ? { x: AT.rug.x, y: AT.rug.y - 8 }
                    : { x: W / 2, y: H / 2 };
  return { x: at.x * k, y: at.y * k, height: H * k };
}

type Spot = 'cushion' | 'sofa' | 'sofa_nap' | 'rug' | 'rug_nap' | 'floor';

export function RoomScene({
  items,
  hound,
  width,
  animate = true,
  time,
  houndProps,
}: {
  // The room items owned (room_sofa, …).
  items: string[];
  hound: YardHound;
  width: number;
  animate?: boolean;
  time?: YardTime;
  // Extra looks for the hound (0169: muddy or fresh from a bath).
  houndProps?: { mud?: boolean; fresh?: boolean };
}) {
  const k = width / W;
  const t = time ?? yardTime();
  const night = t === 'night';
  const winter = yardSeason() === 'winter';
  const has = (id: string) => items.includes(id);
  const fireLit = has('room_fireplace') && (t !== 'day' || winter);
  const lampOn = has('room_lamp') && t !== 'day';

  const [awake, setAwake] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAwake(st === 'active'));
    return () => sub.remove();
  }, []);
  const moving = animate && awake;

  const sleepy = night || hound.mood === 'sleepy';
  const spot: Spot = sleepy
    ? has('room_cushion')
      ? 'cushion'
      : has('room_sofa')
        ? 'sofa_nap'
        : has('room_rug')
          ? 'rug_nap'
          : 'floor'
    : has('room_sofa') && hound.mood !== 'happy'
      ? 'sofa'
      : has('room_rug')
        ? 'rug'
        : 'floor';
  const lying = spot === 'cushion' || spot === 'sofa_nap' || spot === 'rug_nap';

  const size = 104;
  const place = {
    cushion: { x: AT.cushion.x, y: AT.cushion.y - 2 },
    sofa: { x: AT.sofa.x + 6, y: AT.sofa.y - 30 },
    sofa_nap: { x: AT.sofa.x + 6, y: AT.sofa.y - 30 },
    rug: { x: AT.rug.x, y: AT.rug.y + 4 },
    rug_nap: { x: AT.rug.x, y: AT.rug.y + 4 },
    floor: { x: AT.rug.x, y: AT.rug.y + 4 },
  }[spot];
  const houndW = size * k;
  const houndLeft = place.x * k - houndW / 2;
  const houndTop = place.y * k - houndW * 1.2 * 0.98;

  // The fire flickers.
  const flicker = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!moving || !fireLit) {
      flicker.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [moving, fireLit, flicker]);

  const wall = night ? '#4b4766' : '#efe2cf';
  const stripe = night ? '#433f5c' : '#e6d6bf';

  return (
    <View style={{ width, height: H * k, overflow: 'hidden', borderRadius: 14 }}>
      <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="roomFloor" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? '#5b4430' : '#b9875a'} />
            <Stop offset="1" stopColor={night ? '#4a3726' : '#a5744a'} />
          </LinearGradient>
          <LinearGradient id="roomSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? '#1d2140' : t === 'evening' ? '#f3a46b' : '#9fd3f2'} />
            <Stop offset="1" stopColor={night ? '#2e3462' : t === 'evening' ? '#f7cf8a' : '#d6eefa'} />
          </LinearGradient>
        </Defs>

        {/* The wall: striped paper, a picture rail, a skirting board. */}
        <Rect x={0} y={0} width={W} height={FLOOR_Y} fill={wall} />
        {Array.from({ length: 20 }, (_, i) => (
          <Rect key={i} x={i * 20 + 6} y={0} width={8} height={FLOOR_Y} fill={stripe} />
        ))}
        <Rect x={0} y={22} width={W} height={4} fill={night ? '#3a3652' : '#d8c3a5'} />
        <Rect x={0} y={FLOOR_Y - 12} width={W} height={12} fill={night ? '#3a3652' : '#fbf7f0'} />

        {/* The window, with curtains; the sky outside by time of day. */}
        <G>
          <Rect x={AT.window.x - 34} y={AT.window.y - 40} width={68} height={74} rx={3} fill="url(#roomSky)" />
          {night && (
            <>
              <Circle cx={AT.window.x + 14} cy={AT.window.y - 22} r={6} fill="#f5efcf" />
              <Circle cx={AT.window.x - 18} cy={AT.window.y - 10} r={1.2} fill="#ffffff" />
              <Circle cx={AT.window.x - 4} cy={AT.window.y - 28} r={1} fill="#ffffff" />
            </>
          )}
          {winter && !night && (
            <Path d={`M ${AT.window.x - 34} ${AT.window.y + 28} Q ${AT.window.x} ${AT.window.y + 18} ${AT.window.x + 34} ${AT.window.y + 28} V ${AT.window.y + 34} H ${AT.window.x - 34} Z`} fill="#ffffff" />
          )}
          <Path d={`M ${AT.window.x} ${AT.window.y - 40} V ${AT.window.y + 34} M ${AT.window.x - 34} ${AT.window.y - 4} H ${AT.window.x + 34}`} stroke="#fbf7f0" strokeWidth={4} />
          <Rect x={AT.window.x - 38} y={AT.window.y + 32} width={76} height={6} rx={2} fill="#fbf7f0" />
          <Rect x={AT.window.x - 46} y={AT.window.y - 48} width={92} height={5} rx={2} fill="#8a6a48" />
          <Path d={`M ${AT.window.x - 44} ${AT.window.y - 44} Q ${AT.window.x - 30} ${AT.window.y - 4} ${AT.window.x - 40} ${AT.window.y + 40} L ${AT.window.x - 48} ${AT.window.y + 40} L ${AT.window.x - 48} ${AT.window.y - 44} Z`} fill="#c56b6b" />
          <Path d={`M ${AT.window.x + 44} ${AT.window.y - 44} Q ${AT.window.x + 30} ${AT.window.y - 4} ${AT.window.x + 40} ${AT.window.y + 40} L ${AT.window.x + 48} ${AT.window.y + 40} L ${AT.window.x + 48} ${AT.window.y - 44} Z`} fill="#c56b6b" />
        </G>

        {/* The floor: boards. */}
        <Rect x={0} y={FLOOR_Y} width={W} height={H - FLOOR_Y} fill="url(#roomFloor)" />
        {Array.from({ length: 6 }, (_, i) => {
          const y = FLOOR_Y + 12 + i * i * 2.8 + i * 6;
          return <Line key={i} x1={0} y1={y} x2={W} y2={y} stroke={night ? '#47331f' : '#986a40'} strokeWidth={1.4} />;
        })}

        {has('room_photos') && <Photos x={AT.photos.x} y={AT.photos.y} />}
        {has('room_bookshelf') && <Bookshelf x={AT.bookshelf.x} y={AT.bookshelf.y} />}
        {has('room_fireplace') && <Fireplace x={AT.fireplace.x} y={AT.fireplace.y} />}
        {has('room_rug') && <Rug x={AT.rug.x} y={AT.rug.y} />}
        {has('room_cushion') && <Cushion x={AT.cushion.x} y={AT.cushion.y} />}
        {has('room_fern') && <Fern x={AT.fern.x} y={AT.fern.y} />}
        {has('room_sofa') && <Sofa x={AT.sofa.x} y={AT.sofa.y} />}
        {has('room_lamp') && <Lamp x={AT.lamp.x} y={AT.lamp.y} on={lampOn} />}
        {/* The warm light of the evening, from the lamp and the fire. */}
        {night && !lampOn && !fireLit && <Rect x={0} y={0} width={W} height={H} fill="#10122a" opacity={0.25} />}
      </Svg>

      {/* The fire, flickering. */}
      {fireLit && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: flicker.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }]}
        >
          <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`}>
            <Fire x={AT.fireplace.x} y={AT.fireplace.y} />
          </Svg>
        </Animated.View>
      )}

      {/* The hound's portrait in the photo wall's big frame. */}
      {has('room_photos') && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: (AT.photos.x - 15) * k,
            top: (AT.photos.y - 29) * k,
            width: 30 * k,
            height: 30 * k,
            overflow: 'hidden',
            backgroundColor: '#cfe6f2',
          }}
        >
          <HoundArt
            rank={hound.rank}
            mood="happy"
            variant="avatar"
            coatId={hound.coatId}
            breedId={hound.breedId}
            neckId={hound.neckId}
            headId={hound.headId}
            faceId={hound.faceId}
            ears={hound.ears}
            tail={hound.tail}
            markings={hound.markings}
            size={30 * k}
            animate={false}
          />
        </View>
      )}

      <View style={{ position: 'absolute', left: houndLeft, top: houndTop, width: houndW, height: houndW * 1.2 }}>
        <Pressable accessibilityRole="image" accessibilityLabel={`${hound.name} inside`}>
          <HoundArt
            rank={hound.rank}
            mood={sleepy ? 'sleepy' : hound.mood}
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
            mud={houndProps?.mud}
            fresh={houndProps?.fresh}
          />
        </Pressable>
      </View>
    </View>
  );
}

// A thumbnail of one room item, for the shop and the gift sheet.
export function RoomThumb({ id, size = 46 }: { id: string; size?: number }) {
  const box: Record<string, [number, number, number, number]> = {
    room_bookshelf: [0, -122, 80, 128],
    room_photos: [-56, -56, 112, 70],
    room_sofa: [-70, -66, 140, 74],
    room_lamp: [-28, -122, 56, 128],
    room_fireplace: [-52, -110, 104, 114],
    room_cushion: [-44, -30, 88, 40],
    room_fern: [-44, -76, 60, 82],
    room_rug: [-62, -26, 124, 50],
  };
  const [x, y, w, h] = box[id] ?? [-50, -50, 100, 100];
  const side = Math.max(w, h);
  const vb = `${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`;
  return (
    <Svg width={size} height={size} viewBox={vb}>
      {id === 'room_bookshelf' && <Bookshelf x={0} y={0} />}
      {id === 'room_photos' && <Photos x={0} y={0} />}
      {id === 'room_sofa' && <Sofa x={0} y={0} />}
      {id === 'room_lamp' && <Lamp x={0} y={0} on />}
      {id === 'room_fireplace' && (
        <>
          <Fireplace x={0} y={0} />
          <Fire x={0} y={0} />
        </>
      )}
      {id === 'room_cushion' && <Cushion x={0} y={0} />}
      {id === 'room_fern' && <Fern x={0} y={0} />}
      {id === 'room_rug' && <Rug x={0} y={0} />}
    </Svg>
  );
}

function Bookshelf({ x, y }: { x: number; y: number }) {
  const books = [
    ['#c56b6b', 8, 22], ['#4f7fbf', 7, 26], ['#e0b84f', 9, 20], ['#6aa36f', 6, 24], ['#8a6ac0', 8, 23],
  ] as const;
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect x={0} y={-122} width={80} height={126} rx={3} fill="#7a5233" />
      <Rect x={5} y={-116} width={70} height={116} fill="#5c3c24" />
      {[-84, -48, -12].map((sy, row) => (
        <G key={sy}>
          <Rect x={0} y={sy} width={80} height={5} fill="#8f623d" />
          {books.map(([c, bw, bh], i) => {
            const bx = 8 + books.slice(0, i).reduce((n, b) => n + b[1] + 2, 0) + row * 3;
            return bx + bw < 74 ? <Rect key={i} x={bx} y={sy - bh} width={bw} height={bh} rx={1} fill={c} /> : null;
          })}
        </G>
      ))}
      {/* A tennis ball on the top shelf. */}
      <Circle cx={64} cy={-94} r={6} fill="#d8e04f" />
      <Path d="M 59 -97 Q 64 -93 69 -97" stroke="#ffffff" strokeWidth={1} fill="none" />
    </G>
  );
}

function Photos({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      {/* The big frame (the hound's portrait is laid over it). */}
      <Rect x={-19} y={-33} width={38} height={38} rx={2} fill="#2f2a26" />
      <Rect x={-15} y={-29} width={30} height={30} fill="#cfe6f2" />
      {/* A landscape. */}
      <Rect x={-52} y={-24} width={28} height={22} rx={2} fill="#2f2a26" />
      <Rect x={-49} y={-21} width={22} height={16} fill="#bfe3f5" />
      <Path d="M -49 -5 L -42 -14 L -36 -8 L -32 -12 L -27 -5 Z" fill="#6aa36f" />
      {/* A paw print. */}
      <Rect x={24} y={-26} width={26} height={26} rx={2} fill="#f2ead8" stroke="#8a6a48" strokeWidth={3} />
      <Ellipse cx={37} cy={-9} rx={4.5} ry={3.6} fill="#8a6a48" />
      {[-5, -2, 2, 5].map((dx, i) => (
        <Circle key={i} cx={37 + dx} cy={i === 0 || i === 3 ? -15 : -17} r={1.6} fill="#8a6a48" />
      ))}
      {/* A small round one. */}
      <Circle cx={-38} cy={6} r={7} fill="#2f2a26" />
      <Circle cx={-38} cy={6} r={5} fill="#f6d2dc" />
    </G>
  );
}

function Sofa({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect x={-62} y={-2} width={6} height={8} fill="#4a3426" />
      <Rect x={56} y={-2} width={6} height={8} fill="#4a3426" />
      <Rect x={-60} y={-64} width={120} height={40} rx={12} fill="#5b7fb0" />
      <Rect x={-70} y={-44} width={18} height={44} rx={8} fill="#4e6f9c" />
      <Rect x={52} y={-44} width={18} height={44} rx={8} fill="#4e6f9c" />
      <Rect x={-54} y={-32} width={108} height={30} rx={8} fill="#6a8fc2" />
      <Path d="M 0 -30 V -4" stroke="#5b7fb0" strokeWidth={2} />
      <Rect x={-46} y={-58} width={24} height={20} rx={6} fill="#e0b84f" transform="rotate(-10 -34 -48)" />
    </G>
  );
}

function Lamp({ x, y, on }: { x: number; y: number; on: boolean }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      {on && <Circle cx={0} cy={-100} r={40} fill="#ffd98a" opacity={0.28} />}
      <Ellipse cx={0} cy={2} rx={12} ry={3.5} fill="#3a3a44" />
      <Rect x={-1.5} y={-96} width={3} height={98} fill="#3a3a44" />
      <Path d="M -18 -96 L -12 -122 L 12 -122 L 18 -96 Z" fill={on ? '#ffe4a8' : '#efe0c2'} />
      <Path d="M -18 -96 H 18" stroke="#d8c09a" strokeWidth={2} />
    </G>
  );
}

function Fireplace({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Rect x={-46} y={-96} width={92} height={96} fill="#b4624a" />
      {Array.from({ length: 6 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => {
          // Rows offset by half a brick, cut at the chimney's sides.
          const x0 = Math.max(-46, -46 + c * 23 - (r % 2 ? 11 : 0));
          const x1 = Math.min(46, -46 + c * 23 - (r % 2 ? 11 : 0) + 22);
          return x1 - x0 > 2 ? (
            <Rect key={`${r}-${c}`} x={x0} y={-96 + r * 16} width={x1 - x0} height={15} fill="none" stroke="#9a5038" strokeWidth={1} />
          ) : null;
        }),
      )}
      <Rect x={-52} y={-104} width={104} height={10} rx={2} fill="#6f4a30" />
      <Path d="M -28 0 V -50 Q 0 -70 28 -50 V 0 Z" fill="#2b2420" />
      <Rect x={-52} y={-2} width={104} height={6} fill="#8a8f9b" />
      {/* On the mantel: a candle and a little clock. */}
      <Rect x={-36} y={-116} width={6} height={12} fill="#fbf7f0" />
      <Circle cx={30} cy={-112} r={7} fill="#e0b84f" />
      <Circle cx={30} cy={-112} r={5} fill="#fbf7f0" />
      <Path d="M 30 -115 V -112 H 32" stroke="#2f2a26" strokeWidth={1} fill="none" />
    </G>
  );
}

function Fire({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Circle cx={0} cy={-20} r={40} fill="#ffb347" opacity={0.22} />
      <Path d="M -14 -6 L 12 -12 M -10 -12 L 14 -5" stroke="#7a4a24" strokeWidth={4} strokeLinecap="round" />
      <Path d="M -14 -8 Q -18 -26 -4 -40 Q -6 -26 2 -22 Q 4 -34 12 -38 Q 18 -20 10 -8 Z" fill="#f08a24" />
      <Path d="M -6 -8 Q -8 -20 2 -28 Q 2 -18 6 -14 Q 8 -10 4 -8 Z" fill="#ffd23f" />
    </G>
  );
}

function Cushion({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Ellipse cx={0} cy={0} rx={44} ry={14} fill="#a6495a" />
      <Ellipse cx={0} cy={-4} rx={40} ry={11} fill="#c2596c" />
      {[-24, 0, 24].map((dx) => (
        <Circle key={dx} cx={dx} cy={-4} r={1.6} fill="#8f3a4a" />
      ))}
    </G>
  );
}

function Fern({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      {[-40, -18, 4, 26, 48].map((a, i) => (
        <Path
          key={i}
          d="M 0 -30 Q 6 -58 0 -76"
          stroke="#4f8f4f"
          strokeWidth={6}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(${a - 10} 0 -30)`}
        />
      ))}
      <Path d="M -16 -30 L 16 -30 L 12 4 L -12 4 Z" fill="#c07a4a" />
      <Rect x={-18} y={-34} width={36} height={6} rx={2} fill="#a8653a" />
    </G>
  );
}

function Rug({ x, y }: { x: number; y: number }) {
  return (
    <G transform={`translate(${x} ${y})`}>
      <Ellipse cx={0} cy={0} rx={62} ry={20} fill="#d9785a" />
      <Ellipse cx={0} cy={0} rx={50} ry={15} fill="#efc27a" />
      <Ellipse cx={0} cy={0} rx={36} ry={10} fill="#d9785a" />
      <Ellipse cx={0} cy={0} rx={20} ry={5} fill="#efc27a" />
    </G>
  );
}
