import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../components/Text';
import { font } from '../theme/tokens';
import { HoundArt } from './HoundArt';
import { rankBefore, type MoonForm } from './moonForms';
import { logMoonWatched, type MoonHow, type MoonRank } from './moonApi';
import type { Kennel } from './kennelApi';

// A moon form's cut scene (moonForms.ts): night falls, the moon rises,
// your hound sits on the hill in its old form, the moonlight finds it, it
// shakes, a flash, and it stands in its new form and howls; then the
// title. About 9 seconds, Skip any time; Reduce Motion goes straight to
// the new form. Used at a rank up and from the Kennel's Moon forms.

export type HoundLook = Omit<React.ComponentProps<typeof HoundArt>, 'rank' | 'mood' | 'moon' | 'size' | 'animate' | 'variant'>;

const END = 9000;

// Your hound's look from the Kennel, for a scene.
export function lookFromKennel(k: Kennel): HoundLook {
  return {
    neckId: k.neckId,
    headId: k.headId,
    faceId: k.faceId,
    coatId: k.coatId,
    breedId: k.breedId,
    bodyId: k.bodyId,
    feetId: k.feetId,
    ears: k.ears,
    tail: k.tail,
    markings: k.markings,
  };
}

export function MoonScene({
  form,
  look,
  level,
  replay,
  continueLabel,
  onWatched,
  onClose,
}: {
  form: MoonForm;
  look: HoundLook;
  // The level it happened at (a rank up) or was reached at.
  level?: number;
  // From the Kennel: says "Watch again" rather than "Continue".
  replay?: boolean;
  // The button at the end ("Next form" in a run of several).
  continueLabel?: string;
  // Once per showing: watched to the end, or skipped.
  onWatched?: (skipped: boolean) => void;
  onClose: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const t = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const logged = useRef(false);
  const watched = (skipped: boolean) => {
    if (logged.current) return;
    logged.current = true;
    onWatched?.(skipped);
  };

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    t.setValue(0);
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          t.setValue(END);
          setDone(true);
          watched(false);
          return;
        }
        anim.current = Animated.timing(t, { toValue: END, duration: END, easing: Easing.linear, useNativeDriver: true });
        anim.current.start(({ finished }) => {
          if (!finished) return;
          setDone(true);
          watched(false);
        });
      });
    const tw = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(twinkle, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    tw.start();
    return () => {
      cancelled = true;
      anim.current?.stop();
      tw.stop();
    };
  }, [t, twinkle, runKey]);

  const skip = () => {
    anim.current?.stop();
    t.setValue(END);
    setDone(true);
    watched(true);
  };

  const at = (input: number[], output: number[]) => t.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });

  // Layout: the hill's top at 70% down, the moon above the hound.
  const groundY = H * 0.7;
  const houndSize = Math.min(W * 0.52, 240);
  const houndH = houndSize * 1.2;
  const houndTop = groundY - houndH * 0.95;
  const moonR = Math.min(W, H) * (form.phase === 'full' || form.phase === 'blue' ? 0.2 : 0.16);
  const moonCx = W * 0.5;
  const moonCy = H * 0.22;
  const from = rankBefore(form.rank);

  const stars = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => {
        const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const y = (Math.sin(i * 78.233) * 12345.678) % 1;
        return { x: Math.abs(x) * W, y: Math.abs(y) * groundY * 0.9, r: 0.6 + (i % 4) * 0.45, odd: i % 2 === 0 };
      }),
    [W, groundY],
  );
  const sparks = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ a: (i / 16) * Math.PI * 2, d: 0.6 + (i % 3) * 0.25 })), []);

  // The old form: in, then a shake, gone at the flash.
  const shake = at(
    [3600, 3800, 4000, 4200, 4400, 4600, 4800, 5000, 5200, 5400],
    [0, -4, 4, -6, 6, -8, 8, -10, 10, 0],
  );
  const oldOpacity = at([1500, 2300, 5500, 5650], [0, 1, 1, 0]);
  const newOpacity = at([5550, 5700], [0, 1]);
  const newScale = at([5550, 6100, 6600], [0.85, 1.12, 1]);
  const flash = at([5200, 5600, 6200], [0, 1, 0]);
  const beam = at([2900, 3800, 5600, 6400], [0, 0.75, 0.9, 0.25]);
  const ring = at([4200, 5600], [0, 1]);
  const howl = at([6300, 6700, 7600, 8000], [0, 1, 1, 0]);
  const caption = at([1900, 2400, 3700, 4100], [0, 1, 1, 0]);
  const title = at([7400, 8200], [0, 1]);

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: form.sky[0] }]}>
        {/* The sky and its stars. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: at([0, 900], [0, 1]) }]}>
          <Svg width={W} height={H}>
            <Defs>
              <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={form.sky[0]} />
                <Stop offset="1" stopColor={form.sky[1]} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={W} height={H} fill="url(#sky)" />
          </Svg>
        </Animated.View>
        {stars.map((s, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: s.x,
              top: s.y,
              width: s.r * 2,
              height: s.r * 2,
              borderRadius: s.r,
              backgroundColor: '#fff',
              opacity: s.odd ? twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.9] }) : twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0.3] }),
            }}
          />
        ))}
        {form.scenery === 'aurora' && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: at([600, 2200, 9000], [0, 0.8, 1]) }]}>
            <Aurora W={W} H={H} />
          </Animated.View>
        )}

        {/* The moon rises. */}
        <Animated.View
          style={{
            position: 'absolute',
            left: moonCx - moonR * 2,
            top: moonCy - moonR * 2,
            transform: [{ translateY: at([500, 2600], [H * 0.45, 0]) }],
            opacity: at([500, 1100], [0, 1]),
          }}
        >
          <Moon r={moonR} phase={form.phase} />
        </Animated.View>

        {/* The moonbeam onto the hill. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: beam }]} pointerEvents="none">
          <Svg width={W} height={H}>
            <Defs>
              <LinearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={form.phase === 'blue' ? '#cfe0ff' : '#fff6d8'} stopOpacity="0.55" />
                <Stop offset="1" stopColor={form.phase === 'blue' ? '#cfe0ff' : '#fff6d8'} stopOpacity="0.05" />
              </LinearGradient>
            </Defs>
            <Path
              d={`M ${moonCx - moonR * 0.6} ${moonCy} L ${moonCx + moonR * 0.6} ${moonCy} L ${W / 2 + houndSize * 0.62} ${groundY} L ${W / 2 - houndSize * 0.62} ${groundY} Z`}
              fill="url(#beam)"
            />
          </Svg>
        </Animated.View>

        {/* The ground. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: at([0, 700], [0, 1]) }]} pointerEvents="none">
          <Scenery W={W} H={H} groundY={groundY} form={form} />
        </Animated.View>

        {/* The glow gathering around the hound. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: W / 2 - houndSize * 0.75,
            top: houndTop + houndH * 0.5 - houndSize * 0.75,
            width: houndSize * 1.5,
            height: houndSize * 1.5,
            borderRadius: houndSize * 0.75,
            backgroundColor: form.phase === 'blue' ? '#bcd4ff' : '#ffe9a8',
            opacity: at([4200, 5600, 6400], [0, 0.35, 0]),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.2] }) }],
          }}
        />

        {/* The hound: its old form, then its new one. */}
        <Animated.View style={[styles.hound, { left: W / 2 - houndSize / 2, top: houndTop, opacity: oldOpacity, transform: [{ translateX: shake }] }]}>
          <HoundArt {...look} rank={from} moon={from} mood="okay" size={houndSize} animate={false} />
        </Animated.View>
        <Animated.View style={[styles.hound, { left: W / 2 - houndSize / 2, top: houndTop, opacity: newOpacity, transform: [{ scale: newScale }] }]}>
          <HoundArt {...look} rank={form.rank} moon={form.rank} mood="happy" size={houndSize} animate={done} />
        </Animated.View>

        {/* Sparks from the change. */}
        {sparks.map((p, i) => {
          const dist = houndSize * p.d;
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: W / 2 - 3,
                top: houndTop + houndH * 0.45,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: form.phase === 'blue' ? '#dfe9ff' : '#fff1b8',
                opacity: at([5550, 5800, 7000], [0, 1, 0]),
                transform: [
                  { translateX: at([5550, 7000], [0, Math.cos(p.a) * dist]) },
                  { translateY: at([5550, 7000], [0, Math.sin(p.a) * dist]) },
                ],
              }}
            />
          );
        })}

        {/* The flash. */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />

        {/* Words. */}
        <Animated.Text style={[styles.caption, { top: H * 0.46, opacity: caption }]}>{form.caption}</Animated.Text>
        <Animated.Text
          style={[
            styles.howl,
            { top: houndTop - 34, opacity: howl, transform: [{ scale: howl.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
          ]}
        >
          Awooooo!
        </Animated.Text>
        <Animated.View style={[styles.titleBox, { top: groundY + 18, opacity: title, transform: [{ translateY: at([7400, 8200], [16, 0]) }] }]}>
          <Text style={styles.eyebrow}>{form.title.toUpperCase()}{level ? ` · LEVEL ${level}` : ''}</Text>
          <Text style={styles.form}>{form.form}</Text>
          <Text style={styles.gains}>{form.gains}</Text>
          {done && (
            <View style={styles.buttons}>
              <Pressable style={styles.primary} onPress={onClose} accessibilityRole="button">
                <Text style={styles.primaryText}>{continueLabel ?? (replay ? 'Done' : 'Continue')}</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => setRunKey((k) => k + 1)} accessibilityRole="button">
                <Text style={styles.secondaryText}>Watch again</Text>
              </Pressable>
            </View>
          )}
        </Animated.View>

        {!done && (
          <Pressable style={styles.skip} onPress={skip} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip">
            <Text style={styles.skipText}>Skip ›</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

function Moon({ r, phase }: { r: number; phase: MoonForm['phase'] }) {
  const size = r * 4;
  const c = r * 2;
  const face = phase === 'blue' ? '#cfe0ff' : '#f6efcf';
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0.45" stopColor={face} stopOpacity="0.45" />
          <Stop offset="1" stopColor={face} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={c} cy={c} r={r * 2} fill="url(#halo)" opacity={phase === 'crescent' || phase === 'half' ? 0.6 : 1} />
      {/* The lit part only, so the sky shows through the rest. */}
      {phase === 'crescent' ? (
        <Path d={`M ${c} ${c - r} A ${r} ${r} 0 1 0 ${c} ${c + r} A ${r * 0.62} ${r} 0 1 1 ${c} ${c - r} Z`} fill={face} />
      ) : phase === 'half' ? (
        <Path d={`M ${c} ${c - r} A ${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill={face} />
      ) : (
        <Circle cx={c} cy={c} r={r} fill={face} />
      )}
      {(phase === 'full' || phase === 'blue') && (
        <G opacity={0.18} fill="#7d7a8c">
          <Circle cx={c - r * 0.3} cy={c - r * 0.2} r={r * 0.18} />
          <Circle cx={c + r * 0.25} cy={c + r * 0.3} r={r * 0.13} />
          <Circle cx={c + r * 0.35} cy={c - r * 0.35} r={r * 0.08} />
        </G>
      )}
    </Svg>
  );
}

function Scenery({ W, H, groundY, form }: { W: number; H: number; groundY: number; form: MoonForm }) {
  const g = form.ground;
  return (
    <Svg width={W} height={H}>
      {form.scenery === 'ridge' && (
        <Path
          d={`M 0 ${groundY - H * 0.08} L ${W * 0.18} ${groundY - H * 0.2} L ${W * 0.32} ${groundY - H * 0.11} L ${W * 0.5} ${groundY - H * 0.24} L ${W * 0.7} ${groundY - H * 0.1} L ${W * 0.86} ${groundY - H * 0.18} L ${W} ${groundY - H * 0.09} L ${W} ${H} L 0 ${H} Z`}
          fill={g}
          opacity={0.55}
        />
      )}
      {form.scenery === 'forest' &&
        Array.from({ length: 11 }, (_, i) => {
          const x = (i / 10) * W + (i % 2 ? 8 : -8);
          if (Math.abs(x - W / 2) < W * 0.16) return null;
          const h = H * (0.16 + (i % 3) * 0.05);
          const base = groundY + 6;
          return <Path key={i} d={`M ${x} ${base - h} L ${x + h * 0.28} ${base} L ${x - h * 0.28} ${base} Z`} fill={g} opacity={0.9} />;
        })}
      {form.scenery === 'meadow' &&
        Array.from({ length: 14 }, (_, i) => (
          <Circle key={i} cx={(i * 97) % W} cy={groundY - 10 - ((i * 37) % 60)} r={1.8} fill="#e8f59a" opacity={0.7} />
        ))}
      {/* The hill the hound sits on. */}
      <Path d={`M 0 ${groundY + H * 0.05} Q ${W * 0.5} ${groundY - H * 0.06} ${W} ${groundY + H * 0.05} L ${W} ${H} L 0 ${H} Z`} fill={g} />
    </Svg>
  );
}

function Aurora({ W, H }: { W: number; H: number }) {
  return (
    <Svg width={W} height={H}>
      <Defs>
        <LinearGradient id="aur1" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#5ef2c2" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#5ef2c2" stopOpacity="0.45" />
          <Stop offset="1" stopColor="#8a7cff" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={`M 0 ${H * 0.34} C ${W * 0.3} ${H * 0.2}, ${W * 0.6} ${H * 0.44}, ${W} ${H * 0.28} L ${W} ${H * 0.36} C ${W * 0.6} ${H * 0.52}, ${W * 0.3} ${H * 0.3}, 0 ${H * 0.42} Z`} fill="url(#aur1)" />
      <Path d={`M 0 ${H * 0.46} C ${W * 0.35} ${H * 0.36}, ${W * 0.7} ${H * 0.54}, ${W} ${H * 0.42} L ${W} ${H * 0.47} C ${W * 0.7} ${H * 0.6}, ${W * 0.35} ${H * 0.42}, 0 ${H * 0.52} Z`} fill="url(#aur1)" opacity={0.7} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  hound: { position: 'absolute' },
  caption: { position: 'absolute', left: 24, right: 24, textAlign: 'center', color: '#e9ecff', fontSize: 17, fontFamily: font.body, fontStyle: 'italic' },
  howl: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#fff6d8', fontSize: 26, fontFamily: font.heading, letterSpacing: 1 },
  titleBox: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 4 },
  eyebrow: { color: '#c9cff5', fontSize: 12, letterSpacing: 1.6, fontFamily: font.headingSemibold },
  form: { color: '#ffffff', fontSize: 40, fontFamily: font.heading, letterSpacing: -0.5 },
  gains: { color: '#dfe3ff', fontSize: 14.5, fontFamily: font.body, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: { backgroundColor: '#f6efcf', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  primaryText: { color: '#1b1d29', fontFamily: font.heading, fontSize: 15 },
  secondary: { borderColor: 'rgba(255,255,255,0.4)', borderWidth: 1, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  secondaryText: { color: '#ffffff', fontFamily: font.headingSemibold, fontSize: 15 },
  skip: { position: 'absolute', top: 54, right: 20, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  skipText: { color: '#fff', fontFamily: font.headingSemibold, fontSize: 13.5 },
});

// Several scenes one after another (a rank up past two ranks, or the
// catch-up), each logged as it's watched or skipped.
export function MoonSequence({
  forms,
  look,
  how,
  onDone,
}: {
  forms: MoonForm[];
  look: HoundLook;
  how: MoonHow;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const form = forms[i];
  if (!form) return null;
  const last = i >= forms.length - 1;
  return (
    <MoonScene
      key={form.rank}
      form={form}
      look={look}
      level={form.level}
      replay={how === 'replay'}
      continueLabel={last ? undefined : `Next: ${forms[i + 1].form}`}
      onWatched={(skipped) => logMoonWatched(form.rank as MoonRank, how, skipped)}
      onClose={() => (last ? onDone() : setI(i + 1))}
    />
  );
}

