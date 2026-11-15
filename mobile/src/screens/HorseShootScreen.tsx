import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Basketball } from '../components/HoopsCourt';
import { crowdDots, groundPath, perspective, project, type Perspective } from '../components/perspective';
import { HoundArt } from '../kennel/HoundArt';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { formatSteps } from '../challenges/hoops';
import { getHorse, getHorseLive, previewHorseShot, shootHorse, type HorseGame, type HorseLive, type HorsePreview, type HorseShotResult } from '../challenges/horseApi';
import {
  BASKET_V,
  BENCH,
  CHAIN,
  HORSE_CALLS,
  HORSE_FAR,
  callFits,
  describeShot,
  farOf,
  feetOf,
  isOutside,
  overChair,
  spotName,
  starText,
  starsOf,
  timeLeft,
  windowOf,
  type HorseCall,
  type HorseFarKind,
  type HorseSpot,
} from '../challenges/horseLive';

// H-O-R-S-E, call your shot (0209), for a game made with "Take my own
// shots": turn by turn, 24 hours a turn. On your turn to set, tap anywhere
// on the floor (or up on the bench, or a spot beyond the court your best
// day has unlocked), chain your calls (off the floor, off the scoreboard,
// off the glass, behind the back, nothing but net), Shoot, then Release!
// in the green: one shot. Make it and they have 24 hours to match it, the
// same spot and the same calls, or take a letter. Every call narrows the
// green; so does shooting over today's chair. Tries come from steps, one
// per 2,000. The server decides every shot (horse_shoot).
//
// Steve's layout: the court never scrolls away. The header and letters sit
// on top, the court is fixed below them, only the options under it scroll,
// and the meter, the Shoot button and the message are pinned at the bottom.
//
// The court is the half court seen from above half court, looking at the
// basket (perspective.ts): on the ground, x runs across (u −1..1 as
// 0.5 + u/2) and y from the baseline (0) to half court (1). Everything on
// the floor goes through project(). The scoreboard hangs behind the
// basket; the parking lot and the rooftop have their own outside scene.

type Phase = 'aim' | 'meter' | 'waiting' | 'flying' | 'result';
type Pt = { x: number; y: number };
type Leg = { a: Pt; b: Pt; peak: number; ms: number };

// The art is drawn on a 358 × 440 board (the prototype's), scaled to fit.
const BW = 358;
const BH = 440;
const PERIOD = 1300;

function courtView(w: number, h: number): Perspective {
  const kx = w / BW;
  const ky = h / BH;
  return perspective(w, h, { stand: 150 * ky, gap: 0, near: h - 430 * ky, botW: 344 * kx, a: 0.651, b: 0.85 });
}

// Ground to screen, in u (across) and v (baseline → half court).
function P(v: Perspective, u: number, vv: number): { x: number; y: number; s: number } {
  return project(v, 0.5 + u / 2, vv);
}

// Screen to ground: where on the floor a tap landed.
function unproject(v: Perspective, sx: number, sy: number): { u: number; v: number } {
  const up = (sy - v.y0) / (v.y1 - v.y0);
  const y = up / (v.b + up * (1 - v.b));
  const s = v.a + (1 - v.a) * up;
  const x = 0.5 + (sx - v.w / 2) / (v.botW * s);
  return { u: (x - 0.5) * 2, v: y };
}

// Where the spots beyond the court stand on screen (board units).
const FAR_AT: Record<HorseFarKind, { x: number; y: number; sc: number }> = {
  stands: { x: 46, y: 118, sc: 0.6 },
  rafters: { x: 266, y: 50, sc: 0.58 },
  lot: { x: 150, y: 388, sc: 0.9 },
  roof: { x: 52, y: 258, sc: 0.85 },
};

function scaleOf(spot: HorseSpot): number {
  if (spot.kind === 'floor') return 0.75 + 0.55 * spot.v;
  if (spot.kind === 'bench') return 0.75 + 0.55 * BENCH.v;
  return FAR_AT[spot.kind].sc;
}

function quad(a: Pt, b: Pt, peak: number, t: number): Pt {
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 2 * peak };
  const k = 1 - t;
  return { x: k * k * a.x + 2 * k * t * c.x + t * t * b.x, y: k * k * a.y + 2 * k * t * c.y + t * t * b.y };
}

export function HorseShootScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const win = useWindowDimensions();
  const [game, setGame] = useState<HorseGame | null>(null);
  const [live, setLive] = useState<HorseLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spot, setSpot] = useState<HorseSpot>({ kind: 'floor', u: 0, v: 0.66 });
  const [calls, setCalls] = useState<HorseCall[]>([]);
  const [phase, setPhase] = useState<Phase>('aim');
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [toast, setToast] = useState(false);
  const [lastM, setLastM] = useState<number | null>(null);
  const [legs, setLegs] = useState<Leg[] | null>(null);
  const [preview, setPreview] = useState<{ key: string; p: HorsePreview } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const g = await getHorse(challengeId);
      setGame(g);
      const l = g?.live ?? (await getHorseLive(challengeId));
      setLive(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the game.');
    }
  }, [challengeId]);
  useEffect(() => {
    load();
  }, [load]);

  // The court: as wide as the screen, as tall as it can be while leaving
  // room for the options and the pinned controls.
  const courtW = Math.max(240, win.width - 28);
  const courtH = Math.round(Math.min(courtW * (BH / BW), win.height * 0.46));
  const kx = courtW / BW;
  const ky = courtH / BH;
  const v = useMemo(() => courtView(courtW, courtH), [courtW, courtH]);
  const rim = useMemo(() => {
    const f = P(v, 0, BASKET_V);
    return { x: f.x, y: f.y - 48 * ky, rx: 13 * kx, floorY: f.y };
  }, [v, kx, ky]);

  const me = game?.players.find((p) => p.userId === game.me) ?? null;
  const look = parseHoundAvatar(me?.iconId ?? null);
  const themName = live?.them?.name?.split(' ')[0] ?? game?.players.find((p) => p.userId !== game.me)?.name.split(' ')[0] ?? 'Your opponent';
  const matching = !!live?.turn?.mine && live.turn.kind === 'match' && !!live.pending;
  const shot: { spot: HorseSpot; calls: HorseCall[] } = matching && live?.pending ? { spot: live.pending.spot, calls: live.pending.calls } : { spot, calls };
  const outside = isOutside(shot.spot);
  const obstacle = live?.obstacle ?? null;
  const steady = live?.steady ?? 1;
  const key = JSON.stringify([shot.spot, [...shot.calls].sort()]);
  // Matching: the chair is the one from when the shot was set.
  const localW = windowOf(shot.spot, shot.calls, obstacle, steady, matching ? live?.pending?.overChair : undefined);
  const w = preview && preview.key === key ? preview.p.window || localW : localW;
  const stars = starsOf(w);
  const description = matching && live?.pending?.description ? live.pending.description : preview && preview.key === key && preview.p.description ? preview.p.description : describeShot(shot.spot, shot.calls, obstacle);
  const net = shot.calls.includes('net');
  const unlocks = live?.unlocks.length ? live.unlocks : HORSE_FAR.map((f) => ({ kind: f.kind, name: f.name, need: f.need, unlocked: Math.max(live?.bestDay ?? 0, live?.steps ?? 0) >= f.need, feet: f.feet }));
  const unlocked = (kind: string) => unlocks.find((u) => u.kind === kind)?.unlocked ?? false;
  const far = farOf(shot.spot.kind);
  const spotLocked = !!far && !unlocked(far.kind);
  const fresh = preview && preview.key === key ? preview.p : null;

  // The server's window for the call (debounced), so the meter matches it.
  useEffect(() => {
    if (!live || matching) return;
    const t = setTimeout(() => {
      previewHorseShot(challengeId, shot.spot, shot.calls)
        .then((p) => setPreview({ key, p }))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, challengeId, !!live, matching]);

  useEffect(() => {
    if (!live || msg) return;
    if (!live.turn?.mine) return;
    setMsg(
      matching
        ? `${themName} called it: ${live.pending?.description ?? ''} Same spot, same calls, one shot${live.turn.shotsLeft > 1 ? ' (two: it’s your last letter)' : ''}. Miss it and you take the next letter.`
        : 'Your turn to set. Tap anywhere on the floor (or up on the bench), chain your calls, then Shoot and Release in the green. One shot: make it and ' +
            themName +
            ' has 24 hours to match it.',
    );
  }, [live, msg, matching, themName]);

  // The meter: a marker sweeping there and back every 1.3 seconds.
  const meter = useRef(new Animated.Value(0)).current;
  const meterAt = useRef(0);
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  const fly = useRef(new Animated.Value(0)).current;
  const jump = useRef(new Animated.Value(0)).current;
  const hype = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = meter.addListener(({ value }) => {
      meterAt.current = value;
    });
    return () => meter.removeListener(a);
  }, [meter]);

  const spotAt = useCallback(
    (s: HorseSpot): Pt => {
      if (s.kind === 'floor') return P(v, s.u, s.v);
      if (s.kind === 'bench') return P(v, BENCH.u, BENCH.v);
      const f = FAR_AT[s.kind];
      return { x: f.x * kx, y: f.y * ky };
    },
    [v, kx, ky],
  );
  const handsOf = useCallback(
    (s: HorseSpot, back: boolean): Pt => {
      const p = spotAt(s);
      const sc = scaleOf(s);
      return { x: p.x + (back ? -4 : 6) * sc * kx, y: p.y - 34 * sc * ky };
    },
    [spotAt, kx, ky],
  );

  // The ball's way to the rim: through each call in order, then in or off.
  const legsFor = useCallback(
    (s: HorseSpot, cs: HorseCall[], made: boolean, timing: number): Leg[] => {
      const out: Leg[] = [];
      let at = handsOf(s, cs.includes('back'));
      const go = (to: Pt, peak: number) => {
        const d = Math.hypot((to.x - at.x) / kx, (to.y - at.y) / ky);
        out.push({ a: at, b: to, peak: peak * ky, ms: Math.max(260, Math.min(1100, 240 + d * 2.4)) });
        at = to;
      };
      const X = (x: number) => x * kx;
      const Y = (y: number) => y * ky;
      if (isOutside(s)) {
        if (cs.includes('billboard')) go({ x: X(158), y: Y(178) }, 70);
        if (made) {
          go({ x: X(292), y: Y(200) }, cs.includes('billboard') ? 26 : 110);
          go({ x: X(293), y: Y(199) }, 0);
        } else {
          go({ x: X(timing < 0 ? 250 : 334), y: Y(timing < 0 ? 214 : 176) }, cs.includes('billboard') ? 26 : 110);
          go({ x: X(timing < 0 ? 238 : 340), y: Y(386) }, 8);
        }
        return out;
      }
      const f = s.kind === 'floor' ? { u: s.u, v: s.v } : s.kind === 'bench' ? BENCH : null;
      const farSpot = !f;
      const side = f ? (f.u < -0.05 ? -1 : 1) : s.kind === 'stands' ? -1 : 1;
      const ft = Math.min(60, feetOf(s));
      const chair = matching && live?.pending ? live.pending.overChair : overChair(s, obstacle);
      const h = s.kind === 'rafters' ? 24 : 46 + ft * 1.4 + (f && chair ? 30 : 0);
      const has = (c: HorseCall) => cs.includes(c);
      if (has('floor')) {
        const b = f ? P(v, f.u / 2, (f.v + BASKET_V) / 2 + 0.02) : P(v, side * 0.3, 0.3);
        go(b, 18);
      }
      if (has('board')) go({ x: rim.x, y: Y(52) }, farSpot && !has('floor') ? 8 : has('floor') ? Math.min(h + 30, 120) : h * 0.6);
      if (has('glass')) go({ x: rim.x + side * 14 * kx, y: Y(110) }, has('board') ? 2 : has('floor') ? h * 0.6 : h);
      const lastPeak = has('glass') ? 4 : has('board') ? 0 : has('floor') ? h * 0.7 : h;
      if (made) {
        go({ x: rim.x, y: rim.y - 2 * ky }, lastPeak);
        go({ x: rim.x, y: rim.y + 18 * ky }, 0);
        go(P(v, 0.04 * side, 0.2), 10);
      } else if (timing < 0 && !has('board')) {
        go({ x: rim.x - side * 4 * kx, y: rim.y + 6 * ky }, lastPeak * 0.92);
        go(P(v, -0.12 * side, 0.22), 12);
      } else {
        go({ x: rim.x + side * 15 * kx, y: rim.y - ky }, lastPeak);
        go(P(v, 0.32 * side, 0.18), 22);
      }
      return out;
    },
    [handsOf, kx, ky, v, rim, obstacle, matching, live?.pending],
  );

  const ballD = (outside ? 10 : 12) * kx;
  const flight = useMemo(() => {
    if (!legs || legs.length === 0) return null;
    const total = legs.reduce((a, l) => a + l.ms, 0);
    const ts: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    let t0 = 0;
    ts.push(0);
    xs.push(legs[0].a.x - ballD / 2);
    ys.push(legs[0].a.y - ballD / 2);
    for (const l of legs) {
      for (let i = 1; i <= 10; i++) {
        const q = quad(l.a, l.b, l.peak, i / 10);
        ts.push((t0 + (l.ms * i) / 10) / total);
        xs.push(q.x - ballD / 2);
        ys.push(q.y - ballD / 2);
      }
      t0 += l.ms;
    }
    ts[ts.length - 1] = 1;
    return { total, tx: fly.interpolate({ inputRange: ts, outputRange: xs }), ty: fly.interpolate({ inputRange: ts, outputRange: ys }) };
  }, [legs, fly, ballD]);

  // The setter's make, as a dotted trail, while you're matching it.
  const ghost = useMemo(() => {
    if (!matching || !live?.pending || phase !== 'aim') return [];
    const ls = legsFor(live.pending.spot, live.pending.calls, true, 0);
    const dots: Pt[] = [];
    ls.slice(0, ls.length - 1).forEach((l) => {
      for (let i = 1; i <= 7; i++) dots.push(quad(l.a, l.b, l.peak, i / 8));
    });
    return dots;
  }, [matching, live?.pending, phase, legsFor]);

  const busy = phase === 'waiting' || phase === 'flying' || phase === 'result';
  const myTurn = !!live?.turn?.mine && live?.status !== 'final';
  const canShoot = !!live && live.handsOn && live.canShoot && myTurn && !spotLocked;

  const pickSpot = (s: HorseSpot) => {
    if (!live || matching || !myTurn || phase !== 'aim') return;
    const f = farOf(s.kind);
    if (f && !unlocked(f.kind)) {
      setMsg(`A ${f.need / 1000}K day unlocks ${f.name.toLowerCase().replace(', through the gym window', '')} for the rest of the game. You’re at ${formatSteps(live.steps)} today.`);
      return;
    }
    // Keep only the calls that still fit the scene.
    setCalls((cs) => cs.filter((c) => callFits(c, s)));
    setSpot(s);
    setLastM(null);
    setBanner(null);
  };

  const onCourtPress = (e: GestureResponderEvent) => {
    if (!live || matching || !myTurn || phase !== 'aim') return;
    const ne = e.nativeEvent as typeof e.nativeEvent & { offsetX?: number; offsetY?: number };
    const sx = Number.isFinite(ne.locationX) ? ne.locationX : (ne.offsetX ?? NaN);
    const sy = Number.isFinite(ne.locationY) ? ne.locationY : (ne.offsetY ?? NaN);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    // The spots beyond the court you can tap where they are.
    if (!outside) {
      for (const kind of ['stands', 'rafters'] as const) {
        const f = FAR_AT[kind];
        if (Math.hypot(sx - f.x * kx, sy - (f.y - 14) * ky) < 26 * kx) return pickSpot({ kind });
      }
      if (sy < v.y0 - 4) return;
      const g = unproject(v, sx, sy);
      if (g.u > 1.03 && g.v > 0.4 && g.v < 0.82) return pickSpot({ kind: 'bench' });
      if (g.v < -0.02 || g.v > 1.03 || Math.abs(g.u) > 1.06) return;
      pickSpot({ kind: 'floor', u: Math.max(-1, Math.min(1, g.u)), v: Math.max(0, Math.min(1, g.v)) });
    }
  };

  const toggleCall = (c: HorseCall) => {
    if (matching || !myTurn || phase !== 'aim') return;
    if (!callFits(c, shot.spot)) return;
    setCalls((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
    setLastM(null);
  };

  const bannerFor = (r: HorseShotResult, timing: number): { text: string; good: boolean } => {
    if (r.made) {
      if (matching) return { text: 'Matched!', good: true };
      const word = r.swish ? (net ? 'Nothing but net!' : 'Swish!') : 'In!';
      return { text: `${word}${r.stars >= 4 ? ' Highlight!' : ' Shot set'}`, good: true };
    }
    if (r.notNet) return { text: 'In, but not all net', good: false };
    const ww = r.window || w;
    return { text: Math.abs(timing) <= ww ? 'Rims out' : timing < 0 ? 'Short' : 'Long', good: false };
  };

  const act = async () => {
    if (!live) return;
    if (phase === 'aim') {
      if (!canShoot) return;
      setBanner(null);
      setLastM(null);
      setLegs(null);
      fly.setValue(0);
      setPhase('meter');
      setMsg(matching ? 'Same spot, same calls. Release in the green.' : `Release in the green${net ? ': dark green only, you called nothing but net.' : '.'}`);
      meter.setValue(0);
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(meter, { toValue: 1, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(meter, { toValue: 0, duration: PERIOD / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ]),
      );
      loop.current.start();
      return;
    }
    if (phase !== 'meter') return;
    loop.current?.stop();
    const m = meterAt.current;
    const timing = m - 0.5;
    setLastM(m);
    buzz('light');
    setPhase('waiting');
    try {
      const r = await shootHorse(challengeId, shot.spot, shot.calls, timing);
      const ls = legsFor(shot.spot, shot.calls, r.made || r.notNet, timing);
      setLegs(ls);
      setPhase('flying');
      fly.setValue(0);
      jump.setValue(0);
      Animated.timing(jump, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: false }).start();
      const total = ls.reduce((a, l) => a + l.ms, 0);
      Animated.timing(fly, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: false }).start();
      // The banner when the ball gets there: everything but the last leg.
      const landAt = total - (ls.length ? ls[ls.length - 1].ms : 0);
      later(() => {
        setBanner(bannerFor(r, timing));
        setPhase('result');
        if (r.made) buzz('success');
        if (r.highlight) {
          setToast(true);
          hype.setValue(0);
          Animated.timing(hype, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: false }).start();
          later(() => setToast(false), 2600);
        }
      }, landAt);
      setMsg(r.message);
      later(() => {
        setBanner(null);
        setLegs(null);
        fly.setValue(0);
        setPhase('aim');
        getHorseLive(challengeId)
          .then(setLive)
          .catch(() => {});
      }, total + 1600);
    } catch (e) {
      setPhase('aim');
      setLegs(null);
      Alert.alert('H-O-R-S-E', e instanceof Error ? e.message : 'Try again.');
      getHorseLive(challengeId)
        .then(setLive)
        .catch(() => {});
    }
  };

  if (!game || !live) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.top}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
        </View>
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  const myId = live.me ?? game.me ?? '';
  const themId = live.them?.id ?? game.players.find((p) => p.userId !== myId)?.userId ?? '';
  const mine = live.letters[myId] ?? 0;
  const theirs = live.letters[themId] ?? 0;
  const left = timeLeft(live.turn?.endsAt ?? null);
  const turnLine =
    live.status === 'final' ? 'Game over' : myTurn ? `Your turn${left ? ` · ${left} left` : ''}` : `${themName}’s turn${left ? ` · ${left} left` : ''}`;
  const title = live.status === 'final' ? 'H-O-R-S-E' : !myTurn ? `${themName}’s turn` : matching ? `Match ${themName}’s shot` : 'Set a shot';

  const actLabel =
    phase === 'meter'
      ? 'Release!'
      : busy
        ? '…'
        : !live.handsOn
          ? 'Your steps play this game day by day'
          : !myTurn || !live.canShoot
            ? live.reason || (live.status === 'final' ? 'This game is over.' : `${themName}’s turn.`)
            : spotLocked && far
              ? fresh?.locked || `A ${far.need / 1000}K day unlocks this spot`
              : matching
                ? live.turn && live.turn.shotsLeft > 1
                  ? 'Shoot (match it · 2 tries)'
                  : 'Shoot (match it)'
                : 'Shoot your call';
  const actOn = phase === 'meter' || (phase === 'aim' && canShoot);

  const houndPt = spotAt(shot.spot);
  const hs = scaleOf(shot.spot);
  const HS = 46 * kx;
  const back = shot.calls.includes('back');
  const held = handsOf(shot.spot, back);
  const lift = jump.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -10 * ky, 0] });
  const crowdLift = hype.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], outputRange: [0, -5, 0, -5, 0, -5, 0, -5, 0, -4, 0] });
  const visibleCalls = HORSE_CALLS.filter((c) => callFits(c.id, shot.spot));
  const word = live.word ?? game.word;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.body}>
        {/* The header: whose turn, and the tries steps have earned. */}
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              H-O-R-S-E · YOU VS {themName.toUpperCase()}
            </Text>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.turn} numberOfLines={1}>
                {turnLine}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.tries}>{live.tries}</Text>
            <Text style={styles.small}>tries ready</Text>
          </View>
        </View>

        <View style={styles.lettersRow} accessible accessibilityLabel={`You have ${mine} letters, ${themName} has ${theirs}`}>
          <Letters who="You" n={mine} word={word} styles={styles} />
          <View style={{ flex: 1 }} />
          <Letters who={themName} n={theirs} word={word} styles={styles} />
        </View>

        {/* The court: fixed, never scrolls away. */}
        <Pressable onPress={onCourtPress} style={[styles.court, { width: courtW, height: courtH }]} accessibilityLabel="The court: tap anywhere on the floor to shoot from there">
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: crowdLift }] }]} pointerEvents="none">
            <Crowd w={courtW} stand={v.stand} />
          </Animated.View>
          <CourtArt v={v} kx={kx} ky={ky} rim={rim} board={`YOU ${word.slice(0, mine) || '-'}  ${themName.toUpperCase().slice(0, 6)} ${word.slice(0, theirs) || '-'}`} />
          {obstacle && <Chair v={v} kx={kx} ky={ky} at={obstacle} />}
          {outside && <Outside kx={kx} ky={ky} />}

          {/* The far spots and the bench, as rings to tap (dashed while locked). */}
          {!outside &&
            (['stands', 'rafters'] as const).map((k) => {
              const f = FAR_AT[k];
              const on = shot.spot.kind === k;
              return <Ring key={k} x={f.x * kx} y={f.y * ky} sc={f.sc * kx} on={on} locked={!unlocked(k)} />;
            })}
          {!outside && <Ring x={P(v, BENCH.u, BENCH.v).x} y={P(v, BENCH.u, BENCH.v).y} sc={scaleOf({ kind: 'bench' }) * kx} on={shot.spot.kind === 'bench'} locked={false} />}
          {shot.spot.kind === 'floor' && <Ring x={houndPt.x} y={houndPt.y} sc={hs * kx} on locked={false} />}

          {ghost.map((d, i) => (
            <View key={i} pointerEvents="none" style={[styles.ghost, { left: d.x - 2.5, top: d.y - 2.5 }]} />
          ))}

          <Animated.View
            pointerEvents="none"
            style={[
              styles.fig,
              {
                width: HS,
                height: HS,
                left: houndPt.x - HS / 2,
                top: houndPt.y - HS,
                transformOrigin: '50% 100%',
                transform: [{ translateY: lift }, { scaleX: back ? -hs : hs }, { scaleY: hs }],
              },
            ]}
          >
            <View style={[styles.shadow, { width: HS * 0.6, left: HS * 0.2, height: HS * 0.12 }]} />
            <HoundArt
              rank="pup"
              mood="happy"
              size={HS}
              animate={false}
              coatId={look?.coatId}
              ears={look?.ears}
              tail={look?.tail}
              markings={look?.markings}
              neckId={look?.neckId}
              headId={look?.headId}
              faceId={look?.faceId}
              breedId={look?.breedId}
            />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.ball,
              { width: ballD, height: ballD, opacity: outside && phase === 'result' && banner?.good ? 0 : 1 },
              flight && (phase === 'flying' || phase === 'result')
                ? { transform: [{ translateX: flight.tx }, { translateY: flight.ty }] }
                : { transform: [{ translateX: held.x - ballD / 2 }, { translateY: held.y - ballD / 2 }] },
            ]}
          >
            <Basketball size={ballD} />
          </Animated.View>
          {!outside && <RimFront rim={rim} ky={ky} w={courtW} h={courtH} />}

          <Text style={[styles.chip, { left: 8 }]} numberOfLines={2}>
            {`${fresh?.spotName || spotName(shot.spot).replace(/^From the /, '').replace(/^From /, '').replace(', through the gym window', '').replace(/^./, (c) => c.toUpperCase())} · ${Math.round(fresh?.feet || feetOf(shot.spot))} ft`}
          </Text>
          <Text style={[styles.chip, { right: 8, color: '#ffd8b0' }]}>{starText(stars)}</Text>
          {banner && (
            <View pointerEvents="none" style={[styles.banner, { backgroundColor: banner.good ? '#ffd8b0' : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
          {toast && (
            <View pointerEvents="none" style={styles.toast}>
              <Text style={styles.toastText}>Posted to Talk ✓</Text>
            </View>
          )}
        </Pressable>

        {/* Only the options scroll. */}
        <ScrollView style={styles.options} contentContainerStyle={styles.optionsBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.callLine}>
            {matching ? `${themName} called: ` : myTurn ? 'Your call: ' : 'The call: '}
            {description}
          </Text>
          <View style={styles.chips}>
            {visibleCalls.map((c) => {
              const on = shot.calls.includes(c.id);
              const locked = matching || !myTurn || phase !== 'aim';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggleCall(c.id)}
                  disabled={locked}
                  style={[styles.callChip, on && styles.callChipOn, locked && !on && { opacity: 0.55 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: locked }}
                >
                  <Text style={[styles.callText, on && { color: '#161826' }]}>
                    {c.name} <Text style={[styles.callHint, on && { color: 'rgba(22,24,38,0.7)' }]}>{c.id === 'net' ? 'swish only' : `×${c.mult}`}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!matching && (
            <Text style={styles.small}>
              {CHAIN.filter((c) => shot.calls.includes(c)).length > 1 ? 'Calls chain in order: off the floor, off the scoreboard, off the glass. ' : ''}Tap anywhere on the floor to move your spot.
            </Text>
          )}

          <View style={{ gap: 2 }}>
            <Text style={styles.section}>BEYOND THE COURT · A BIG DAY UNLOCKS THEM FOR THE GAME</Text>
            <Text style={styles.small}>
              Today {formatSteps(live.steps)} · best day {formatSteps(Math.max(live.bestDay, live.steps))}
            </Text>
          </View>
          <View style={styles.farGrid}>
            {unlocks.map((u) => {
              const on = shot.spot.kind === u.kind;
              const shut = !u.unlocked;
              return (
                <Pressable
                  key={u.kind}
                  onPress={() => pickSpot({ kind: u.kind as HorseFarKind })}
                  style={[styles.farCard, on && styles.farCardOn, shut && !on && { opacity: 0.55 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: shut }}
                >
                  <Text style={[styles.farName, on && { color: '#161826' }]} numberOfLines={2}>
                    {u.name}
                  </Text>
                  <Text style={[styles.farSub, on && { color: 'rgba(22,24,38,0.75)' }]}>
                    {shut ? `🔒 a ${u.need / 1000}K day unlocks it` : `${u.feet || farOf(u.kind)?.feet || ''} ft · unlocked for this game`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {live.stakes && (
            <View style={styles.stakes}>
              <Text style={{ fontSize: 18 }}>🧁</Text>
              <Text style={styles.stakesText}>
                <Text style={{ fontFamily: font.headingSemibold }}>Stakes:</Text> the loser bakes the winner’s hound a {live.stakes.name}.
              </Text>
            </View>
          )}
          {live.last && (
            <Text style={styles.small}>
              Last shot: {live.last.by === myId ? 'you' : themName} {live.last.made ? 'made' : 'missed'} {live.last.description.replace(/\.$/, '').replace(/^From/, 'from')} {starText(live.last.stars)}
            </Text>
          )}
          <Text style={[styles.small, { textAlign: 'center', opacity: 0.7 }]}>Tries come from steps: 1 per 2,000.</Text>
        </ScrollView>

        {/* Pinned: the meter, Shoot and the message. */}
        <View style={styles.meter} accessibilityLabel={`Meter: the green is ${Math.round(w * 100)}% wide`}>
          <View style={[styles.band, { backgroundColor: '#e5484d', left: 0, width: '100%' }]} />
          <View style={[styles.band, { backgroundColor: '#e0a94f', left: `${Math.max(0, 0.5 - w) * 100}%`, width: `${Math.min(1, 2 * w) * 100}%` }]} />
          <View style={[styles.band, { backgroundColor: net ? '#a8c98a' : '#7fd39b', left: `${(0.5 - w / 2) * 100}%`, width: `${w * 100}%` }]} />
          <View style={[styles.band, { backgroundColor: '#3fb37f', left: `${(0.5 - w / 4) * 100}%`, width: `${(w / 2) * 100}%` }]} />
          <Text style={[styles.meterWord, { left: 10 }]}>SHORT</Text>
          <Text style={[styles.meterWord, { right: 10 }]}>LONG</Text>
          {phase === 'meter' ? (
            <Animated.View style={[styles.marker, { left: meter.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          ) : lastM != null ? (
            <View style={[styles.marker, { left: `${lastM * 100}%`, borderColor: '#ffd8b0' }]} />
          ) : null}
        </View>
        <Pressable
          onPress={act}
          disabled={!actOn}
          style={[styles.act, actOn ? { backgroundColor: phase === 'meter' ? '#f08a24' : colors.green } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !actOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]} numberOfLines={2}>
            {actLabel}
          </Text>
        </Pressable>
        <Text style={styles.msg} numberOfLines={3}>
          {msg}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Letters({ who, n, word, styles }: { who: string; n: number; word: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.letters}>
      <Text style={styles.who} numberOfLines={1}>
        {who}
      </Text>
      {word.split('').map((l, i) => (
        <View key={i} style={[styles.letter, i < n && styles.letterOn]}>
          <Text style={[styles.letterText, i < n && { color: '#fff' }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function Ring({ x, y, sc, on, locked }: { x: number; y: number; sc: number; on: boolean; locked: boolean }) {
  const w = 18 * sc;
  const h = 7 * sc;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: 999,
        borderWidth: 2,
        borderStyle: locked ? 'dashed' : 'solid',
        borderColor: on ? '#ffd8b0' : locked ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)',
        backgroundColor: on ? '#f08a24' : locked ? 'transparent' : 'rgba(255,255,255,0.18)',
      }}
    />
  );
}

const Crowd = React.memo(function Crowd({ w, stand }: { w: number; stand: number }) {
  const dots = useMemo(() => crowdDots(w, stand * 0.82, false), [w, stand]);
  return (
    <Svg width={w} height={stand} style={StyleSheet.absoluteFill}>
      {dots.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y + stand * 0.12} r={3.4} fill={d.c} opacity={0.55} />
      ))}
    </Svg>
  );
});

// The floor and its lines, the stand behind the baseline, the scoreboard
// with both players' letters, the backboard and the back of the rim, the
// bench, a cooler and the ball rack.
const CourtArt = React.memo(function CourtArt({ v, kx, ky, rim, board }: { v: Perspective; kx: number; ky: number; rim: { x: number; y: number; rx: number; floorY: number }; board: string }) {
  const G2 = (pts: [number, number][], close = false) => groundPath(v, pts.map(([u, vv]) => [0.5 + u / 2, vv] as [number, number]), close);
  const arc: [number, number][] = [[-0.88, 0]];
  const T = Math.asin((0.88 * 25) / 23.75);
  for (let i = 0; i <= 40; i++) {
    const th = -T + (2 * T * i) / 40;
    arc.push([(23.75 * Math.sin(th)) / 25, BASKET_V + (23.75 * Math.cos(th)) / 47]);
  }
  arc.push([0.88, 0]);
  const ftc = Array.from({ length: 25 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / 24;
    return [0.24 * Math.sin(a), 0.4 + 0.128 * Math.cos(a)] as [number, number];
  });
  const center = Array.from({ length: 25 }, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / 24;
    return [0.24 * Math.sin(a), 1 - 0.128 * Math.cos(a)] as [number, number];
  });
  const planks = Array.from({ length: 15 }, (_, i) => G2([[i / 8 - 0.875, 0], [i / 8 - 0.875, 1.02]])).join(' ');
  const bench = G2([[1.07, 0.44], [1.2, 0.44], [1.2, 0.78], [1.07, 0.78]], true);
  const cooler = P(v, -1.14, 0.55);
  const rack = P(v, -0.86, 0.95);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={44 * ky} width={v.w} height={7 * ky} fill="#5a6585" />
      <Rect x={0} y={130 * ky} width={v.w} height={20 * ky} fill="#3a3f5c" />
      <Rect x={0} y={146 * ky} width={v.w} height={4 * ky} fill="#f08a24" />
      <Path d={G2([[-1.08, 0], [1.08, 0], [1.08, 1.03], [-1.08, 1.03]], true)} fill="#d9a066" />
      <Path d={planks} stroke="rgba(120,70,25,0.18)" strokeWidth={1} fill="none" />
      <Path d={G2([[-0.24, 0], [0.24, 0], [0.24, 0.4], [-0.24, 0.4]], true)} fill="rgba(142,111,209,0.55)" />
      <G stroke="#fff" strokeWidth={2} fill="none">
        <Path d={G2([[-1, 0], [1, 0], [1, 1], [-1, 1]], true)} />
        <Path d={G2([[-0.24, 0], [0.24, 0], [0.24, 0.4], [-0.24, 0.4]], true)} />
        <Path d={G2(ftc)} />
        <Path d={G2(arc)} />
        <Path d={G2(center)} />
      </G>
      <Path d={bench} fill="#a06c38" />
      <Rect x={cooler.x - 9 * kx} y={cooler.y - 16 * ky} width={18 * kx} height={16 * ky} rx={3} fill="#f08a24" />
      <Rect x={rack.x - 16 * kx} y={rack.y - 12 * ky} width={32 * kx} height={12 * ky} rx={3} fill="#4b4f66" />
      {[0, 1, 2, 3].map((i) => (
        <Circle key={i} cx={rack.x - 12 * kx + i * 8 * kx} cy={rack.y - 16 * ky} r={4 * kx} fill="#e07b28" />
      ))}
      {/* The scoreboard, hanging behind the basket. */}
      <Rect x={124 * kx} y={8 * ky} width={110 * kx} height={42 * ky} rx={6} fill="#0b0c14" stroke="#3a3f5c" strokeWidth={2} />
      <SvgText x={179 * kx} y={22 * ky} fill="#7fd39b" fontSize={8 * kx} fontWeight="800" textAnchor="middle">
        H-O-R-S-E
      </SvgText>
      <SvgText x={179 * kx} y={39 * ky} fill="#f0c24a" fontSize={10.5 * kx} fontWeight="900" textAnchor="middle">
        {board}
      </SvgText>
      {/* The backboard and its square, and the back of the rim. */}
      <Rect x={rim.x - 28 * kx} y={94 * ky} width={56 * kx} height={34 * ky} rx={3} fill="rgba(255,255,255,0.92)" stroke="#c9ccd8" strokeWidth={2} />
      <Rect x={rim.x - 10 * kx} y={106 * ky} width={20 * kx} height={14 * ky} fill="none" stroke="#f08a24" strokeWidth={2} />
      <Ellipse cx={rim.x} cy={rim.floorY} rx={rim.rx * 1.3} ry={rim.rx * 0.3} fill="rgba(0,0,0,0.14)" />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${rim.rx * 0.32} 0 0 1 ${rim.x + rim.rx} ${rim.y}`} stroke="#c0631c" strokeWidth={3} fill="none" />
    </Svg>
  );
});

// The net and the front of the rim, over the ball, so a make drops through.
function RimFront({ rim, ky, w, h }: { rim: { x: number; y: number; rx: number }; ky: number; w: number; h: number }) {
  const ry = rim.rx * 0.32;
  const net = 16 * ky;
  const strands = Array.from({ length: 7 }, (_, i) => {
    const f = i / 6;
    const x0 = rim.x - rim.rx + 2 * rim.rx * f;
    const x1 = rim.x - rim.rx * 0.6 + 1.2 * rim.rx * f;
    return `M ${x0.toFixed(1)} ${(rim.y + Math.sin(Math.PI * f) * ry).toFixed(1)} L ${x1.toFixed(1)} ${(rim.y + net).toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={strands} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} fill="none" />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${ry} 0 0 0 ${rim.x + rim.rx} ${rim.y}`} stroke="#f08a24" strokeWidth={3.5} fill="none" />
    </Svg>
  );
}

// Today's obstacle: a folding chair in the lane.
function Chair({ v, kx, ky, at }: { v: Perspective; kx: number; ky: number; at: { u: number; v: number } }) {
  const p = P(v, at.u, at.v);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: p.x - 9 * kx, top: p.y - 22 * ky, width: 18 * kx, height: 34 * ky, alignItems: 'center' }}>
      <Svg width={18 * kx} height={22 * ky}>
        <Rect x={kx} y={0} width={16 * kx} height={9 * ky} rx={3} fill="#6a7bb0" />
        <Rect x={0} y={10 * ky} width={18 * kx} height={4 * ky} rx={2} fill="#8796c9" />
        <Rect x={2 * kx} y={13 * ky} width={2 * kx} height={9 * ky} fill="#3b4466" />
        <Rect x={14 * kx} y={13 * ky} width={2 * kx} height={9 * ky} fill="#3b4466" />
      </Svg>
      <Text style={{ fontSize: 9, fontFamily: font.headingSemibold, color: '#3b4466', backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 6, paddingHorizontal: 4, overflow: 'hidden', marginTop: 1 }}>
        today
      </Text>
    </View>
  );
}

// Beyond the gym: the rooftop across the street, the lot, the billboard and
// the gym's lit window, for the two outside spots.
function Outside({ kx, ky }: { kx: number; ky: number }) {
  const X = (n: number) => n * kx;
  const Y = (n: number) => n * ky;
  return (
    <Svg width={X(BW)} height={Y(BH)} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={X(BW)} height={Y(BH)} fill="#f3c98e" />
      <Rect x={0} y={Y(140)} width={X(BW)} height={Y(300)} fill="#9cc3e3" opacity={0.75} />
      <Rect x={X(96)} y={Y(222)} width={X(40)} height={Y(140)} fill="rgba(70,80,120,0.35)" />
      <Rect x={X(138)} y={Y(250)} width={X(30)} height={Y(110)} fill="rgba(70,80,120,0.3)" />
      <Rect x={X(196)} y={Y(236)} width={X(36)} height={Y(124)} fill="rgba(70,80,120,0.32)" />
      <Rect x={0} y={Y(262)} width={X(96)} height={Y(178)} fill="#3b3f58" />
      {Array.from({ length: 4 }, (_, c) =>
        Array.from({ length: 6 }, (_, r) => <Rect key={`${c}-${r}`} x={X(10 + c * 22)} y={Y(276 + r * 26)} width={X(10)} height={Y(14)} fill="rgba(255,233,176,0.55)" />),
      )}
      <Rect x={0} y={Y(256)} width={X(100)} height={Y(8)} fill="#2a2d40" />
      <Rect x={0} y={Y(360)} width={X(BW)} height={Y(34)} fill="#4b4f66" />
      {Array.from({ length: 10 }, (_, i) => (
        <Rect key={i} x={X(34 + i * 36)} y={Y(360)} width={X(2)} height={Y(34)} fill="rgba(255,255,255,0.6)" />
      ))}
      <Rect x={X(182)} y={Y(368)} width={X(40)} height={Y(18)} rx={5} fill="#e5484d" />
      <Rect x={0} y={Y(394)} width={X(BW)} height={Y(46)} fill="#2e3142" />
      {Array.from({ length: 10 }, (_, i) => (
        <Rect key={i} x={X(20 + i * 34)} y={Y(416)} width={X(14)} height={Y(3)} fill="#f0c24a" />
      ))}
      <Rect x={X(156)} y={Y(202)} width={X(6)} height={Y(160)} fill="#55607e" />
      <Rect x={X(108)} y={Y(150)} width={X(102)} height={Y(54)} rx={4} fill="#f2f2f6" stroke="#55607e" strokeWidth={3} />
      <SvgText x={X(159)} y={Y(174)} fill="#6b4ad6" fontSize={15 * kx} fontWeight="900" textAnchor="middle">
        HOUND
      </SvgText>
      <SvgText x={X(159)} y={Y(192)} fill="#161826" fontSize={8 * kx} fontWeight="800" textAnchor="middle">
        WALK MORE. SHOOT FARTHER.
      </SvgText>
      <Rect x={X(236)} y={Y(120)} width={X(122)} height={Y(240)} fill="#8a4b3a" />
      <Rect x={X(230)} y={Y(112)} width={X(128)} height={Y(12)} fill="#5a2f25" />
      <Rect x={X(262)} y={Y(132)} width={X(60)} height={Y(16)} rx={3} fill="#161826" />
      <SvgText x={X(292)} y={Y(144)} fill="#f0c24a" fontSize={10 * kx} fontWeight="900" textAnchor="middle">
        GYM
      </SvgText>
      <Rect x={X(262)} y={Y(172)} width={X(60)} height={Y(58)} fill="#ffe9b0" stroke="#5a2f25" strokeWidth={4} />
      <Rect x={X(282)} y={Y(182)} width={X(20)} height={Y(13)} fill="#fff" stroke="#c9ccd8" strokeWidth={1} />
      <Ellipse cx={X(292)} cy={Y(198)} rx={X(7)} ry={Y(2)} fill="none" stroke="#f08a24" strokeWidth={2} />
      <Rect x={X(276)} y={Y(330)} width={X(34)} height={Y(30)} fill="#3a2018" />
    </Svg>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { flex: 1, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8, gap: 7 },
    back: { paddingRight: 2, paddingBottom: 4 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8 },
    title: { fontFamily: font.headingSemibold, fontSize: 19, color: colors.text, flexShrink: 1 },
    turn: { fontFamily: font.headingSemibold, fontSize: 11.5, color: '#3fb37f', flexShrink: 1 },
    tries: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    small: { fontSize: 11.5, lineHeight: 16, color: withAlpha(colors.text, 0.65) },
    lettersRow: { flexDirection: 'row', alignItems: 'center' },
    letters: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    who: { fontFamily: font.headingSemibold, fontSize: 11.5, color: colors.text, maxWidth: 64, marginRight: 2 },
    letter: { width: 20, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.08) },
    letterOn: { backgroundColor: '#e5484d' },
    letterText: { fontFamily: font.headingSemibold, fontSize: 12, color: withAlpha(colors.text, 0.35) },
    court: { alignSelf: 'center', borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2033' },
    fig: { position: 'absolute' },
    shadow: { position: 'absolute', bottom: -2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)' },
    ball: { position: 'absolute', left: 0, top: 0 },
    ghost: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,216,176,0.9)' },
    chip: {
      position: 'absolute',
      top: 8,
      maxWidth: '48%',
      backgroundColor: 'rgba(15,17,28,0.82)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      fontSize: 11,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '40%', borderRadius: 14, paddingHorizontal: 15, paddingVertical: 9 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 19, color: '#161826' },
    toast: { position: 'absolute', alignSelf: 'center', bottom: 12, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(15,17,28,0.88)' },
    toastText: { fontFamily: font.headingSemibold, fontSize: 12, color: '#a6e3b8' },
    options: { flex: 1, minHeight: 60, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(colors.text, 0.1) },
    optionsBody: { gap: 8, paddingVertical: 6 },
    callLine: { fontFamily: font.headingSemibold, fontSize: 13, lineHeight: 18, color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    callChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.surface },
    callChipOn: { backgroundColor: '#ffd8b0' },
    callText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text },
    callHint: { fontSize: 12, color: withAlpha(colors.text, 0.65) },
    section: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.7, color: withAlpha(colors.text, 0.6) },
    farGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    farCard: { width: '48.5%', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    farCardOn: { backgroundColor: '#ffd8b0' },
    farName: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text },
    farSub: { fontSize: 11, color: withAlpha(colors.text, 0.7), marginTop: 1 },
    stakes: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(255,216,176,0.1)', borderWidth: 1, borderColor: 'rgba(255,216,176,0.35)' },
    stakesText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: colors.text },
    meter: { height: 30, borderRadius: 15, overflow: 'hidden', position: 'relative' },
    band: { position: 'absolute', top: 0, bottom: 0 },
    meterWord: { position: 'absolute', top: 8, fontSize: 11, fontFamily: font.headingSemibold, color: '#161826' },
    marker: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
    act: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
    msg: { fontSize: 12, lineHeight: 16, color: withAlpha(colors.text, 0.75), height: 48 },
  });
}
