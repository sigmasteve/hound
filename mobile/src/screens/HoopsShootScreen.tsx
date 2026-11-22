import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Basketball } from '../components/HoopsCourt';
import { crowdDots, groundPath, perspective, project, type Perspective } from '../components/perspective';
import { HoundArt } from '../kennel/HoundArt';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { HOOPS_SHOT_NAME, HOOPS_SHOT_POINTS, HOOPS_TEAM_COLOR, formatSteps, type HoopsShot } from '../challenges/hoops';
import {
  getHoops,
  getHoopsLive,
  takeHoopsShot,
  type HoopsGame,
  type HoopsLive,
  type HoopsLiveShot,
  type HoopsShotResult,
} from '../challenges/hoopsApi';
import { BoardLink } from '../components/BoardLink';

// Hoops, shot by shot (0206), for a game made with "Take my own shots":
// your steps so far today earn the shots, and you take them here. Pick a
// shot, Shoot starts the meter and the move (a drive goes to the rim, a
// mid-range pulls up at the elbow, a three steps back), Release! stops it.
// The green is the make zone and the dark green a swish; the more your
// defender out-walks you, the narrower it gets (the server's
// windows[kind]). The release decides the shot (0223): dark green 97%,
// green 80-95%, orange 10-25%, red 3%. The server rolls it and keeps it;
// it counts when the day is played overnight, with anything you didn't
// take.
//
// The court is seen from behind the shooter, facing the basket, drawn in
// perspective (perspective.ts): on the ground, x runs across (0 the left
// sideline) and y from the baseline (0) out to 32 ft (1). Everything on
// the floor goes through project(); the hoop stands on its spot under the
// basket but is drawn bigger than life so the rim reads on a phone.
// Replays stay on the sideline view (HoopsCourt).

type Phase = 'aim' | 'meter' | 'waiting' | 'flying' | 'result';
type Pt = { x: number; y: number };

const FEET = 32; // the ground's length, baseline to the near edge
const HOOP: Pt = { x: 0.5, y: 5.25 / FEET };
const HS = 78; // the hound up close
const DW = 46; // the defender's box up close
const DH = 92;
const MOVE_MS = 650;
const FLIGHT_MS = 900;
const N = 12;

// Where each shot starts, where its move takes you, and how much the
// defender follows: a drive goes round them to the rim, a mid-range is
// one dribble to the elbow, a three a step back as they close out.
const SHOTS: Record<HoopsShot, { from: Pt; via: Pt; to: Pt; follow: number; label: string; note: string; arc: number }> = {
  drive: { from: { x: 0.72, y: 0.72 }, via: { x: 0.82, y: 0.42 }, to: { x: 0.57, y: 0.24 }, follow: 0, label: 'Drive · right side', note: 'easy', arc: 0.13 },
  mid: { from: { x: 0.42, y: 0.8 }, via: { x: 0.39, y: 0.7 }, to: { x: 0.36, y: 0.6 }, follow: 0.35, label: 'Elbow jumper', note: 'fair', arc: 0.27 },
  three: { from: { x: 0.27, y: 0.86 }, via: { x: 0.255, y: 0.895 }, to: { x: 0.24, y: 0.93 }, follow: 0.55, label: 'Left wing three', note: 'hard', arc: 0.37 },
};
const KINDS: HoopsShot[] = ['drive', 'mid', 'three'];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const bez = (s: (typeof SHOTS)[HoopsShot], t: number): Pt => ({
  x: (1 - t) * (1 - t) * s.from.x + 2 * (1 - t) * t * s.via.x + t * t * s.to.x,
  y: (1 - t) * (1 - t) * s.from.y + 2 * (1 - t) * t * s.via.y + t * t * s.to.y,
});
// The defender: between the shot and the rim, following the move a bit.
const guardAt = (s: (typeof SHOTS)[HoopsShot], g: Pt): Pt => {
  const d0 = { x: s.from.x + (HOOP.x - s.from.x) * 0.3, y: s.from.y + (HOOP.y - s.from.y) * 0.3 };
  return { x: d0.x + (g.x - s.from.x) * s.follow, y: d0.y + (g.y - s.from.y) * s.follow };
};
// Easing.inOut(Easing.quad), backwards: when the move reaches v.
const timeOf = (v: number) => (v < 0.5 ? Math.sqrt(v / 2) : 1 - Math.sqrt((1 - v) / 2));

function view(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.28, gap: h * 0.07, near: h * 0.03, botW: w, a: 0.56, b: 0.75 });
}

function rimOf(v: Perspective) {
  const floor = project(v, HOOP.x, HOOP.y);
  const rx = v.w * 0.052;
  const y = floor.y - v.w * 0.16;
  return { x: floor.x, y, rx, ry: rx * 0.34, floorY: floor.y, net: rx * 1.35 };
}

type Key = { t: number; x: number; y: number; d: number };

// The ball's path after the release, as keyframes: the flight to the rim,
// then in (through the net) or out, and a putback if there is one.
function flightKeys(v: Perspective, start: { x: number; y: number; d: number }, kind: HoopsShot, r: HoopsShotResult, timing: number): { keys: Key[]; landAt: number; putbackAt: number | null } {
  const rim = rimOf(v);
  const ball = rim.rx * 1.1;
  const keys: Key[] = [];
  let t = 0;
  const arc = (a: { x: number; y: number; d: number }, b: { x: number; y: number; d: number }, hgt: number, ms: number) => {
    for (let i = 1; i <= N; i++) {
      const p = i / N;
      keys.push({ t: t + ms * p, x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - hgt * 4 * p * (1 - p), d: lerp(a.d, b.d, p) });
    }
    t += ms;
    return b;
  };
  const line = (b: { x: number; y: number; d: number }, ms: number) => {
    t += ms;
    keys.push({ t, ...b });
    return b;
  };
  keys.push({ t: 0, ...start });
  const side = timing < 0 ? -1 : 1;
  const rimC = { x: rim.x, y: rim.y - rim.ry * 0.4, d: ball };
  const through = () => {
    line({ x: rim.x, y: rim.y + rim.net, d: ball }, 240);
    line({ x: rim.x + rim.rx * 0.3, y: rim.floorY - ball * 0.2, d: ball }, 260);
  };
  const height = v.h * SHOTS[kind].arc;
  let at = start;
  if (r.made) {
    arc(start, rimC, r.dunk ? height * 0.35 : height, r.dunk ? FLIGHT_MS * 0.6 : FLIGHT_MS);
    const landAt = t;
    through();
    return { keys, landAt, putbackAt: null };
  }
  // Rims out (a good release that missed, as the server words it), short,
  // or long off the board.
  const end =
    rimsOut(r)
      ? { x: rim.x + side * rim.rx * 0.95, y: rim.y - 2, d: ball }
      : timing < 0
        ? { x: rim.x, y: rim.y + rim.rx * 0.9, d: ball }
        : { x: rim.x + side * rim.rx * 0.3, y: rim.y - v.w * 0.07, d: ball };
  at = arc(start, end, height, FLIGHT_MS);
  const landAt = t;
  const floor = { x: rim.x + side * rim.rx * 3, y: rim.floorY + v.h * 0.06, d: ball * 1.05 };
  at = arc(at, floor, v.h * 0.06, 420);
  if (!r.putback) {
    line({ x: floor.x + side * rim.rx, y: floor.y + 4, d: floor.d }, 300);
    return { keys, landAt, putbackAt: null };
  }
  // Your side's rebound, straight back up.
  at = arc(at, rimC, v.h * 0.1, 620);
  const putbackAt = t;
  if (r.putback.made) through();
  else arc(at, { x: rim.x - side * rim.rx * 3, y: rim.floorY + v.h * 0.05, d: ball }, v.h * 0.05, 420);
  return { keys, landAt, putbackAt };
}

function bannerFor(r: HoopsShotResult, timing: number): { text: string; good: boolean } {
  if (r.made) return { text: `${r.dunk ? 'Dunk!' : r.quality === 'swish' ? 'Swish!' : 'Good!'} +${r.pts}`, good: true };
  if (r.putback?.made) return { text: `Putback! +${r.putback.pts}`, good: true };
  return { text: rimsOut(r) ? 'Rims out' : timing < 0 ? 'Short' : 'Long', good: false };
}

// The server says "Rims out." for a miss on a swish or green release, and
// "Short." / "Long." otherwise; the court and banner match it.
function rimsOut(r: HoopsShotResult): boolean {
  return r.quality === 'swish' || r.quality === 'green';
}

function shotLine(s: HoopsLiveShot): string {
  const name = HOOPS_SHOT_NAME[s.kind];
  if (s.made) return `${s.dunk ? 'Dunk' : name} +${s.pts}${s.onFire ? ' 🔥' : ''}`;
  if (s.putback?.made) return `${name} · putback +${s.putback.pts}`;
  return `${name} · miss`;
}

export function HoopsShootScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [game, setGame] = useState<HoopsGame | null>(null);
  const [live, setLive] = useState<HoopsLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<HoopsShot>('three');
  const [phase, setPhase] = useState<Phase>('aim');
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [lastM, setLastM] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [houndFront, setHoundFront] = useState(true);
  const [ballKeys, setBallKeys] = useState<Key[] | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const g = await getHoops(challengeId);
      setGame(g);
      const l = g?.live ?? (await getHoopsLive(challengeId));
      setLive(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the game.');
    }
  }, [challengeId]);
  useEffect(() => {
    load();
  }, [load]);

  const me = game?.players.find((p) => p.userId === game.me) ?? null;
  const myTeam = me?.team ?? 'home';
  const look = parseHoundAvatar(me?.iconId ?? null);
  const defName = live?.defender?.name ?? null;
  const mine = live?.steps ?? 0;
  const theirs = live?.defender?.steps ?? 0;
  const pressure = Math.max(0, Math.min(0.5, (theirs - mine) / Math.max(theirs, mine, 1)));
  const win = live?.windows[kind] ?? 0.26;
  const shot = SHOTS[kind];

  useEffect(() => {
    if (!live || msg) return;
    if (!live.handsOn) return;
    setMsg(
      `Pick a shot, tap Shoot, then Release as the marker crosses the green. ${
        defName && pressure > 0
          ? `${defName} has more steps today, so the window is tighter.`
          : defName
            ? `You've out-walked ${defName} today: the window's as wide as it gets.`
            : 'Nobody guards you today: open looks.'
      } Any shots you don't take play for you tonight.`,
    );
  }, [live, msg, defName, pressure]);

  // The meter: a marker sweeping there and back about once a second.
  const meter = useRef(new Animated.Value(0)).current;
  const meterAt = useRef(0);
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  // The move (0 → 1), the jump at the release, and the ball after it.
  const move = useRef(new Animated.Value(0)).current;
  const moveAt = useRef(0);
  const jump = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = meter.addListener(({ value }) => {
      meterAt.current = value;
    });
    const b = move.addListener(({ value }) => {
      moveAt.current = value;
    });
    return () => {
      meter.removeListener(a);
      move.removeListener(b);
    };
  }, [meter, move]);

  const v = useMemo(() => (size.w > 0 ? view(size.w, size.h) : null), [size.w, size.h]);
  const rim = v ? rimOf(v) : null;
  const ballMax = rim ? rim.rx * 1.6 : 24;

  // The figures along the move, sampled through project() so they shrink
  // with distance and stay on the drawn floor.
  const path = useMemo(() => {
    if (!v) return null;
    const ts = Array.from({ length: N + 1 }, (_, i) => i / N);
    const g = ts.map((t) => bez(shot, t));
    const p = g.map((q) => project(v, q.x, q.y));
    const d = g.map((q) => project(v, guardAt(shot, q).x, guardAt(shot, q).y));
    const r = rimOf(v);
    const ballD = r.rx * 1.25;
    // Does the move take you past the defender (further up the floor)?
    let cross: number | null = null;
    for (let i = 1; i <= N; i++) {
      if (g[i].y < guardAt(shot, g[i]).y && g[i - 1].y >= guardAt(shot, g[i - 1]).y) cross = ts[i];
    }
    return { ts, g, p, d, ballD, cross };
  }, [v, shot]);

  const anim = useMemo(() => {
    if (!path) return null;
    const { ts, p, d, ballD } = path;
    const iy = (out: number[]) => move.interpolate({ inputRange: ts, outputRange: out });
    const lift = jump.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -12, -18, -12, 0] });
    const defLift = jump.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, -8, -10, 0] });
    const bounce = move.interpolate({
      inputRange: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1],
      outputRange: [0, 9, 0, 9, 0, 9, 0],
    });
    return {
      hound: {
        tx: iy(p.map((q) => q.x - HS / 2)),
        ty: Animated.add(iy(p.map((q) => q.y - HS / 2 - (q.s * HS) / 2)), lift),
        k: iy(p.map((q) => q.s)),
      },
      def: {
        tx: iy(d.map((q) => q.x - DW / 2)),
        ty: Animated.add(iy(d.map((q) => q.y - DH / 2 - (q.s * DH) / 2)), defLift),
        k: iy(d.map((q) => q.s)),
      },
      held: {
        tx: iy(p.map((q) => q.x + 0.3 * HS * q.s - ballMax / 2)),
        ty: Animated.add(Animated.add(iy(p.map((q) => q.y - 0.4 * HS * q.s - ballMax / 2)), bounce), lift),
        k: iy(p.map((q) => (q.s * ballD) / ballMax)),
      },
    };
  }, [path, move, jump, ballMax]);

  const flight = useMemo(() => {
    if (!ballKeys || ballKeys.length < 2) return null;
    const total = ballKeys[ballKeys.length - 1].t;
    const ts = ballKeys.map((k) => k.t / total);
    const at = (out: number[]) => fly.interpolate({ inputRange: ts, outputRange: out });
    return {
      tx: at(ballKeys.map((k) => k.x - ballMax / 2)),
      ty: at(ballKeys.map((k) => k.y - ballMax / 2)),
      k: at(ballKeys.map((k) => k.d / ballMax)),
    };
  }, [ballKeys, fly, ballMax]);

  const canShoot = !!live && live.handsOn && live.canShoot && live.ready > 0;

  const reset = () => {
    move.setValue(0);
    jump.setValue(0);
    fly.setValue(0);
    setBallKeys(null);
    setHoundFront(true);
  };

  const act = async () => {
    if (!live || !v || !path) return;
    if (phase === 'aim') {
      if (!canShoot) return;
      setBanner(null);
      setLastM(null);
      reset();
      setPhase('meter');
      const who = defName ?? 'your defender';
      setMsg(
        kind === 'drive'
          ? `Driving past ${who}… release as the marker crosses the green.`
          : kind === 'mid'
            ? 'One dribble to the elbow, pull up… release in the green.'
            : `Step back for space, ${who} closes out… release in the green.`,
      );
      meter.setValue(0);
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(meter, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(meter, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ]),
      );
      loop.current.start();
      Animated.timing(move, { toValue: 1, duration: MOVE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
      if (path.cross != null) later(() => setHoundFront(false), MOVE_MS * timeOf(path.cross));
      return;
    }
    if (phase !== 'meter') return;
    loop.current?.stop();
    // Where the marker is now, from the animation itself.
    let m = meterAt.current;
    meter.stopAnimation((x) => {
      m = x;
    });
    const timing = m - 0.5;
    setLastM(m);
    buzz('light');
    setPhase('waiting');
    // Where the ball leaves your hands: wherever the move had got to.
    const t = Math.max(0, Math.min(1, moveAt.current));
    const i = Math.round(t * N);
    const q = path.p[i];
    const start = { x: q.x + 0.3 * HS * q.s, y: q.y - 0.4 * HS * q.s - 18, d: q.s * path.ballD };
    try {
      const r = await takeHoopsShot(challengeId, kind, timing);
      move.stopAnimation();
      const f = flightKeys(v, start, kind, r, timing);
      setBallKeys(f.keys);
      setPhase('flying');
      fly.setValue(0);
      Animated.timing(jump, { toValue: 1, duration: 420, easing: Easing.linear, useNativeDriver: false }).start();
      const total = f.keys[f.keys.length - 1].t;
      Animated.timing(fly, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: false }).start();
      const first = bannerFor({ ...r, putback: r.putback ? { made: false, pts: 0 } : null }, timing);
      later(() => {
        setBanner(r.putback ? { text: first.text === 'Long' || first.text === 'Short' ? `${first.text}… your rebound` : 'Rims out… your rebound', good: false } : first);
        setPhase('result');
        if (r.made) buzz('success');
      }, f.landAt);
      if (f.putbackAt != null) {
        later(() => {
          setBanner(bannerFor(r, timing));
          if (r.putback?.made) buzz('success');
        }, f.putbackAt);
      }
      setMsg(r.message);
      setLive((l) =>
        l
          ? {
              ...l,
              ready: r.ready,
              taken: l.taken + 1,
              todayPts: r.todayPts,
              shots: l.shots.concat([{ n: r.n, kind: r.kind, quality: r.quality, made: r.made, pts: r.pts, dunk: r.dunk, onFire: r.onFire, putback: r.putback }]),
            }
          : l,
      );
      later(() => {
        setBanner(null);
        reset();
        setPhase('aim');
        getHoopsLive(challengeId)
          .then(setLive)
          .catch(() => {});
      }, total + 1300);
    } catch (e) {
      reset();
      setPhase('aim');
      setMsg('');
      Alert.alert('Hoops', e instanceof Error ? e.message : 'Try again.');
      getHoopsLive(challengeId)
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

  const busy = phase === 'waiting' || phase === 'flying' || phase === 'result';
  const actLabel =
    phase === 'meter'
      ? 'Release!'
      : busy
        ? '…'
        : !live.handsOn
          ? 'Your walks play this game for you'
          : !live.canShoot
            ? live.reason || 'No shots to take right now'
            : live.ready <= 0
              ? live.nextAt != null
                ? `No shots ready: next at ${formatSteps(live.nextAt)} steps`
                : "That's all your shots today."
              : 'Shoot';
  const actOn = phase === 'meter' || (phase === 'aim' && canShoot);
  const defColor = HOOPS_TEAM_COLOR[myTeam === 'home' ? 'away' : 'home'];
  const chip = phase === 'meter' || busy ? (kind === 'drive' ? `Past ${defName ?? 'them'}` : kind === 'mid' ? `${defName ?? 'Defender'} on you` : `${defName ?? 'Defender'} closing out`) : defName ? `${defName} guarding` : 'Open look';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BoardLink challengeId={challengeId}>
              <Text style={styles.kicker} numberOfLines={1}>
                HOOPS{live.label ? ` · ${live.label.toUpperCase()}` : ''}
                {defName ? ` · YOU VS ${defName.toUpperCase()}` : ''}
              </Text>
            </BoardLink>
            <Text style={styles.title}>Your shots</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.title}>{live.todayPts}</Text>
            <Text style={styles.small}>pts today</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>SHOTS READY</Text>
              <Text style={styles.bankValue}>{live.ready}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {formatSteps(live.steps)} steps today
              {live.nextAt != null ? ` · next at ${formatSteps(live.nextAt)}` : ` · all ${live.earned} earned`}
            </Text>
          </View>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#ffd8b0' }]} numberOfLines={1}>
                {defName ? `${defName.toUpperCase()} GUARDS` : 'NOBODY GUARDS'}
              </Text>
              <Text style={styles.bankValue}>{defName ? formatSteps(theirs) : '–'}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {!defName ? 'Open looks today' : pressure > 0 ? 'More steps: tighter window' : 'Fewer steps than you: full window'}
            </Text>
          </View>
        </View>

        <View style={styles.court} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && rim && anim && (
            <>
              <CourtArt v={v} />
              {!houndFront && <Hound anim={anim.hound} look={look} />}
              <Defender anim={anim.def} color={defColor} reach={18 + pressure * 20} />
              {houndFront && <Hound anim={anim.hound} look={look} />}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.ball,
                  { width: ballMax, height: ballMax },
                  flight && (phase === 'flying' || phase === 'result')
                    ? { transform: [{ translateX: flight.tx }, { translateY: flight.ty }, { scale: flight.k }] }
                    : { transform: [{ translateX: anim.held.tx }, { translateY: anim.held.ty }, { scale: anim.held.k }] },
                ]}
              >
                <Basketball size={ballMax} />
              </Animated.View>
              <RimFront v={v} />
            </>
          )}
          <Text style={[styles.chip, { left: 10 }]}>{shot.label}</Text>
          <Text style={[styles.chip, { right: 10, color: '#ffd8b0' }]}>{chip}</Text>
          {banner && (
            <View style={[styles.banner, { backgroundColor: banner.good ? '#ffd8b0' : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>

        <View style={styles.kinds}>
          {KINDS.map((k) => {
            const on = k === kind;
            const off = phase !== 'aim';
            return (
              <Pressable
                key={k}
                onPress={() => {
                  if (phase !== 'aim') return;
                  setKind(k);
                  setLastM(null);
                }}
                disabled={off}
                style={[styles.kind, on && styles.kindOn, off && !on && { opacity: 0.5 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: off }}
              >
                <Text style={styles.kindName}>{HOOPS_SHOT_NAME[k]}</Text>
                <Text style={styles.kindNote}>
                  {HOOPS_SHOT_POINTS[k]} · {SHOTS[k].note}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.meter} accessibilityLabel={`Meter: the green is ${Math.round(win * 100)}% wide`}>
          <View style={[styles.band, { backgroundColor: '#e5484d', left: 0, width: '100%' }]} />
          <View style={[styles.band, { backgroundColor: '#e0a94f', left: `${Math.max(0, 0.5 - win) * 100}%`, width: `${Math.min(1, 2 * win) * 100}%` }]} />
          <View style={[styles.band, { backgroundColor: '#7fd39b', left: `${(0.5 - win / 2) * 100}%`, width: `${win * 100}%` }]} />
          <View style={[styles.band, { backgroundColor: '#3fb37f', left: `${(0.5 - win / 4) * 100}%`, width: `${(win / 2) * 100}%` }]} />
          <Text style={[styles.meterWord, { left: 10 }]}>SHORT</Text>
          <Text style={[styles.meterWord, { right: 10 }]}>LONG</Text>
          {phase === 'meter' ? (
            <Animated.View style={[styles.marker, { left: meter.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          ) : lastM != null ? (
            <View style={[styles.marker, { left: `${lastM * 100}%`, borderColor: '#ffd8b0' }]} />
          ) : null}
        </View>

        {/* A timing tap counts when the finger lands, not when it lifts: a tap is about a tenth of a second, and the marker crosses a third of the bar in that time near the middle (Steve, Nov 2026: every Hoops shot came up long). */}
        <Pressable
          onPressIn={phase === 'meter' ? act : undefined}
          onPress={phase === 'meter' ? undefined : act}
          disabled={!actOn}
          style={[styles.act, actOn ? { backgroundColor: phase === 'meter' ? '#f08a24' : colors.green } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !actOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>{actLabel}</Text>
        </Pressable>
        <Text style={styles.msg}>{msg}</Text>

        {live.shots.length > 0 && (
          <View style={styles.today}>
            <Text style={styles.small}>Today, counted tonight:</Text>
            {live.shots.map((s) => (
              <Text key={s.n} style={[styles.pill, (s.made || s.putback?.made) && styles.pillMade]}>
                {shotLine(s)}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type Moving = { tx: Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition<number>; ty: Animated.AnimatedAddition<number>; k: Animated.AnimatedInterpolation<number> };

function Hound({ anim, look }: { anim: Moving; look: ReturnType<typeof parseHoundAvatar> }) {
  return (
    <Animated.View pointerEvents="none" style={[styles0.fig, { width: HS, height: HS, transform: [{ translateX: anim.tx }, { translateY: anim.ty }, { scale: anim.k }] }]}>
      <View style={[styles0.shadow, { width: HS * 0.62, left: HS * 0.19, height: HS * 0.12 }]} />
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
  );
}

// The defender: their team's jersey, arms up; longer arms the harder
// they're pressing.
function Defender({ anim, color, reach }: { anim: Moving; color: string; reach: number }) {
  const cx = DW / 2;
  const shoulder = DH * 0.4;
  return (
    <Animated.View pointerEvents="none" style={[styles0.fig, { width: DW, height: DH, transform: [{ translateX: anim.tx }, { translateY: anim.ty }, { scale: anim.k }] }]}>
      <Svg width={DW} height={DH}>
        <Ellipse cx={cx} cy={DH - 3} rx={DW * 0.36} ry={4} fill="rgba(0,0,0,0.28)" />
        <Rect x={cx - 9} y={DH * 0.68} width={7} height={DH * 0.3} rx={3} fill="#2b2f45" />
        <Rect x={cx + 2} y={DH * 0.68} width={7} height={DH * 0.3} rx={3} fill="#2b2f45" />
        <Rect x={cx - 12} y={DH * 0.58} width={24} height={DH * 0.16} rx={4} fill={color} opacity={0.8} />
        <Rect x={cx - 12} y={shoulder - 2} width={24} height={DH * 0.24} rx={7} fill={color} />
        <Line x1={cx - 10} y1={shoulder + 2} x2={cx - 15} y2={shoulder + 2 - reach} stroke="#e7c39b" strokeWidth={5} strokeLinecap="round" />
        <Line x1={cx + 10} y1={shoulder + 2} x2={cx + 15} y2={shoulder + 2 - reach} stroke="#e7c39b" strokeWidth={5} strokeLinecap="round" />
        <Circle cx={cx} cy={shoulder - 9} r={8.5} fill="#e7c39b" />
      </Svg>
    </Animated.View>
  );
}

// The floor from behind the shooter, the stand behind the basket, and the
// hoop's back half: drawn once per size.
const CourtArt = React.memo(function CourtArt({ v }: { v: Perspective }) {
  const rim = rimOf(v);
  const crowd = useMemo(() => crowdDots(v.w, v.stand, false), [v.w, v.stand]);
  const X = (ft: number) => 0.5 + ft / 50; // feet from the middle → share across
  const Y = (ft: number) => ft / FEET; // feet from the baseline
  const planks = Array.from({ length: 15 }, (_, i) => groundPath(v, [[(i + 1) / 16, 0], [(i + 1) / 16, 1]])).join(' ');
  const T = Math.asin(22 / 23.75);
  const arc = Array.from({ length: 41 }, (_, i) => {
    const t = -T + (2 * T * i) / 40;
    return [X(23.75 * Math.sin(t)), HOOP.y + Y(23.75 * Math.cos(t))] as [number, number];
  });
  const ft = Array.from({ length: 25 }, (_, i) => {
    const t = (Math.PI * i) / 24;
    return [X(6 * Math.cos(t)), Y(19) + Y(6 * Math.sin(t))] as [number, number];
  });
  const key: [number, number][] = [
    [X(-8), 0],
    [X(8), 0],
    [X(8), Y(19)],
    [X(-8), Y(19)],
  ];
  const board = { w: v.w * 0.25, h: v.w * 0.165 };
  const boardTop = rim.y + 4 - board.h;
  const pole = project(v, 0.5, -0.07);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.2} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={2.3} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={0} y={v.stand} width={v.w / 2} height={v.h * 0.012} fill={HOOPS_TEAM_COLOR.home} />
      <Rect x={v.w / 2} y={v.stand} width={v.w / 2} height={v.h * 0.012} fill={HOOPS_TEAM_COLOR.away} />
      <Rect x={0} y={v.stand + v.h * 0.012} width={v.w} height={v.h} fill="#8a5a30" />
      <Path d={groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true)} fill="#d9a466" />
      <Path d={planks} stroke="#c48d52" strokeWidth={1} fill="none" />
      <Path d={groundPath(v, key, true)} fill="rgba(145,132,217,0.7)" />
      <G stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none">
        <Path d={groundPath(v, [[0, 0], [1, 0]])} />
        <Path d={groundPath(v, [[0, 0], [0, 1]])} />
        <Path d={groundPath(v, [[1, 0], [1, 1]])} />
        <Path d={groundPath(v, key)} />
        <Path d={groundPath(v, ft)} />
        <Path d={groundPath(v, [[X(-22), 0], [X(-22), HOOP.y + Y(23.75 * Math.cos(T))]])} />
        <Path d={groundPath(v, [[X(22), 0], [X(22), HOOP.y + Y(23.75 * Math.cos(T))]])} />
        <Path d={groundPath(v, arc)} strokeWidth={2.5} />
      </G>
      {/* The stanchion behind the baseline, the backboard and its square,
          and the back of the rim. */}
      <Rect x={pole.x - 4} y={boardTop + board.h - 6} width={8} height={pole.y - (boardTop + board.h - 6)} fill="#8a8fa5" />
      <Rect x={rim.x - board.w / 2} y={boardTop} width={board.w} height={board.h} rx={3} fill="rgba(255,255,255,0.92)" stroke="#d9dbe6" strokeWidth={2} />
      <Rect x={rim.x - board.w * 0.18} y={boardTop + board.h * 0.38} width={board.w * 0.36} height={board.h * 0.4} fill="none" stroke="#e5484d" strokeWidth={2} />
      <Ellipse cx={rim.x} cy={rim.floorY} rx={rim.rx * 1.2} ry={rim.rx * 0.3} fill="rgba(0,0,0,0.16)" />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${rim.ry} 0 0 1 ${rim.x + rim.rx} ${rim.y}`} stroke="#c0631c" strokeWidth={3} fill="none" />
    </Svg>
  );
});

// The net and the front of the rim, over the ball, so a make drops through.
const RimFront = React.memo(function RimFront({ v }: { v: Perspective }) {
  const rim = rimOf(v);
  const strands = Array.from({ length: 7 }, (_, i) => {
    const f = i / 6;
    const x0 = rim.x - rim.rx + 2 * rim.rx * f;
    const x1 = rim.x - rim.rx * 0.6 + 1.2 * rim.rx * f;
    return `M ${x0.toFixed(1)} ${(rim.y + Math.sin(Math.PI * f) * rim.ry).toFixed(1)} L ${x1.toFixed(1)} ${(rim.y + rim.net).toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={strands} stroke="rgba(255,255,255,0.8)" strokeWidth={1.2} fill="none" />
      <Path
        d={`M ${rim.x - rim.rx * 0.8} ${rim.y + rim.net * 0.45} L ${rim.x + rim.rx * 0.8} ${rim.y + rim.net * 0.45} M ${rim.x - rim.rx * 0.65} ${rim.y + rim.net * 0.8} L ${rim.x + rim.rx * 0.65} ${rim.y + rim.net * 0.8}`}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth={1}
      />
      <Path d={`M ${rim.x - rim.rx} ${rim.y} A ${rim.rx} ${rim.ry} 0 0 0 ${rim.x + rim.rx} ${rim.y}`} stroke="#f08a24" strokeWidth={3.5} fill="none" />
    </Svg>
  );
});

const styles0 = StyleSheet.create({
  fig: { position: 'absolute', left: 0, top: 0 },
  shadow: { position: 'absolute', bottom: -2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)' },
});

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 9 },
    back: { paddingRight: 2, paddingBottom: 4 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    banks: { flexDirection: 'row', gap: 8 },
    bank: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    bankTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6, flexShrink: 1 },
    bankValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    bankNote: { fontSize: 11, color: withAlpha(colors.text, 0.65), marginTop: 2 },
    court: { flex: 1, minHeight: 330, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    ball: { position: 'absolute', left: 0, top: 0 },
    chip: {
      position: 'absolute',
      top: 10,
      backgroundColor: 'rgba(15,17,28,0.78)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '44%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
    kinds: { flexDirection: 'row', gap: 6 },
    kind: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    kindOn: { borderWidth: 2, borderColor: '#f08a24', backgroundColor: 'rgba(240,138,36,0.16)' },
    kindName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    kindNote: { fontSize: 11, color: withAlpha(colors.text, 0.75) },
    meter: { height: 34, borderRadius: 17, overflow: 'hidden', position: 'relative' },
    band: { position: 'absolute', top: 0, bottom: 0 },
    meterWord: { position: 'absolute', top: 9, fontSize: 11, fontFamily: font.headingSemibold, color: '#161826' },
    marker: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
    act: { minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.72), minHeight: 36 },
    today: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pill: {
      fontSize: 12,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.75),
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    pillMade: { color: '#161826', backgroundColor: '#a6e3b8' },
  });
}
