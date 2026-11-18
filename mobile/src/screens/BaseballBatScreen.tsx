import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { crowdDots, groundPath, perspective, project, type Perspective } from '../components/perspective';
import { HoundArt } from '../kennel/HoundArt';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { formatSteps, inningLabel, isLiveHit, LIVE_RESULT_SHORT, liveAtBatWhen, type BaseballPos, type BaseballZone } from '../challenges/baseball';
import {
  getBaseballGame,
  getBaseballLive,
  swingBaseball,
  throwBaseballPitch,
  type BaseballGame,
  type BaseballLive,
  type BaseballSwing,
  type BaseballThrown,
} from '../challenges/baseballApi';

// Baseball, pitch by pitch (0207), for a game made with "Take my own
// at-bats": your steps so far today earn the at-bats (one per 3,000, up
// to 3), and you take them here. Pitch: the other side's pitcher winds up
// (450 ms) and the ball comes in (a fastball in about 700 ms, quicker the
// more they've out-walked you; a changeup in a second, dropping). The
// timing bar runs EARLY → LATE and crosses the middle the moment the ball
// reaches the zone; Swing! sends how early or late you were, and no swing
// takes the pitch. The server calls every pitch and decides the at-bat;
// the game uses it the next time you come up in the batting order.
//
// The field is seen from behind home plate, facing the mound, drawn in
// perspective (perspective.ts) on the Baseball card's ground (560 × 400,
// home at the bottom middle, the fence a 300 arc from home): every point
// (the lines, the pitcher, the fielders, the hound at the plate, the
// ball) goes through project().

type Phase = 'ready' | 'waiting' | 'pitch' | 'result';
export type Pt = { x: number; y: number };
export type Key = { t: number; x: number; y: number; d: number };

export const W = 560;
export const H = 400;
export const HOME: Pt = { x: 280, y: 372 };
export const MOUND: Pt = { x: 280, y: 312 };
export const AT: Record<Exclude<BaseballPos, 'c' | 'p'>, Pt> = {
  '1b': { x: 380, y: 266 },
  '2b': { x: 326, y: 212 },
  ss: { x: 234, y: 212 },
  '3b': { x: 180, y: 266 },
  lf: { x: 177, y: 198 },
  cf: { x: 280, y: 162 },
  rf: { x: 383, y: 198 },
};
const BASES: Pt[] = [
  { x: 351, y: 301 },
  { x: 280, y: 231 },
  { x: 209, y: 301 },
];
// Where a hit lands, by how far it went and where it was hit.
const LANDS: Record<'single' | 'double' | 'triple' | 'home_run', Record<BaseballZone, Pt>> = {
  single: { left: { x: 190, y: 232 }, center: { x: 300, y: 196 }, right: { x: 372, y: 232 } },
  double: { left: { x: 214, y: 150 }, center: { x: 236, y: 122 }, right: { x: 346, y: 150 } },
  triple: { left: { x: 112, y: 172 }, center: { x: 330, y: 96 }, right: { x: 450, y: 172 } },
  home_run: { left: { x: 70, y: 66 }, center: { x: 280, y: 34 }, right: { x: 490, y: 66 } },
};
export const WINDUP_MS = 450;
export const TAKE_MS = 250; // no swing by then: you took it
export const BAR_MS = 500; // the timing bar, end to end
export const HS = 92; // the hound up close
export const FW = 40; // a figure's box up close
export const FH = 84;
export const BALL = 20; // the ball on the ground up close
export const PITCHER_COLOR = '#9184d9';

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function view(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.15, gap: h * 0.02, near: 0, botW: w * 3.2, a: 0.3, b: 0.3 });
}
export const P = (v: Perspective, p: Pt) => project(v, p.x / W, p.y / H);

// The ball's path as keyframes: up `hgt` px at the top of an arc.
export function arcKeys(keys: Key[], t0: number, a: Omit<Key, 't'>, b: Omit<Key, 't'>, hgt: number, ms: number, n = 14): number {
  for (let i = 1; i <= n; i++) {
    const p = i / n;
    keys.push({ t: t0 + ms * p, x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - hgt * 4 * p * (1 - p), d: lerp(a.d, b.d, p) });
  }
  return t0 + ms;
}

export function at(keys: Key[], t: number): Key {
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const f = (t - a.t) / Math.max(1, b.t - a.t);
      return { t, x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), d: lerp(a.d, b.d, f) };
    }
  }
  return keys[keys.length - 1];
}

// Where the ball goes after the pitch reaches the plate, from what the
// server called: into the catcher's mitt (a take or a whiff), foul, or
// out to the field (caught by the fielder for an out).
function afterKeys(v: Perspective, zone: Omit<Key, 't'>, s: BaseballSwing, timing: number | null): { keys: Key[]; landAt: number; catcher: string | null } {
  const keys: Key[] = [{ t: 0, ...zone }];
  // A take, a whiff, or a foul tip caught for strike three: into the mitt.
  if (s.call !== 'in_play' && !(s.call === 'foul' && !s.done)) {
    const end = arcKeys(keys, 0, zone, { x: zone.x - 4, y: v.h + 20, d: zone.d * 1.3 }, 0, 220, 4);
    return { keys, landAt: end, catcher: null };
  }
  const ground = (p: Pt, lift = 0) => {
    const q = P(v, p);
    return { x: q.x, y: q.y - lift * q.s, d: BALL * q.s };
  };
  if (s.call === 'foul') {
    const side = (timing ?? 0) < 0 ? -1 : 1;
    const end = arcKeys(keys, 0, zone, ground({ x: 280 + side * 330, y: 250 }, 0), v.h * 0.22, 850);
    return { keys, landAt: end, catcher: null };
  }
  const r = s.result;
  const aim: BaseballZone = r?.aim ?? 'center';
  const kind = r?.kind ?? 'single';
  if (kind === 'ground_out' || kind === 'fly_out') {
    const pos = (r?.fielderPos && r.fielderPos in AT ? r.fielderPos : aim === 'left' ? 'lf' : aim === 'right' ? 'rf' : 'cf') as keyof typeof AT;
    const fly = kind === 'fly_out';
    const target = ground(AT[pos], fly ? FH * 0.62 : 4);
    if (fly) {
      const end = arcKeys(keys, 0, zone, target, v.h * 0.3, 1250);
      return { keys, landAt: end, catcher: pos };
    }
    // A grounder: down into the dirt, then skipping out to the fielder.
    const bounce = ground({ x: lerp(HOME.x, AT[pos].x, 0.25), y: lerp(HOME.y, AT[pos].y, 0.25) });
    let t = arcKeys(keys, 0, zone, bounce, 6, 200, 4);
    t = arcKeys(keys, t, bounce, target, 10, 650, 8);
    return { keys, landAt: t, catcher: pos };
  }
  if (kind === 'home_run' || kind === 'single' || kind === 'double' || kind === 'triple') {
    const land = ground(LANDS[kind][aim]);
    // Kept on screen: the top of the arc stays under the stand.
    const hgt = kind === 'home_run' ? v.h * 0.3 : kind === 'single' ? v.h * 0.1 : v.h * 0.2;
    const ms = kind === 'home_run' ? 1400 : kind === 'single' ? 750 : 1050;
    let t = arcKeys(keys, 0, zone, land, hgt, ms);
    const landAt = t;
    if (kind !== 'home_run') {
      // One hop on, into the gap.
      const roll = ground({ x: LANDS[kind][aim].x + (aim === 'left' ? -18 : aim === 'right' ? 18 : 0), y: LANDS[kind][aim].y - 22 });
      t = arcKeys(keys, t, land, roll, 8, 300, 5);
    }
    return { keys, landAt, catcher: null };
  }
  // A walk or a strikeout ends on a pitch that was never in play.
  const end = arcKeys(keys, 0, zone, { x: zone.x, y: v.h + 20, d: zone.d }, 0, 220, 4);
  return { keys, landAt: end, catcher: null };
}

function bannerFor(s: BaseballSwing): { text: string; good: boolean } {
  switch (s.call) {
    case 'ball':
      return { text: s.done ? 'Ball four: walk' : 'Ball', good: true };
    case 'strike':
      return { text: s.done ? 'Strike three' : 'Called strike', good: false };
    case 'whiff':
      return { text: s.done ? 'Strike three, swinging' : 'Swing and a miss', good: false };
    case 'foul':
      return { text: s.done ? 'Foul tip: strike three' : 'Foul', good: false };
    default: {
      const k = s.result?.kind ?? 'single';
      if (k === 'home_run') return { text: 'Home run!', good: true };
      return { text: LIVE_RESULT_SHORT[k] ?? 'In play', good: isLiveHit(k) };
    }
  }
}

export function BaseballBatScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [game, setGame] = useState<BaseballGame | null>(null);
  const [live, setLive] = useState<BaseballLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [count, setCount] = useState({ balls: 0, strikes: 0 });
  const [abOpen, setAbOpen] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The pitch in the air, the swing, and what happened after.
  const [pitch, setPitch] = useState<{ p: BaseballThrown; startAt: number; releaseAt: number; arriveAt: number } | null>(null);
  const [swingAt, setSwingAt] = useState<number | null>(null);
  const [lastMark, setLastMark] = useState<number | null>(null);
  const [after, setAfter] = useState<{ keys: Key[]; startAt: number; landAt: number; catcher: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const sent = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const [g, l] = await Promise.all([getBaseballGame(challengeId), getBaseballLive(challengeId)]);
      setGame(g);
      setLive(l);
      if (l.open) {
        setCount({ balls: l.open.balls, strikes: l.open.strikes });
        setAbOpen(true);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the game.');
    }
  }, [challengeId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!user?.id) return;
    getMyEquippedCosmetics(user.id)
      .then((c) => setIconId(c.iconId))
      .catch(() => {});
  }, [user?.id]);
  const look = parseHoundAvatar(iconId);

  // A frame clock while anything's moving.
  const moving = phase === 'pitch' || phase === 'waiting' || phase === 'result';
  useEffect(() => {
    if (!moving) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [moving]);

  const v = useMemo(() => (size.w > 0 ? view(size.w, size.h) : null), [size.w, size.h]);
  const pitcherName = live?.pitcher?.name ?? null;
  const pressure = live?.pressure ?? 0;
  const bands = live?.bands ?? { barrel: 45, solid: 85, weak: 135, foul: 210 };

  useEffect(() => {
    if (!live || msg || !live.handsOn) return;
    const pw = live.power.strength > 0 ? ` Your workout power (×${live.power.pw.toFixed(2)}) helps the ball carry.` : '';
    setMsg(
      `Your steps give you at-bats. Tap Pitch, then Swing as the ball crosses the zone. ${
        pitcherName && pressure > 0
          ? `${pitcherName} walked more today, so the fastball is quicker.`
          : pitcherName
            ? `You've out-walked ${pitcherName} today: the fastball's as slow as it gets.`
            : ''
      }${pw}`,
    );
  }, [live, msg, pitcherName, pressure]);

  // Where things are on the field.
  const spots = useMemo(() => {
    if (!v) return null;
    const home = P(v, HOME);
    const mound = P(v, MOUND);
    const batter = P(v, { x: HOME.x - 38, y: HOME.y + 2 });
    const zone = { x: home.x, y: home.y - HS * home.s * 0.5, d: 22 };
    const hand = { x: mound.x + FW * 0.25 * mound.s, y: mound.y - FH * 0.78 * mound.s, d: 12 * mound.s };
    return { home, mound, batter, zone, hand };
  }, [v]);

  const finish = (s: BaseballSwing) => {
    setCount({ balls: s.balls, strikes: s.strikes });
    setMsg(s.message);
    setAbOpen(!s.done);
    setLive((l) => (l ? { ...l, ready: s.ready, waiting: s.waiting } : l));
  };

  // The swing (timing in ms against the ball reaching the zone), or a
  // take (null): the server calls it, then the ball goes where it went.
  const send = async (timing: number | null, p: NonNullable<typeof pitch>) => {
    if (sent.current || !v || !spots) return;
    sent.current = true;
    setPhase('waiting');
    try {
      const s = await swingBaseball(challengeId, timing);
      const start = Math.max(Date.now(), p.arriveAt);
      const zoneAt = { x: spots.zone.x + (p.p.inZone ? 0 : 26), y: spots.zone.y + (p.p.kind === 'changeup' ? 10 : 0), d: spots.zone.d };
      const a = afterKeys(v, zoneAt, s, timing);
      setAfter({ keys: a.keys, startAt: start, landAt: a.landAt, catcher: a.catcher });
      setPhase('result');
      const total = a.keys[a.keys.length - 1].t;
      later(() => {
        setBanner(bannerFor(s));
        if (s.call === 'in_play' && s.result && isLiveHit(s.result.kind)) buzz('success');
        finish(s);
      }, start - Date.now() + a.landAt);
      later(
        () => {
          setBanner(null);
          setPitch(null);
          setAfter(null);
          setSwingAt(null);
          if (s.done) setCount({ balls: 0, strikes: 0 });
          setPhase('ready');
          getBaseballLive(challengeId)
            .then(setLive)
            .catch(() => {});
        },
        start - Date.now() + Math.max(total, a.landAt) + (s.done ? 1700 : 1100),
      );
    } catch (e) {
      setPitch(null);
      setAfter(null);
      setSwingAt(null);
      setPhase('ready');
      Alert.alert('Baseball', e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  // No swing by the time the ball's past you: you took it.
  useEffect(() => {
    if (phase !== 'pitch' || !pitch || swingAt != null || sent.current) return;
    if (now > pitch.arriveAt + TAKE_MS) {
      setLastMark(null);
      send(null, pitch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, pitch, swingAt]);

  const canPitch = !!live && live.handsOn && (abOpen || (live.canBat && live.ready > 0));

  const act = async () => {
    if (!live || !v) return;
    if (phase === 'ready') {
      if (!canPitch) return;
      setBanner(null);
      setLastMark(null);
      setSwingAt(null);
      setAfter(null);
      setPhase('waiting');
      try {
        const p = await throwBaseballPitch(challengeId);
        setCount({ balls: p.balls, strikes: p.strikes });
        setAbOpen(true);
        const t = Date.now();
        sent.current = false;
        setPitch({ p, startAt: t, releaseAt: t + WINDUP_MS, arriveAt: t + WINDUP_MS + p.ms });
        setNow(t);
        setPhase('pitch');
        setMsg('Here it comes…');
      } catch (e) {
        setPhase('ready');
        Alert.alert('Baseball', e instanceof Error ? e.message : 'Try again.');
        load();
      }
      return;
    }
    if (phase !== 'pitch' || !pitch || swingAt != null || sent.current) return;
    const t = Date.now();
    if (t < pitch.releaseAt) return; // still winding up
    const timing = t - pitch.arriveAt;
    setSwingAt(t);
    setLastMark(clamp(0.5 + timing / BAR_MS, 0.02, 0.98));
    buzz('light');
    send(timing, pitch);
  };

  if (!live) {
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

  // ── This frame ──
  const winding = phase === 'pitch' && pitch != null && now < pitch.releaseAt;
  let ball: { x: number; y: number; d: number } | null = null;
  if (spots && pitch && !after && now >= pitch.releaseAt) {
    const p = Math.min(1.15, (now - pitch.releaseAt) / pitch.p.ms);
    ball = {
      x: lerp(spots.hand.x, spots.zone.x, p) + (pitch.p.inZone ? 0 : 26 * p),
      y: lerp(spots.hand.y, spots.zone.y, p) + (pitch.p.kind === 'changeup' ? 10 * p * p : 0),
      d: lerp(spots.hand.d, spots.zone.d, Math.min(1, p)),
    };
  } else if (after) {
    const k = at(after.keys, now - after.startAt);
    ball = { x: k.x, y: k.y, d: k.d };
  }
  const caught = !!after?.catcher && now - after.startAt >= after.landAt - 120 ? after.catcher : null;
  // The swing, then the follow-through held until the pitch is done.
  const batAngle = batAngleFor(swingAt, now);
  const liveMark = phase === 'pitch' && pitch && swingAt == null && !sent.current && now >= pitch.releaseAt;
  const mark = liveMark && pitch ? clamp(0.5 + (now - pitch.arriveAt) / BAR_MS, 0.02, 0.98) : lastMark;

  const busy = phase === 'waiting' || phase === 'result';
  const actLabel =
    phase === 'pitch'
      ? 'Swing!'
      : busy
        ? '…'
        : !live.handsOn
          ? 'Your walks play this game for you'
          : canPitch
            ? abOpen
              ? 'Next pitch'
              : 'Pitch'
            : live.reason || (live.nextAt != null ? `No at-bats ready: next at ${formatSteps(live.nextAt)}` : "That's all your at-bats today.");
  const actOn = phase === 'pitch' || (phase === 'ready' && canPitch);
  const pitchChip =
    pitch && (phase === 'pitch' || phase === 'waiting' || phase === 'result')
      ? `${pitch.p.kind === 'changeup' ? 'Changeup' : 'Fastball'} · ${pitch.p.mph}`
      : pitcherName
        ? `${pitcherName} on the mound`
        : 'On the mound';
  const innings = game?.innings ?? 9;

  // The bar: whiff at the ends, then foul, weak, solid and the barrel in
  // the middle, each the server's band (ms) either side of on time.
  const share = (ms: number) => clamp(ms / BAR_MS, 0, 0.5);
  const band = (ms: number, color: string) => (
    <View style={[styles.band, { backgroundColor: color, left: `${(0.5 - share(ms)) * 100}%`, width: `${2 * share(ms) * 100}%` }]} />
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              BASEBALL{live.inning ? ` · ${inningLabel(live.inning, innings).toUpperCase()}` : ''}
              {pitcherName ? ` · YOU VS ${pitcherName.toUpperCase()}` : ''}
            </Text>
            <Text style={styles.title}>Your at-bats</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`${count.balls} balls, ${count.strikes} strikes`}>
            <Text style={styles.title}>
              {count.balls}–{count.strikes}
            </Text>
            <Text style={styles.small}>balls–strikes</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>AT-BATS READY</Text>
              <Text style={styles.bankValue}>{live.ready}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {formatSteps(live.steps)} today
              {live.nextAt != null ? ` · next at ${live.nextAt.toLocaleString()}` : ` · all ${live.earned} earned`}
              {live.waiting > 0 ? ` · ${live.waiting} waiting` : ''}
            </Text>
          </View>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#ffd8b0' }]} numberOfLines={1}>
                {pitcherName ? `${pitcherName.toUpperCase()} PITCHING` : 'THE PITCHER'}
              </Text>
              <Text style={styles.bankValue}>{live.pitcher ? live.pitcher.steps.toLocaleString() : '–'}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {!live.pitcher ? 'Steps decide the speed' : pressure > 0 ? 'More steps: a quicker fastball' : 'Fewer steps than you: hittable'}
              {live.power.strength > 0 ? ` · your power ×${live.power.pw.toFixed(2)}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && spots && (
            <>
              <FieldArt v={v} />
              {(Object.keys(AT) as (keyof typeof AT)[]).map((pos) => {
                const q = P(v, AT[pos]);
                return <Figure key={pos} x={q.x} y={q.y} s={q.s} color={PITCHER_COLOR} pose={caught === pos ? 'catch' : 'ready'} />;
              })}
              <Figure x={spots.mound.x} y={spots.mound.y} s={spots.mound.s} color={PITCHER_COLOR} pose={winding ? 'windup' : pitch && phase === 'pitch' ? 'thrown' : 'set'} />
              {/* The strike zone over the plate. */}
              <View
                pointerEvents="none"
                style={[
                  styles.zone,
                  { left: spots.zone.x - HS * spots.home.s * 0.2, top: spots.zone.y - HS * spots.home.s * 0.22, width: HS * spots.home.s * 0.4, height: HS * spots.home.s * 0.44 },
                ]}
              />
              <Batter x={spots.batter.x} y={spots.batter.y} s={spots.batter.s} look={look} angle={batAngle} />
              {ball && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ball.x - ball.d / 2, top: ball.y - ball.d / 2 }}>
                  <BaseballBall size={Math.max(4, ball.d)} />
                </View>
              )}
            </>
          )}
          <Text style={[styles.chip, { left: 10 }]}>{pitchChip}</Text>
          {live.power.strength > 0 && <Text style={[styles.chip, { right: 10, color: '#ffd8b0' }]}>Power ×{live.power.pw.toFixed(2)}</Text>}
          {banner && (
            <View style={[styles.banner, { backgroundColor: banner.good ? '#ffd8b0' : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>

        <View
          style={styles.meter}
          accessibilityLabel={`Timing: on time is the middle; a barrel is within ${bands.barrel} milliseconds, a foul within ${bands.foul}`}
        >
          <View style={[styles.band, { backgroundColor: '#e5484d', left: 0, width: '100%' }]} />
          {band(bands.foul, '#e0a94f')}
          {band(bands.weak, '#bfe8cb')}
          {band(bands.solid, '#7fd39b')}
          {band(bands.barrel, '#3fb37f')}
          <Text style={[styles.meterWord, { left: 10 }]}>EARLY</Text>
          <Text style={[styles.meterWord, { right: 10 }]}>LATE</Text>
          {mark != null && <View style={[styles.marker, { left: `${mark * 100}%` }, !liveMark && { borderColor: '#ffd8b0' }]} />}
        </View>

        {/* A timing tap counts when the finger lands, not when it lifts: a tap is about a tenth of a second, and the marker crosses a third of the bar in that time near the middle (Steve, Nov 2026: every Hoops shot came up long). */}
        <Pressable
          onPressIn={phase === 'pitch' ? act : undefined}
          onPress={phase === 'pitch' ? undefined : act}
          disabled={!actOn}
          style={[styles.act, actOn ? { backgroundColor: phase === 'pitch' ? '#f08a24' : colors.green } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !actOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>{actLabel}</Text>
        </Pressable>
        <Text style={styles.msg}>{msg}</Text>

        {live.abs.length > 0 && (
          <View style={styles.today}>
            <Text style={styles.small}>Your at-bats:</Text>
            {live.abs.map((a) => (
              <Text key={`${a.day}-${a.n}`} style={[styles.pill, isLiveHit(a.result) && styles.pillHit]}>
                {LIVE_RESULT_SHORT[a.result] ?? a.result} · {liveAtBatWhen(a.used, a.inning)}
              </Text>
            ))}
          </View>
        )}
        {live.abs.some((a) => !a.used) && <Text style={styles.small}>The game uses each one the next time you come up in the order. At-bats you don’t take play for you.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

// The ball: white, with red seams.
export function BaseballBall({ size }: { size: number }) {
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={r} cy={r} r={r - 0.5} fill="#ffffff" stroke="#d9d9d9" strokeWidth={0.6} />
      {size >= 9 && (
        <>
          <Path d={`M ${r * 0.45} ${r * 0.35} Q ${r * 0.85} ${r} ${r * 0.45} ${r * 1.65}`} stroke="#e5484d" strokeWidth={Math.max(0.8, size / 18)} fill="none" />
          <Path d={`M ${r * 1.55} ${r * 0.35} Q ${r * 1.15} ${r} ${r * 1.55} ${r * 1.65}`} stroke="#e5484d" strokeWidth={Math.max(0.8, size / 18)} fill="none" />
        </>
      )}
    </Svg>
  );
}

// A fielder or the pitcher, standing on the ground at (x, y), sized by s.
// The pitcher winds up (arm back over the head), then throws (arm
// forward); a fielder puts the glove up to catch.
export function Figure({ x, y, s, color, pose }: { x: number; y: number; s: number; color: string; pose: 'ready' | 'catch' | 'set' | 'windup' | 'thrown' }) {
  const w = FW * s;
  const h = FH * s;
  const cx = FW / 2;
  const sh = FH * 0.4;
  const arms =
    pose === 'windup'
      ? [
          [cx - 10, sh + 2, cx - 16, sh + 16],
          [cx + 10, sh + 2, cx + 4, sh - 26],
        ]
      : pose === 'thrown'
        ? [
            [cx - 10, sh + 2, cx - 16, sh + 16],
            [cx + 10, sh + 2, cx + 18, sh + 18],
          ]
        : pose === 'catch'
          ? [
              [cx - 10, sh + 2, cx - 14, sh - 22],
              [cx + 10, sh + 2, cx + 14, sh - 22],
            ]
          : [
              [cx - 10, sh + 2, cx - 17, sh + 16],
              [cx + 10, sh + 2, cx + 17, sh + 16],
            ];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - w / 2, top: y - h, width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${FW} ${FH}`}>
        <Ellipse cx={cx} cy={FH - 3} rx={FW * 0.36} ry={4} fill="rgba(0,0,0,0.28)" />
        <Rect x={cx - 8} y={FH * 0.66} width={7} height={FH * 0.32} rx={3} fill="#e9e9ed" />
        <Rect x={cx + 1} y={FH * 0.66} width={7} height={FH * 0.32} rx={3} fill="#e9e9ed" />
        <Rect x={cx - 11} y={sh - 2} width={22} height={FH * 0.3} rx={7} fill={color} />
        {arms.map(([x1, y1, x2, y2], i) => (
          <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e7c39b" strokeWidth={5} strokeLinecap="round" />
        ))}
        <Circle cx={cx} cy={sh - 9} r={8} fill="#e7c39b" />
        <Path d={`M ${cx - 8.5} ${sh - 11} A 8.5 8.5 0 0 1 ${cx + 8.5} ${sh - 11} L ${cx + 12} ${sh - 10} Z`} fill={color} />
      </Svg>
    </View>
  );
}

// The bat's angle (0° points across the plate, negative turns it up).
// Seen from behind the plate, the batter loads with the bat up and back
// over the shoulder, away from the plate (−115°); the swing drops it
// behind them, brings it level across the plate (−360°, the contact) and
// follows through up toward the mound (−410°). Steve: the old swing,
// −70° to +15°, chopped the wrong way round.
export const BAT_REST = -115;
export function batAngleFor(swingAt: number | null, now: number): number {
  if (swingAt == null) return BAT_REST;
  const t = Math.max(0, Math.min(1, (now - swingAt) / 200));
  const e = 1 - Math.pow(1 - t, 3);
  return BAT_REST - 295 * e;
}

// Your hound at the plate, the bat over the shoulder, turning about the
// hands as batAngleFor says.
export function Batter({ x, y, s, look, angle }: { x: number; y: number; s: number; look: ReturnType<typeof parseHoundAvatar>; angle: number }) {
  const size = HS * s;
  const L = size * 0.78; // the bat
  const hands = { x: x + size * 0.28, y: y - size * 0.42 };
  return (
    <>
      <View pointerEvents="none" style={{ position: 'absolute', left: x - size / 2, top: y - size, width: size, height: size }}>
        <View style={[styles0.shadow, { width: size * 0.62, left: size * 0.19, height: size * 0.12 }]} />
        <HoundArt
          rank="pup"
          mood="happy"
          size={size}
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
      </View>
      {/* A box twice the bat's length, centred on the hands, turns; the
          bat fills its right half, so it turns about the hands. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: hands.x - L, top: hands.y - 4, width: 2 * L, height: 8, transform: [{ rotate: `${angle}deg` }] }}
      >
        <View style={[styles0.bat, { left: L, width: L, height: Math.max(5, size * 0.07), borderRadius: 4 }]} />
      </View>
    </>
  );
}

// The ballpark from behind the plate: the stand beyond the fence, the
// outfield in stripes, the infield dirt, the bases, the mound and the
// batter's boxes. Drawn once per size.
export const FieldArt = React.memo(function FieldArt({ v }: { v: Perspective }) {
  const path = (pts: [number, number][], close = true) => groundPath(v, pts.map(([x, y]) => [x / W, y / H] as [number, number]), close);
  const arc = (r: number, from: Pt, to: Pt, n = 28): [number, number][] => {
    const a0 = Math.atan2(from.y - HOME.y, from.x - HOME.x);
    const a1 = Math.atan2(to.y - HOME.y, to.x - HOME.x);
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [HOME.x + Math.cos(a) * r, HOME.y + Math.sin(a) * r];
    });
  };
  const FL = { x: 68, y: 160 };
  const FR = { x: 492, y: 160 };
  const fence = arc(300, FL, FR, 48);
  const crowd = useMemo(() => crowdDots(v.w, v.stand, false), [v.w, v.stand]);
  const wallH = 16;
  const top = fence.map(([x, y]) => {
    const q = project(v, x / W, y / H);
    return `${q.x.toFixed(1)},${(q.y - wallH * q.s).toFixed(1)}`;
  });
  const base = fence.map(([x, y]) => {
    const q = project(v, x / W, y / H);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  });
  const stripes = Array.from({ length: 12 }, (_, i) => 72 + i * 26);
  const ring = (c: Pt, rx: number, ry: number): [number, number][] =>
    Array.from({ length: 25 }, (_, i) => [c.x + Math.cos((i / 24) * Math.PI * 2) * rx, c.y + Math.sin((i / 24) * Math.PI * 2) * ry]);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <ClipPath id="fair">
          <Path d={path([[HOME.x, HOME.y], ...fence])} />
        </ClipPath>
      </Defs>
      <Rect x={0} y={0} width={v.w} height={v.h} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.25} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={2.3} fill={c.c} opacity={0.85} />
      ))}
      <Path d={path([[0, 0], [W, 0], [W, 140], ...[...fence].reverse(), [0, 140]])} fill="#3a4060" />
      <Path d={path([[0, 140], ...fence, [W, 140], [W, H], [0, H]])} fill="#357a45" />
      <Path d={path([[HOME.x, HOME.y], ...fence])} fill="#3e8a4f" />
      <G clipPath="url(#fair)">
        {stripes.map((y, i) => (i % 2 ? <Path key={y} d={path([[0, y], [W, y], [W, y + 26], [0, y + 26]])} fill="#357a45" opacity={0.55} /> : null))}
      </G>
      <Path d={path([[HOME.x, HOME.y], [160, 252], ...arc(170, { x: 160, y: 252 }, { x: 400, y: 252 }, 24)])} fill="#c9a273" />
      <Path d={path([[HOME.x, HOME.y], [BASES[0].x, BASES[0].y], [BASES[1].x, BASES[1].y], [BASES[2].x, BASES[2].y]])} fill="#3e8a4f" />
      <Path d={path([[HOME.x, HOME.y], [FL.x, FL.y]], false)} stroke="rgba(255,255,255,0.9)" strokeWidth={2} />
      <Path d={path([[HOME.x, HOME.y], [FR.x, FR.y]], false)} stroke="rgba(255,255,255,0.9)" strokeWidth={2} />
      <Path d={path(ring({ x: MOUND.x, y: MOUND.y + 4 }, 13, 11))} fill="#c9a273" />
      <Path d={path(ring({ x: HOME.x, y: HOME.y - 2 }, 26, 20))} fill="#c9a273" />
      {[-1, 1].map((side) => (
        <Path
          key={side}
          d={path([[HOME.x + side * 9, HOME.y - 12], [HOME.x + side * 22, HOME.y - 12], [HOME.x + side * 22, HOME.y + 10], [HOME.x + side * 9, HOME.y + 10]])}
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={1.5}
        />
      ))}
      {BASES.map((b, i) => (
        <Path key={i} d={path([[b.x, b.y - 7], [b.x + 7, b.y], [b.x, b.y + 7], [b.x - 7, b.y]])} fill="#ffffff" />
      ))}
      <Path d={path([[MOUND.x - 4, MOUND.y - 1], [MOUND.x + 4, MOUND.y - 1], [MOUND.x + 4, MOUND.y + 1], [MOUND.x - 4, MOUND.y + 1]])} fill="#ffffff" />
      <Path d={path([[HOME.x - 7, HOME.y - 4], [HOME.x + 7, HOME.y - 4], [HOME.x + 7, HOME.y + 2], [HOME.x, HOME.y + 8], [HOME.x - 7, HOME.y + 2]])} fill="#ffffff" />
      <Polygon points={[...base, ...[...top].reverse()].join(' ')} fill="#1f4e35" />
      <Path d={`M ${top.join(' L ')}`} fill="none" stroke="#ffd23f" strokeWidth={2.2} />
      {[FL, FR].map((f, i) => {
        const q = project(v, f.x / W, f.y / H);
        return <Line key={i} x1={q.x} y1={q.y} x2={q.x} y2={q.y - 60 * q.s} stroke="#ffd23f" strokeWidth={3} />;
      })}
    </Svg>
  );
});

const styles0 = StyleSheet.create({
  shadow: { position: 'absolute', bottom: -2, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)' },
  bat: { position: 'absolute', top: 1, backgroundColor: '#a8723f', borderWidth: 1, borderColor: '#6b3f1f' },
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
    field: { flex: 1, minHeight: 360, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    zone: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.75)', borderRadius: 4 },
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
    banner: { position: 'absolute', alignSelf: 'center', top: '30%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
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
    pillHit: { color: '#161826', backgroundColor: '#a6e3b8' },
  });
}
