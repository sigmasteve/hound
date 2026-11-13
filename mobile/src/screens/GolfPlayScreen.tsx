import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { GolfHole, type GolfFlight } from '../components/GolfHole';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import {
  GOLF_CLUBS,
  GOLF_LIE_NAME,
  GOLF_POWER_STEPS,
  GOLF_PULL_MAX,
  GOLF_STEPS_PER_YARD,
  caddieClub,
  distanceText,
  golfClub,
  ordinal,
  scoreWord,
  type GolfClubId,
} from '../challenges/golf';
import { getGolfGame, takeGolfShot, type GolfGame, type GolfShotResult, type GolfSpot } from '../challenges/golfApi';

// Golf, played a shot at a time (0200_golf.sql), the way the prototype
// Steve played works: your steps since your last shot are yards, your
// workouts are power, and every shot spends what it used. Pull down on
// the course for distance (sideways to aim) and the caddie picks the club;
// tap a club to choose your own for one shot. Swing, then tap Hit as the
// marker crosses the middle. The server plays the shot and keeps the banks;
// the dotted line here is only a guide.

type Phase = 'aim' | 'meter' | 'waiting' | 'flying' | 'holed';

const PULL_PX = 150; // a full pull, in points

function windArrow(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  if (d < 45 || d >= 315) return '↑';
  if (d < 135) return '→';
  if (d < 225) return '↓';
  return '←';
}

export function GolfPlayScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [game, setGame] = useState<GolfGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ball, setBall] = useState<GolfSpot>({ d: 0, lat: 0 });
  const [lie, setLie] = useState('tee');
  const [strokes, setStrokes] = useState(0);
  const [banks, setBanks] = useState({ yards: 0, power: 0 });
  const [club, setClub] = useState<GolfClubId>('driver');
  const [manual, setManual] = useState(false);
  const [pick, setPick] = useState(0);
  const [pull, setPull] = useState<{ dx: number; dy: number } | null>(null);
  const [phase, setPhase] = useState<Phase>('aim');
  const [flight, setFlight] = useState<GolfFlight | null>(null);
  const [msg, setMsg] = useState('');
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [trail, setTrail] = useState<{ from: GolfSpot; to: GolfSpot }[]>([]);
  // Where the holing shot was played from: the camera stays there.
  const [holedFrom, setHoledFrom] = useState<GolfSpot | null>(null);
  const pending = useRef<GolfShotResult | null>(null);
  // The last hole is in: nothing left to play.
  const [roundOver, setRoundOver] = useState(false);

  const me = game?.players.find((p) => p.userId === game.me) ?? null;
  const holeNo = me?.hole ?? 1;
  const hole = game?.course.holes[(holeNo - 1) % Math.max(1, game.course.holes.length)] ?? null;
  const onGreen = lie === 'green';
  const toPin = hole ? Math.hypot(hole.pin.d - ball.d, hole.pin.lat - ball.lat) : 0;

  const load = useCallback(async () => {
    try {
      const g = await getGolfGame(challengeId);
      if (!g) return;
      setGame(g);
      const mine = g.players.find((p) => p.userId === g.me);
      const h = mine ? g.course.holes[(mine.hole - 1) % Math.max(1, g.course.holes.length)] : null;
      if (mine && h) {
        setBall(mine.ball);
        setLie(mine.lie);
        setStrokes(mine.strokesOnHole);
        const left = Math.hypot(h.pin.d - mine.ball.d, h.pin.lat - mine.ball.lat);
        setClub(mine.lie === 'green' ? 'putter' : caddieClub(left).id);
        setManual(false);
        if (mine.strokesOnHole === 0) setTrail([]);
      }
      setBanks({ yards: g.banks.yards, power: g.banks.power });
      setError(null);
      if (!msg) {
        setMsg(
          `Your ${g.banks.steps.toLocaleString()} steps since your last shot are ${g.banks.yards.toLocaleString()} yards. Pull down on the course: further is longer. The caddie picks the club.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the course.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  useEffect(() => {
    load();
  }, [load]);

  // What the pull asks for: yards (the caddie's club, or yours), aim, where it lands.
  const plan = useMemo(() => {
    if (!pull || !hole) return null;
    const frac = Math.max(0.03, Math.min(1, pull.dy / PULL_PX));
    let c = golfClub(club);
    let yd: number;
    if (c.id === 'putter' || manual) yd = Math.round(frac * c.max);
    else {
      yd = Math.round(frac * GOLF_PULL_MAX);
      c = caddieClub(yd);
    }
    const capped = yd > banks.yards;
    if (capped) yd = banks.yards;
    const aim = Math.max(-35, Math.min(35, -pull.dx / 2.5));
    const base = Math.atan2(hole.pin.lat - ball.lat, hole.pin.d - ball.d);
    const th = base + (aim * Math.PI) / 180;
    const carry = yd * (1 + (c.id === 'putter' ? 0 : pick) / 100);
    return { club: c.id, yd, capped, aim, th, carry, to: { d: ball.d + carry * Math.cos(th), lat: ball.lat + carry * Math.sin(th) } };
  }, [pull, hole, club, manual, banks.yards, ball, pick]);

  // The pull: down for distance, sideways to aim.
  const live = useRef({ phase, canPlay: false });
  const canPlay = !!game && !!me && game.handsOn && game.status === 'live' && !me.done && (strokes > 0 || game.today.canStart);
  live.current = { phase, canPlay };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => live.current.phase === 'aim' && live.current.canPlay,
        onMoveShouldSetPanResponder: () => live.current.phase === 'aim' && live.current.canPlay,
        onPanResponderGrant: () => setPull({ dx: 0, dy: 0 }),
        onPanResponderMove: (_e, g) => setPull({ dx: g.dx, dy: g.dy }),
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  // The meter: a marker sweeping across, there and back.
  const meter = useRef(new Animated.Value(0)).current;
  const meterAt = useRef(0);
  const loop = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    const id = meter.addListener(({ value }) => {
      meterAt.current = value;
    });
    return () => meter.removeListener(id);
  }, [meter]);

  const swing = async () => {
    if (phase === 'holed') {
      setBanner(null);
      setHoledFrom(null);
      setPhase('aim');
      setTrail([]);
      setPull(null);
      await load();
      return;
    }
    if (phase === 'aim') {
      if (!plan || plan.yd <= 0) return;
      setPhase('meter');
      setMsg('Tap Hit as the marker crosses the middle. Early hooks it left, late slices it right.');
      meter.setValue(0.05);
      loop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(meter, { toValue: 1, duration: 560, easing: Easing.linear, useNativeDriver: false }),
          Animated.timing(meter, { toValue: 0, duration: 560, easing: Easing.linear, useNativeDriver: false }),
        ]),
      );
      loop.current.start();
      return;
    }
    if (phase === 'meter' && plan && game) {
      loop.current?.stop();
      const timing = meterAt.current - 0.5;
      buzz('light');
      setPhase('waiting');
      try {
        const r = await takeGolfShot(challengeId, {
          club: plan.club,
          yards: plan.yd,
          aim: plan.aim,
          power: plan.club === 'putter' ? 0 : pick,
          timing,
        });
        pending.current = r;
        // Fly to where it came down; after water or out of bounds, the next
        // shot is from r.ball (the drop, or where it was).
        setFlight({ from: r.from, to: r.to, putt: plan.club === 'putter', carry: r.carry, key: Date.now() });
        setPhase('flying');
      } catch (e) {
        setPhase('aim');
        setPull(null);
        Alert.alert('Golf', e instanceof Error ? e.message : 'Try again.');
      }
    }
  };

  const landed = () => {
    const r = pending.current;
    setFlight(null);
    if (!r || !hole) {
      setPhase('aim');
      return;
    }
    setTrail((t) => t.concat([{ from: r.from, to: r.to }]));
    setBall(r.ball);
    setLie(r.holed ? 'holed' : r.lie === 'water' || r.lie === 'out' ? 'drop' : r.lie);
    setStrokes(r.strokesOnHole);
    setBanks(r.banks);
    setPull(null);
    setPick(0);
    if (r.holed || r.pickedUp) {
      setHoledFrom(r.from);
      const score = r.holeScore ?? r.strokesOnHole;
      const diff = score - hole.par;
      buzz(diff <= 0 ? 'success' : 'light');
      setBanner({ text: `${r.pickedUp ? 'Picked up' : scoreWord(score, hole.par)} · ${score} ${score === 1 ? 'stroke' : 'strokes'}`, good: diff <= 0 });
      setMsg(
        r.message ||
          `In the hole in ${score}. ${r.banks.yards.toLocaleString()} yards left in the bank${r.nextHole ? ` for the ${ordinal(r.nextHole)}.` : '.'}`,
      );
      if (r.nextHole == null || r.finished) setRoundOver(true);
      setPhase('holed');
      return;
    }
    const left = Math.hypot(hole.pin.d - r.ball.d, hole.pin.lat - r.ball.lat);
    const green = r.lie === 'green';
    setClub(green ? 'putter' : caddieClub(left).id);
    setManual(false);
    const caddie = green ? `putter for ${Math.round(left * 3)} ft` : `${caddieClub(left).name.toLowerCase()} for ${Math.round(left)} yd`;
    setMsg(`${r.message || `${Math.round(r.carry)} yd, ${GOLF_LIE_NAME[r.lie] ?? r.lie}.`} Caddie: ${caddie}.`);
    setPhase('aim');
  };

  if (!game || !hole || !me) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <TopBar onBack={onBack} styles={styles} colors={colors} />
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  const powerFrom = game.banks.powerFrom.map((p) => `${p.name.replace(/Traditional |Functional /, '')} ${p.minutes} min${p.mult > 1 ? ` ×${p.mult}` : ''}`).join(' + ');
  const yardsFull = Math.max(1, game.banks.yards);
  const powerFull = Math.max(1, game.banks.power);
  const shownClub = plan ? plan.club : club;
  const limitHit = strokes === 0 && !game.today.canStart;
  const finished = roundOver || me.done || game.status === 'final';
  const swingReady = phase === 'meter' || phase === 'holed' || (phase === 'aim' && finished) || (phase === 'aim' && !!plan && plan.yd > 0 && canPlay);
  const swingLabel =
    phase === 'meter'
      ? 'Hit!'
      : phase === 'waiting' || phase === 'flying'
        ? '…'
        : finished
          ? 'Back to the card'
          : phase === 'holed'
            ? 'Next hole'
            : limitHit
            ? `That's ${game.holesPerDay} holes today. More tomorrow.`
            : !game.handsOn
              ? 'Your walks play this game for you'
              : banks.yards <= 0
                ? 'No yards banked yet: go for a walk'
                : plan
                  ? 'Swing'
                  : 'Pull down on the course to aim';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar onBack={onBack} styles={styles} colors={colors} />
      <ScrollView contentContainerStyle={styles.body} scrollEnabled={!pull}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>
              {game.course.name.toUpperCase()} · HOLE {holeNo}
            </Text>
            <Text style={styles.title}>
              Par {hole.par} · {hole.length} yd
            </Text>
            <Text style={styles.small}>
              {hole.name}
              {hole.slope ? ` · ${hole.slope}` : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.small}>Stroke</Text>
            <Text style={styles.title}>{phase === 'holed' ? strokes : strokes + 1}</Text>
          </View>
        </View>

        <View style={styles.banks}>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#a6e3b8' }]}>YARDS</Text>
              <Text style={styles.bankValue}>{banks.yards.toLocaleString()}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { backgroundColor: colors.green, width: `${Math.round(Math.min(1, banks.yards / yardsFull) * 100)}%` }]} />
            </View>
            <Text style={styles.bankNote}>{(banks.yards * GOLF_STEPS_PER_YARD).toLocaleString()} steps banked</Text>
          </View>
          <View style={styles.bank}>
            <View style={styles.bankTop}>
              <Text style={[styles.bankLabel, { color: '#ffd8b0' }]}>POWER</Text>
              <Text style={styles.bankValue}>{banks.power}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { backgroundColor: '#f08a24', width: `${Math.round(Math.min(1, banks.power / powerFull) * 100)}%` }]} />
            </View>
            <Text style={styles.bankNote} numberOfLines={2}>
              {powerFrom || 'Workouts add power: strength ×2, golf ×3'}
            </Text>
          </View>
        </View>

        <View {...responder.panHandlers}>
          <GolfHole
            hole={hole}
            course={game.course.id}
            ball={ball}
            plan={plan && phase !== 'waiting' ? { to: plan.to, putt: plan.club === 'putter' } : null}
            flight={flight}
            onLanded={landed}
            trail={trail}
            cameraAt={phase === 'holed' ? holedFrom : null}
          />
          <View style={styles.chips} pointerEvents="none">
            <Text style={styles.chip}>{phase === 'holed' ? 'In the hole' : `${distanceText(toPin)} to the ${toPin < 30 ? 'cup' : 'pin'}`}</Text>
            <Text style={styles.chip}>
              Wind {Math.round(game.wind.mph)} mph {windArrow(game.wind.deg)}
            </Text>
          </View>
          {phase !== 'holed' && (
            <Text style={[styles.chip, styles.lieChip]} pointerEvents="none">
              {GOLF_LIE_NAME[lie] ?? (lie === 'drop' ? 'Drop' : lie)}
              {lie === 'green' && Math.abs(hole.green.break) >= 0.02 ? ` · breaks ${hole.green.break > 0 ? 'right' : 'left'}` : ''}
            </Text>
          )}
          {phase === 'aim' && !pull && strokes === 0 && canPlay && (
            <View style={styles.hint} pointerEvents="none">
              <Text style={styles.hintText}>Put your finger on the course and pull down toward you. Pull left or right to aim.</Text>
            </View>
          )}
          {plan && (phase === 'aim' || phase === 'meter') && (
            <View style={styles.pullInfo} pointerEvents="none">
              <Text style={styles.pullText}>
                <Text style={{ fontFamily: font.headingSemibold, color: '#fff' }}>{plan.club === 'putter' ? distanceText(plan.carry) : `${Math.round(plan.carry)} yd`}</Text> · {golfClub(plan.club).name}
                {manual ? ' (yours)' : ''} · {Math.abs(plan.aim) < 2 ? 'at the pin' : `${Math.round(Math.abs(plan.aim))}° ${plan.aim > 0 ? 'right' : 'left'}`}
                {plan.capped ? ' · all your yards' : ''}
              </Text>
              <Text style={[styles.pullText, { color: '#a6e3b8' }]}>
                {(plan.yd * GOLF_STEPS_PER_YARD).toLocaleString()} steps{pick && plan.club !== 'putter' ? ` + ${pick} power` : ''}
              </Text>
            </View>
          )}
          {banner && (
            <View style={[styles.banner, { backgroundColor: banner.good ? '#ffd8b0' : '#e9e9ed' }]} pointerEvents="none">
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>

        {/* The bag: the caddie (Auto), or a club of your own for one shot. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bag}>
          <Pressable
            onPress={() => {
              setManual(false);
              setPull(null);
            }}
            disabled={phase !== 'aim' || onGreen}
            style={[styles.clubChip, !manual && !onGreen && styles.clubOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: !manual && !onGreen }}
          >
            <Text style={styles.clubName}>Auto</Text>
            <Text style={styles.clubMax}>{manual ? 'Back to caddie' : 'Caddie picks'}</Text>
          </Pressable>
          {GOLF_CLUBS.map((c) => {
            const on = shownClub === c.id;
            const disabled = phase !== 'aim' || (c.id === 'putter' ? !onGreen : onGreen);
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  setClub(c.id);
                  setManual(c.id !== 'putter');
                  setPull(null);
                }}
                disabled={disabled}
                style={[styles.clubChip, on && styles.clubOn, disabled && !on && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled }}
              >
                <Text style={styles.clubName}>{c.name}</Text>
                <Text style={styles.clubMax}>{c.max} yd</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.powerRow}>
          <Text style={styles.powerLabel}>Power</Text>
          {GOLF_POWER_STEPS.map((p) => {
            const on = pick === p;
            const disabled = phase !== 'aim' || p > banks.power || onGreen;
            return (
              <Pressable
                key={p}
                onPress={() => setPick(p)}
                disabled={disabled}
                style={[styles.powerChip, on && styles.powerOn, disabled && !on && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled }}
              >
                <Text style={styles.powerText}>{p ? `+${p}%` : 'None'}</Text>
              </Pressable>
            );
          })}
        </View>

        {phase === 'meter' && (
          <View style={styles.meter}>
            <View style={[styles.meterBand, { backgroundColor: '#e5484d', left: 0, width: '100%' }]} />
            <View style={[styles.meterBand, { backgroundColor: '#e0a94f', left: '15%', width: '70%' }]} />
            <View style={[styles.meterBand, { backgroundColor: '#7fd39b', left: '38%', width: '24%' }]} />
            <View style={[styles.meterBand, { backgroundColor: '#3fb37f', left: '46%', width: '8%' }]} />
            <Text style={[styles.meterWord, { left: 10 }]}>HOOK</Text>
            <Text style={[styles.meterWord, { right: 10 }]}>SLICE</Text>
            <Animated.View
              style={[
                styles.marker,
                { left: meter.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        )}

        <Pressable
          onPress={finished && phase !== 'meter' && phase !== 'waiting' && phase !== 'flying' ? onBack : swing}
          disabled={!swingReady}
          style={[styles.swing, swingReady ? { backgroundColor: phase === 'meter' ? '#f08a24' : colors.green } : styles.swingOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.swingText, !swingReady && { color: withAlpha(colors.text, 0.55) }]}>{swingLabel}</Text>
        </Pressable>
        <Text style={styles.msg}>{msg}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar({ onBack, styles, colors }: { onBack: () => void; styles: ReturnType<typeof makeStyles>; colors: Palette }) {
  return (
    <View style={styles.top}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <ArrowLeftIcon size={20} color={colors.accentActive} />
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { paddingHorizontal: 16, paddingVertical: 6, minHeight: 36 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    body: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    banks: { flexDirection: 'row', gap: 8 },
    bank: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: colors.surface },
    bankTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    bankLabel: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6 },
    bankValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    bar: { height: 5, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1), marginTop: 6, overflow: 'hidden' },
    barFill: { height: 5 },
    bankNote: { fontSize: 11, color: withAlpha(colors.text, 0.6), marginTop: 4 },
    chips: { position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 6 },
    chip: {
      backgroundColor: 'rgba(15,17,28,0.75)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    lieChip: { position: 'absolute', right: 10, top: 10 },
    hint: { position: 'absolute', left: '50%', bottom: 70, width: 240, marginLeft: -120, backgroundColor: 'rgba(15,17,28,0.82)', borderRadius: 12, padding: 10 },
    hintText: { color: '#fff', fontSize: 12.5, fontFamily: font.headingSemibold, textAlign: 'center' },
    pullInfo: {
      position: 'absolute',
      left: 10,
      right: 10,
      top: 44,
      backgroundColor: 'rgba(15,17,28,0.85)',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
    },
    pullText: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, flexShrink: 1 },
    banner: { position: 'absolute', alignSelf: 'center', top: '42%', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 18, color: '#161826' },
    bag: { gap: 6, paddingVertical: 2 },
    clubChip: {
      minWidth: 62,
      minHeight: 44,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      justifyContent: 'center',
    },
    clubOn: { borderWidth: 2, borderColor: '#a6e3b8', backgroundColor: 'rgba(127,211,155,0.18)' },
    clubName: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text },
    clubMax: { fontSize: 10.5, color: withAlpha(colors.text, 0.7) },
    powerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    powerLabel: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), minWidth: 46 },
    powerChip: {
      flex: 1,
      minHeight: 44,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    powerOn: { borderWidth: 2, borderColor: '#ffd8b0', backgroundColor: 'rgba(240,138,36,0.18)' },
    powerText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text },
    meter: { height: 30, borderRadius: 15, overflow: 'hidden', position: 'relative' },
    meterBand: { position: 'absolute', top: 0, bottom: 0 },
    meterWord: { position: 'absolute', top: 8, fontSize: 11, fontFamily: font.headingSemibold, color: '#161826' },
    marker: { position: 'absolute', top: 0, bottom: 0, width: 6, marginLeft: -3, borderRadius: 3, backgroundColor: '#161826', borderWidth: 2, borderColor: '#ffffff' },
    swing: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    swingOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    swingText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
    msg: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.72), minHeight: 36 },
  });
}
