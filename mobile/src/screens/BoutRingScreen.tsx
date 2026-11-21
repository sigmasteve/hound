import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, StarIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { getChallengeSponsor, type ChallengeSponsor } from '../challenges/globalChallenges';
import { Boxer, Referee, RingArt, ringView, useClock, type BoxerAct } from '../components/BoutRing';
import { project } from '../components/perspective';
import {
  dodgeOk,
  finishDefense,
  getBoutLive,
  punchName,
  startDefense,
  startExchange,
  throwRingPunch,
  type BoutKind,
  type BoutLive,
  type BoutPunchKind,
  type IncomingPunch,
  type OpeningKind,
  type RingPunchResult,
  type SlipDir,
} from '../challenges/boutApi';

// Hound Bout's ring (0230; the playable prototype is
// claude.ai/artifact/UhZUFuQSocRai4ekSoXXy4), for Hound Bout and the
// Title Bout alike. Throw: an exchange, three openings lighting up on the
// opponent one after another, each with a ring closing on it; tap it as
// the ring closes (green is now). Where it lights picks the punch: the
// face a jab, the side of the head a hook, the chin an uppercut. Each
// punch goes to the server as it's thrown, so the block or counter you
// see is real. Incoming: their combination, punch by punch, each
// telegraphed by the glove winding up and a glint; tap where to move
// (the sides to slip, the top to lean back, the bottom to duck). A tight
// slip opens a counter on their face: tap it (+2, a star). A star arms a
// Star punch: double. The ring never scrolls away; the buttons stay
// pinned.

const OFFSETS = [450, 1450, 2450];
const SHRINK = 750;
const GRACE = 220;
const TELL = 680;
const GAP = 700;
const LEAD = 600;
const COUNTER_MS = 750;
const ME_COLOR = '#ffd8b0';
const GREEN = '#7fd39b';
const AMBER = '#ffd27a';
const GOLD = '#f0c24a';

// Openings on the opponent, in their 100 x 140 drawing (BoutRing's Boxer).
const SPOTS: Record<OpeningKind, { x: number; y: number; r: number; punch: BoutPunchKind; name: string }> = {
  jab: { x: 50, y: 24, r: 10, punch: 'jab', name: 'Jab' },
  hookL: { x: 33, y: 19, r: 9, punch: 'hook', name: 'Hook' },
  hookR: { x: 67, y: 19, r: 9, punch: 'hook', name: 'Hook' },
  up: { x: 50, y: 38, r: 8, punch: 'up', name: 'Uppercut' },
};

type Mode = 'throw' | 'slip';
type Act = { pose: BoxerAct['pose']; dir?: BoxerAct['dir']; at: number; len: number };
type Exchange = { id: number; openings: OpeningKind[]; t0: number; sent: boolean[]; res: (RingPunchResult | null)[]; lastAt: number };
type Defense = {
  id: number;
  punches: IncomingPunch[];
  t0: number;
  moves: ({ dir: SlipDir; dt: number } | null | undefined)[];
  tights: number;
  counters: number;
  counterUntil: number;
  lastAt: number;
  sending: boolean;
};
type Slot = { what: string; how: string; good: boolean | null };

export function BoutRingScreen({
  challengeId,
  initialMode,
  kind = 'bout',
  onBack,
}: {
  challengeId: string;
  initialMode?: Mode;
  kind?: BoutKind;
  onBack: () => void;
}) {
  const gameName = kind === 'titlebout' ? 'Title Bout' : 'Hound Bout';
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [live, setLive] = useState<BoutLive | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode ?? 'throw');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [stars, setStars] = useState(0);
  const [msg, setMsg] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [banner, setBanner] = useState<{ text: string; tone: 'good' | 'bad' | 'star'; at: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ex = useRef<Exchange | null>(null);
  const def = useRef<Defense | null>(null);
  const meAct = useRef<Act | null>(null);
  const oppAct = useRef<Act | null>(null);
  const hitAt = useRef(0);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const load = useCallback(async () => {
    try {
      const l = await getBoutLive(challengeId, kind);
      setLive(l);
      setStars(l.stars);
      setError(null);
      return l;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the fight.');
      return null;
    }
  }, [challengeId, kind]);
  useEffect(() => {
    load();
    getChallengeSponsor(challengeId)
      .then(setSponsor)
      .catch(() => {});
  }, [load, challengeId]);

  const running = !!ex.current || !!def.current;
  const now = useClock(running || (!!banner && Date.now() - banner.at < 1200) || !!meAct.current || !!oppAct.current);
  const rv = useMemo(() => (size.w > 0 ? ringView(size.w, size.h) : null), [size.w, size.h]);
  const oppName = live?.opponent ? (live.opponent.id ? live.opponent.name.split(' ')[0] : 'The sparring hound') : 'Your opponent';
  const say = (text: string, tone: 'good' | 'bad' | 'star') => setBanner({ text, tone, at: Date.now() });
  const act = (who: 'me' | 'opp', pose: BoxerAct['pose'], len = 520, dir?: BoxerAct['dir'], delay = 0) => {
    const a = { pose, dir, at: Date.now() + delay, len };
    if (who === 'me') meAct.current = a;
    else oppAct.current = a;
  };

  const introFor = (m: Mode, l: BoutLive | null) =>
    m === 'slip'
      ? l && l.combos > 0
        ? `${oppName} has ${l.combos} ${l.combos === 1 ? 'combination' : 'combinations'} waiting. Jab: slip left or right. Hook: away from it or duck. Uppercut: lean back. Move just before it lands for a counter.`
        : `Nothing coming at you right now. ${oppName}'s combinations wait here until the round's scored; anything you don't face lands.`
      : 'Openings light up on your opponent. Tap each as its ring closes: the face is a jab, the side of the head a hook, the chin an uppercut.';
  useEffect(() => {
    if (live && !msg) setMsg(introFor(mode, live));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // ── Throwing ──

  const beginExchange = async () => {
    if (busy || running || !live?.canAct) return;
    setBusy(true);
    try {
      const r = await startExchange(kind, challengeId);
      ex.current = { id: r.id, openings: r.openings, t0: Date.now(), sent: [false, false, false], res: [null, null, null], lastAt: 0 };
      setStars(r.stars);
      setSlots([]);
      setMsg('Tap each glow as its ring closes. Green means now.');
      buzz('light');
      rerender();
    } catch (e) {
      Alert.alert(gameName, e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const throwAt = (i: number, progress: number | null, late = false) => {
    const x = ex.current;
    if (!x || x.sent[i]) return;
    x.sent[i] = true;
    x.lastAt = Date.now();
    const spot = SPOTS[x.openings[i]];
    const star = armed && progress != null;
    if (star) setArmed(false);
    if (progress != null && progress >= 0.45) {
      act('me', spot.punch, 380);
      buzz('light');
    } else {
      say(late ? 'Too late' : progress == null ? 'Swung at air' : 'Too early', 'bad');
    }
    throwRingPunch(x.id, i, progress, star)
      .then((r) => {
        x.res[i] = r;
        setStars(r.stars);
        if (r.points > 0) {
          act('opp', 'hit', 520, undefined, 60);
          buzz('success');
          say(r.star ? `STAR PUNCH +${r.points}` : `${punchName(r.punch)} +${r.points}${r.quality === 'perfect' ? ' · perfect' : ''}`, r.star ? 'star' : 'good');
        } else if (r.countered) {
          act('opp', 'block', 420);
          act('me', 'hit', 520, undefined, 220);
          say(`Countered! +1 ${oppName}`, 'bad');
        } else if (r.blocked) {
          act('opp', 'block', 520);
          say('Blocked', 'bad');
        } else if (progress != null) {
          act('opp', 'slip', 480, 'left');
        }
        rerender();
      })
      .catch((e) => {
        x.res[i] = { seq: i, punch: spot.punch, side: null, quality: 'miss', blocked: false, countered: false, points: 0, star: false, stars, message: e instanceof Error ? e.message : '' };
        rerender();
      });
  };

  // ── Defending ──

  const beginDefense = async () => {
    if (busy || running || !live?.canAct || live.combos <= 0) return;
    setBusy(true);
    try {
      const r = await startDefense(kind, challengeId);
      def.current = { id: r.id, punches: r.punches, t0: Date.now() + LEAD, moves: r.punches.map(() => undefined), tights: 0, counters: 0, counterUntil: 0, lastAt: 0, sending: false };
      setStars(r.stars);
      setSlots([]);
      setMsg(`${oppName} throws. Watch the glove; move as it glints.`);
      rerender();
    } catch (e) {
      Alert.alert(gameName, e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const strikeAt = (d: Defense, i: number) => d.t0 + i * (TELL + GAP) + TELL;
  const move = (dir: SlipDir) => {
    const d = def.current;
    if (!d) return;
    const t = Date.now();
    const i = d.moves.findIndex((m) => m === undefined);
    if (i < 0 || t < strikeAt(d, i) - TELL) return;
    const p = d.punches[i];
    const dt = t - strikeAt(d, i);
    const ok = dodgeOk(p.punch, p.side, dir) && dt >= -320 && dt <= 140;
    const tight = ok && dt >= -170;
    d.moves[i] = { dir, dt: Math.round(dt) };
    d.lastAt = t;
    if (ok) {
      act('me', 'slip', 620, dir);
      buzz('light');
      if (tight) {
        d.tights += 1;
        d.counterUntil = t + COUNTER_MS;
        say('Slipped! Counter now', 'good');
      } else say('Slipped', 'good');
    } else {
      act('me', 'hit', 520);
      hitAt.current = Math.max(t, strikeAt(d, i));
      buzz('warning');
      say(dt < -320 ? 'Too soon: caught it' : 'Wrong way: caught it', 'bad');
    }
    rerender();
  };
  const counter = () => {
    const d = def.current;
    if (!d || Date.now() > d.counterUntil || d.counters >= d.tights) return;
    d.counters += 1;
    d.counterUntil = 0;
    d.lastAt = Date.now();
    act('me', 'jab', 380);
    act('opp', 'hit', 520, undefined, 80);
    buzz('success');
    say(stars < 3 ? 'Counter +2 · ★' : 'Counter +2', 'star');
    rerender();
  };

  // ── The clock: expiries, and the end of an exchange or a combination ──

  useEffect(() => {
    const t = Date.now();
    const x = ex.current;
    if (x) {
      x.openings.forEach((_, i) => {
        if (!x.sent[i] && t > x.t0 + OFFSETS[i] + SHRINK + GRACE) throwAt(i, null, true);
      });
      if (x.res.every((r) => r) && t > x.lastAt + 650) {
        ex.current = null;
        const res = x.res as RingPunchResult[];
        setSlots(
          res.map((r) => ({
            what: r.points > 0 ? `${punchName(r.punch)} +${r.points}` : r.countered ? 'Countered' : r.blocked ? 'Blocked' : 'Miss',
            how: r.star ? 'Star punch' : r.points > 0 ? (r.quality === 'perfect' ? 'Perfect' : 'Clean') : r.quality === 'miss' ? 'Early, late or off' : 'Their guard',
            good: r.points > 0,
          })),
        );
        const landed = res.filter((r) => r.points > 0);
        const power = landed.reduce((n, r) => n + (r.punch === 'jab' ? 0 : r.star ? 2 : 1), 0);
        setMsg(
          (landed.length === 3 && power >= 2) || power >= 3
            ? `That's a knockdown's worth: unless ${oppName} slips them, ${oppName} goes down tonight.`
            : landed.length > 0
              ? `${landed.length} of 3 got through. ${oppName} can still slip them before tonight. The openings hint at the guard: chin means high, hooks mean body, an easy jab can be bait.`
              : 'Nothing got through. Watch which openings show: they hint at the guard.',
        );
        load();
      }
    }
    const d = def.current;
    if (d) {
      d.punches.forEach((p, i) => {
        if (d.moves[i] === undefined && t > strikeAt(d, i) + 140 && (i === 0 || d.moves[i - 1] !== undefined)) {
          d.moves[i] = null;
          d.lastAt = t;
          act('me', 'hit', 520);
          hitAt.current = t;
          buzz('warning');
          say(`${punchName(p.punch)} lands`, 'bad');
        }
      });
      if (!d.sending && d.moves.every((m) => m !== undefined) && t > d.lastAt + 900 && t > d.counterUntil) {
        d.sending = true;
        const moves = d.moves.map((m) => m ?? null);
        finishDefense(d.id, moves, d.counters)
          .then((r) => {
            setStars(r.stars);
            setSlots(
              d.punches.map((p, i) => {
                const m = moves[i];
                return {
                  what: r.slipped[i] ? 'Slipped' : `${punchName(p.punch)} lands`,
                  how: m ? (m.dir === 'duck' ? 'Ducked' : m.dir === 'back' ? 'Leaned back' : `Moved ${m.dir}`) : 'Didn’t move',
                  good: !!r.slipped[i],
                };
              }),
            );
            setMsg(r.message + (r.counters > 0 ? ` Stars: ${r.stars} of 3.` : ''));
          })
          .catch((e) => Alert.alert(gameName, e instanceof Error ? e.message : 'Try again.'))
          .finally(() => {
            def.current = null;
            load();
          });
      }
    }
  });

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
  const actOf = (a: Act | null): BoxerAct => {
    if (!a || now < a.at) return { pose: 'idle', k: 0 };
    const k = (now - a.at) / a.len;
    if (k >= 1) return { pose: 'idle', k: 0 };
    return { pose: a.pose, k, dir: a.dir };
  };
  const meA = actOf(meAct.current);
  let oppA = actOf(oppAct.current);
  if (meAct.current && now - meAct.current.at > meAct.current.len) meAct.current = null;
  if (oppAct.current && now - oppAct.current.at > oppAct.current.len) oppAct.current = null;

  const tb = live.titleBout;
  const kicker = !tb
    ? `HOUND BOUT · ROUND ${Math.max(1, Math.min(live.rounds, live.round))} OF ${live.rounds}`
    : tb.title
      ? `TITLE FIGHT · ROUND ${live.round} OF 2`
      : `TITLE BOUT · DAY ${Math.max(1, tb.dayNo)} OF 7${tb.opponentIsBot ? ' · SPARRING' : ''}`;
  const apron = sponsor?.name ?? gameName;
  // A step nearer than the replay's opponent, and your hound low at the
  // bottom, so their whole guard is in view.
  const oppAt = rv ? project(rv.v, 0.5, 0.62) : { x: 0, y: 0, s: 1 };
  const oppH = rv ? rv.v.h * 0.64 * oppAt.s : 0;
  const oppW = (oppH * 100) / 140;
  const box = rv ? { left: oppAt.x - oppW / 2, top: oppAt.y - oppH, sc: oppH / 140 } : { left: 0, top: 0, sc: 1 };
  const P = (px: number, py: number) => ({ x: box.left + px * box.sc, y: box.top + py * box.sc });

  // The opening that's live now, its ring closing.
  const x = ex.current;
  let op: { i: number; kind: OpeningKind; p: number } | null = null;
  if (x) {
    for (let i = 0; i < x.openings.length; i++) {
      const s = x.t0 + OFFSETS[i];
      if (!x.sent[i] && now >= s && now <= s + SHRINK + GRACE) {
        op = { i, kind: x.openings[i], p: (now - s) / SHRINK };
        break;
      }
    }
  }

  // Their combination: the tell, then the strike.
  const d = def.current;
  let tellGlove: { x: number; y: number } | null = null;
  let glint = false;
  let fromSide: 'left' | 'right' | null = null;
  if (d) {
    const i = d.moves.findIndex((m) => m === undefined);
    if (i >= 0) {
      const p = d.punches[i];
      const strike = strikeAt(d, i);
      if (now >= strike - TELL && now < strike - 120) {
        tellGlove = p.punch === 'up' ? P(30, 72) : p.punch === 'hook' ? P(p.side === 'L' ? 84 : 16, 56) : P(70, 64);
        glint = now > strike - 220;
        fromSide = p.punch === 'hook' ? (p.side === 'L' ? 'right' : 'left') : null;
      } else if (now >= strike - 120) {
        oppA = { pose: p.punch, k: Math.min(1, (now - strike + 120) / 420) };
      }
    }
  }
  // Moving with your slip: the ring shifts the other way.
  let shift = { x: 0, y: 0 };
  if (meA.pose === 'slip' && rv) {
    const e = meA.k < 0.25 ? meA.k / 0.25 : meA.k < 0.7 ? 1 : 1 - (meA.k - 0.7) / 0.3;
    const dir = meA.dir ?? 'left';
    shift = dir === 'left' ? { x: rv.v.w * 0.12 * e, y: 0 } : dir === 'right' ? { x: -rv.v.w * 0.12 * e, y: 0 } : dir === 'duck' ? { x: 0, y: -rv.v.h * 0.08 * e } : { x: 0, y: rv.v.h * 0.06 * e };
  }
  const shake = now - hitAt.current < 260 ? Math.sin(now / 18) * 7 * (1 - (now - hitAt.current) / 260) : 0;
  const flash = now - hitAt.current < 260 ? 0.32 * (1 - (now - hitAt.current) / 260) : 0;
  const counterOpen = !!d && now < d.counterUntil && d.counters < d.tights;
  const showBanner = !!banner && now - banner.at < 900;

  const left = live.day.left;
  const throwLabel = busy ? '…' : x ? 'In the exchange…' : !live.canAct ? (live.reason ?? 'No actions') : `Throw an exchange · ${left} left`;
  const slipLabel = busy ? '…' : d ? 'Incoming…' : live.combos <= 0 ? 'Nothing coming at you' : !live.canAct ? (live.reason ?? 'No actions') : `Face their combination · ${live.combos} waiting`;
  const canThrow = !busy && !running && live.canAct && live.status === 'active';
  const canFace = !busy && !running && live.canAct && live.combos > 0 && live.status === 'active';
  const switchMode = (m: Mode) => {
    if (running) return;
    setMode(m);
    setSlots([]);
    setMsg(introFor(m, live));
  };
  const slotList: Slot[] = [0, 1, 2].map((i) => slots[i] ?? { what: '–', how: ' ', good: null });
  const spot = op ? SPOTS[op.kind] : null;
  const c = spot ? P(spot.x, spot.y) : null;
  const r = spot ? Math.max(22, spot.r * box.sc) : 0;
  const R = spot && op ? spot.r * box.sc * (2.7 - 1.7 * Math.min(1, op.p)) : 0;
  const closing = !!op && op.p >= 0.85;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker} numberOfLines={1}>
              {kicker}
            </Text>
            <Text style={styles.title}>{mode === 'throw' ? 'In the ring' : 'Incoming'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`Today so far: you ${live.tally.mine}, ${oppName} ${live.tally.theirs}`}>
            <Text style={[styles.title, { color: ME_COLOR }]}>
              {live.tally.mine}–{live.tally.theirs}
            </Text>
            <Text style={styles.small}>you – {oppName}, today</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>ACTIONS</Text>
            <Text style={styles.bankValue}>{left}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              1 per 1,500{live.day.cardio ? ' · +2 cardio' : ''}
            </Text>
          </View>
          <Pressable style={styles.bank} onPress={() => switchMode('slip')} accessibilityRole="button" accessibilityLabel={`Incoming: ${live.combos}`}>
            <Text style={[styles.bankLabel, { color: '#f0a37a' }]}>INCOMING</Text>
            <Text style={styles.bankValue}>{live.combos}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              to face
            </Text>
          </Pressable>
          <View style={styles.bank} accessible accessibilityLabel={`${stars} of 3 stars`}>
            <Text style={[styles.bankLabel, { color: GOLD }]}>STARS</Text>
            <View style={{ flexDirection: 'row', gap: 2, paddingVertical: 2 }}>
              {[0, 1, 2].map((i) => (
                <StarIcon key={i} size={17} color={GOLD} weight={i < stars ? 'fill' : 'regular'} />
              ))}
            </View>
            <Text style={styles.bankNote} numberOfLines={1}>
              from counters
            </Text>
          </View>
        </View>

        <View style={[styles.ring, { transform: [{ translateX: shake }] }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {rv && (
            <>
              <View style={[StyleSheet.absoluteFill, { transform: [{ translateX: shift.x }, { translateY: shift.y }] }]} pointerEvents="none">
                <RingArt rv={rv} apron={apron} />
                <Referee rv={rv} counting={null} />
                <Boxer at={oppAt} height={oppH} facing="front" trunks="#e05b5b" gloves="#c2410c" act={oppA} />
                {tellGlove && <View style={[styles.tell, { left: tellGlove.x - 20, top: tellGlove.y - 20 }]} />}
                {glint && <View style={[styles.glint, { left: P(56, 18).x - 5, top: P(56, 18).y - 5 }]} />}
              </View>
              <Boxer at={{ x: rv.me.x, y: rv.v.h * 1.16 }} height={rv.v.h * 0.44} facing="back" trunks="#4f7be0" gloves="#4f7be0" coat="#c08a52" act={meA} />
            </>
          )}
          {flash > 0 && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(224,91,91,${flash.toFixed(2)})` }]} />}

          {/* Throwing: a swing anywhere but the glow misses. */}
          {mode === 'throw' && x && <Pressable style={StyleSheet.absoluteFill} onPressIn={() => op && throwAt(op.i, null)} accessibilityLabel="Swing at air" />}
          {mode === 'throw' && op && spot && c && (
            <>
              <View pointerEvents="none" style={[styles.approach, { left: c.x - R, top: c.y - R, width: 2 * R, height: 2 * R, borderRadius: R, borderColor: closing ? GREEN : 'rgba(255,255,255,0.9)' }]} />
              <Pressable
                onPressIn={() => x && throwAt(op!.i, (Date.now() - (x.t0 + OFFSETS[op!.i])) / SHRINK)}
                accessibilityRole="button"
                accessibilityLabel={`${spot.name}: tap as the ring closes`}
                style={[
                  styles.target,
                  { left: c.x - r, top: c.y - r, width: 2 * r, height: 2 * r, borderRadius: r, borderColor: closing ? GREEN : AMBER, backgroundColor: closing ? 'rgba(127,211,155,0.35)' : 'rgba(255,210,122,0.28)' },
                ]}
              />
              <Text pointerEvents="none" style={[styles.tag, { left: c.x - 50, top: c.y + r + 4 }]}>
                {spot.name.toUpperCase()}
              </Text>
            </>
          )}

          {/* Incoming: tap where to move. */}
          {mode === 'slip' && d && (
            <>
              <Pressable style={[styles.zone, { left: 0, top: 0, bottom: 0, width: '33%', alignItems: 'flex-start' }]} onPressIn={() => move('left')} accessibilityLabel="Slip left">
                <Text style={styles.zoneText}>‹ SLIP</Text>
              </Pressable>
              <Pressable style={[styles.zone, { right: 0, top: 0, bottom: 0, width: '33%', alignItems: 'flex-end' }]} onPressIn={() => move('right')} accessibilityLabel="Slip right">
                <Text style={styles.zoneText}>SLIP ›</Text>
              </Pressable>
              <Pressable style={[styles.zone, { left: '33%', right: '33%', top: 0, height: '50%', justifyContent: 'flex-start', paddingTop: 36 }]} onPressIn={() => move('back')} accessibilityLabel="Lean back">
                <Text style={styles.zoneText}>LEAN BACK</Text>
              </Pressable>
              <Pressable style={[styles.zone, { left: '33%', right: '33%', bottom: 0, height: '50%', justifyContent: 'flex-end', paddingBottom: 14 }]} onPressIn={() => move('duck')} accessibilityLabel="Duck">
                <Text style={styles.zoneText}>DUCK</Text>
              </Pressable>
              {fromSide && (
                <Text pointerEvents="none" style={[styles.from, fromSide === 'left' ? { left: 10 } : { right: 10 }]}>
                  {fromSide === 'left' ? 'HOOK ›' : '‹ HOOK'}
                </Text>
              )}
              {counterOpen && rv && (
                <Pressable
                  onPressIn={counter}
                  accessibilityRole="button"
                  accessibilityLabel="Counter: tap their face"
                  style={[styles.target, { left: P(50, 24).x + shift.x - 26, top: P(50, 24).y + shift.y - 26, width: 52, height: 52, borderRadius: 26, borderColor: GREEN, backgroundColor: 'rgba(127,211,155,0.4)' }]}
                />
              )}
            </>
          )}

          {mode === 'throw' && !x && stars > 0 && live.canAct && (
            <Pressable onPress={() => setArmed((a) => !a)} style={[styles.starBtn, armed && styles.starBtnOn]} accessibilityRole="button" accessibilityState={{ selected: armed }}>
              <StarIcon size={14} color={armed ? '#161826' : GOLD} weight="fill" />
              <Text style={[styles.starText, armed && { color: '#161826' }]}>{armed ? 'Armed: next punch' : 'Star punch'}</Text>
            </Pressable>
          )}
          {showBanner && banner && (
            <View pointerEvents="none" style={[styles.banner, { backgroundColor: banner.tone === 'star' ? GOLD : banner.tone === 'good' ? GREEN : '#e9e9ed' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <View style={styles.slots}>
          {slotList.map((s, i) => (
            <View key={i} style={[styles.slot, s.good === true && styles.slotGood, s.good === false && styles.slotBad]}>
              <Text style={styles.slotN}>PUNCH {i + 1}</Text>
              <Text style={[styles.slotWhat, s.good === true && { color: '#a6e3b8' }]} numberOfLines={1}>
                {s.what}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {s.how}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.msg}>{msg}</Text>
        <Text style={styles.small}>
          {live.day.steps.toLocaleString()} steps today · {live.day.earned} actions
          {live.day.nextAt != null ? ` · next at ${live.day.nextAt.toLocaleString()}` : ''}. Scored tomorrow morning.
        </Text>
      </ScrollView>

      <View style={styles.pinned}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['throw', 'slip'] as Mode[]).map((m) => {
            const on = mode === m;
            return (
              <Pressable key={m} onPress={() => switchMode(m)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{m === 'throw' ? 'Throw' : `Incoming · ${live.combos}`}</Text>
              </Pressable>
            );
          })}
        </View>
        {mode === 'throw' ? (
          <Pressable onPress={beginExchange} disabled={!canThrow} style={[styles.act, canThrow ? { backgroundColor: '#f08a24' } : styles.actOff]} accessibilityRole="button">
            <Text style={[styles.actText, !canThrow && styles.actTextOff]}>{throwLabel}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={beginDefense} disabled={!canFace} style={[styles.act, canFace ? { backgroundColor: '#f08a24' } : styles.actOff]} accessibilityRole="button">
            <Text style={[styles.actText, !canFace && styles.actTextOff]}>{slipLabel}</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
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
    ring: { flex: 1, minHeight: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    approach: { position: 'absolute', borderWidth: 3 },
    target: { position: 'absolute', borderWidth: 3 },
    tag: { position: 'absolute', width: 100, textAlign: 'center', fontSize: 10.5, fontFamily: font.headingSemibold, letterSpacing: 0.8, color: '#ffffff', textShadowColor: '#000', textShadowRadius: 3 },
    tell: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: AMBER, backgroundColor: 'rgba(255,210,122,0.18)' },
    glint: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#ffffff', shadowColor: '#ffffff', shadowOpacity: 1, shadowRadius: 6 },
    zone: { position: 'absolute', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
    zoneText: { fontSize: 10.5, fontFamily: font.headingSemibold, letterSpacing: 0.8, color: 'rgba(255,255,255,0.75)', backgroundColor: 'rgba(15,17,28,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
    from: { position: 'absolute', top: '42%', fontSize: 12, fontFamily: font.headingSemibold, color: '#161826', backgroundColor: AMBER, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
    starBtn: { position: 'absolute', right: 10, top: 10, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 12, borderWidth: 2, borderColor: GOLD, backgroundColor: 'rgba(15,17,28,0.82)' },
    starBtnOn: { backgroundColor: GOLD },
    starText: { fontFamily: font.headingSemibold, fontSize: 12, color: GOLD },
    banner: { position: 'absolute', alignSelf: 'center', top: '36%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 19, color: '#161826' },
    scroll: { flexGrow: 0, maxHeight: 150, marginTop: 8 },
    scrollBody: { paddingHorizontal: 16, gap: 6, paddingBottom: 6 },
    slots: { flexDirection: 'row', gap: 8 },
    slot: { flex: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: colors.surface, gap: 1 },
    slotGood: { backgroundColor: withAlpha(GREEN, 0.16) },
    slotBad: { backgroundColor: withAlpha('#e05b5b', 0.14) },
    slotN: { fontSize: 10, fontFamily: font.headingSemibold, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55) },
    slotWhat: { fontSize: 13.5, fontFamily: font.headingSemibold, color: colors.text },
    msg: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.78) },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 8 },
    tabs: { flexDirection: 'row', gap: 6, padding: 3, borderRadius: 12, backgroundColor: colors.surface },
    tab: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.text },
    tabText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    tabTextOn: { color: colors.bg },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
    actTextOff: { color: withAlpha(colors.text, 0.6), fontSize: 14 },
  });
}
