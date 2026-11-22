import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { HoundArt } from '../kennel/HoundArt';
import { parseHoundAvatar } from '../kennel/houndAvatar';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { SoccerBall } from '../components/SoccerField';
import { GoalArt, Keeper, shootoutView, zonePoint, type ShootoutView } from '../components/ShootoutGoal';
import { getChallengeSponsor, type ChallengeSponsor } from '../challenges/globalChallenges';
import {
  conversion,
  getShootoutLive,
  isTopBins,
  kickShootout,
  ZONE_NAMES,
  type ShootoutKick,
  type ShootoutKickRow,
  type ShootoutLive,
} from '../challenges/shootoutApi';
import { arcKeys, at, clamp, type Key } from './BaseballBatScreen';
import { BoardLink } from '../components/BoardLink';

// The Hound Shootout (0221), at the spot. Seen from behind the penalty
// spot, facing the goal (ShootoutGoal: every point through project()).
// Tap where in the goal to aim (six spots), then Kick! as the marker
// crosses the green on the power meter. Too soft and the keeper holds it;
// too hard and it's over the bar or wide. The keeper reads your last 10
// kicks: go the same way too often and he goes there. The server decides
// every kick: where he dives, and whether he gets to it.
//
// The pitch never scrolls away (Steve's ask, as H-O-R-S-E and the Derby):
// only the message and today's kicks under it scroll; the meter and the
// button stay pinned at the bottom.

type Phase = 'aim' | 'power' | 'waiting' | 'result';

const GOLD = '#f0c24a';
const ME_COLOR = '#ffd8b0';
const GREEN = '#7fd39b';
// One sweep of the meter, soft to over.
const SWEEP_MS = 1000;
const FLIGHT_MS = 620;
const DIVE_START = 90;
const DIVE_MS = 380;

// Where the meter is, 0-100, a time after it started: soft to over and
// back.
function meterAt(ms: number): number {
  const p = (ms / SWEEP_MS) % 2;
  return (p <= 1 ? p : 2 - p) * 100;
}

function flightFor(sv: ShootoutView, k: ShootoutKick): Key[] {
  const g = sv.goal;
  const start = { x: sv.spot.x, y: sv.spot.y - sv.spot.d / 2, d: sv.spot.d };
  const aim = zonePoint(g, k.zone);
  const far = Math.max(5, sv.spot.d * 0.5);
  const keys: Key[] = [{ t: 0, ...start }];
  const col = k.zone % 3;
  if (k.result === 'held') {
    // Rolled gently at him: he gathers it.
    arcKeys(keys, 0, start, { x: (g.l + g.r) / 2, y: g.bottom - g.h * 0.12, d: far }, 2, FLIGHT_MS * 1.6, 10);
  } else if (k.result === 'over') {
    const t = arcKeys(keys, 0, start, { x: aim.x, y: g.top - g.h * 0.08, d: far }, g.h * 0.4, FLIGHT_MS, 12);
    arcKeys(keys, t, { x: aim.x, y: g.top - g.h * 0.08, d: far }, { x: aim.x + (col - 1) * 12, y: sv.boardsTop - 14, d: far * 0.7 }, 0, 260, 4);
  } else if (k.result === 'wide') {
    const x = col === 0 ? g.l - g.w * 0.14 : g.r + g.w * 0.14;
    const t = arcKeys(keys, 0, start, { x, y: aim.y, d: far }, g.h * 0.2, FLIGHT_MS, 12);
    arcKeys(keys, t, { x, y: aim.y, d: far }, { x: x + (col === 0 ? -10 : 10), y: sv.boardsBottom - 2, d: far * 0.8 }, 0, 240, 4);
  } else if (k.result === 'saved') {
    // To where he gets a glove on it, then away off the post side.
    const stop = { x: aim.x, y: aim.y, d: far };
    const t = arcKeys(keys, 0, start, stop, g.h * 0.25, FLIGHT_MS, 12);
    const out = col === 2 ? 1 : col === 0 ? -1 : k.zone < 3 ? 1 : -1;
    arcKeys(keys, t, stop, { x: aim.x + out * g.w * 0.35, y: g.bottom + g.h * 0.3, d: far * 1.1 }, g.h * 0.2, 380, 6);
  } else {
    const t = arcKeys(keys, 0, start, { x: aim.x, y: aim.y, d: far }, g.h * 0.25, FLIGHT_MS, 12);
    // In the net: a little further back and down.
    arcKeys(keys, t, { x: aim.x, y: aim.y, d: far }, { x: aim.x + (col - 1) * 4, y: g.bottom - g.h * 0.08, d: far * 0.9 }, 0, 300, 5);
  }
  return keys;
}

function bannerFor(k: ShootoutKick): { text: string; tone: 'gold' | 'good' | 'out' } {
  if (k.result === 'goal') {
    if (k.golden) return { text: `★ Golden goal! +${k.points}`, tone: 'gold' };
    return isTopBins(k.zone) ? { text: 'GOAL! Top bins +2', tone: 'good' } : { text: 'GOAL! +1', tone: 'good' };
  }
  if (k.result === 'saved') return { text: 'SAVED', tone: 'out' };
  if (k.result === 'held') return { text: 'Too soft: held', tone: 'out' };
  if (k.result === 'over') return { text: 'Over the bar', tone: 'out' };
  return { text: 'Wide', tone: 'out' };
}

export function kickPill(r: Pick<ShootoutKickRow, 'result' | 'zone' | 'golden'>): string {
  const star = r.golden ? '★ ' : '';
  if (r.result === 'goal') return `${star}Goal${isTopBins(r.zone) ? ' · top bins' : ''}`;
  if (r.result === 'saved') return `${star}Saved`;
  if (r.result === 'held') return `${star}Held`;
  if (r.result === 'over') return `${star}Over`;
  return `${star}Wide`;
}

// The keeper's shirt: the sponsor's colour, or Hound's gold.
export function keeperShirt(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#e0a94f';
}

// What the keeper's leaning says, once he's seen a few.
function leanLine(live: ShootoutLive): string | null {
  if (live.keeper.reads < 3) return null;
  const [l, m, r] = live.keeper.lean;
  if (l >= 0.5) return 'The keeper’s leaning left';
  if (r >= 0.5) return 'The keeper’s leaning right';
  if (m >= 0.4) return 'The keeper’s staying home';
  return null;
}

export function ShootoutKickScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [live, setLive] = useState<ShootoutLive | null>(null);
  const [sponsor, setSponsor] = useState<ChallengeSponsor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iconId, setIconId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('aim');
  const [zone, setZone] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; tone: 'gold' | 'good' | 'out' } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [meterFrom, setMeterFrom] = useState(0);
  const [mark, setMark] = useState<number | null>(null);
  const [shot, setShot] = useState<{ k: ShootoutKick; keys: Key[]; startAt: number } | null>(null);
  const [mine, setMine] = useState<ShootoutKickRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const sent = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const load = useCallback(async () => {
    try {
      setLive(await getShootoutLive(challengeId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Shootout.');
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

  const moving = phase === 'power' || phase === 'result';
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

  const sv = useMemo(() => (size.w > 0 ? shootoutView(size.w, size.h) : null), [size.w, size.h]);
  const boardName = live?.sponsor?.name ?? sponsor?.name ?? 'Hound';
  const shirt = keeperShirt(sponsor?.color ?? live?.sponsor?.color);

  useEffect(() => {
    if (!live || msg) return;
    setMsg(
      live.canKick
        ? 'Tap where in the goal to aim. The top corners count 2, and they’re the hardest to hit.'
        : (live.reason ?? 'No kicks ready.'),
    );
  }, [live, msg]);

  const canKick = !!live && live.canKick && live.kicksLeft > 0;

  const pick = (z: number) => {
    if (!live || !canKick || (phase !== 'aim' && phase !== 'power')) return;
    setZone(z);
    setMark(null);
    setBanner(null);
    if (phase !== 'power') {
      setMeterFrom(Date.now());
      setNow(Date.now());
    }
    setPhase('power');
    setMsg(
      `${ZONE_NAMES[z]}${isTopBins(z) ? ': top bins, worth 2' : ''}. Now tap Kick! as the marker crosses the green.${live.goldenNext ? ' It’s the golden ball: it counts double.' : ''}`,
    );
    buzz('light');
  };

  const kick = async () => {
    if (!live || !sv || zone == null || phase !== 'power' || sent.current) return;
    const power = meterAt(Date.now() - meterFrom);
    sent.current = true;
    setMark(power);
    setPhase('waiting');
    buzz('light');
    try {
      const k = await kickShootout(challengeId, zone, power);
      const startAt = Date.now();
      const keys = flightFor(sv, k);
      setShot({ k, keys, startAt });
      setNow(startAt);
      setPhase('result');
      const flight = keys[keys.length - 1].t;
      later(() => {
        setBanner(bannerFor(k));
        if (k.result === 'goal') buzz('success');
        setMsg(k.message);
        setMine((m) => [{ n: k.n, day: '', zone: k.zone, power: k.power, golden: k.golden, dive: k.dive, perfect: k.perfect, result: k.result, points: k.points }, ...m].slice(0, 8));
        setLive((l) =>
          l
            ? {
                ...l,
                kicksLeft: k.kicksLeft,
                kicksTaken: l.kicksTaken + 1,
                goldenNext: k.goldenNext,
                goldenDone: l.goldenDone || k.golden,
                keeper: { lean: k.lean, reads: Math.min(10, l.keeper.reads + 1) },
                me: { ...l.me, points: k.total, goals: k.goals, kicks: k.kicks, curStreak: k.streak, bestStreak: k.bestStreak, rank: k.rank ?? l.me.rank },
              }
            : l,
        );
      }, FLIGHT_MS);
      later(() => {
        setBanner(null);
        setShot(null);
        setMark(null);
        setZone(null);
        sent.current = false;
        setPhase('aim');
        getShootoutLive(challengeId)
          .then((l) => {
            setLive(l);
            setMine([]);
          })
          .catch(() => {});
      }, flight + 1500);
    } catch (e) {
      sent.current = false;
      setMark(null);
      setPhase('aim');
      Alert.alert('Hound Shootout', e instanceof Error ? e.message : 'Try again.');
      load();
    }
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
  const golden = shot ? shot.k.golden : live.goldenNext && canKick;
  const t = shot ? now - shot.startAt : 0;
  let ball = sv ? { x: sv.spot.x, y: sv.spot.y - sv.spot.d / 2, d: sv.spot.d } : null;
  if (shot) {
    const k = at(shot.keys, t);
    ball = { x: k.x, y: k.y, d: k.d };
  }
  const diveK = shot ? clamp((t - DIVE_START) / DIVE_MS, 0, 1) : 0;
  const diveDir: -1 | 0 | 1 = shot && shot.k.result !== 'held' ? ((shot.k.dive - 1) as -1 | 0 | 1) : 0;
  const lift = shot && shot.k.dive === shot.k.zone % 3 && shot.k.zone < 3 ? 1 : 0;
  const lean = shot ? 0 : live.keeper.reads >= 3 ? live.keeper.lean[2] - live.keeper.lean[0] : 0;
  const kickerStep = shot ? clamp(t / 140, 0, 1) : 0;
  const liveMark = phase === 'power' ? meterAt(now - meterFrom) : mark;
  const w = zone != null ? live.widths[zone] : null;

  const busy = phase === 'waiting' || phase === 'result';
  const actLabel = busy
    ? '…'
    : phase === 'power'
      ? 'Kick!'
      : canKick
        ? 'Tap where to aim'
        : live.reason || (live.nextKickAt != null ? `No kicks ready: your next comes at ${live.nextKickAt.toLocaleString()} steps` : 'That’s 20 kicks today. Back tomorrow.');
  const actOn = phase === 'power';
  const kicks = mine.length ? [...mine, ...live.recent].slice(0, 8) : live.recent;
  const hint = leanLine(live);

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
                HOUND SHOOTOUT{live.dayNo > 0 ? ` · DAY ${live.dayNo} OF ${live.days}` : ''}
              </Text>
            </BoardLink>
            <Text style={styles.title}>At the spot</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessible accessibilityLabel={`${live.me.points} goals`}>
            <Text style={[styles.title, { color: ME_COLOR }]}>{live.me.points}</Text>
            <Text style={styles.small}>goals</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>KICKS LEFT</Text>
            <Text style={styles.bankValue}>{live.kicksLeft}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              1 per 1,000
            </Text>
          </View>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: ME_COLOR }]}>SCORED</Text>
            <Text style={styles.bankValue}>{conversion(live.me.goals, live.me.kicks)}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              {live.me.goals} of {live.me.kicks}
              {live.me.curStreak > 1 ? ` · ${live.me.curStreak} in a row` : ''}
            </Text>
          </View>
          <View style={styles.bank}>
            <Text style={[styles.bankLabel, { color: '#b4aaf0' }]}>RANK</Text>
            <Text style={styles.bankValue}>{live.me.rank != null ? `#${live.me.rank}` : '–'}</Text>
            <Text style={styles.bankNote} numberOfLines={1}>
              {live.field > 0 ? `of ${live.field.toLocaleString()}` : 'kick to get one'}
            </Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {sv && (
            <>
              <GoalArt sv={sv} board={boardName} />
              <Keeper g={sv.goal} color={shirt} label={live.sponsor?.name ?? null} dive={diveDir} k={diveK} lift={lift} lean={lean} />
              {/* The six spots to aim at, while you can. */}
              {(phase === 'aim' || phase === 'power') && canKick && (
                <View style={[styles.grid, { left: sv.goal.l, top: sv.goal.top, width: sv.goal.w, height: sv.goal.h }]}>
                  {[0, 1, 2, 3, 4, 5].map((z) => {
                    const on = zone === z;
                    return (
                      <Pressable
                        key={z}
                        onPress={() => pick(z)}
                        hitSlop={4}
                        style={[styles.cell, on && styles.cellOn]}
                        accessibilityRole="button"
                        accessibilityLabel={`Aim ${ZONE_NAMES[z].toLowerCase()}${isTopBins(z) ? ', worth 2' : ''}`}
                        accessibilityState={{ selected: on }}
                      >
                        {isTopBins(z) && <Text style={styles.cellTwo}>2</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {zone != null && phase !== 'aim' && !shot && (
                <View pointerEvents="none" style={[styles.target, { left: zonePoint(sv.goal, zone).x - 11, top: zonePoint(sv.goal, zone).y - 11 }]} />
              )}
              {/* Your hound, behind the ball. */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: sv.kicker.x - sv.v.h * 0.17,
                  top: sv.kicker.y - sv.v.h * 0.34 - kickerStep * 8,
                  width: sv.v.h * 0.34,
                  height: sv.v.h * 0.34,
                }}
              >
                <HoundArt
                  rank="pup"
                  mood="happy"
                  size={sv.v.h * 0.34}
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
              {ball && (
                <View pointerEvents="none" style={{ position: 'absolute', left: ball.x - ball.d / 2, top: ball.y - ball.d / 2 }}>
                  {golden ? (
                    <View style={[styles.goldBall, { width: ball.d, height: ball.d, borderRadius: ball.d / 2 }]}>
                      <SoccerBall size={ball.d} />
                    </View>
                  ) : (
                    <SoccerBall size={ball.d} />
                  )}
                </View>
              )}
            </>
          )}
          {golden && <Text style={[styles.chip, { left: 10, top: 10, color: GOLD }]}>★ Golden ball · counts double</Text>}
          {!golden && hint && <Text style={[styles.chip, { left: 10, top: 10 }]}>{hint}</Text>}
          {live.pace.cut > 0 && <Text style={[styles.chip, { right: 10, top: 40, color: ME_COLOR }]}>Workout pace · −{live.pace.cut}% saves</Text>}
          {banner && (
            <View
              style={[
                styles.banner,
                { backgroundColor: banner.tone === 'gold' ? GOLD : banner.tone === 'good' ? GREEN : '#e9e9ed' },
              ]}
            >
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Text style={styles.msg}>{msg}</Text>
        {kicks.length > 0 && (
          <View style={styles.today}>
            {kicks.map((r, i) => (
              <Text key={`${r.n}-${i}`} style={[styles.pill, r.result === 'goal' && styles.pillGoal, r.golden && r.result === 'goal' && styles.pillGold]}>
                {kickPill(r)}
              </Text>
            ))}
          </View>
        )}
        <Text style={styles.small}>
          {live.steps.toLocaleString()} steps today · {live.kicksEarned} of {live.cap} kicks earned
          {live.nextKickAt != null ? ` · next at ${live.nextKickAt.toLocaleString()}` : ''}
        </Text>
        <Text style={styles.small}>
          The green narrows as the week goes on{live.stage > 1 ? ' (it has)' : ''}, and it’s narrowest for the top corners. Steps never change it; a strength workout makes your kicks harder to save.
        </Text>
      </ScrollView>

      <View style={styles.pinned}>
        <View style={styles.meter} accessibilityLabel={w != null ? `Power: the green is ${Math.round(live.center - w)} to ${Math.round(live.center + w)}` : 'Power: aim first'}>
          <View style={[styles.band, { backgroundColor: '#c2504f', left: 0, width: '100%' }]} />
          {w != null && (
            <>
              <View style={[styles.band, { backgroundColor: '#b9e6c6', left: `${live.center - w}%`, width: `${2 * w}%` }]} />
              <View style={[styles.band, { backgroundColor: '#3f9a6b', left: `${live.center - w * live.perfectShare}%`, width: `${2 * w * live.perfectShare}%` }]} />
            </>
          )}
          <Text style={[styles.meterWord, { left: 10 }]}>SOFT</Text>
          <Text style={[styles.meterWord, { right: 10 }]}>OVER</Text>
          {liveMark != null && <View style={[styles.markerBar, { left: `${clamp(liveMark, 1, 99)}%` }, phase !== 'power' && { borderColor: ME_COLOR }]} />}
        </View>
        {/* A timing tap counts when the finger lands, not when it lifts (as Hoops and the Derby). */}
        <Pressable
          onPressIn={phase === 'power' ? kick : undefined}
          disabled={!actOn}
          style={[styles.act, actOn ? { backgroundColor: GREEN } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !actOn && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>{actLabel}</Text>
        </Pressable>
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
    field: { flex: 1, minHeight: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1d2133' },
    grid: { position: 'absolute', flexDirection: 'row', flexWrap: 'wrap' },
    cell: {
      width: '33.333%',
      height: '50%',
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: 'rgba(255,255,255,0.7)',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderRadius: 4,
      alignItems: 'flex-end',
      padding: 2,
    },
    cellOn: { borderStyle: 'solid', borderColor: ME_COLOR, backgroundColor: 'rgba(255,216,176,0.22)' },
    cellTwo: { fontFamily: font.headingSemibold, fontSize: 10, color: '#f0c98a' },
    target: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: ME_COLOR, backgroundColor: 'rgba(255,216,176,0.2)' },
    goldBall: { shadowColor: GOLD, shadowOpacity: 0.95, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, backgroundColor: GOLD },
    chip: {
      position: 'absolute',
      backgroundColor: 'rgba(15,17,28,0.8)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    banner: { position: 'absolute', alignSelf: 'center', top: '52%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
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
    pillGoal: { color: GREEN, backgroundColor: withAlpha(GREEN, 0.16) },
    pillGold: { color: '#161826', backgroundColor: GOLD },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, gap: 8 },
    meter: { height: 32, borderRadius: 16, overflow: 'hidden', position: 'relative' },
    band: { position: 'absolute', top: 0, bottom: 0 },
    meterWord: { position: 'absolute', top: 8, fontSize: 11, fontFamily: font.headingSemibold, color: '#ffffff' },
    markerBar: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
