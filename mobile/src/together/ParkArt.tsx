import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Text } from '../components/Text';
import { HoundArt } from '../kennel/HoundArt';
import { YARD_ASPECT, yardSeason, yardTime, type YardHound, type YardTime } from '../kennel/YardArt';
import type { ParkHound } from './together';

// The dog park (0170, lifestyle phase 5): friends' hounds that have been
// out walking in the last day turn up here, with your hound once you've
// walked. A friend who walked with you stands next to yours, with a
// heart. Tap a friend's hound to visit them.

const W = 400;
const H = W * YARD_ASPECT;
const GRASS_Y = 150;

// Feet positions, nearest the middle first; the first two sit either side
// of yours. Further back is smaller.
const SPOTS = [
  { x: 112, y: 268 },
  { x: 288, y: 268 },
  { x: 58, y: 222 },
  { x: 342, y: 222 },
  { x: 140, y: 192 },
  { x: 262, y: 192 },
];
const ME = { x: 200, y: 288 };
export const PARK_ROOM = SPOTS.length;

export function DogParkScene({
  hounds,
  me,
  width,
  animate = true,
  time,
  onOpen,
}: {
  // Friends' hounds, in order; walked-with-you ones first.
  hounds: ParkHound[];
  // Yours, when you've walked in the last day.
  me: YardHound | null;
  width: number;
  animate?: boolean;
  time?: YardTime;
  onOpen?: (h: ParkHound) => void;
}) {
  const k = width / W;
  const t = time ?? yardTime();
  const night = t === 'night';
  const evening = t === 'evening';
  const winter = yardSeason() === 'winter';
  const shown = [...hounds].sort((a, b) => Number(b.withMe) - Number(a.withMe)).slice(0, SPOTS.length);
  const sizeAt = (y: number) => (50 + (y - 190) * 0.26) * k;

  const tag = (label: string, x: number, y: number, size: number, key: string, heart = false) => (
    <View key={key} pointerEvents="none" style={[styles.tag, { left: x * k - 40, top: y * k - size * 1.08, width: 80 }]}>
      <View style={styles.tagPill}>
        <Text style={styles.tagText} numberOfLines={1}>
          {heart ? '♥ ' : ''}
          {label}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ width, height: H * k, overflow: 'hidden', borderRadius: 14 }}>
      <Svg width={width} height={H * k} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="parkSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? '#1d2140' : evening ? '#f3a46b' : '#9fd3f2'} />
            <Stop offset="1" stopColor={night ? '#33396a' : evening ? '#f7cf8a' : '#dff1fb'} />
          </LinearGradient>
          <LinearGradient id="parkGrass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={winter ? '#e8eef4' : night ? '#2f5a3a' : '#7cc576'} />
            <Stop offset="1" stopColor={winter ? '#d5dee8' : night ? '#24482d' : '#5fae5c'} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={GRASS_Y + 4} fill="url(#parkSky)" />
        {night && (
          <>
            <Circle cx={340} cy={36} r={13} fill="#f5efcf" />
            {[[60, 30], [120, 54], [210, 22], [280, 60], [380, 80]].map(([x, y]) => (
              <Circle key={`${x}`} cx={x} cy={y} r={1.3} fill="#ffffff" />
            ))}
          </>
        )}
        {!night && <Circle cx={340} cy={40} r={16} fill={evening ? '#ffd27a' : '#fff3b0'} />}
        {/* Trees along the back. */}
        {[18, 92, 300, 382].map((x, i) => (
          <G key={x}>
            <Rect x={x - 4} y={GRASS_Y - 30} width={8} height={34} fill="#7a5233" />
            <Circle cx={x} cy={GRASS_Y - 44} r={i % 2 ? 24 : 28} fill={winter ? '#c9d6e2' : night ? '#24482d' : '#4f9f52'} />
            <Circle cx={x - 12} cy={GRASS_Y - 34} r={16} fill={winter ? '#dbe5ee' : night ? '#2b5634' : '#5bb05e'} />
          </G>
        ))}
        <Rect x={0} y={GRASS_Y} width={W} height={H - GRASS_Y} fill="url(#parkGrass)" />
        {/* The fence, with the sign. */}
        {Array.from({ length: 21 }, (_, i) => (
          <Rect key={i} x={i * 20 + 2} y={GRASS_Y - 22} width={6} height={26} rx={2} fill={night ? '#6b5a48' : '#c9a77a'} />
        ))}
        <Rect x={0} y={GRASS_Y - 16} width={W} height={4} fill={night ? '#6b5a48' : '#c9a77a'} />
        <Rect x={160} y={GRASS_Y - 48} width={80} height={24} rx={4} fill="#5d5294" />
        <Path d={`M 170 ${GRASS_Y - 24} V ${GRASS_Y + 2} M 230 ${GRASS_Y - 24} V ${GRASS_Y + 2}`} stroke="#4a4078" strokeWidth={4} />
        <SvgText x={200} y={GRASS_Y - 31} fontSize={11} fontWeight="bold" textAnchor="middle" fill="#f1ecff">
          DOG PARK
        </SvgText>
        {/* A path, a bench, a pond and a ball. */}
        <Path d={`M 160 ${H} Q 190 ${GRASS_Y + 60} 205 ${GRASS_Y + 6} L 215 ${GRASS_Y + 6} Q 214 ${GRASS_Y + 60} 260 ${H} Z`} fill={winter ? '#c8ced6' : night ? '#5c5040' : '#e3cfa4'} opacity={0.85} />
        <G>
          <Rect x={20} y={GRASS_Y + 34} width={64} height={7} rx={2} fill="#8a5a33" />
          <Rect x={20} y={GRASS_Y + 22} width={64} height={6} rx={2} fill="#8a5a33" />
          <Path d={`M 26 ${GRASS_Y + 41} V ${GRASS_Y + 52} M 78 ${GRASS_Y + 41} V ${GRASS_Y + 52}`} stroke="#5c3c24" strokeWidth={4} />
        </G>
        <Ellipse cx={350} cy={GRASS_Y + 34} rx={44} ry={13} fill={winter ? '#cfe6f2' : night ? '#2e4a6a' : '#7fc4ea'} />
        <Ellipse cx={342} cy={GRASS_Y + 31} rx={20} ry={4} fill="#ffffff" opacity={0.35} />
        <Circle cx={292} cy={GRASS_Y + 128} r={6} fill="#d8e04f" />
        <Path d={`M 287 ${GRASS_Y + 125} Q 292 ${GRASS_Y + 130} 297 ${GRASS_Y + 125}`} stroke="#ffffff" strokeWidth={1} fill="none" />
        {night && <Rect x={0} y={0} width={W} height={H} fill="#0c0f24" opacity={0.18} />}
      </Svg>

      {shown.map((h, i) => {
        const at = SPOTS[i];
        const size = sizeAt(at.y);
        return (
          <React.Fragment key={h.userId}>
            <Pressable
              onPress={() => onOpen?.(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.hound.name}, ${h.owner}'s hound. Visit ${h.owner}`}
              style={{ position: 'absolute', left: at.x * k - size / 2, top: at.y * k - size * 1.2 * 0.98, width: size, height: size * 1.2 }}
            >
              <HoundArt
                rank={h.hound.rank}
                mood={night ? 'sleepy' : 'happy'}
                neckId={h.hound.neckId}
                headId={h.hound.headId}
                faceId={h.hound.faceId}
                coatId={h.hound.coatId}
                breedId={h.hound.breedId}
                bodyId={h.hound.bodyId}
                feetId={h.hound.feetId}
                ears={h.hound.ears}
                tail={h.hound.tail}
                markings={h.hound.markings}
                size={size}
                animate={animate}
              />
            </Pressable>
            {tag(h.hound.name, at.x, at.y, size, `tag-${h.userId}`, h.withMe)}
          </React.Fragment>
        );
      })}

      {me && (
        <>
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: ME.x * k - sizeAt(ME.y) / 2,
              top: ME.y * k - sizeAt(ME.y) * 1.2 * 0.98,
              width: sizeAt(ME.y),
              height: sizeAt(ME.y) * 1.2,
            }}
          >
            <HoundArt
              rank={me.rank}
              mood={night ? 'sleepy' : 'happy'}
              neckId={me.neckId}
              headId={me.headId}
              faceId={me.faceId}
              coatId={me.coatId}
              breedId={me.breedId}
              bodyId={me.bodyId}
              feetId={me.feetId}
              ears={me.ears}
              tail={me.tail}
              markings={me.markings}
              size={sizeAt(ME.y)}
              animate={animate}
            />
          </View>
          {tag(me.name, ME.x, ME.y, sizeAt(ME.y), 'tag-me')}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', alignItems: 'center' },
  tagPill: { paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 8, backgroundColor: 'rgba(22,24,38,0.72)', maxWidth: 80 },
  tagText: { fontSize: 10, color: '#ffffff' },
});
