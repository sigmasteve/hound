import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha } from '../theme/tokens';
import { HOLIDAY_THEMES, type HolidayThemeId } from './holidays';
import { useHoliday } from './HolidayContext';

// The drawings for each holiday theme on Today (0184): a garland across
// the top with the countdown pill, a trim along the top of each tile, a
// little something in the Goals tile's corner, and things drifting down
// the screen. Fixed colours, the same in both themes, except the snow,
// which turns pale blue on a light page so it still shows.

// The pill's colour, darker on a light page and lighter on a dark one.
const PILL: Record<HolidayThemeId, { tint: string; onLight: string; onDark: string }> = {
  diwali: { tint: '#f08a24', onLight: '#a8510c', onDark: '#ffb36b' },
  thanksgiving: { tint: '#c96a1b', onLight: '#8c4a12', onDark: '#f2a65a' },
  christmas: { tint: '#d12f3f', onLight: '#b3202f', onDark: '#ff8a93' },
  newyear: { tint: '#e0b84f', onLight: '#8a6a12', onDark: '#f2d27a' },
  lunarnewyear: { tint: '#d7263d', onLight: '#a8162b', onDark: '#ff8a93' },
};

// ---- The garland, with the countdown pill above it ----

export function HolidayHeader() {
  const h = useHoliday();
  const { mode } = useTheme();
  const [w, setW] = useState(0);
  if (!h) return null;
  const pill = PILL[h.theme.id];
  return (
    // Bleeds to the screen's edges, past Today's padding.
    <View style={styles.header} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      <Pressable
        onPress={h.onPillTap}
        style={({ pressed }) => [styles.pill, { backgroundColor: withAlpha(pill.tint, 0.15) }, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={`${h.pill}. Open the ${h.theme.name} note`}
      >
        <Text style={[styles.pillText, { color: mode === 'light' ? pill.onLight : pill.onDark }]}>
          {h.theme.emoji} {h.pill}
        </Text>
      </Pressable>
      {w > 0 && <Garland theme={h.theme.id} w={w} still={!h.motion} />}
    </View>
  );
}

interface Hang {
  x: number;
  y: number;
  a: number;
  i: number;
}

// Points along a few swags of wire across the width.
function swagPoints(w: number, swags: number, per: number, sag: number, top = 4): { wire: string; pts: Hang[] } {
  const sw = w / swags;
  const pts: Hang[] = [];
  let i = 0;
  for (let s = 0; s < swags; s++) {
    for (let k = 1; k <= per; k++) {
      const t = k / (per + 1);
      pts.push({ x: s * sw + t * sw, y: top + 4 * sag * t * (1 - t), a: (Math.atan((4 * sag * (1 - 2 * t)) / sw) * 180) / Math.PI, i: i++ });
    }
  }
  const wire = Array.from({ length: swags }, (_, s) => `M ${s * sw} ${top} Q ${s * sw + sw / 2} ${top + 2 * sag} ${(s + 1) * sw} ${top}`).join(' ');
  return { wire, pts };
}

const BULBS = ['#e5484d', '#ffd23f', '#3fb37f', '#4f9cf0', '#f08a24'];
const AUTUMN = ['#d9822b', '#b5462a', '#e0a52e', '#7a4a2a', '#c96a1b'];
const PARTY = ['#e0b84f', '#c4c8d6', '#2b2741', '#e0b84f', '#8b6fd6'];

function Garland({ theme, w, still }: { theme: HolidayThemeId; w: number; still: boolean }) {
  // Lights and lanterns twinkle: half glow while the other half dims.
  const glow = useRef(new Animated.Value(1)).current;
  const glows = theme === 'christmas' || theme === 'diwali' || theme === 'lunarnewyear';
  useEffect(() => {
    if (!glows || still) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.25, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [glow, glows, still]);

  const swags = Math.max(3, Math.round(w / 100));
  if (theme === 'christmas') {
    const { wire, pts } = swagPoints(w, swags, 4, 14, 4);
    const glowLayer = (odd: boolean) => (
      <Svg width={w} height={36} style={StyleSheet.absoluteFill}>
        {pts
          .filter((p) => p.i % 2 === (odd ? 1 : 0))
          .map((p) => (
            <Circle key={p.i} cx={p.x + Math.sin((p.a * Math.PI) / 180) * -8} cy={p.y + 8} r={8} fill={BULBS[p.i % BULBS.length]} opacity={0.3} />
          ))}
      </Svg>
    );
    return (
      <View style={{ width: w, height: 36 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>{glowLayer(false)}</Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow.interpolate({ inputRange: [0.25, 1], outputRange: [1, 0.25] }) }]}>{glowLayer(true)}</Animated.View>
        <Svg width={w} height={36} style={StyleSheet.absoluteFill}>
          <Path d={wire} stroke="#2d4a35" strokeWidth={1.6} fill="none" />
          {pts.map((p) => (
            <G key={p.i} rotation={p.a} origin={`${p.x},${p.y}`}>
              <Rect x={p.x - 2} y={p.y} width={4} height={3.5} rx={1} fill="#4a4f5c" />
              <Ellipse cx={p.x} cy={p.y + 8} rx={3.4} ry={5} fill={BULBS[p.i % BULBS.length]} />
              <Ellipse cx={p.x - 1} cy={p.y + 6.5} rx={1} ry={1.8} fill="#ffffff" opacity={0.6} />
            </G>
          ))}
        </Svg>
      </View>
    );
  }

  if (theme === 'diwali' || theme === 'lunarnewyear') {
    // Red lanterns hanging at different lengths, with marigolds strung
    // between them for Diwali.
    const H = 56;
    const { wire, pts } = swagPoints(w, swags, 2, 8, 3);
    const drop = (p: Hang) => 6 + ((p.i * 7) % 3) * 5;
    const lantern = (p: Hang) => {
      const x = p.x;
      const y = p.y + drop(p);
      if (theme === 'diwali') {
        // A kandil: a red diamond lantern with gold trim and a tassel.
        return (
          <G key={p.i}>
            <Line x1={x} y1={p.y} x2={x} y2={y} stroke="#7a4a2a" strokeWidth={1} />
            <Polygon points={`${x},${y} ${x + 9},${y + 7} ${x + 9},${y + 17} ${x},${y + 24} ${x - 9},${y + 17} ${x - 9},${y + 7}`} fill="#d7263d" stroke="#f5b82e" strokeWidth={1.2} />
            <Polygon points={`${x},${y + 4} ${x + 5},${y + 9} ${x + 5},${y + 15} ${x},${y + 20} ${x - 5},${y + 15} ${x - 5},${y + 9}`} fill="#f26b3a" opacity={0.8} />
            <Line x1={x - 9} y1={y + 12} x2={x + 9} y2={y + 12} stroke="#f5b82e" strokeWidth={1} />
            {[-3, 0, 3].map((k) => (
              <Line key={k} x1={x + k * 0.6} y1={y + 24} x2={x + k} y2={y + 32} stroke="#f5b82e" strokeWidth={1} />
            ))}
          </G>
        );
      }
      // A round Chinese lantern: gold caps, ribs and a red tassel.
      return (
        <G key={p.i}>
          <Line x1={x} y1={p.y} x2={x} y2={y} stroke="#7a4a2a" strokeWidth={1} />
          <Rect x={x - 4.5} y={y} width={9} height={3} rx={1} fill="#f5b82e" />
          <Ellipse cx={x} cy={y + 12} rx={11} ry={9.5} fill="#d7263d" />
          <Ellipse cx={x} cy={y + 12} rx={5.5} ry={9.5} fill="none" stroke="#f5b82e" strokeWidth={0.9} />
          <Line x1={x} y1={y + 2.5} x2={x} y2={y + 21.5} stroke="#f5b82e" strokeWidth={0.9} />
          <Ellipse cx={x - 4} cy={y + 8} rx={2.5} ry={3.5} fill="#ffffff" opacity={0.18} />
          <Rect x={x - 4.5} y={y + 21} width={9} height={3} rx={1} fill="#f5b82e" />
          {[-2, 0, 2].map((k) => (
            <Line key={k} x1={x + k * 0.5} y1={y + 24} x2={x + k} y2={y + 32} stroke="#e5484d" strokeWidth={1.2} />
          ))}
        </G>
      );
    };
    const glowLayer = (odd: boolean) => (
      <Svg width={w} height={H} style={StyleSheet.absoluteFill}>
        {pts
          .filter((p) => p.i % 2 === (odd ? 1 : 0))
          .map((p) => (
            <Circle key={p.i} cx={p.x} cy={p.y + drop(p) + 12} r={15} fill="#ffb347" opacity={0.28} />
          ))}
      </Svg>
    );
    // Marigolds along the wire, between the lanterns.
    const marigolds =
      theme === 'diwali'
        ? swagPoints(w, swags, 9, 8, 3).pts.filter((_, i) => i % 3 !== 1)
        : [];
    return (
      <View style={{ width: w, height: H }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>{glowLayer(false)}</Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow.interpolate({ inputRange: [0.25, 1], outputRange: [1, 0.25] }) }]}>{glowLayer(true)}</Animated.View>
        <Svg width={w} height={H} style={StyleSheet.absoluteFill}>
          <Path d={wire} stroke="#7a4a2a" strokeWidth={1.4} fill="none" />
          {marigolds.map((m) => (
            <G key={`m${m.i}`}>
              <Circle cx={m.x} cy={m.y} r={3.6} fill={m.i % 2 ? '#ffc233' : '#f08a24'} />
              <Circle cx={m.x} cy={m.y} r={1.3} fill="#b5541f" />
            </G>
          ))}
          {pts.map(lantern)}
        </Svg>
      </View>
    );
  }

  // Bunting: autumn pennants for Thanksgiving, gold and silver for New
  // Year with stars between.
  const colors = theme === 'thanksgiving' ? AUTUMN : PARTY;
  const { wire, pts } = swagPoints(w, swags, 5, 9, 3);
  return (
    <Svg width={w} height={34}>
      <Path d={wire} stroke={theme === 'thanksgiving' ? '#7a4a2a' : '#c4c8d6'} strokeWidth={1.3} fill="none" />
      {pts.map((p) => (
        <G key={p.i} rotation={p.a} origin={`${p.x},${p.y}`}>
          <Polygon points={`${p.x - 8},${p.y} ${p.x + 8},${p.y} ${p.x},${p.y + 17}`} fill={colors[p.i % colors.length]} />
          {theme === 'newyear' && p.i % colors.length === 2 && <Circle cx={p.x} cy={p.y + 6} r={2} fill="#e0b84f" />}
          {theme === 'thanksgiving' && p.i % 2 === 0 && <Path d={leafPath(p.x, p.y + 7, 3.2)} fill="#f6e3b4" opacity={0.85} />}
        </G>
      ))}
      {theme === 'newyear' &&
        pts
          .filter((p) => p.i % 3 === 1)
          .map((p) => <Path key={`s${p.i}`} d={starPath(p.x + 12, p.y + 20, 3.2)} fill="#e0b84f" />)}
    </Svg>
  );
}

// A four-pointed sparkle.
function starPath(x: number, y: number, r: number): string {
  const q = r * 0.3;
  return `M ${x} ${y - r} L ${x + q} ${y - q} L ${x + r} ${y} L ${x + q} ${y + q} L ${x} ${y + r} L ${x - q} ${y + q} L ${x - r} ${y} L ${x - q} ${y - q} Z`;
}

// A maple leaf, centred on x, y, about 2r across.
function leafPath(x: number, y: number, r: number): string {
  const p = (dx: number, dy: number) => `${(x + dx * r).toFixed(2)} ${(y + dy * r).toFixed(2)}`;
  return `M ${p(0, -1)} L ${p(0.25, -0.45)} L ${p(0.7, -0.6)} L ${p(0.55, -0.15)} L ${p(1, 0)} L ${p(0.45, 0.25)} L ${p(0.5, 0.6)} L ${p(0.08, 0.45)} L ${p(0.08, 1)} L ${p(-0.08, 1)} L ${p(-0.08, 0.45)} L ${p(-0.5, 0.6)} L ${p(-0.45, 0.25)} L ${p(-1, 0)} L ${p(-0.55, -0.15)} L ${p(-0.7, -0.6)} L ${p(-0.25, -0.45)} Z`;
}

// ---- The trim along the top of a tile ----

// Snow settled on top for Christmas; a string of marigolds for Diwali.
// Drawn inside the tile's top edge (tiles clip what's outside them).
export function HolidayTileCap() {
  const h = useHoliday();
  const { mode } = useTheme();
  const [w, setW] = useState(0);
  if (!h || (h.theme.id !== 'christmas' && h.theme.id !== 'diwali')) return null;
  return (
    <View pointerEvents="none" style={styles.cap} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      {w > 0 && (h.theme.id === 'christmas' ? <SnowCap w={w} light={mode === 'light'} /> : <MarigoldCap w={w} />)}
    </View>
  );
}

function SnowCap({ w, light }: { w: number; light: boolean }) {
  const bumps = Math.max(3, Math.round(w / 34));
  let d = 'M 0 0 L 0 5';
  for (let i = 0; i < bumps; i++) {
    const x0 = (w * i) / bumps;
    const x1 = (w * (i + 1)) / bumps;
    d += ` Q ${(x0 + x1) / 2} ${(i % 2 ? 13 : 10) + 2} ${x1} 5`;
  }
  d += ` L ${w} 0 Z`;
  return (
    <Svg width={w} height={16}>
      <Path d={d} fill={light ? '#f2f6fc' : '#ffffff'} />
      {light && <Path d={d} fill="none" stroke="#b9cae0" strokeWidth={1.2} />}
    </Svg>
  );
}

// A string of marigolds right along the top edge, clear of the label.
function MarigoldCap({ w }: { w: number }) {
  const n = Math.floor((w - 16) / 8);
  return (
    <Svg width={w} height={8}>
      {Array.from({ length: n + 1 }, (_, i) => (
        <Circle key={i} cx={8 + (i * (w - 16)) / n} cy={3} r={2.4} fill={i % 2 ? '#ffc233' : '#f08a24'} />
      ))}
    </Svg>
  );
}

// ---- The Goals tile's corner ----

export const HOLIDAY_CORNER = 30;

export function HolidayCorner() {
  const h = useHoliday();
  if (!h) return null;
  return (
    <View pointerEvents="none" style={styles.corner}>
      <Svg width={HOLIDAY_CORNER} height={HOLIDAY_CORNER} viewBox="0 0 40 40">
        {h.theme.id === 'christmas' ? (
          <G>
            <Path d="M 20 22 C 12 20 6 24 2 18 C 7 17 6 12 10 12 C 10 8 15 9 16 6 C 19 11 22 15 20 22 Z" fill="#2f8a4e" />
            <Path d="M 20 22 C 28 20 34 24 38 18 C 33 17 34 12 30 12 C 30 8 25 9 24 6 C 21 11 18 15 20 22 Z" fill="#257341" />
            <Circle cx={16} cy={24} r={4} fill="#d12f3f" />
            <Circle cx={23} cy={25} r={4} fill="#e5484d" />
            <Circle cx={19.5} cy={29.5} r={4} fill="#c0283a" />
            <Circle cx={15} cy={23} r={1.1} fill="#ffffff" opacity={0.7} />
          </G>
        ) : h.theme.id === 'diwali' ? (
          // A diya: a clay lamp with its flame.
          <G>
            <Circle cx={20} cy={15} r={10} fill="#ffb347" opacity={0.3} />
            <Path d="M 20 5 C 24 11 24 16 20 19 C 16 16 16 11 20 5 Z" fill="#ffc233" />
            <Path d="M 20 10 C 22 13 22 16 20 18 C 18 16 18 13 20 10 Z" fill="#f26b3a" />
            <Path d="M 5 21 L 35 21 C 33 31 27 35 20 35 C 13 35 7 31 5 21 Z" fill="#b5541f" />
            <Path d="M 5 21 L 35 21 L 33 24 L 7 24 Z" fill="#d9822b" />
            {[11, 17, 23, 29].map((x) => (
              <Circle key={x} cx={x} cy={29} r={1.4} fill="#ffc233" />
            ))}
          </G>
        ) : h.theme.id === 'thanksgiving' ? (
          // A pumpkin.
          <G>
            <Path d="M 20 10 C 20 7 22 5 24 4" stroke="#4f6b2a" strokeWidth={2.4} fill="none" strokeLinecap="round" />
            <Path d="M 22 8 C 27 4 32 6 33 9 C 29 10 25 10 22 8 Z" fill="#5f8a34" />
            <Ellipse cx={12} cy={23} rx={8} ry={11} fill="#d9822b" />
            <Ellipse cx={28} cy={23} rx={8} ry={11} fill="#d9822b" />
            <Ellipse cx={20} cy={23} rx={8.5} ry={12} fill="#f08a24" />
            <Ellipse cx={17} cy={19} rx={2} ry={5} fill="#ffffff" opacity={0.18} />
          </G>
        ) : h.theme.id === 'newyear' ? (
          // A party hat with a pom-pom.
          <G>
            <Polygon points="20,4 33,34 7,34" fill="#8b6fd6" />
            <Path d="M 16 13 L 24 13 L 26 18 L 14 18 Z" fill="#e0b84f" />
            <Path d="M 12 23 L 28 23 L 30.5 28 L 9.5 28 Z" fill="#e0b84f" />
            <Rect x={6} y={33} width={28} height={3.5} rx={1.5} fill="#e0b84f" />
            <Circle cx={20} cy={4} r={4} fill="#ffd23f" />
            <Path d={starPath(33, 10, 4)} fill="#e0b84f" />
          </G>
        ) : (
          // A red envelope with a gold coin.
          <G rotation={-12} origin="20,20">
            <Rect x={8} y={5} width={24} height={31} rx={2.5} fill="#d7263d" />
            <Path d="M 8 7.5 Q 20 18 32 7.5 L 32 5 L 8 5 Z" fill="#b51c30" />
            <Circle cx={20} cy={14} r={5} fill="#f5b82e" />
            <Rect x={18.2} y={12.2} width={3.6} height={3.6} fill="#d7263d" />
            <Rect x={12} y={27} width={16} height={1.4} fill="#f5b82e" />
          </G>
        )}
      </Svg>
    </View>
  );
}

// ---- Things drifting down the screen ----

interface Flake {
  x: number;
  size: number;
  ms: number;
  phase: number;
  sway: number;
  spin: number;
  kind: number;
}

function rand(i: number, n: number): number {
  const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const COUNT: Record<HolidayThemeId, number> = { christmas: 24, diwali: 18, thanksgiving: 12, newyear: 26, lunarnewyear: 16 };

// Over all of Today, behind nothing you can tap (it lets touches
// through). Still for anyone with Reduce Motion on.
export function HolidayParticles() {
  const h = useHoliday();
  const { mode } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const id = h?.theme.id;
  const flakes = useMemo<Flake[]>(() => {
    if (!id || size.w === 0) return [];
    return Array.from({ length: COUNT[id] }, (_, i) => ({
      x: rand(i, 1) * size.w,
      size: id === 'thanksgiving' ? 12 + rand(i, 2) * 8 : id === 'christmas' ? 3 + rand(i, 2) * 4 : 6 + rand(i, 2) * 5,
      ms: (id === 'thanksgiving' ? 13000 : id === 'newyear' ? 9000 : 15000) + rand(i, 3) * 8000,
      phase: rand(i, 4),
      sway: 10 + rand(i, 5) * 22,
      spin: id === 'thanksgiving' || id === 'newyear' || id === 'lunarnewyear' ? (rand(i, 6) > 0.5 ? 1 : -1) : 0,
      kind: Math.floor(rand(i, 7) * 5),
    }));
  }, [id, size.w]);
  if (!h || !h.effects) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.h > 0 &&
        flakes.map((f, i) => <Drifter key={`${h.theme.id}-${i}`} f={f} height={size.h} theme={h.theme.id} light={mode === 'light'} still={!h.motion} />)}
    </View>
  );
}

function Drifter({ f, height, theme, light, still }: { f: Flake; height: number; theme: HolidayThemeId; light: boolean; still: boolean }) {
  const t = useRef(new Animated.Value(f.phase)).current;
  useEffect(() => {
    if (still) return;
    let stopped = false;
    const run = (from: number) => {
      t.setValue(from);
      Animated.timing(t, { toValue: 1, duration: f.ms * (1 - from), easing: Easing.linear, useNativeDriver: true }).start(({ finished }) => {
        if (finished && !stopped) run(0);
      });
    };
    run(f.phase);
    return () => {
      stopped = true;
      t.stopAnimation();
    };
  }, [t, f, still]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-24, height + 24] });
  const translateX = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, f.sway, 0, -f.sway, 0] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${f.spin * 540}deg`] });
  const s = f.size;
  return (
    <Animated.View style={{ position: 'absolute', left: f.x, top: 0, width: s, height: s, transform: [{ translateY }, { translateX }, { rotate }] }}>
      <Svg width={s} height={s} viewBox="0 0 20 20">
        {theme === 'christmas' ? (
          <Circle cx={10} cy={10} r={9} fill={light ? '#9fb4d3' : '#ffffff'} opacity={light ? 0.75 : 0.8} />
        ) : theme === 'diwali' ? (
          <Path d={starPath(10, 10, 9)} fill={f.kind % 2 ? '#ffd23f' : '#f5b82e'} opacity={0.85} />
        ) : theme === 'thanksgiving' ? (
          <Path d={leafPath(10, 10, 9)} fill={AUTUMN[f.kind % AUTUMN.length]} opacity={0.9} />
        ) : theme === 'newyear' ? (
          <Rect x={6} y={2} width={8} height={16} rx={1.5} fill={['#e0b84f', '#e5484d', '#4f9cf0', '#3fb37f', '#8b6fd6'][f.kind]} />
        ) : f.kind < 4 ? (
          // A plum blossom.
          <G>
            {[0, 72, 144, 216, 288].map((a) => (
              <Circle key={a} cx={10 + Math.cos(((a - 90) * Math.PI) / 180) * 5} cy={10 + Math.sin(((a - 90) * Math.PI) / 180) * 5} r={4.2} fill="#f6a5c0" />
            ))}
            <Circle cx={10} cy={10} r={2.4} fill="#f5b82e" />
          </G>
        ) : (
          <Circle cx={10} cy={10} r={6} fill="#f5b82e" />
        )}
      </Svg>
    </Animated.View>
  );
}

export function holidayNoteTitle(id: HolidayThemeId): string {
  return `${HOLIDAY_THEMES[id].emoji} ${HOLIDAY_THEMES[id].name}`;
}

const styles = StyleSheet.create({
  header: { marginHorizontal: -16, marginTop: -8, marginBottom: -8, alignItems: 'center', gap: 4 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontFamily: font.headingSemibold, fontSize: 13 },
  cap: { position: 'absolute', top: 0, left: 0, right: 0 },
  corner: { position: 'absolute', top: 6, right: 6 },
});
