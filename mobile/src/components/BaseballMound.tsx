import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '../offline/cache';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { crowdDots, groundPath, perspective, project, type Perspective } from './perspective';
import { BaseballBall } from '../screens/BaseballBatScreen';
import { PITCH_NAMES, zonePoint, type ZoneBox } from './baseballSwing';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { formatSteps, isLiveHit, LIVE_RESULT_SHORT, liveAtBatWhen } from '../challenges/baseball';
import { getBaseballMound, throwBaseballMound, type BaseballMound, type BaseballPitchKind, type BaseballThrowResult } from '../challenges/baseballApi';

// On the mound (0231; mockup claude.ai/artifact/HGso1dZWWMbsHBxMMfSxP5,
// board 2): you pitch an at-bat to the other side's next batter. Seen from
// behind the mound, facing home plate, in perspective (perspective.ts):
// the ground runs from the backstop (y 0) to the mound under you (y 1),
// and every point (the plate, the boxes, the batter, the catcher, the
// umpire, the ball) goes through project(). Pick the pitch, tap your spot
// in the zone (or just off it, for a chase), and a ring closes on the
// spot: tap again, or Let it go, as it meets the gold circle. Tight is on
// your spot; off and it drifts, maybe over the middle. The server has the
// batter answer it at once; the at-bat waits for them in the order.

const RING0 = 46;
const GOAL = 9;
const RING_MS = 950;
// How far off the circle counts as nowhere near (the server's 1).
const RING_SPAN = 36;
const FLIGHT: Record<BaseballPitchKind, number> = { fastball: 480, curveball: 650, changeup: 700 };
const KINDS: { kind: BaseballPitchKind; sub: string }[] = [
  { kind: 'fastball', sub: 'straight, quick' },
  { kind: 'curveball', sub: 'drops late' },
  { kind: 'changeup', sub: 'looks fast' },
];
const PLATE = { x: 0.5, y: 0.5 };
const OPP = '#e05b5b';
const ME = '#4f7be0';

type Phase = 'aim' | 'ring' | 'waiting' | 'flight' | 'done';

function moundView(w: number, h: number): Perspective {
  return perspective(w, h, { stand: h * 0.2, gap: h * 0.015, near: 0, botW: w * 2.2, a: 0.42, b: 0.62 });
}

export function BaseballMoundMode({ challengeId, onBusy }: { challengeId: string; onBusy: (b: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [m, setM] = useState<BaseballMound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<BaseballPitchKind>('fastball');
  const [phase, setPhase] = useState<Phase>('aim');
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const [ringAt, setRingAt] = useState<number | null>(null);
  const [res, setRes] = useState<(BaseballThrowResult & { at: number }) | null>(null);
  const [count, setCount] = useState({ balls: 0, strikes: 0 });
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [msg, setMsg] = useState(
    'Pick a pitch, then tap your spot in the zone. A ring closes on it: tap again as it meets the gold circle. Change speeds and spots: a batter who’s seen a pitch hits it better.',
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => onBusy(phase !== 'aim' && phase !== 'done'), [phase, onBusy]);

  const load = useCallback(async () => {
    try {
      const d = await getBaseballMound(challengeId);
      setM(d);
      if (d.open) setCount({ balls: d.open.balls, strikes: d.open.strikes });
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Could not load the mound.'));
    }
  }, [challengeId]);
  useEffect(() => {
    load();
  }, [load]);

  const moving = phase === 'ring' || phase === 'flight' || phase === 'waiting' || !!banner;
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

  const v = useMemo(() => (size.w > 0 ? moundView(size.w, size.h) : null), [size.w, size.h]);
  const spots = useMemo(() => {
    if (!v) return null;
    const plate = project(v, PLATE.x, PLATE.y);
    // The zone, big enough to aim at with a thumb, and everyone at the
    // plate sized to it: the batter about 4.4 zone half-heights tall, the
    // zone from their knees to their chest.
    const hh = v.h * 0.085;
    const hw = v.w * 0.095;
    const tall = hh * 4.4;
    const zb: ZoneBox = { x: plate.x, y: plate.y - tall * 0.5, hw, hh };
    // The plate as wide as the zone, in ground units at the plate.
    const gw = (hw * 0.85) / (v.botW * plate.s);
    const batter = project(v, 0.5 + gw * 3.2, PLATE.y + 0.005);
    const catcher = project(v, 0.5, PLATE.y - 0.025);
    const ump = project(v, 0.5, PLATE.y - 0.06);
    const hand = { x: v.w * 0.43, y: v.h * 0.8, d: 16 };
    return { plate, zb, batter, catcher, ump, hand, gw, tall, u: hh / 30 };
  }, [v]);

  const ringR = ringAt != null ? Math.max(0, RING0 * (1 - (now - ringAt) / RING_MS)) : 0;

  const release = useCallback(
    async (t: number) => {
      if (phase !== 'ring' || !aim || ringAt == null || !m) return;
      const r = Math.max(0, RING0 * (1 - (t - ringAt) / RING_MS));
      const err = r <= 0 ? 1 : Math.min(1, Math.abs(r - GOAL) / RING_SPAN);
      setPhase('waiting');
      setRingAt(null);
      buzz('light');
      try {
        const out = await throwBaseballMound(challengeId, kind, aim, err);
        const at0 = Date.now();
        setRes({ ...out, at: at0 });
        setPhase('flight');
        const fl = FLIGHT[out.kind] ?? 500;
        const outMs = out.result && out.call === 'in_play' ? 1200 : 300;
        later(() => {
          setCount({ balls: out.balls, strikes: out.strikes });
          setBanner(bannerFor(out));
          setMsg(`${PITCH_NAMES[out.kind]}, ${out.mph} mph, ${out.where}. ${out.message}`);
          if (out.done && (out.result?.kind === 'strikeout' || (out.call !== 'in_play' && out.strikes >= 3))) buzz('success');
        }, fl + outMs);
        later(
          () => {
            setBanner(null);
            setPhase(out.done ? 'done' : 'aim');
            if (out.done) setCount({ balls: 0, strikes: 0 });
            setRes(null);
            setAim(null);
            load();
          },
          fl + outMs + (out.done ? 1800 : 1200),
        );
      } catch (e) {
        setPhase('aim');
        setAim(null);
        Alert.alert('Baseball', e instanceof Error ? e.message : 'Try again.');
        load();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase, aim, ringAt, m, kind, challengeId],
  );

  // The ring ran out: let it go, nowhere near.
  useEffect(() => {
    if (phase === 'ring' && ringAt != null && now - ringAt > RING_MS + 60) release(now);
  }, [now, phase, ringAt, release]);

  const onField = (x: number, y: number) => {
    if (!spots || !m) return;
    if (phase === 'ring') {
      release(Date.now());
      return;
    }
    if (phase === 'done') {
      setPhase('aim');
      return;
    }
    if (phase !== 'aim' || !(m.canPitch || m.open)) return;
    const zx = (x - spots.zb.x) / spots.zb.hw;
    const zy = -(y - spots.zb.y) / spots.zb.hh;
    if (Math.abs(zx) > 1.7 || Math.abs(zy) > 1.7) {
      setMsg('Aim in the zone, or just off it to get a chase.');
      return;
    }
    setAim({ x: zx, y: zy });
    setRingAt(Date.now());
    setNow(Date.now());
    setPhase('ring');
  };

  if (!m) {
    return <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>;
  }

  const canThrow = m.canPitch || !!m.open;
  // ── This frame ──
  let ball: { x: number; y: number; d: number } | null = null;
  let swingK = 0;
  if (spots && res) {
    const fl = FLIGHT[res.kind] ?? 500;
    const k = (now - res.at) / fl;
    const end = zonePoint(spots.zb, res.px, res.py);
    const drop = res.kind === 'curveball' ? spots.zb.hh * 1.1 : res.kind === 'changeup' ? spots.zb.hh * 0.35 : 0;
    if (k < 1) {
      const f = Math.pow(k, 0.85);
      ball = { x: spots.hand.x + (end.x - spots.hand.x) * f, y: spots.hand.y + (end.y - drop - spots.hand.y) * f + drop * k * k * k - 30 * Math.sin(Math.PI * k), d: 16 - 10 * f };
    } else if (res.call === 'in_play') {
      // Hit: up and away, out over the stand.
      const h = Math.min(1, (k - 1) / 1.6);
      const side = res.result?.aim === 'left' ? -1 : res.result?.aim === 'right' ? 1 : 0;
      ball = { x: end.x + (side * 0.4 * v!.w + (end.x < v!.w / 2 ? -10 : 10)) * h, y: end.y - v!.h * 0.9 * h + v!.h * 0.4 * h * h, d: Math.max(3, 6 + 6 * Math.sin(Math.PI * h)) };
      if (h >= 1) ball = null;
    } else if (k < 1.6) {
      ball = { x: end.x, y: end.y, d: 6 };
    }
    if (res.swung) swingK = Math.max(0, Math.min(1, (now - res.at - fl * 0.82) / 180));
  }
  const mitt = spots
    ? res && (now - res.at) / (FLIGHT[res.kind] ?? 500) >= 1 && res.call !== 'in_play'
      ? zonePoint(spots.zb, res.px, res.py)
      : aim
        ? zonePoint(spots.zb, aim.x, aim.y)
        : { x: spots.zb.x + 6, y: spots.zb.y + spots.zb.hh * 0.5 }
    : null;
  const near = phase === 'ring' && Math.abs(ringR - GOAL) / RING_SPAN <= 0.08;

  const mainLabel =
    phase === 'ring'
      ? 'Let it go'
      : phase === 'waiting' || phase === 'flight'
        ? 'Here it goes…'
        : !canThrow
          ? m.reason || 'No at-bats ready'
          : phase === 'done'
            ? 'Next batter'
            : 'Tap your spot in the zone';
  const mainOn = phase === 'ring' || (phase === 'done' && canThrow);

  return (
    <>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              BASEBALL · ON THE MOUND{m.batter ? ` · ${m.batter.name.toUpperCase()} UP` : ''}
            </Text>
            <Text style={styles.title}>Pitch to them</Text>
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
              <Text style={styles.bankValue}>{m.ready}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {formatSteps(m.steps)} today · shared with batting{m.waiting > 0 ? ` · ${m.waiting} waiting` : ''}
            </Text>
          </View>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#ffd8b0' }]} numberOfLines={1}>
                {m.batter ? m.batter.name.toUpperCase() : 'THE BATTER'}
              </Text>
              <Text style={styles.bankValue}>{m.batter ? m.batter.steps.toLocaleString() : '–'}</Text>
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {!m.batter ? 'Their next batter' : m.batter.steps > m.steps ? 'More steps than you: hits better' : 'Fewer steps than you: you have the edge'}
            </Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && spots && (
            <>
              <MoundArt v={v} gw={spots.gw} />
              <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                {/* The umpire and the catcher behind the plate. */}
                <G>
                  <Ellipse cx={spots.ump.x} cy={spots.ump.y} rx={16 * spots.u * 0.9} ry={4 * spots.u * 0.9} fill="rgba(0,0,0,0.2)" />
                  <Rect x={spots.ump.x - 10 * spots.u * 0.9} y={spots.ump.y - 52 * spots.u * 0.9} width={20 * spots.u * 0.9} height={46 * spots.u * 0.9} rx={6 * spots.u * 0.9} fill="#2b2f45" />
                  <Circle cx={spots.ump.x} cy={spots.ump.y - 60 * spots.u * 0.9} r={9 * spots.u * 0.9} fill="#2b2f45" />
                </G>
                <G>
                  <Ellipse cx={spots.catcher.x} cy={spots.catcher.y + 2} rx={26 * spots.u} ry={6 * spots.u} fill="rgba(0,0,0,0.22)" />
                  <Ellipse cx={spots.catcher.x} cy={spots.catcher.y - 16 * spots.u} rx={20 * spots.u} ry={16 * spots.u} fill="#3a3f5c" />
                  <Circle cx={spots.catcher.x} cy={spots.catcher.y - 38 * spots.u} r={11 * spots.u} fill="#2b2f45" />
                </G>
                {mitt && <Circle cx={mitt.x} cy={mitt.y} r={8} fill="#7a4a2c" stroke="#5e3b26" strokeWidth={1} />}
                {/* The batter, in the right-hand box, the bat up. */}
                <Batter at={spots.batter} tall={spots.tall} swingK={swingK} />
                {/* The zone, a third each way. */}
                <Rect
                  x={spots.zb.x - spots.zb.hw}
                  y={spots.zb.y - spots.zb.hh}
                  width={spots.zb.hw * 2}
                  height={spots.zb.hh * 2}
                  fill="rgba(255,255,255,0.05)"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth={1.3}
                  strokeDasharray="5 4"
                />
                {[-1 / 3, 1 / 3].map((f) => (
                  <G key={f}>
                    <Line x1={spots.zb.x + f * 2 * spots.zb.hw} y1={spots.zb.y - spots.zb.hh} x2={spots.zb.x + f * 2 * spots.zb.hw} y2={spots.zb.y + spots.zb.hh} stroke="rgba(255,255,255,0.18)" />
                    <Line x1={spots.zb.x - spots.zb.hw} y1={spots.zb.y + f * 2 * spots.zb.hh} x2={spots.zb.x + spots.zb.hw} y2={spots.zb.y + f * 2 * spots.zb.hh} stroke="rgba(255,255,255,0.18)" />
                  </G>
                ))}
                {aim && (phase === 'ring' || phase === 'waiting' || phase === 'flight') && (
                  <G>
                    <Circle cx={zonePoint(spots.zb, aim.x, aim.y).x} cy={zonePoint(spots.zb, aim.x, aim.y).y} r={GOAL} fill="rgba(255,210,122,0.25)" stroke="#ffd27a" strokeWidth={2} />
                    {phase === 'ring' && (
                      <Circle cx={zonePoint(spots.zb, aim.x, aim.y).x} cy={zonePoint(spots.zb, aim.x, aim.y).y} r={ringR} fill="none" stroke={near ? '#7fd39b' : '#ffffff'} strokeWidth={2.5} />
                    )}
                  </G>
                )}
                {res && (now - res.at) / (FLIGHT[res.kind] ?? 500) >= 1 && (
                  <Circle cx={zonePoint(spots.zb, res.px, res.py).x} cy={zonePoint(spots.zb, res.px, res.py).y} r={4} fill="none" stroke="#ffffff" strokeWidth={1.5} />
                )}
                {/* You, from behind, the ball in your hand. */}
                <Me v={v} armUp={phase === 'ring'} thrown={phase === 'flight'} />
              </Svg>
              {ball && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ball.x - ball.d / 2, top: ball.y - ball.d / 2 }}>
                  <BaseballBall size={Math.max(3, ball.d)} />
                </View>
              )}
            </>
          )}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={(e) => onField(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            accessibilityRole="button"
            accessibilityLabel={phase === 'ring' ? 'Let it go' : 'Tap your spot in the zone'}
          />
          <Text style={[styles.chip, { left: 10 }]} pointerEvents="none">
            {res ? `${PITCH_NAMES[res.kind]} · ${res.mph} mph` : phase === 'ring' ? 'Wait for the ring…' : `Catcher’s sign: ${PITCH_NAMES[kind]}`}
          </Text>
          {banner && (
            <View pointerEvents="none" style={[styles.banner, { backgroundColor: banner.good ? '#a6e3b8' : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.msg}>{msg}</Text>
        {m.abs.length > 0 && (
          <View style={styles.today}>
            <Text style={styles.small}>You pitched:</Text>
            {m.abs.map((a) => (
              <Text key={a.n} style={[styles.pill, !isLiveHit(a.result) && a.result !== 'walk' && styles.pillGood]}>
                {a.batter}: {LIVE_RESULT_SHORT[a.result] ?? a.result} · {liveAtBatWhen(a.used, a.inning)}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.small}>Each at-bat you pitch waits for that batter and plays when they come up, unless they took their own.</Text>
      </ScrollView>

      <View style={styles.pinned}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {KINDS.map((k) => {
            const on = kind === k.kind;
            const again = m.open?.lastKind === k.kind;
            return (
              <Pressable
                key={k.kind}
                onPress={() => phase === 'aim' && setKind(k.kind)}
                style={[styles.kind, on && styles.kindOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.kindName, on && { color: '#ffd2a6' }]}>{PITCH_NAMES[k.kind]}</Text>
                <Text style={styles.kindSub} numberOfLines={1}>
                  {again ? 'again · ' : ''}
                  {k.sub}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPressIn={phase === 'ring' ? () => release(Date.now()) : undefined}
          onPress={phase === 'done' ? () => setPhase('aim') : undefined}
          disabled={!mainOn}
          style={[styles.act, mainOn ? { backgroundColor: '#f08a24' } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !mainOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>{mainLabel}</Text>
        </Pressable>
      </View>
    </>
  );
}

function bannerFor(r: BaseballThrowResult): { text: string; good: boolean } {
  switch (r.call) {
    case 'ball':
      return { text: r.done ? 'Ball four' : 'Ball', good: false };
    case 'strike':
      return { text: r.done ? 'Strike three, looking!' : 'Called strike', good: true };
    case 'whiff':
      return { text: r.done ? 'Strike three, swinging!' : 'Swing and a miss', good: true };
    case 'foul':
      return { text: r.done ? 'Foul tip: strike three' : 'Fouled off', good: true };
    default: {
      const k = r.result?.kind ?? 'single';
      if (k === 'ground_out' || k === 'fly_out') return { text: k === 'ground_out' ? 'Grounder: out' : 'Fly ball: out', good: true };
      return { text: k === 'home_run' ? 'They took you deep' : `${LIVE_RESULT_SHORT[k] ?? 'Hit'} off you`, good: false };
    }
  }
}

// The batter in the right-hand box: legs, body, the hound's head, the bat
// up over the shoulder, swinging round when swingK runs 0 → 1.
function Batter({ at, tall, swingK }: { at: { x: number; y: number; s: number }; tall: number; swingK: number }) {
  const u = tall / 100;
  const x = at.x;
  const y = at.y;
  const hands = { x: x - 14 * u, y: y - 58 * u };
  const ang = (-70 - 140 * swingK) * (Math.PI / 180);
  const L = 50 * u;
  return (
    <G>
      <Ellipse cx={x} cy={y} rx={22 * u} ry={5 * u} fill="rgba(0,0,0,0.22)" />
      <Rect x={x - 9 * u} y={y - 34 * u} width={7 * u} height={34 * u} rx={3 * u} fill="#e9e9ed" />
      <Rect x={x + 2 * u} y={y - 34 * u} width={7 * u} height={34 * u} rx={3 * u} fill="#e9e9ed" />
      <Ellipse cx={x} cy={y - 52 * u} rx={14 * u} ry={21 * u} fill={OPP} />
      <Circle cx={x} cy={y - 82 * u} r={12 * u} fill="#8a8f99" />
      <Path d={`M ${x - 12 * u} ${y - 84 * u} Q ${x} ${y - 100 * u} ${x + 12 * u} ${y - 84 * u} Z`} fill="#c2410c" />
      <Ellipse cx={x + 11 * u} cy={y - 86 * u} rx={3 * u} ry={7 * u} fill="#5d626c" />
      <Line x1={hands.x} y1={hands.y} x2={hands.x + Math.cos(ang) * L} y2={hands.y + Math.sin(ang) * L} stroke="#c9a06a" strokeWidth={5 * u} strokeLinecap="round" />
      <Circle cx={hands.x} cy={hands.y} r={5 * u} fill="#c2410c" />
    </G>
  );
}

// You on the mound, from behind: big, near the camera, lower left.
function Me({ v, armUp, thrown }: { v: Perspective; armUp: boolean; thrown: boolean }) {
  const u = v.h / 440;
  const x = v.w * 0.36;
  const y = v.h * 0.96;
  const arm = thrown ? { x: x + 10 * u, y: y - 30 * u } : armUp ? { x: x + 40 * u, y: y - 120 * u } : { x: x + 34 * u, y: y - 70 * u };
  return (
    <G>
      <Ellipse cx={x} cy={y + 30 * u} rx={40 * u} ry={52 * u} fill={ME} />
      <SvgText x={x} y={y + 22 * u} fontSize={20 * u} fontWeight="bold" fill="#ffffff" textAnchor="middle">
        7
      </SvgText>
      <Ellipse cx={x - 22 * u} cy={y - 60 * u} rx={7 * u} ry={15 * u} fill="#5e3b26" />
      <Ellipse cx={x + 22 * u} cy={y - 60 * u} rx={7 * u} ry={15 * u} fill="#5e3b26" />
      <Circle cx={x} cy={y - 56 * u} r={24 * u} fill="#c08a52" />
      <Path d={`M ${x - 24 * u} ${y - 60 * u} Q ${x} ${y - 88 * u} ${x + 24 * u} ${y - 60 * u} Z`} fill="#2f4fa0" />
      <Line x1={x + 26 * u} y1={y - 26 * u} x2={arm.x} y2={arm.y} stroke="#c08a52" strokeWidth={9 * u} strokeLinecap="round" />
    </G>
  );
}

// The view from the mound: the stand behind the backstop, the dirt round
// home plate and down to the mound, the plate and the boxes.
const MoundArt = React.memo(function MoundArt({ v, gw }: { v: Perspective; gw: number }) {
  const path = (pts: [number, number][], close = true) => groundPath(v, pts, close);
  const ring = (cx: number, cy: number, rx: number, ry: number): [number, number][] =>
    Array.from({ length: 33 }, (_, i) => [cx + Math.cos((i / 32) * Math.PI * 2) * rx, cy + Math.sin((i / 32) * Math.PI * 2) * ry]);
  const crowd = useMemo(() => crowdDots(v.w, v.stand, false), [v.w, v.stand]);
  const p = PLATE;
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={v.w} height={v.h} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={2.4} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={0} y={v.stand - 10} width={v.w} height={v.y0 - v.stand + 10} fill="#2d5a3a" />
      <SvgText x={v.w / 2} y={v.stand - 1} fontSize={9} fontWeight="bold" fill="#e9e9ed" textAnchor="middle" letterSpacing={1.5}>
        HOUND PARK
      </SvgText>
      <Path d={path([[0, 0], [1, 0], [1, 1], [0, 1]])} fill="#3e8a4f" />
      <Path d={path(ring(p.x, p.y, 0.2, 0.11))} fill="#c9a273" />
      <Path d={path([[0.45, p.y + 0.08], [0.55, p.y + 0.08], [0.6, 1], [0.4, 1]])} fill="#c9a273" />
      <Path d={path(ring(0.5, 1.02, 0.16, 0.08))} fill="#c9a273" />
      {[-1, 1].map((side) => (
        <Path
          key={side}
          d={path([
            [p.x + side * gw * 1.4, p.y - 0.03],
            [p.x + side * gw * 3.6, p.y - 0.03],
            [p.x + side * gw * 3.6, p.y + 0.03],
            [p.x + side * gw * 1.4, p.y + 0.03],
          ])}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={1.5}
        />
      ))}
      <Path
        d={path([
          [p.x - gw, p.y + 0.012],
          [p.x + gw, p.y + 0.012],
          [p.x + gw, p.y - 0.002],
          [p.x, p.y - 0.014],
          [p.x - gw, p.y - 0.002],
        ])}
        fill="#f2f2f2"
      />
      <Path d={path([[0.48, 0.985], [0.52, 0.985], [0.52, 0.995], [0.48, 0.995]])} fill="#ffffff" />
    </Svg>
  );
});

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    fixed: { flex: 1, paddingHorizontal: 16, gap: 8 },
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
    field: { flex: 1, minHeight: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
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
    banner: { position: 'absolute', alignSelf: 'center', top: '30%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
    scroll: { flexGrow: 0, maxHeight: 104, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    today: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pill: {
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.7),
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    pillGood: { color: '#161826', backgroundColor: '#a6e3b8' },
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
      paddingHorizontal: 4,
    },
    kindOn: { borderColor: '#f08a24', backgroundColor: withAlpha('#f08a24', 0.14) },
    kindName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    kindSub: { fontSize: 10.5, color: withAlpha(colors.text, 0.6) },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
