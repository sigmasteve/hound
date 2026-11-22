import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import type { Perspective } from '../components/perspective';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { getChallengeSponsor, sponsorColor, type ChallengeSponsor } from '../challenges/globalChallenges';
import {
  bandsFor,
  getDerbyLive,
  swingDerby,
  throwDerbyPitch,
  type DerbyBands,
  type DerbyLive,
  type DerbyPitch,
  type DerbySwing,
  type DerbySwingRow,
} from '../challenges/derbyApi';
import {
  arcKeys,
  at,
  BALL,
  BaseballBall,
  BAR_MS,
  Batter,
  FH,
  FieldArt,
  Figure,
  FW,
  HOME,
  HS,
  type Key,
  MOUND,
  P,
  PITCHER_COLOR,
  type Pt,
  TAKE_MS,
  view,
  WINDUP_MS,
  batAngleFor,
} from './BaseballBatScreen';
import {
  COUNT_MS,
  COUNT_STEP,
  Countdown,
  feelLine,
  pitchPoint,
  SwingModeSwitch,
  TapMark,
  tapToZone,
  TimingMeter,
  useSwingMode,
  zoneBox,
  zonePoint,
} from '../components/baseballSwing';
import { BoardLink } from '../components/BoardLink';

// The Hound Home Run Derby (0211), at the plate. Baseball batting's view
// (0207): the ballpark from behind home plate, facing the mound, every
// point through project(). Every pitch is a meatball from the batting
// practice pitcher, crossing somewhere near the middle (0231). The same
// swing as an at-bat (mockup claude.ai/artifact/HGso1dZWWMbsHBxMMfSxP5):
// Pitch, a quick 3-2-1, then tap where the ball crosses as it gets there.
// Where you tap and when go to the server (no swing is a take: an out),
// and it decides the distance: how close you were in both, your steps
// today and a strength workout. Over
// the wall is a home run, 475+ ft a Moonshot (counts as 2), a golden ball
// doubles it, and the sponsor's sign on the center-field wall pays Bones.
//
// The ballpark never scrolls away (Steve's ask, as H-O-R-S-E): only the
// message and today's swings under it scroll; the button stays pinned at
// the bottom.

type Phase = 'ready' | 'waiting' | 'pitch' | 'result';

const GOLD = '#f0c24a';
const ME_COLOR = '#ffd8b0';
// The fence (a 300 arc from home on the ground), from the left-field pole
// to the right.
const FL: Pt = { x: 68, y: 160 };
const FR: Pt = { x: 492, y: 160 };
const FENCE_R = 300;
const A0 = Math.atan2(FL.y - HOME.y, FL.x - HOME.x);
const A1 = Math.atan2(FR.y - HOME.y, FR.x - HOME.x);
export const onFence = (t: number, r = FENCE_R): Pt => {
  const a = A0 + (A1 - A0) * t;
  return { x: HOME.x + Math.cos(a) * r, y: HOME.y + Math.sin(a) * r };
};
export const WALL_H = 16;
// Distance markers on the wall: share along the fence and its feet.
export const MARKERS: { t: number; ft: number }[] = [
  { t: 0.07, ft: 330 },
  { t: 0.27, ft: 375 },
  { t: 0.5, ft: 410 },
  { t: 0.73, ft: 375 },
  { t: 0.93, ft: 330 },
];
// Outfielders playing deep, near the wall.
const DEEP: Record<'lf' | 'cf' | 'rf', Pt> = {
  lf: onFence(0.22, FENCE_R - 34),
  cf: onFence(0.5, FENCE_R - 34),
  rf: onFence(0.78, FENCE_R - 34),
};

// Where along the fence a ball goes: center when on time, the gaps a
// little off, the lines further off.
function fenceShare(dir: 'left' | 'center' | 'right', ft: number | null): number {
  if (dir === 'center') return 0.5;
  const deep = (ft ?? 0) >= 410 ? 0.3 : (ft ?? 0) >= 375 ? 0.25 : 0.1;
  return dir === 'left' ? deep : 1 - deep;
}

function afterKeys(
  v: Perspective,
  zone: Omit<Key, 't'>,
  s: DerbySwing,
  sign: { x: number; y: number } | null,
): { keys: Key[]; landAt: number; catcher: 'lf' | 'cf' | 'rf' | null } {
  const keys: Key[] = [{ t: 0, ...zone }];
  const ground = (p: Pt, lift = 0) => {
    const q = P(v, p);
    return { x: q.x, y: q.y - lift * q.s, d: BALL * q.s };
  };
  if (s.result === 'whiff' || s.result === 'take') {
    const end = arcKeys(keys, 0, zone, { x: zone.x - 4, y: v.h + 20, d: zone.d * 1.3 }, 0, 220, 4);
    return { keys, landAt: end, catcher: null };
  }
  const t = fenceShare(s.dir, s.ft);
  const wallAt = P(v, onFence(t));
  const wallTop = { x: wallAt.x, y: wallAt.y - WALL_H * wallAt.s, d: BALL * wallAt.s };
  if (s.result === 'fly_out') {
    const pos = s.dir === 'left' ? 'lf' : s.dir === 'right' ? 'rf' : 'cf';
    const target = ground(DEEP[pos], FH * 0.62);
    const end = arcKeys(keys, 0, zone, target, v.h * 0.32, 1350);
    return { keys, landAt: end, catcher: pos };
  }
  // A home run.
  if (s.sign && sign) {
    const hit = { x: sign.x, y: sign.y, d: BALL * wallAt.s * 1.2 };
    let end = arcKeys(keys, 0, zone, hit, v.h * 0.3, 1350);
    const landAt = end;
    end = arcKeys(keys, end, hit, { x: sign.x + 4, y: wallTop.y + 2, d: hit.d }, -4, 380, 5);
    return { keys, landAt, catcher: null };
  }
  if (s.moonshot) {
    // Out of the park: over the stand and off the top of the screen.
    const out = { x: wallTop.x + (t - 0.5) * 40, y: -30, d: 3 };
    const end = arcKeys(keys, 0, zone, out, v.h * 0.18, 1700);
    return { keys, landAt: end - 300, catcher: null };
  }
  const beyond = Math.max(6, ((s.ft ?? 410) - 330) * 0.55);
  const land = { x: wallTop.x + (t - 0.5) * 20, y: Math.max(8, wallTop.y - beyond), d: BALL * wallAt.s * 0.8 };
  const end = arcKeys(keys, 0, zone, land, v.h * 0.3, 1450);
  return { keys, landAt: end, catcher: null };
}

function bannerFor(s: DerbySwing): { text: string; tone: 'gold' | 'good' | 'out' } {
  if (s.result === 'hr') {
    const ft = s.ft != null ? `${s.ft} ft` : '';
    const what = s.moonshot ? `Moonshot! ${ft}` : s.sign ? `Off the sign! ${ft}` : `Gone! ${ft}`;
    return s.golden ? { text: `★ Golden! ${what}`, tone: 'gold' } : { text: what, tone: 'good' };
  }
  if (s.result === 'fly_out') return { text: s.golden ? 'Golden ball caught at the wall' : 'Caught at the wall', tone: 'out' };
  if (s.result === 'take') return { text: 'Took it: out', tone: 'out' };
  return { text: s.golden ? 'Golden ball: swing and a miss' : 'Swing and a miss', tone: 'out' };
}

function pillText(r: DerbySwingRow): string {
  if (r.result === 'hr') return `HR ${r.ft ?? ''} ft${r.moonshot ? ' · Moonshot' : ''}${r.sign ? ' · sign' : ''}${r.golden ? ' · ★' : ''}`;
  if (r.result === 'fly_out') return r.golden ? '★ Out' : 'Fly out';
  if (r.result === 'take') return 'Took it';
  return r.golden ? '★ Miss' : 'Miss';
}

export function DerbyBatScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [live, setLive] = useState<DerbyLive | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'gold' | 'good' | 'out' } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pitch, setPitch] = useState<{ p: DerbyPitch; countEnd: number; releaseAt: number; arriveAt: number } | null>(null);
  const [swingAt, setSwingAt] = useState<number | null>(null);
  const [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  // Meter (the default) or tap the ball; the meter's last mark.
  const [mode, setMode] = useSwingMode();
  const [lastMark, setLastMark] = useState<number | null>(null);
  const [after, setAfter] = useState<{ keys: Key[]; startAt: number; landAt: number; catcher: 'lf' | 'cf' | 'rf' | null; golden: boolean } | null>(null);
  const [signLit, setSignLit] = useState(false);
  const [mine, setMine] = useState<DerbySwingRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const sent = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      const l = await getDerbyLive(challengeId);
      setLive(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Derby.');
    }
  }, [challengeId]);
  useEffect(() => {
    load();
    getChallengeSponsor(challengeId)
      .then(setSponsor)
      .catch(() => {});
  }, [load, challengeId]);
  useEffect(() => {
    if (!user?.id) return;
    getMyEquippedCosmetics(user.id)
      .then((c) => setIconId(c.iconId))
      .catch(() => {});
  }, [user?.id]);
  const look = parseHoundAvatar(iconId);

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
  const factor = live?.factor ?? 1;
  const bands: DerbyBands = pitch?.p.bands ?? live?.bands ?? bandsFor(factor);
  const signName = live?.sponsor?.name ?? sponsor?.name ?? null;
  const signColor = sponsorColor(sponsor);

  useEffect(() => {
    if (!live || msg) return;
    const extra = live.power.stepsFt + live.power.workoutFt;
    setMsg(
      `Every pitch is a meatball: it’s a derby. ${
        mode === 'meter'
          ? 'Tap Pitch, then Swing! as the marker crosses the middle of the meter.'
          : 'Tap Pitch, then tap the ball where it crosses the plate, as it gets there.'
      } Barrel it and it’s gone.${
        extra > 0 ? ` Your steps and workouts add ${extra} feet today.` : ''
      }`,
    );
  }, [live, msg, mode]);

  const spots = useMemo(() => {
    if (!v) return null;
    const home = P(v, HOME);
    const mound = P(v, MOUND);
    const batter = P(v, { x: HOME.x - 38, y: HOME.y + 2 });
    const zone = { x: home.x, y: home.y - HS * home.s * 0.5, d: 22 };
    const hand = { x: mound.x + FW * 0.25 * mound.s, y: mound.y - FH * 0.78 * mound.s, d: 12 * mound.s };
    const zb = zoneBox(zone, home.s, HS);
    const c = P(v, onFence(0.5));
    const signW = Math.min(190, v.w * 0.44);
    const signH = Math.max(16, signW * 0.16);
    const sign = { x: c.x, y: c.y - WALL_H * c.s - signH / 2 - 2, w: signW, h: signH };
    const markers = MARKERS.map((m) => {
      const q = P(v, onFence(m.t));
      return { ft: m.ft, x: q.x, y: q.y - WALL_H * q.s };
    });
    return { home, mound, batter, zone, hand, zb, sign, markers };
  }, [v]);

  const finish = (s: DerbySwing) => {
    setMsg(s.message + feelLine(s.timing, s.miss));
    setLive((l) =>
      l
        ? {
            ...l,
            swingsLeft: s.swingsLeft,
            pending: null,
            me: { ...l.me, hrs: s.hrs, longestFt: Math.max(l.me.longestFt, s.longestFt), rank: s.rank ?? l.me.rank, moonshots: l.me.moonshots + (s.moonshot ? 1 : 0) },
          }
        : l,
    );
    setMine((m) => [{ n: Date.now(), day: null, golden: s.golden, result: s.result, ft: s.ft, moonshot: s.moonshot, sign: s.sign, counts: s.counts }, ...m].slice(0, 8));
  };

  const send = async (timing: number | null, at0: { x: number; y: number } | null, p: NonNullable<typeof pitch>) => {
    if (sent.current || !v || !spots) return;
    sent.current = true;
    setPhase('waiting');
    try {
      const s = await swingDerby(challengeId, timing, at0);
      const start = Math.max(Date.now(), p.arriveAt);
      const cross = zonePoint(spots.zb, p.p.px, p.p.py);
      const a = afterKeys(v, { x: cross.x, y: cross.y, d: spots.zone.d }, s, spots.sign);
      setAfter({ keys: a.keys, startAt: start, landAt: a.landAt, catcher: a.catcher, golden: p.p.golden });
      setPhase('result');
      const total = a.keys[a.keys.length - 1].t;
      later(() => {
        setBanner(bannerFor(s));
        if (s.sign) setSignLit(true);
        if (s.result === 'hr') buzz('success');
        finish(s);
      }, start - Date.now() + a.landAt);
      later(
        () => {
          setBanner(null);
          setPitch(null);
          setAfter(null);
          setSwingAt(null);
          setTap(null);
          setSignLit(false);
          setPhase('ready');
          getDerbyLive(challengeId)
            .then((l) => {
              setLive(l);
              if (l.recent.length) setMine([]);
            })
            .catch(() => {});
        },
        start - Date.now() + Math.max(total, a.landAt) + 1500,
      );
    } catch (e) {
      setPitch(null);
      setAfter(null);
      setSwingAt(null);
      setPhase('ready');
      Alert.alert('Home Run Derby', e instanceof Error ? e.message : 'Try again.');
      load();
    }
  };

  // No swing by the time the ball's past you: a take, an out.
  useEffect(() => {
    if (phase !== 'pitch' || !pitch || swingAt != null || sent.current) return;
    if (now > pitch.arriveAt + TAKE_MS) send(null, null, pitch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, pitch, swingAt]);

  const canPitch = !!live && (!!live.pending || live.canSwing);

  const act = async () => {
    if (!live || !v) return;
    if (phase === 'ready') {
      if (!canPitch) return;
      setBanner(null);
      setTap(null);
      setLastMark(null);
      setSwingAt(null);
      setAfter(null);
      setPhase('waiting');
      try {
        const p = await throwDerbyPitch(challengeId, factor);
        const t = Date.now();
        sent.current = false;
        // The 3-2-1 is for looking up at the plate; the meter is right
        // by the button, so it starts straight away.
        const countEnd = t + (mode === 'tap' ? COUNT_MS : 0);
        setPitch({ p, countEnd, releaseAt: countEnd + WINDUP_MS, arriveAt: countEnd + WINDUP_MS + p.ms });
        setNow(t);
        setPhase('pitch');
        setMsg(p.golden ? 'A golden ball! Hit it out and it counts double.' : mode === 'tap' ? 'Eyes up: here it comes…' : 'Here it comes…');
        if (p.golden) buzz('light');
      } catch (e) {
        setPhase('ready');
        Alert.alert('Home Run Derby', e instanceof Error ? e.message : 'Try again.');
        load();
      }
      return;
    }
    // The meter's Swing!: only the timing counts.
    if (mode !== 'meter' || phase !== 'pitch' || !pitch || swingAt != null || sent.current) return;
    const t = Date.now();
    if (t < pitch.releaseAt) return;
    const timing = t - pitch.arriveAt;
    setSwingAt(t);
    setLastMark(Math.max(0.02, Math.min(0.98, 0.5 + timing / BAR_MS)));
    buzz('light');
    send(timing, null, pitch);
  };

  // The swing is a tap on the field, counted when the finger lands.
  const swingAtPoint = (x: number, y: number) => {
    if (mode !== 'tap' || phase !== 'pitch' || !pitch || swingAt != null || sent.current || !spots) return;
    const t = Date.now();
    if (t < pitch.releaseAt) return;
    setSwingAt(t);
    setTap({ x, y });
    buzz('light');
    send(t - pitch.arriveAt, tapToZone(spots.zb, x, y), pitch);
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
  const counting = phase === 'pitch' && pitch != null && now < pitch.countEnd;
  const winding = phase === 'pitch' && pitch != null && now >= pitch.countEnd && now < pitch.releaseAt;
  const golden = !!pitch?.p.golden && (phase !== 'ready' || !!after);
  let ball: { x: number; y: number; d: number } | null = null;
  if (spots && pitch && !after && now >= pitch.releaseAt) {
    ball = pitchPoint(spots.hand, spots.zb, { kind: 'fastball', px: pitch.p.px, py: pitch.p.py }, spots.zone.d, Math.min(1.15, (now - pitch.releaseAt) / pitch.p.ms));
  } else if (after) {
    const k = at(after.keys, now - after.startAt);
    ball = { x: k.x, y: k.y, d: k.d };
  }
  const caught = !!after?.catcher && now - after.startAt >= after.landAt - 120 ? after.catcher : null;
  const batAngle = batAngleFor(swingAt, now);

  const busy = phase === 'waiting' || phase === 'result';
  const actLabel =
    phase === 'pitch'
      ? mode === 'meter'
        ? 'Swing!'
        : counting
          ? 'Eyes on the plate…'
          : 'Tap where it crosses'
      : busy
        ? '…'
        : canPitch
          ? live.pending
            ? 'Next pitch'
            : 'Pitch'
          : live.reason || (live.nextSwingAt != null ? `No swings ready: your next comes at ${live.nextSwingAt.toLocaleString()} steps` : 'That’s 20 swings today. Back tomorrow.');
  const actOn = (phase === 'ready' && canPitch) || (mode === 'meter' && phase === 'pitch' && swingAt == null);
  const liveMark = mode === 'meter' && phase === 'pitch' && pitch && swingAt == null && !sent.current && now >= pitch.releaseAt;
  const mark = liveMark && pitch ? Math.max(0.02, Math.min(0.98, 0.5 + (now - pitch.arriveAt) / BAR_MS)) : lastMark;
  const leftChip = golden
    ? '★ Golden ball · worth 2'
    : pitch && phase !== 'ready'
      ? `Meatball · ${pitch.p.mph} mph`
      : `Golden balls today: ${Math.min(2, live.goldens.shown)} of 2`;
  const powerChip =
    live.power.stepsFt + live.power.workoutFt > 0
      ? [live.power.stepsFt > 0 ? `+${live.power.stepsFt} ft steps` : null, live.power.workoutFt > 0 ? `+${live.power.workoutFt} ft workout` : null].filter(Boolean).join(' · ')
      : null;

  const swings = mine.length ? [...mine, ...live.recent].slice(0, 8) : live.recent;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BoardLink challengeId={challengeId}>
              <Text style={styles.kicker} numberOfLines={1}>
                HOME RUN DERBY{live.dayNo > 0 ? ` · DAY ${live.dayNo} OF ${live.days}` : ''}
              </Text>
            </BoardLink>
            <Text style={styles.title}>At the plate</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`${live.me.hrs} home runs`}>
            <Text style={[styles.title, { color: ME_COLOR }]}>{live.me.hrs}</Text>
            <Text style={styles.small}>home runs</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>SWINGS LEFT</Text>
            <Text style={styles.bankValue}>{live.swingsLeft}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              1 per 1,000
            </Text>
          </View>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: ME_COLOR }]}>LONGEST</Text>
            <Text style={styles.bankValue}>{live.me.longestFt ? `${live.me.longestFt} ft` : '–'}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              this Derby
            </Text>
          </View>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#b4aaf0' }]}>RANK</Text>
            <Text style={styles.bankValue}>{live.me.rank != null ? `#${live.me.rank}` : '–'}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              {live.field > 0 ? `of ${live.field.toLocaleString()}` : 'swing to get one'}
            </Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && spots && (
            <>
              <FieldArt v={v} />
              {spots.markers.map((m, i) => (
                <Text key={i} style={[styles.marker330, { left: m.x - 14, top: m.y + 1 }]}>
                  {m.ft}
                </Text>
              ))}
              {signName && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.sign,
                    {
                      left: spots.sign.x - spots.sign.w / 2,
                      top: spots.sign.y - spots.sign.h / 2,
                      width: spots.sign.w,
                      height: spots.sign.h,
                      borderColor: signColor,
                      backgroundColor: signLit ? ME_COLOR : '#f2f2f6',
                    },
                  ]}
                >
                  <Text style={[styles.signText, { fontSize: Math.max(8, Math.min(spots.sign.h * 0.55, (spots.sign.w * 1.6) / Math.max(6, signName.length))) }]} numberOfLines={1}>
                    {signName.toUpperCase()}
                  </Text>
                </View>
              )}
              {(Object.keys(DEEP) as (keyof typeof DEEP)[]).map((pos) => {
                const q = P(v, DEEP[pos]);
                return <Figure key={pos} x={q.x} y={q.y} s={q.s} color={PITCHER_COLOR} pose={caught === pos ? 'catch' : 'ready'} />;
              })}
              <Figure x={spots.mound.x} y={spots.mound.y} s={spots.mound.s} color="#7fb3dd" pose={winding ? 'windup' : pitch && phase === 'pitch' ? 'thrown' : 'set'} />
              <View
                pointerEvents="none"
                style={[styles.zone, { left: spots.zb.x - spots.zb.hw, top: spots.zb.y - spots.zb.hh, width: spots.zb.hw * 2, height: spots.zb.hh * 2 }]}
              />
              <Batter x={spots.batter.x} y={spots.batter.y} s={spots.batter.s} look={look} angle={batAngle} />
              {ball && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ball.x - ball.d / 2, top: ball.y - ball.d / 2 }}>
                  {golden ? <GoldenBall size={Math.max(4, ball.d)} /> : <BaseballBall size={Math.max(4, ball.d)} />}
                </View>
              )}
              {tap && swingAt != null && now - swingAt < 900 && <TapMark x={tap.x} y={tap.y} />}
            </>
          )}
          {/* The swing: tap where the ball crosses, counted when the finger lands. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={(e) => swingAtPoint(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            disabled={phase !== 'pitch' || mode !== 'tap'}
            accessibilityRole="button"
            accessibilityLabel="Swing: tap where the ball crosses the plate"
          />
          {counting && pitch && <Countdown n={Math.max(1, Math.ceil((pitch.countEnd - now) / COUNT_STEP))} color={GOLD} />}
          <Text style={[styles.chip, { left: 10 }, golden && { color: GOLD }]}>{leftChip}</Text>
          {powerChip && <Text style={[styles.chip, { right: 10, color: ME_COLOR }]}>{powerChip}</Text>}
          {banner && (
            <View
              style={[
                styles.banner,
                { backgroundColor: banner.tone === 'gold' ? GOLD : banner.tone === 'good' ? ME_COLOR : '#e9e9ed' },
                banner.tone === 'gold' && styles.bannerGold,
              ]}
            >
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.msg}>{msg}</Text>
        {swings.length > 0 && (
          <View style={styles.today}>
            {swings.map((r, i) => (
              <Text key={`${r.n}-${i}`} style={[styles.pill, r.result === 'hr' && styles.pillHit, r.golden && r.result === 'hr' && styles.pillGold]}>
                {pillText(r)}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.small}>
          {live.steps.toLocaleString()} steps today · {live.swingsEarned} of {live.cap} swings earned
          {live.nextSwingAt != null ? ` · next at ${live.nextSwingAt.toLocaleString()}` : ''}
          {live.goldens.shown < 2 && live.steps < live.goldens.secondUnlocksAt ? ` · a second golden ball after ${live.goldens.secondUnlocksAt.toLocaleString()}` : ''}
        </Text>
        <Text style={styles.small}>
          Pitch speed: {live.mph} mph{live.stage > 1 ? ' (it picks up as the Derby goes on)' : ''}. 475 ft or more is a Moonshot and counts as 2.
          {live.sponsor && live.sponsor.signBones > 0
            ? ` Hit the ${live.sponsor.name} sign for +${live.sponsor.signBones} (${live.sponsor.signHits} of ${live.sponsor.signCap}).`
            : ''}
        </Text>
      </ScrollView>

      <View style={styles.pinned}>
        <SwingModeSwitch mode={mode} onChange={(m) => { setMode(m); setMsg(''); }} disabled={phase !== 'ready'} />
        {mode === 'meter' && (
          <TimingMeter
            barMs={BAR_MS}
            bands={[
              { ms: bands.warning, color: '#c97a3a' },
              { ms: bands.b70, color: '#e0a94f' },
              { ms: bands.b45, color: '#bfe8cb' },
              { ms: bands.b30, color: '#7fd39b' },
              { ms: bands.b20, color: '#4fc48c' },
              { ms: bands.b10, color: '#2f9e6b' },
            ]}
            mark={mark}
            moving={!!liveMark}
            label={`Timing: on time is the middle; contact within ${Math.round(bands.b70)} milliseconds`}
          />
        )}
        {/* The meter's Swing! counts when the finger lands, not when it lifts. */}
        <Pressable
          onPressIn={phase === 'pitch' && mode === 'meter' ? act : undefined}
          onPress={phase === 'pitch' ? undefined : act}
          disabled={!actOn}
          style={[styles.act, actOn ? { backgroundColor: phase === 'pitch' ? '#f08a24' : colors.green } : phase === 'pitch' ? { backgroundColor: '#2a2c38' } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !actOn && { color: phase === 'pitch' ? ME_COLOR : withAlpha(colors.text, 0.6), fontSize: 14 }]}>{actLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// The golden ball: gold, glowing.
function GoldenBall({ size }: { size: number }) {
  const r = size / 2;
  const glow = size * 0.6;
  return (
    <View style={{ marginLeft: -glow, marginTop: -glow }}>
      <Svg width={size + glow * 2} height={size + glow * 2}>
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffe7a0" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#f0c24a" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={r + glow} cy={r + glow} r={r + glow} fill="url(#g)" />
        <Circle cx={r + glow} cy={r + glow} r={r - 0.5} fill={GOLD} stroke="#c98f12" strokeWidth={0.8} />
        {size >= 9 && (
          <>
            <Path d={`M ${glow + r * 0.45} ${glow + r * 0.35} Q ${glow + r * 0.85} ${glow + r} ${glow + r * 0.45} ${glow + r * 1.65}`} stroke="#fff6c8" strokeWidth={Math.max(0.8, size / 18)} fill="none" />
            <Path d={`M ${glow + r * 1.55} ${glow + r * 0.35} Q ${glow + r * 1.15} ${glow + r} ${glow + r * 1.55} ${glow + r * 1.65}`} stroke="#fff6c8" strokeWidth={Math.max(0.8, size / 18)} fill="none" />
          </>
        )}
      </Svg>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    fixed: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 8 },
    back: { paddingRight: 2, paddingBottom: 4 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    banks: { flexDirection: 'row', gap: 8 },
    bank: { flex: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6 },
    bankValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    bankNote: { fontSize: 10.5, color: withAlpha(colors.text, 0.6) },
    field: { flex: 1, minHeight: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    zone: { position: 'absolute', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.75)', borderRadius: 4 },
    marker330: { position: 'absolute', width: 28, textAlign: 'center', fontSize: 9.5, fontFamily: font.headingSemibold, color: 'rgba(255,255,255,0.85)' },
    sign: { position: 'absolute', borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    signText: { fontFamily: font.headingSemibold, color: '#161826', letterSpacing: 0.4 },
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
    bannerGold: { shadowColor: GOLD, shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 20, color: '#161826' },
    scroll: { flexGrow: 0, maxHeight: 128, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    today: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pill: {
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.65),
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
      overflow: 'hidden',
    },
    pillHit: { color: ME_COLOR, backgroundColor: withAlpha(ME_COLOR, 0.16) },
    pillGold: { color: '#161826', backgroundColor: GOLD },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 8 },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
