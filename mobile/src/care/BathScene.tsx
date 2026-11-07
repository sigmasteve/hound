import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ShowerIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { HoundArt } from '../kennel/HoundArt';
import type { HoundEars, HoundMarkings, HoundTail } from '../kennel/kennelItems';
import { font } from '../theme/tokens';

// Bath time: a bath you give, not one you watch. Four steps, each by hand:
//
//   scrub    drag a finger over the hound: foam where you rub, mud off
//   bubbles  bubbles float up from the tub; tap to pop, +1 Bone each, and
//            now and then a golden one, +5
//   rinse    drag the shower over the hound to wash the foam away
//   dry      the hound shakes off and sparkles
//
// The Bones are counted here and paid by the server when the bath ends,
// capped there (bath_bubble_cap). "Quick bath" skips it all, no Bones.
// Colours are fixed, not themed: a bathroom reads the same either way.

const TILE = '#2b4a6b';
const TILE_LINE = 'rgba(255,255,255,0.07)';
const TUB = '#f4f1ea';
const TUB_SHADE = '#d9d3c6';
const WATER = '#9fd3f0';
const FOAM = 'rgba(255,255,255,0.86)';
const FOAM_MAX = 40;
// A steady wobble for foam positions, so a stroke doesn't leave a neat row.
const jitter = (n: number, amp: number) => Math.sin(n * 12.9898) * amp;
const GOLD = '#f3c74f';

export const BUBBLES_PER_BATH = 10;
export const GOLDEN_BONES = 5;

type Stage = 'scrub' | 'bubbles' | 'rinse' | 'dry';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'scrub', label: 'Scrub' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'rinse', label: 'Rinse' },
  { id: 'dry', label: 'Dry' },
];

export interface BathHound {
  name: string;
  rank: React.ComponentProps<typeof HoundArt>['rank'];
  coatId?: string | null;
  breedId?: string | null;
  ears?: HoundEars;
  tail?: HoundTail;
  markings?: HoundMarkings;
  muddy: boolean;
}

export function BathScene({
  visible,
  hound,
  onFinish,
  onQuick,
  onClose,
}: {
  visible: boolean;
  hound: BathHound;
  // The bath's done: bubbles popped and whether the golden one was.
  onFinish: (popped: number, golden: boolean) => void;
  onQuick: () => void;
  onClose: () => void;
}) {
  // Read out here: a full-screen Modal is its own window, and the safe
  // area inside it reads as none (see ScanCodeModal).
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {visible && <BathPlay hound={hound} insets={insets} onFinish={onFinish} onQuick={onQuick} onClose={onClose} />}
    </Modal>
  );
}

type Blob = { id: number; x: number; y: number; r: number };
type Bubble = { id: number; x: number; golden: boolean; delay: number };

export function BathPlay({
  hound,
  insets,
  onFinish,
  onQuick,
  onClose,
  startStage = 'scrub',
}: {
  hound: BathHound;
  insets: { top: number; bottom: number };
  onFinish: (popped: number, golden: boolean) => void;
  onQuick: () => void;
  onClose: () => void;
  // For previews: start part-way through.
  startStage?: Stage;
}) {
  const { width } = useWindowDimensions();
  const W = Math.min(width, 520);
  const H = Math.round(W * 1.12);
  // The hound, centred, sitting in the tub. HoundArt draws the dog in the
  // lower part of its box (ground at 1.15 x size down, the top of the
  // head about 0.58 down), so it's placed by where it stands: paws a little
  // under the water line, the rest above the rim.
  const houndSize = Math.round(W * 0.78);
  const hx = (W - houndSize) / 2;
  const tubTop = Math.round(H * 0.64);
  const hy = tubTop + houndSize * 0.12 - houndSize * 1.15;
  // The part of the hound you can see and scrub: head to the rim.
  const bodyTop = hy + houndSize * 0.58;
  const bodyX0 = W / 2 - houndSize * 0.24;
  const bodyX1 = W / 2 + houndSize * 0.24;

  const [stage, setStage] = useState<Stage>(startStage);
  const [foam, setFoam] = useState<Blob[]>([]);
  const [cells, setCells] = useState<Set<number>>(new Set());
  const [mud, setMud] = useState<{ id: number; x: number; y: number }[]>(() =>
    hound.muddy
      ? [
          [0.3, 0.22],
          [0.68, 0.3],
          [0.42, 0.62],
          [0.18, 0.55],
          [0.8, 0.62],
          [0.58, 0.84],
        ].map(([fx, fy], i) => ({ id: i, x: bodyX0 + fx * (bodyX1 - bodyX0), y: bodyTop + fy * (tubTop - bodyTop) }))
      : [],
  );
  const [popped, setPopped] = useState(0);
  const [golden, setGolden] = useState(false);
  const [bubblesDone, setBubblesDone] = useState(false);
  const [shower, setShower] = useState<{ x: number; y: number } | null>(null);
  const blobId = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  const lastBuzz = useRef(0);

  // The scrub grid: the hound's head and body above the tub's rim.
  const COLS = 6;
  const ROWS = 4;
  const gx0 = bodyX0;
  const gx1 = bodyX1;
  const gy0 = bodyTop;
  const gy1 = tubTop;
  const coverage = cells.size / (COLS * ROWS);

  const buzz = useCallback(() => {
    if (Platform.OS === 'web') return;
    const now = Date.now();
    if (now - lastBuzz.current < 140) return;
    lastBuzz.current = now;
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const scrubAt = useCallback(
    (x: number, y: number) => {
      if (x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1) {
        const c = Math.min(COLS - 1, Math.floor(((x - gx0) / (gx1 - gx0)) * COLS));
        const r = Math.min(ROWS - 1, Math.floor(((y - gy0) / (gy1 - gy0)) * ROWS));
        setCells((s) => (s.has(r * COLS + c) ? s : new Set(s).add(r * COLS + c)));
        buzz();
      }
      setMud((m) => (m.length ? m.filter((p) => Math.hypot(p.x - x, p.y - y) > 26) : m));
      const prev = last.current;
      if (!prev || Math.hypot(prev.x - x, prev.y - y) > 14) {
        last.current = { x, y };
        // Foam only on the hound, and not piled up: a new blob needs a
        // little room from the others.
        if (x > bodyX0 - 6 && x < bodyX1 + 6 && y > bodyTop - 4 && y < tubTop + 4) {
          setFoam((f) =>
            f.length >= FOAM_MAX || f.some((b) => Math.hypot(b.x - x, b.y - y) < 16)
              ? f
              : [...f, { id: blobId.current++, x: x + jitter(blobId.current, 7), y: y + jitter(blobId.current + 3, 7), r: 8 + ((blobId.current * 7) % 8) }],
          );
        }
      }
    },
    [gx0, gx1, gy0, gy1, bodyX0, bodyX1, bodyTop, tubTop, buzz],
  );

  const rinseAt = useCallback(
    (x: number, y: number) => {
      setShower({ x, y });
      // The spray falls straight down from the head.
      setFoam((f) => f.filter((b) => !(Math.abs(b.x - x) < 34 && b.y > y - 10)));
      buzz();
    },
    [buzz],
  );

  const stageRef = useRef(stage);
  stageRef.current = stage;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => stageRef.current === 'scrub' || stageRef.current === 'rinse',
        onMoveShouldSetPanResponder: () => stageRef.current === 'scrub' || stageRef.current === 'rinse',
        onPanResponderGrant: (e) => {
          last.current = null;
          const { locationX: x, locationY: y } = e.nativeEvent;
          if (stageRef.current === 'scrub') scrubAt(x, y);
          else rinseAt(x, y);
        },
        onPanResponderMove: (e) => {
          const { locationX: x, locationY: y } = e.nativeEvent;
          if (stageRef.current === 'scrub') scrubAt(x, y);
          else rinseAt(x, y);
        },
      }),
    [scrubAt, rinseAt],
  );

  // Scrubbed enough: cover the hound in foam and on to the bubbles.
  useEffect(() => {
    if (stage !== 'scrub' || coverage < 0.75) return;
    const t = setTimeout(() => {
      setMud([]);
      setFoam((f) => {
        const extra: Blob[] = [];
        for (let i = 0; i < 24 && f.length + extra.length < FOAM_MAX; i++) {
          const x = bodyX0 + (bodyX1 - bodyX0) * (0.08 + 0.84 * (((i * 37) % 100) / 100));
          const y = bodyTop + (tubTop - bodyTop) * (0.08 + 0.84 * (((i * 53) % 100) / 100));
          if ([...f, ...extra].some((b) => Math.hypot(b.x - x, b.y - y) < 18)) continue;
          extra.push({ id: blobId.current++, x: x + jitter(i, 6), y: y + jitter(i + 5, 6), r: 9 + ((i * 5) % 7) });
        }
        return [...f, ...extra];
      });
      setStage('bubbles');
    }, 500);
    return () => clearTimeout(t);
  }, [stage, coverage, bodyX0, bodyX1, bodyTop, tubTop]);

  // The bubbles: ten, and a golden one somewhere among them.
  const bubbles = useMemo<Bubble[]>(() => {
    const goldAt = 3 + Math.floor(Math.random() * 6);
    const out: Bubble[] = [];
    for (let i = 0; i < BUBBLES_PER_BATH; i++) {
      out.push({ id: i, x: W * (0.18 + Math.random() * 0.64), golden: false, delay: i * 650 });
      if (i === goldAt) out.push({ id: 100, x: W * (0.25 + Math.random() * 0.5), golden: true, delay: i * 650 + 320 });
    }
    return out;
  }, [W]);

  // Rinsed: on to the shake.
  useEffect(() => {
    if (stage === 'rinse' && foam.length <= 3) {
      const t = setTimeout(() => {
        setFoam([]);
        setShower(null);
        setStage('dry');
      }, 300);
      return () => clearTimeout(t);
    }
  }, [stage, foam.length]);

  // The shake.
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (stage !== 'dry') return;
    Animated.sequence([
      Animated.loop(
        Animated.sequence([
          Animated.timing(shake, { toValue: 1, duration: 70, useNativeDriver: true }),
          Animated.timing(shake, { toValue: -1, duration: 140, useNativeDriver: true }),
          Animated.timing(shake, { toValue: 0, duration: 70, useNativeDriver: true }),
        ]),
        { iterations: 5 },
      ),
    ]).start();
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [stage, shake]);

  const bones = popped + (golden ? GOLDEN_BONES : 0);
  const stageIdx = STAGES.findIndex((s) => s.id === stage);
  const hint =
    stage === 'scrub'
      ? hound.muddy
        ? `Scrub ${hound.name} clean: rub all over with your finger.`
        : `Scrub-a-dub: rub all over ${hound.name} with your finger.`
      : stage === 'bubbles'
        ? bubblesDone
          ? 'That’s all the bubbles. Time to rinse.'
          : 'Pop the bubbles! +1 Bone each, +5 for gold.'
        : stage === 'rinse'
          ? 'Drag the shower over the foam to rinse it off.'
          : `${hound.name} is squeaky clean!`;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Bath time</Text>
        {stage === 'scrub' ? (
          <Pressable onPress={onQuick} hitSlop={8} accessibilityRole="button" style={styles.quick}>
            <Text style={styles.quickText}>Quick bath</Text>
          </Pressable>
        ) : (
          <View style={styles.bonesPill}>
            <Text style={styles.bonesText}>🦴 +{bones}</Text>
          </View>
        )}
        {stage !== 'dry' && (
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={20} color="rgba(255,255,255,0.8)" />
          </Pressable>
        )}
      </View>

      <View style={styles.steps}>
        {STAGES.map((s, i) => (
          <View key={s.id} style={styles.step}>
            <View style={[styles.stepDot, i < stageIdx && styles.stepDone, i === stageIdx && styles.stepOn]} />
            <Text style={[styles.stepText, i === stageIdx && styles.stepTextOn]}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{hint}</Text>

      {/* The bathroom. Touches land here for scrubbing and rinsing. */}
      <View style={[styles.room, { width: W, height: H }]} {...pan.panHandlers}>
        {Array.from({ length: 8 }, (_, i) => (
          <View key={`h${i}`} pointerEvents="none" style={[styles.tileLineH, { top: (H / 8) * i }]} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <View key={`v${i}`} pointerEvents="none" style={[styles.tileLineV, { left: (W / 6) * i }]} />
        ))}

        {/* Back of the tub, then the hound in it. */}
        <View pointerEvents="none" style={[styles.tubBack, { left: W * 0.08, right: W * 0.08, top: tubTop - 18, height: 36 }]} />
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: hx,
            top: hy,
            width: houndSize,
            alignItems: 'center',
            transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-9deg', '9deg'] }) }],
          }}
        >
          <HoundArt
            rank={hound.rank}
            mood={stage === 'scrub' && coverage < 0.2 ? 'okay' : 'happy'}
            coatId={hound.coatId}
            breedId={hound.breedId}
            ears={hound.ears}
            tail={hound.tail}
            markings={hound.markings}
            size={houndSize}
            fresh={stage === 'dry'}
          />
        </Animated.View>

        {mud.map((m) => (
          <View key={`m${m.id}`} pointerEvents="none" style={[styles.mud, { left: m.x - 11, top: m.y - 8 }]} />
        ))}
        {foam.map((b) => (
          <View key={b.id} pointerEvents="none" style={[styles.foam, { left: b.x - b.r, top: b.y - b.r, width: b.r * 2, height: b.r * 2, borderRadius: b.r }]} />
        ))}

        {/* Water, and the front of the tub over the hound's legs. */}
        <View pointerEvents="none" style={[styles.water, { left: W * 0.1, right: W * 0.1, top: tubTop - 4, height: 18 }]} />
        <View pointerEvents="none" style={[styles.tubFront, { left: W * 0.06, right: W * 0.06, top: tubTop + 6, height: H - tubTop - 40 }]}>
          <View style={styles.tubRim} />
        </View>
        <View pointerEvents="none" style={[styles.foot, { left: W * 0.14, top: H - 40 }]} />
        <View pointerEvents="none" style={[styles.foot, { right: W * 0.14, top: H - 40 }]} />

        {stage === 'bubbles' && (
          <BubbleField
            bubbles={bubbles}
            fromY={tubTop}
            onPop={(b) => {
              if (b.golden) setGolden(true);
              else setPopped((p) => Math.min(BUBBLES_PER_BATH, p + 1));
              if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            }}
            onAllGone={() => setBubblesDone(true)}
          />
        )}

        {stage === 'rinse' && <ShowerHead at={shower ?? { x: W * 0.78, y: bodyTop - 70 }} />}

        {stage === 'dry' && <Sparkles W={W} hy={bodyTop - houndSize * 0.1} size={houndSize} />}
      </View>

      <View style={styles.footer}>
        {stage === 'scrub' && (
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.min(100, (coverage / 0.75) * 100)}%` }]} />
          </View>
        )}
        {stage === 'bubbles' && bubblesDone && (
          <Pressable style={styles.cta} onPress={() => setStage('rinse')} accessibilityRole="button">
            <ShowerIcon size={18} color="#1b2b3d" weight="fill" />
            <Text style={styles.ctaText}>Rinse off</Text>
          </Pressable>
        )}
        {stage === 'rinse' && (
          <Pressable onPress={() => setFoam([])} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Rinse it all</Text>
          </Pressable>
        )}
        {stage === 'dry' && (
          <Pressable style={styles.cta} onPress={() => onFinish(popped, golden)} accessibilityRole="button">
            <Text style={styles.ctaText}>{bones > 0 ? `All done · +${bones} Bones` : 'All done'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// The bubbles, rising from the tub on one clock (25 a second), each with a
// wobble. Tap one before it floats off the top.
const RISE_MS = 4200;
function BubbleField({
  bubbles,
  fromY,
  onPop,
  onAllGone,
}: {
  bubbles: Bubble[];
  fromY: number;
  onPop: (b: Bubble) => void;
  onAllGone: () => void;
}) {
  const start = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [popped, setPopped] = useState<Map<number, number>>(new Map());
  const ended = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 40);
    return () => clearInterval(t);
  }, []);
  const t = now - start.current;
  const last = Math.max(...bubbles.map((b) => b.delay)) + RISE_MS + 800;
  useEffect(() => {
    if (!ended.current && t > last) {
      ended.current = true;
      onAllGone();
    }
  }, [t, last, onAllGone]);

  return (
    <>
      {bubbles.map((b) => {
        const size = b.golden ? 54 : 44 + (b.id % 3) * 6;
        const poppedAt = popped.get(b.id);
        if (poppedAt != null) {
          // "+1" floating up from where it popped, for 0.7 s.
          const age = now - poppedAt;
          if (age > 700) return null;
          const k = (poppedAt - start.current - b.delay) / RISE_MS;
          const y = fromY - size - k * (fromY + size);
          return (
            <Text
              key={b.id}
              style={[styles.plus, { position: 'absolute', left: b.x - 14, top: y - age * 0.06, opacity: 1 - age / 700 }, b.golden && { color: GOLD }]}
            >
              +{b.golden ? GOLDEN_BONES : 1}
            </Text>
          );
        }
        const k = (t - b.delay) / RISE_MS;
        if (k < 0 || k > 1) return null;
        const y = fromY - size - k * (fromY + size);
        const x = b.x - size / 2 + Math.sin(k * Math.PI * 4 + b.id) * 12;
        return (
          <Pressable
            key={b.id}
            onPress={() => {
              setPopped((m) => new Map(m).set(b.id, Date.now()));
              onPop(b);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={b.golden ? 'Golden bubble' : 'Bubble'}
            style={{ position: 'absolute', left: x, top: y }}
          >
            <View style={[styles.bubble, { width: size, height: size, borderRadius: size / 2 }, b.golden && styles.bubbleGold]}>
              <View style={styles.bubbleShine} />
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

function ShowerHead({ at }: { at: { x: number; y: number } }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: at.x - 30, top: at.y - 34 }}>
      <View style={styles.showerHead}>
        <ShowerIcon size={34} color="#e8eef5" weight="fill" />
      </View>
      {Array.from({ length: 5 }, (_, i) => (
        <View key={i} style={[styles.spray, { left: 12 + i * 8, height: 70 + (i % 2) * 24 }]} />
      ))}
    </View>
  );
}

function Sparkles({ W, hy, size }: { W: number; hy: number; size: number }) {
  const spots = [
    [0.22, 0.1],
    [0.78, 0.16],
    [0.15, 0.42],
    [0.84, 0.46],
    [0.5, 0.02],
    [0.3, 0.7],
    [0.72, 0.68],
  ];
  return (
    <>
      {spots.map(([fx, fy], i) => (
        <Text key={i} style={[styles.sparkle, { left: (W - size) / 2 + fx * size, top: hy + fy * size }]}>
          {i % 2 ? '✨' : '💧'}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b2b3d', alignItems: 'center', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'stretch', paddingHorizontal: 18 },
  title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 22, color: '#ffffff' },
  quick: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)' },
  quickText: { fontFamily: font.heading, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  bonesPill: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(243,199,79,0.18)' },
  bonesText: { fontFamily: font.headingSemibold, fontSize: 14, color: GOLD, fontVariant: ['tabular-nums'] },
  steps: { flexDirection: 'row', gap: 18, marginTop: 4 },
  step: { alignItems: 'center', gap: 4 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.2)' },
  stepOn: { backgroundColor: WATER, transform: [{ scale: 1.3 }] },
  stepDone: { backgroundColor: 'rgba(159,211,240,0.55)' },
  stepText: { fontSize: 11.5, color: 'rgba(255,255,255,0.5)' },
  stepTextOn: { color: '#ffffff', fontFamily: font.heading },
  hint: { fontSize: 14, color: 'rgba(255,255,255,0.85)', textAlign: 'center', paddingHorizontal: 24, minHeight: 40 },
  room: { backgroundColor: TILE, borderRadius: 20, overflow: 'hidden' },
  tileLineH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: TILE_LINE },
  tileLineV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: TILE_LINE },
  tubBack: { position: 'absolute', backgroundColor: TUB_SHADE, borderRadius: 18 },
  water: { position: 'absolute', backgroundColor: WATER, borderRadius: 9, opacity: 0.85 },
  tubFront: { position: 'absolute', backgroundColor: TUB, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderBottomLeftRadius: 60, borderBottomRightRadius: 60 },
  tubRim: { height: 10, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#ffffff' },
  foot: { position: 'absolute', width: 22, height: 26, borderRadius: 8, backgroundColor: '#c9a24a' },
  mud: { position: 'absolute', width: 22, height: 16, borderRadius: 9, backgroundColor: '#7a5532', opacity: 0.85 },
  foam: { position: 'absolute', backgroundColor: FOAM, borderWidth: 1, borderColor: 'rgba(200,225,240,0.9)' },
  bubble: {
    backgroundColor: 'rgba(190,230,255,0.28)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  bubbleGold: { backgroundColor: 'rgba(243,199,79,0.35)', borderColor: GOLD },
  bubbleShine: { position: 'absolute', top: 7, left: 9, width: 10, height: 6, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.9)', transform: [{ rotate: '-30deg' }] },
  plus: { fontFamily: font.headingSemibold, fontSize: 20, color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4 },
  showerHead: { width: 60, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#5c7896' },
  spray: { position: 'absolute', top: 40, width: 3, borderRadius: 2, backgroundColor: 'rgba(159,211,240,0.8)' },
  sparkle: { position: 'absolute', fontSize: 20 },
  footer: { minHeight: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  meter: { alignSelf: 'stretch', height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  meterFill: { height: 10, borderRadius: 5, backgroundColor: WATER },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 999, backgroundColor: WATER },
  ctaText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#1b2b3d' },
  link: { fontFamily: font.heading, fontSize: 14, color: 'rgba(255,255,255,0.75)' },
});
