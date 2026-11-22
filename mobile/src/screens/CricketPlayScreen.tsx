import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { crowdDots, groundPath, perspective, project, type Perspective } from '../components/perspective';
import { Batter, Figure } from './BaseballBatScreen';
import { COUNT_MS, COUNT_STEP, Countdown, TapMark } from '../components/baseballSwing';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import {
  bowlCricketBall,
  bowlToMe,
  getCricketHand,
  playCricketShot,
  type CricketBallKind,
  type CricketBowled,
  type CricketDelivery,
  type CricketHand,
  type CricketHandBall,
  type CricketShot,
} from '../challenges/cricketApi';
import { BoardLink } from '../components/BoardLink';

// Cricket, bat and bowl yourself (0234; mockup claude.ai/artifact/QUXJkAEQntumiEYV7kafn5).
// The ground seen from behind the bowler, down the pitch to the batter,
// like TV cricket, in perspective (perspective.ts): the pitch runs from
// the batter's stumps (far, along 0) to the bowler's (near, along 1), a
// line across it in half-widths of the stumps' line (|line| <= 0.28 hits
// them), and every point (the pitch, the creases, the stumps, the
// fielders, the batter, the ball) goes through project().
//
//   Batting   Bowl it, a quick 3-2-1 (the button's at the bottom: look
//             up), the run-up, and the ball comes down the pitch: a puff
//             where it pitches, then tap it as it reaches the bat. Where
//             you tap is the shot, when you tap is the timing: early to
//             the leg side, late to the off side. No tap leaves it.
//   Bowling   Pick pace, spin or a yorker, tap where it should pitch (the
//             lengths are marked), and let it go as the ring meets the
//             circle. The batter answers it at once.
// The server judges every ball; tonight's over uses them.

type Phase = 'ready' | 'waiting' | 'flight' | 'result' | 'aim' | 'ring';
type Pt = { x: number; y: number; s: number };

const RUNUP = 700;
const PW = 0.1; // the pitch's half-width on the ground, at |line| = 1
const ALONG0 = 0.1; // the batter's stumps on the ground
const ALONG1 = 0.82; // the pitch's length on the ground
const RING0 = 40;
const GOAL = 9;
const RING_MS = 950;
const LENGTH_H: Record<string, number> = { yorker: 3, full: 12, good: 20, short: 34 };
const BANDS = [
  { a: 0.02, b: 0.09, fill: '#b4aaf0', name: 'YORKER' },
  { a: 0.09, b: 0.22, fill: '#f0c24a', name: 'FULL' },
  { a: 0.22, b: 0.4, fill: '#7fd39b', name: 'GOOD LENGTH' },
  { a: 0.4, b: 0.66, fill: '#e05b5b', name: 'SHORT' },
];
const KINDS: { kind: CricketBallKind; name: string; sub: string }[] = [
  { kind: 'pace', name: 'Pace', sub: 'quick, bounces' },
  { kind: 'spin', name: 'Spin', sub: 'slow, turns' },
  { kind: 'yorker', name: 'Yorker', sub: 'at the toes' },
];
const FIELD: [number, number][] = [
  [0.18, 0.1],
  [0.82, 0.1],
  [0.08, 0.36],
  [0.92, 0.36],
  [0.22, 0.6],
  [0.78, 0.6],
  [0.64, 0.06],
];

function groundView(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.15, gap: h * 0.02, near: 0, botW: w * 1.6, a: 0.42, b: 0.6 });
}
// A point on the pitch (line across, along 0 far .. 1 near), lifted h px.
function P(v: Perspective, line: number, along: number, h = 0): Pt {
  const q = project(v, 0.5 + line * PW, ALONG0 + along * ALONG1);
  return { x: q.x, y: q.y - h * q.s, s: q.s };
}
// A screen point back onto the pitch.
function unproject(v: Perspective, x: number, y: number): { line: number; along: number } {
  const u = Math.max(0, Math.min(1, (y - v.y0) / (v.y1 - v.y0)));
  const Y = u / (v.b + u * (1 - v.b));
  const s = v.a + (1 - v.a) * u;
  const X = 0.5 + (x - v.w / 2) / (v.botW * s);
  return { line: (X - 0.5) / PW, along: (Y - ALONG0) / ALONG1 };
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// Where the ball is, t ms after release, for a delivery that pitches at
// `bounce` on `line` and turns by `turn` on the way to the bat.
function ballAt(v: Perspective, d: { line: number; bounce: number; turn: number; length: string; ms: number }, t: number): Pt & { r: number; ground: Pt } {
  const frac = Math.max(0.05, (0.92 - d.bounce) / 0.89);
  const tb = d.ms * frac;
  let line: number;
  let along: number;
  let h: number;
  if (t < tb) {
    const k = Math.max(0, t / tb);
    line = lerp(0.25, d.line, k);
    along = lerp(0.92, d.bounce, k);
    h = 46 * (1 - k) + 12 * Math.sin(Math.PI * k);
  } else {
    const k = Math.min(1.25, (t - tb) / Math.max(1, d.ms - tb));
    line = lerp(d.line, d.line + d.turn, Math.min(1, k));
    along = lerp(d.bounce, 0.03, k);
    h = (LENGTH_H[d.length] ?? 18) * Math.sin(Math.min(1, k) * (Math.PI / 2));
  }
  const p = P(v, line, along, h);
  return { ...p, r: 3 + 7 * p.s, ground: P(v, line, along) };
}

function bannerFor(o: string, how: string): { text: string; tone: 'gold' | 'good' | 'out' | 'plain' } {
  if (o === 'W') return { text: how === 'bowled' ? 'BOWLED!' : how === 'caught_behind' ? 'Caught behind!' : 'Caught!', tone: 'out' };
  if (o === '6') return { text: 'SIX!', tone: 'gold' };
  if (o === '4') return { text: 'FOUR!', tone: 'good' };
  if (o === '0') return { text: how === 'left' ? 'Left alone' : how === 'beaten' ? 'Beaten' : 'Dot ball', tone: 'plain' };
  return { text: o === '1' ? 'A single' : `${o} runs`, tone: 'plain' };
}

export function CricketPlayScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [hand, setHand] = useState<CricketHand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'gold' | 'good' | 'out' | 'plain' } | null>(null);
  const [balls, setBalls] = useState<CricketHandBall[]>([]);
  // Batting: the ball coming, and the shot.
  const [ball, setBall] = useState<{ d: CricketDelivery; start: number; rel: number; arrive: number } | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number; at: number } | null>(null);
  const [shot, setShot] = useState<(CricketShot & { at: number }) | null>(null);
  // Bowling: the kind, the aim, the ring and what happened.
  const [kind, setKind] = useState<CricketBallKind>('pace');
  const [aim, setAim] = useState<{ line: number; along: number } | null>(null);
  const [ringAt, setRingAt] = useState<number | null>(null);
  const [bowled, setBowled] = useState<(CricketBowled & { at: number; kind: CricketBallKind }) | null>(null);
  const [hive, setHive] = useState<{ line: number; along: number; c: string }[]>([]);
  const sent = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const h = await getCricketHand(challengeId);
      setHand(h);
      setBalls(h.balls);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the match.');
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

  const moving = phase !== 'ready' && phase !== 'aim' ? true : !!banner;
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

  useEffect(() => {
    if (!hand || msg) return;
    setMsg(
      hand.role === 'bat'
        ? `Tap Bowl it, look up for the 3-2-1, and watch where it pitches. Then tap the ball as it reaches your bat: where you tap is the shot, when you tap is the timing. Early pulls it to the leg side, late cuts it to the off side.`
        : hand.role === 'bowl'
          ? `Pick a ball, then tap where it should pitch: a good length on the stumps is the hardest to score off. A ring closes on your spot: tap again as it meets the circle.`
          : '',
    );
  }, [hand, msg]);

  const v = useMemo(() => (size.w > 0 ? groundView(size.w, size.h) : null), [size.w, size.h]);
  const zoneR = size.w * 0.06;

  // ── Batting ──
  const bowlIt = async () => {
    if (!hand || phase !== 'ready' || !hand.canPlay) return;
    setBanner(null);
    setShot(null);
    setTap(null);
    setPhase('waiting');
    try {
      const d = await bowlToMe(challengeId);
      const t = Date.now();
      sent.current = false;
      const rel = t + COUNT_MS + RUNUP;
      setBall({ d, start: t, rel, arrive: rel + d.ms });
      setNow(t);
      setPhase('flight');
      setMsg('Eyes up: watch where it pitches…');
    } catch (e) {
      setPhase('ready');
      Alert.alert('Cricket', e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  const sendShot = async (timing: number | null, miss: number | null) => {
    if (sent.current || !ball) return;
    sent.current = true;
    try {
      const s = await playCricketShot(challengeId, timing, miss);
      const at = Math.max(Date.now(), ball.arrive);
      setShot({ ...s, at });
      setPhase('result');
      const travel = s.outcome === '6' ? 1400 : 1000;
      later(() => {
        setBanner(bannerFor(s.outcome, s.how));
        if (s.outcome === '6' || s.outcome === '4') buzz('success');
        const feel = timing == null ? '' : ` (${Math.abs(Math.round(timing))} ms ${timing < 0 ? 'early' : 'late'}${miss != null ? `, ${miss <= 0.25 ? 'right on the ball' : `${miss.toFixed(1)} off the ball`}` : ''})`;
        setMsg(s.message + feel);
        setBalls(s.balls);
        setHand((h) => (h ? { ...h, ready: s.ready, taken: s.taken } : h));
      }, at - Date.now() + Math.min(500, travel));
      later(() => {
        setBanner(null);
        setBall(null);
        setShot(null);
        setTap(null);
        setPhase('ready');
        load();
      }, at - Date.now() + travel + 1300);
    } catch (e) {
      setBall(null);
      setPhase('ready');
      Alert.alert('Cricket', e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  // No tap by the time it's past the bat: left alone.
  useEffect(() => {
    if (hand?.role !== 'bat' || phase !== 'flight' || !ball || sent.current || tap) return;
    if (now > ball.arrive + 140) sendShot(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase]);

  // ── Bowling ──
  const ringR = ringAt != null ? Math.max(0, RING0 * (1 - (now - ringAt) / RING_MS)) : 0;
  const release = async (t: number) => {
    if (phase !== 'ring' || !aim || ringAt == null) return;
    const r = Math.max(0, RING0 * (1 - (t - ringAt) / RING_MS));
    const err = r <= 0 ? 1 : Math.min(1, Math.abs(r - GOAL) / 30);
    setPhase('waiting');
    setRingAt(null);
    buzz('light');
    try {
      const b = await bowlCricketBall(challengeId, kind, { line: aim.line, length: aim.along }, err);
      const at = Date.now();
      setBowled({ ...b, at, kind });
      setPhase('result');
      const ms = kind === 'spin' ? 960 : kind === 'pace' ? 640 : 620;
      later(() => {
        setBanner(bannerFor(b.outcome, b.how));
        if (b.outcome === 'W') buzz('success');
        setMsg(b.message);
        setBalls(b.balls);
        setHive((hv) => [...hv, { line: b.line, along: b.bounce, c: b.outcome === 'W' ? '#7fd39b' : b.outcome === '0' ? '#b4b6c2' : b.outcome === '4' || b.outcome === '6' ? '#e05b5b' : '#ffd27a' }]);
        setHand((h) => (h ? { ...h, ready: b.ready, taken: b.taken } : h));
      }, ms + 250);
      later(() => {
        setBanner(null);
        setBowled(null);
        setAim(null);
        setPhase('ready');
        load();
      }, ms + 1900);
    } catch (e) {
      setPhase('ready');
      setAim(null);
      Alert.alert('Cricket', e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };
  useEffect(() => {
    if (phase === 'ring' && ringAt != null && now - ringAt > RING_MS + 60) release(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase]);

  const onField = (x: number, y: number) => {
    if (!v || !hand) return;
    const t = Date.now();
    if (hand.role === 'bat') {
      if (phase !== 'flight' || !ball || sent.current || t < ball.rel) return;
      const c = ballAt(v, ball.d, ball.d.ms);
      const miss = Math.hypot(x - c.x, y - c.y) / zoneR;
      setTap({ x, y, at: t });
      buzz('light');
      sendShot(t - ball.arrive, miss);
      return;
    }
    if (hand.role === 'bowl') {
      if (phase === 'ring') {
        release(t);
        return;
      }
      if (phase !== 'ready' || !hand.canPlay) return;
      const g = unproject(v, x, y);
      if (g.along < 0.01 || g.along > 0.72 || Math.abs(g.line) > 1.2) {
        setMsg('Pitch it on the strip: tap the pitch between you and the batter.');
        return;
      }
      setBanner(null);
      setAim(g);
      setRingAt(t);
      setNow(t);
      setPhase('ring');
    }
  };

  if (!hand) {
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
  const bat = hand.role === 'bat';
  const counting = bat && phase === 'flight' && !!ball && now < ball.start + COUNT_MS;
  let ballPt: (Pt & { r: number; ground: Pt }) | null = null;
  let puff: { p: Pt; k: number } | null = null;
  let bowlerPose: 'set' | 'windup' | 'thrown' = 'set';
  let bowlerY = 0;
  let batK = 0;
  if (v && bat && ball) {
    const t = now - ball.rel;
    if (now >= ball.start + COUNT_MS && now < ball.rel) {
      const r = (now - ball.start - COUNT_MS) / RUNUP;
      bowlerPose = r > 0.6 ? 'windup' : 'set';
      bowlerY = (1 - r) * 40;
    } else if (t >= 0) bowlerPose = 'thrown';
    const frac = Math.max(0.05, (0.92 - ball.d.bounce) / 0.89);
    const tb = ball.d.ms * frac;
    if (t >= tb && t < tb + 500) puff = { p: P(v, ball.d.line, ball.d.bounce), k: (t - tb) / 500 };
    if (t >= 0 && !shot) ballPt = ballAt(v, ball.d, t);
    if (shot) {
      // After the shot: away to where it went.
      const k = Math.min(1, (now - shot.at) / (shot.outcome === '6' ? 1400 : 1000));
      const c = ballAt(v, ball.d, ball.d.ms);
      const how = shot.how;
      const dir = how === 'pulled' || how === 'flicked' ? 1 : how === 'cut' || how === 'driven' ? -1 : 0;
      const far = shot.outcome === '6' || shot.outcome === '4' ? 1 : shot.outcome === '2' ? 0.7 : 0.45;
      let tx = c.x + dir * v.w * 0.55 * far;
      let ty = c.y + (dir === 0 ? v.h * 0.55 * far : v.h * 0.12 * far);
      if (how === 'caught_behind' || how === 'beaten' || how === 'bowled' || how === 'left') {
        tx = c.x;
        ty = c.y - 18;
      }
      const lift = shot.outcome === '6' ? v.h * 0.4 : 20;
      if (k < 1) ballPt = { x: lerp(c.x, tx, k), y: lerp(c.y, ty, k) - lift * Math.sin(Math.PI * k), s: c.s, r: c.r + (shot.outcome === '6' ? 4 * Math.sin(Math.PI * k) : 0), ground: { x: lerp(c.x, tx, k), y: lerp(c.y, ty, k) + 4, s: c.s } };
      if (shot.timing != null && how !== 'beaten' && how !== 'bowled' && how !== 'left') batK = Math.min(1, (now - shot.at + 80) / 200);
    }
    if (tap && now - tap.at < 300) batK = Math.max(batK, Math.min(1, (now - tap.at) / 200));
  }
  if (v && !bat && bowled) {
    const ms = bowled.kind === 'spin' ? 960 : bowled.kind === 'pace' ? 640 : 620;
    const t = now - bowled.at;
    bowlerPose = t < 150 ? 'windup' : 'thrown';
    const d = { line: bowled.line, bounce: bowled.bounce, turn: bowled.turn, length: bowled.length, ms };
    if (t < ms + 250) ballPt = ballAt(v, d, t);
    const frac = Math.max(0.05, (0.92 - bowled.bounce) / 0.89);
    if (t >= ms * frac && t < ms * frac + 500) puff = { p: P(v, bowled.line, bowled.bounce), k: (t - ms * frac) / 500 };
    if (bowled.outcome !== '0' && bowled.how !== 'bowled' && t > ms - 80) batK = Math.min(1, (t - ms + 80) / 200);
  }
  if (!bat && phase === 'ring') bowlerPose = 'windup';

  const batterAt = v ? P(v, -0.55, 0.035) : null;
  const bowlerAt = v ? P(v, 0.45, 1.02) : null;
  const aimPt = v && aim ? P(v, aim.line, aim.along) : null;
  const near = phase === 'ring' && Math.abs(ringR - GOAL) <= 2.4;
  const busy = phase === 'waiting' || phase === 'flight' || phase === 'result';

  const label = bat
    ? phase === 'flight'
      ? counting
        ? 'Eyes on the pitch…'
        : 'Tap the ball at the bat'
      : busy
        ? '…'
        : hand.canPlay
          ? 'Bowl it'
          : hand.reason || 'No balls ready'
    : phase === 'ring'
      ? 'Let it go'
      : busy
        ? 'Here it goes…'
        : hand.canPlay
          ? 'Tap your spot on the pitch'
          : hand.reason || 'No balls ready';
  const on = bat ? phase === 'ready' && hand.canPlay : phase === 'ring';
  const runs = (b: CricketHandBall) => (b.outcome === 'W' ? 'W' : b.outcome === '0' ? '•' : b.outcome);
  const innings = hand.innings === 2 ? 'second innings' : 'first innings';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ paddingBottom: 4 }}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BoardLink challengeId={challengeId}>
              <Text style={styles.kicker} numberOfLines={1}>
                CRICKET{hand.overNo ? ` · OVER ${hand.overNo} OF ${hand.overs}` : ''} · {innings.toUpperCase()}
              </Text>
            </BoardLink>
            <Text style={styles.title}>{bat ? 'At the crease' : hand.role === 'bowl' ? 'Your over' : 'Today’s over'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.title}>
              {hand.score.runs}/{hand.score.wickets}
            </Text>
            <Text style={styles.small}>{hand.score.target ? `chasing ${hand.score.target}` : 'runs/wickets'}</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>BALLS READY</Text>
              <Text style={styles.bankValue}>{hand.ready}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {hand.steps.toLocaleString()} steps today{hand.nextAt != null ? ` · next at ${hand.nextAt.toLocaleString()}` : ' · all 6 earned'}
            </Text>
          </View>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#ffd8b0' }]} numberOfLines={1}>
                {hand.opponent ? `${hand.opponent.name.toUpperCase()} ${bat ? 'BOWLING' : 'BATTING'}` : 'THE OTHER SIDE'}
              </Text>
              <Text style={styles.bankValue}>{hand.opponent ? hand.opponent.steps.toLocaleString() : '–'}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {!hand.opponent ? '' : hand.opponent.steps > hand.steps ? 'More steps than you: tougher' : 'Fewer steps than you: you have the edge'}
            </Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && (
            <>
              <GroundArt v={v} bands={!bat && hand.role === 'bowl'} />
              <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                {hive.map((h, i) => {
                  const q = P(v, h.line, h.along);
                  return <Circle key={i} cx={q.x} cy={q.y} r={3.2} fill={h.c} stroke="#161826" strokeWidth={0.8} />;
                })}
                {/* The batter's stumps. */}
                {[-0.2, 0, 0.2].map((l) => {
                  const q = P(v, l, 0);
                  return <Line key={l} x1={q.x} y1={q.y} x2={q.x} y2={q.y - 30 * q.s} stroke="#f2e6c9" strokeWidth={2.4} />;
                })}
                {(() => {
                  const a = P(v, -0.22, 0, 30);
                  const b = P(v, 0.22, 0, 30);
                  const out = banner?.text === 'BOWLED!';
                  return out ? null : <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c9a06a" strokeWidth={2.4} />;
                })()}
                {puff && <Ellipse cx={puff.p.x} cy={puff.p.y} rx={(4 + 10 * puff.k) * puff.p.s * 1.4} ry={(1.5 + 3 * puff.k) * puff.p.s * 1.4} fill="#f2e6c9" opacity={0.85 * (1 - puff.k)} />}
                {aimPt && (phase === 'ring' || phase === 'waiting') && (
                  <>
                    <Ellipse cx={aimPt.x} cy={aimPt.y} rx={GOAL} ry={GOAL * 0.55} fill="rgba(255,210,122,0.3)" stroke="#ffd27a" strokeWidth={2} />
                    {phase === 'ring' && <Ellipse cx={aimPt.x} cy={aimPt.y} rx={ringR} ry={ringR * 0.55} fill="none" stroke={near ? '#7fd39b' : '#ffffff'} strokeWidth={2.5} />}
                  </>
                )}
              </Svg>
              {FIELD.map(([fx, fy], i) => {
                const q = project(v, fx, fy);
                return <Figure key={i} x={q.x} y={q.y} s={q.s * 0.55} color="#9184d9" pose={banner && (banner.text === 'Caught!') && i === 4 ? 'catch' : 'ready'} />;
              })}
              {(() => {
                const q = P(v, 0, -0.07);
                return <Figure x={q.x} y={q.y} s={q.s * 0.55} color="#3a3f5c" pose={banner?.text === 'Caught behind!' ? 'catch' : 'ready'} />;
              })()}
              {batterAt && (
                <Batter x={batterAt.x} y={batterAt.y} s={batterAt.s * 0.62} look={bat ? look : null} angle={-60 + 130 * batK} />
              )}
              {ballPt && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ballPt.x - ballPt.r, top: ballPt.y - ballPt.r }}>
                  <Svg width={ballPt.r * 2} height={ballPt.r * 2}>
                    <Circle cx={ballPt.r} cy={ballPt.r} r={ballPt.r - 0.5} fill="#c0392b" stroke="#ffffff" strokeWidth={0.8} />
                  </Svg>
                </View>
              )}
              {bowlerAt && <Figure x={bowlerAt.x} y={bowlerAt.y + bowlerY} s={bowlerAt.s * 1.15} color={bat ? '#e05b5b' : '#4f7be0'} pose={bowlerPose} />}
              {tap && now - tap.at < 900 && <TapMark x={tap.x} y={tap.y} />}
            </>
          )}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={(e) => onField(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            accessibilityRole="button"
            accessibilityLabel={bat ? 'Play the ball: tap it as it reaches the bat' : 'Tap your spot on the pitch, then let it go'}
          />
          <Text style={[styles.chip, { left: 10 }]} pointerEvents="none">
            {bat
              ? ball && now >= ball.rel
                ? `${ball.d.kind === 'pace' ? 'Pace' : ball.d.kind === 'spin' ? 'Spin' : 'Yorker'} · ${ball.d.mph} mph`
                : `${hand.opponent?.name ?? 'The bowler'} bowling`
              : phase === 'ring'
                ? 'Wait for the ring…'
                : `Keeper’s sign: ${KINDS.find((k) => k.kind === kind)?.name}`}
          </Text>
          {counting && ball && <Countdown n={Math.max(1, Math.ceil((ball.start + COUNT_MS - now) / COUNT_STEP))} />}
          {banner && (
            <View
              pointerEvents="none"
              style={[
                styles.banner,
                { backgroundColor: banner.tone === 'gold' ? '#f0c24a' : banner.tone === 'good' ? '#7fd39b' : banner.tone === 'out' ? (bat ? '#f2a3a3' : '#7fd39b') : '#e9e9ed' },
              ]}
            >
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <View style={styles.overRow}>
          <Text style={styles.small}>{bat ? 'Your balls today' : 'Your over'}</Text>
          {balls.map((b) => (
            <Text key={b.n} style={[styles.ballPill, b.outcome === 'W' ? (bat ? styles.pillBad : styles.pillGood) : b.outcome === '4' || b.outcome === '6' ? (bat ? styles.pillGood : styles.pillBad) : null]}>
              {runs(b)}
            </Text>
          ))}
        </View>
        <Text style={styles.msg}>{hand.role ? msg : hand.reason}</Text>
        <Text style={styles.small}>
          One ball per 1,000 steps, up to six a day. Tonight’s over uses them: {bat ? 'yours as you face them' : 'yours, unless the batter played their own'}.
        </Text>
      </ScrollView>

      <View style={styles.pinned}>
        {!bat && hand.role === 'bowl' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {KINDS.map((k) => {
              const sel = kind === k.kind;
              return (
                <Pressable key={k.kind} onPress={() => phase === 'ready' && setKind(k.kind)} style={[styles.kind, sel && styles.kindOn]} accessibilityRole="button" accessibilityState={{ selected: sel }}>
                  <Text style={[styles.kindName, sel && { color: '#ffd2a6' }]}>{k.name}</Text>
                  <Text style={styles.kindSub}>{k.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Pressable
          onPressIn={!bat && phase === 'ring' ? () => release(Date.now()) : undefined}
          onPress={bat ? bowlIt : undefined}
          disabled={!on}
          style={[styles.act, on ? { backgroundColor: bat ? colors.green : '#f08a24' } : busy && bat ? { backgroundColor: '#2a2c38' } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !on && { color: busy && bat ? '#ffd8b0' : withAlpha(colors.text, 0.6), fontSize: 14 }]}>{label}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// The ground from behind the bowler: the stand and the sight screen past
// the batter, the outfield and the rope, the pitch with its creases, and
// (bowling) the lengths marked on it.
const GroundArt = React.memo(function GroundArt({ v, bands }: { v: Perspective; bands: boolean }) {
  const crowd = useMemo(() => crowdDots(v.w, v.stand, false), [v.w, v.stand]);
  const strip = (l0: number, l1: number, a0: number, a1: number) =>
    groundPath(
      v,
      [
        [0.5 + l0 * PW, ALONG0 + a0 * ALONG1],
        [0.5 + l1 * PW, ALONG0 + a0 * ALONG1],
        [0.5 + l1 * PW, ALONG0 + a1 * ALONG1],
        [0.5 + l0 * PW, ALONG0 + a1 * ALONG1],
      ],
      true,
    );
  const rope = Array.from({ length: 41 }, (_, i): [number, number] => [0.5 + Math.cos((i / 40) * Math.PI * 2) * 0.62, 0.42 + Math.sin((i / 40) * Math.PI * 2) * 0.5]);
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={v.w} height={v.h} fill="#2c6238" />
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={2.4} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={v.w * 0.42} y={v.stand - 16} width={v.w * 0.16} height={16} fill="#f2f2f6" />
      <Rect x={0} y={v.stand - 2} width={v.w} height={v.y0 - v.stand + 2} fill="#2d5a3a" />
      <Path d={groundPath(v, [[0, 0], [1, 0], [1, 1], [0, 1]], true)} fill="#3b7f4a" />
      {[0.12, 0.3, 0.5, 0.72, 0.9].map((y, i) => (
        <Path key={i} d={groundPath(v, [[0, y], [1, y], [1, y + 0.08], [0, y + 0.08]], true)} fill="#357443" opacity={0.6} />
      ))}
      <Path d={groundPath(v, rope, true)} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.4} />
      <Path d={strip(-1, 1, -0.06, 1.06)} fill="#d8c48f" />
      {bands &&
        BANDS.map((b) => {
          const lab = P(v, 0.62, (b.a + b.b) / 2);
          return (
            <React.Fragment key={b.name}>
              <Path d={strip(-1, 1, b.a, b.b)} fill={b.fill} opacity={0.32} />
              <SvgText x={lab.x + 2} y={lab.y + 3} fontSize={9} fontWeight="bold" fill="#161826" opacity={0.75}>
                {b.name}
              </SvgText>
            </React.Fragment>
          );
        })}
      {[0.04, 0.96].map((a) => {
        const l = P(v, -1.6, a);
        const r = P(v, 1.6, a);
        return <Line key={a} x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke="#ffffff" strokeWidth={1.5} opacity={0.85} />;
      })}
      {(() => {
        const a = P(v, 0, 0.02);
        const b = P(v, 0, 0.98);
        return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={0.8} strokeDasharray="3 4" opacity={bands ? 0.55 : 0} />;
      })()}
      {[-0.2, 0, 0.2].map((l) => {
        const q = P(v, l, 1);
        return <Line key={l} x1={q.x} y1={q.y} x2={q.x} y2={q.y - 30 * q.s} stroke="#f2e6c9" strokeWidth={3} />;
      })}
    </Svg>
  );
});

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    fixed: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 8 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    banks: { flexDirection: 'row', gap: 8 },
    bank: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    bankTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6, flexShrink: 1 },
    bankValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    bankNote: { fontSize: 11, color: withAlpha(colors.text, 0.65), marginTop: 2 },
    field: { flex: 1, minHeight: 320, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    chip: {
      position: 'absolute',
      top: 10,
      backgroundColor: 'rgba(15,17,28,0.8)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '32%', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 22, color: '#161826' },
    scroll: { flexGrow: 0, height: 118, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    overRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    ballPill: {
      minWidth: 26,
      height: 26,
      borderRadius: 13,
      overflow: 'hidden',
      textAlign: 'center',
      lineHeight: 26,
      fontSize: 12,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.8),
      backgroundColor: colors.surface,
    },
    pillGood: { backgroundColor: '#7fd39b', color: '#161826' },
    pillBad: { backgroundColor: '#e05b5b', color: '#ffffff' },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 8 },
    kind: {
      flex: 1,
      minHeight: 50,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.text, 0.18),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    kindOn: { borderColor: '#f08a24', backgroundColor: withAlpha('#f08a24', 0.14) },
    kindName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    kindSub: { fontSize: 10.5, color: withAlpha(colors.text, 0.6) },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
