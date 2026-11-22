import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { useHealthProvider } from '../health/HealthContext';
import { localDayKey } from '../goals/goals';
import { LongShotRangeArt } from '../components/LongShotRange';
import {
  aimLongShot,
  fireLongShot,
  getLongShot,
  longshotBreath,
  longshotFlagWind,
  longshotSway,
  PLACE_NAMES,
  setLongShotLoadout,
  yd,
  type LongShotAim,
  type LongShotGame,
  type LongShotResult,
  type LongShotRifle,
} from '../challenges/longshotApi';
import { BoardLink } from '../components/BoardLink';

// Long Shot (0247): the range, the scope and the shot. The server flies
// every round; this screen draws the day's range (2.5D, LongShotRange),
// the reticle's sway with the server's own formula, and what happened.
// The range never scrolls away: only what's under it scrolls, and the
// action stays pinned (Steve's rule).

type Mode = 'range' | 'scope' | 'flying' | 'shot';

const fmt = (n: number) => n.toLocaleString('en-US');
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const sideOf = (x: number) => (x >= 0 ? 'R' : 'L');
const upOf = (y: number) => (y >= 0 ? 'up' : 'down');

export function LongShotScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { width } = useWindowDimensions();
  const [game, setGame] = useState<LongShotGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('range');
  const [dist, setDist] = useState<number | null>(null);
  const [aim, setAim] = useState<LongShotAim | null>(null);
  const [aimAt, setAimAt] = useState(0);
  const [hold, setHold] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [shot, setShot] = useState<LongShotResult | null>(null);
  const [flyAt, setFlyAt] = useState(0);
  const [rack, setRack] = useState(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const dragFrom = useRef({ x: 0, y: 0 });

  const todaySteps = useCallback(async (): Promise<number | null> => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const days = await health.getDailyStepsSince(start);
      return days.find((d) => d.date === localDayKey(new Date()))?.steps ?? null;
    } catch {
      return null;
    }
  }, [health]);

  const load = useCallback(async () => {
    try {
      const g = await getLongShot(challengeId, await todaySteps());
      setGame(g);
      setError(null);
      setDist((d) => d ?? pickPlate(g));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the range.');
    }
  }, [challengeId, todaySteps]);

  useEffect(() => {
    load();
  }, [load]);

  // The flags and the sway move: a frame clock while they're on screen.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > (mode === 'range' ? 120 : 33)) {
        last = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const scopeSize = Math.min(width - 32, 360);
  const plate = aim ? { size: aim.size, dist: aim.dist } : null;
  // Scale: about ±5.5 mils across the scope's radius.
  const pxPerMil = scopeSize / 2 / 5.5;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragFrom.current = { ...holdRef.current };
        },
        onPanResponderMove: (_e, g) => {
          // Drag the scope: right aims right, up aims higher.
          const x = Math.max(-25, Math.min(25, dragFrom.current.x + g.dx / pxPerMil));
          const y = Math.max(-25, Math.min(25, dragFrom.current.y - g.dy / pxPerMil));
          setHold({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        },
      }),
    [pxPerMil],
  );

  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  const cond = game.conditions;
  const moon = cond.world === 'moon';
  const left = game.today.left;
  const live = !game.over && game.me.joined && game.dayNo >= 1 && game.dayNo <= game.days;
  const rifle = game.rifles.find((r) => r.id === game.me.caliber) ?? game.rifles[0];
  const cardRow = (d: number | null) => game.card.find((c) => c.dist === d) ?? null;
  const selPlate = game.plates.find((p) => p.dist === dist) ?? null;

  const takeAim = async (d: number | null = dist) => {
    if (busy || d == null) return;
    setBusy(true);
    try {
      const a = await aimLongShot(challengeId, d);
      setAim(a);
      setAimAt(Date.now());
      setHold({ x: 0, y: 0 });
      setShot(null);
      setMode('scope');
    } catch (e) {
      Alert.alert('Long Shot', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const fire = async () => {
    if (busy || !aim) return;
    setBusy(true);
    const t = Date.now() - aimAt;
    buzz('light');
    try {
      const r = await fireLongShot(challengeId, aim.aimId, hold.x, hold.y, t);
      setShot(r);
      setFlyAt(Date.now());
      setMode('flying');
      const flight = Math.max(500, Math.min(2600, r.tof * 1000));
      setTimeout(() => {
        if (r.hit) buzz(r.gold || r.center ? 'success' : 'light');
        setMode('shot');
        load();
      }, flight + 650);
    } catch (e) {
      Alert.alert('Long Shot', e instanceof Error ? e.message : 'Try again.');
      setMode('range');
      load();
    } finally {
      setBusy(false);
    }
  };

  // ── Header ──
  const header = (
    <View style={styles.head}>
      <Pressable
        onPress={mode === 'range' ? onBack : () => setMode('range')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={mode === 'range' ? 'Back' : 'Back to the range'}
        style={{ paddingBottom: 4 }}
      >
        <ArrowLeftIcon size={20} color={colors.accentActive} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <BoardLink challengeId={challengeId}>
          <Text style={styles.kicker} numberOfLines={1}>
            LONG SHOT{game.dayNo >= 1 && game.dayNo <= game.days ? ` · DAY ${game.dayNo} OF ${game.days}` : ''}
            {moon ? ' · MOON DAY' : ''}
          </Text>
        </BoardLink>
        <Text style={styles.title}>{mode === 'range' ? (moon ? 'The Moon range' : 'The range') : mode === 'scope' ? 'In the scope' : yd(aim?.dist ?? 0)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.title, { color: '#f0a24a' }]}>{fmt(game.me.points)}</Text>
        <Text style={styles.small}>
          points · {ord(game.me.rank)} of {fmt(game.players)}
        </Text>
      </View>
    </View>
  );

  // ── The range ──
  if (mode === 'range') {
    const sceneW = width - 32;
    const sceneH = Math.round(sceneW * 1.05);
    const toNext = game.today.nextAt != null ? game.today.nextAt - game.today.steps : null;
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.fixed}>
          {header}
          <View style={styles.stats}>
            <Stat label="ROUNDS" tone="#8fd8a8" value={String(left)} sub={toNext != null ? `${fmt(toNext)} steps to the next` : `all ${game.settings.maxRounds} today`} styles={styles} />
            <Stat
              label="HOLD"
              tone="#f0c27a"
              value={game.today.steady ? 'Steady' : 'Shaky'}
              sub={game.today.steady ? `a ${game.today.workoutMin}-min workout` : `a ${game.settings.workoutMin}-min workout steadies it`}
              styles={styles}
            />
            <Stat label="LONGEST" tone="#b9b2f0" value={game.me.longest ? yd(game.me.longest) : '–'} sub={`${game.me.hits} of ${game.me.shots} hit`} styles={styles} />
          </View>
          <View style={styles.scene}>
            <LongShotRangeArt width={sceneW} height={sceneH} conditions={cond} plates={game.plates} selected={dist} onPick={setDist} now={now} />
            <View style={styles.sceneChips} pointerEvents="none">
              <Text style={styles.sceneChip}>
                {moon ? '⅙ gravity · no air · no wind' : `${cond.tempF}°F · ${cond.altitudeFt ? `${fmt(cond.altitudeFt)} ft` : 'sea level'} · read the flags`}
              </Text>
              {cond.bounty && (
                <Text style={[styles.sceneChip, { color: '#ffd34d' }]}>
                  {game.goldTaker ? `Gold rung by ${game.goldTaker.me ? 'you' : game.goldTaker.name}` : `Gold: ${yd(cond.gold)}`}
                </Text>
              )}
            </View>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.under}>
          <View style={styles.chips}>
            {game.plates.map((p) => {
              const on = p.dist === dist;
              return (
                <Pressable
                  key={p.dist}
                  onPress={() => setDist(p.dist)}
                  style={[styles.chip, on ? styles.chipOn : p.gold ? styles.chipGold : p.hitToday ? styles.chipHit : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${p.dist} yards, ${p.pts} points${p.gold ? ', the gold plate' : ''}${p.hitToday ? ', rung today' : ''}`}
                >
                  <Text style={[styles.chipText, on && { color: '#1b1205' }, !on && p.gold && { color: '#ffd34d' }, !on && p.hitToday && { color: '#8fd8a8' }]}>
                    {fmt(p.dist)} · {p.pts}
                    {p.hitToday ? ' ✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.line}>
            {moon
              ? 'Moon day: no wind to read, and rounds barely drop. The plates are tiny, so it’s all in the hold.'
              : `Today’s range is the same for everyone. ${cond.bounty ? (game.goldTaker ? `The gold plate went to ${game.goldTaker.me ? 'you' : game.goldTaker.name} today.` : `The gold plate at ${yd(cond.gold)} pays ${game.settings.bountyBones} Bones to the first to ring it.`) : ''}`}
          </Text>
          <Text style={styles.small}>
            A center hit doubles. The day’s first round, if it hits, adds {game.settings.coldBore}. Rounds: 1 per {fmt(game.settings.stepsPerRound)} steps, up to{' '}
            {game.settings.maxRounds} a day, and they carry over a day.
          </Text>
          {game.card.length > 0 && <DataCard game={game} highlight={dist} styles={styles} />}
          {game.recent.length > 0 && (
            <View style={styles.box}>
              <Text style={styles.boxHead}>YOUR LAST ROUNDS</Text>
              {game.recent.map((r, i) => (
                <Text key={i} style={styles.small}>
                  {yd(r.dist)}: {r.hit ? (r.center ? `center, ${r.points}` : `hit, ${r.points}`) : `miss, ${Math.round(Math.abs(r.yIn))} in ${r.yIn > 0 ? 'high' : 'low'}, ${Math.round(Math.abs(r.xIn))} in ${r.xIn > 0 ? 'right' : 'left'}`}
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
        <View style={styles.pinned}>
          <Pressable onPress={() => setRack(true)} style={styles.rifleRow} accessibilityRole="button" accessibilityLabel={`Rifle: ${rifle?.name}, ${game.me.barrel} inch barrel. Change it`}>
            <Text style={styles.small}>Rifle</Text>
            <Text style={styles.rifleName}>
              {rifle?.name} · {game.me.barrel} in barrel ›
            </Text>
          </Pressable>
          <Pressable
            onPress={() => takeAim()}
            disabled={!live || left < 1 || !selPlate || busy}
            style={[styles.act, live && left > 0 && selPlate ? { backgroundColor: moon ? '#b9b2f0' : colors.green } : styles.actOff]}
            accessibilityRole="button"
          >
            <Text style={[styles.actText, !(live && left > 0) && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>
              {!live
                ? game.over
                  ? 'This one’s over'
                  : game.me.joined
                    ? 'It hasn’t started yet'
                    : 'Join to shoot'
                : left < 1
                  ? `No rounds: ${fmt(game.today.nextAt != null ? game.today.nextAt - game.today.steps : 0)} steps to the next`
                  : `Take aim at ${yd(dist ?? 0)}`}
            </Text>
          </Pressable>
        </View>
        <RifleRack
          visible={rack}
          game={game}
          styles={styles}
          colors={colors}
          onClose={() => setRack(false)}
          onPick={async (r, barrel) => {
            try {
              await setLongShotLoadout(challengeId, r.id, barrel);
              setRack(false);
              load();
            } catch (e) {
              Alert.alert('Long Shot', e instanceof Error ? e.message : 'Try again.');
            }
          }}
        />
      </SafeAreaView>
    );
  }

  // ── The scope (and the flight in it) ──
  if ((mode === 'scope' || mode === 'flying') && aim && plate) {
    const t = Math.max(0, now - aimAt);
    const flying = mode === 'flying' && shot;
    const sw = flying ? shot.sway : longshotSway(aim.seed, aim.amp, t);
    const ax = flying ? shot.hold.x : hold.x;
    const ay = flying ? shot.hold.y : hold.y;
    const R = scopeSize / 2;
    // The plate in the scope: where the reticle isn't.
    const px = R - (ax + sw.x) * pxPerMil;
    const py = R + (ay + sw.y) * pxPerMil;
    const plateR = Math.max(1.5, (plate.size / 2 / (plate.dist * 0.036)) * pxPerMil);
    const br = longshotBreath(t);
    const windMid = (longshotFlagWind(cond.wind, now, 'near') + longshotFlagWind(cond.wind, now, 'mid')) / 2;
    const row = cardRow(plate.dist);
    // The flight: the trace rises and falls onto the impact, over its time.
    const fk = flying ? Math.max(0, Math.min(1, (now - flyAt) / Math.max(500, Math.min(2600, shot.tof * 1000)))) : 0;
    const impX = flying ? px + shot.impact.xMil * pxPerMil : 0;
    const impY = flying ? py - shot.impact.yMil * pxPerMil : 0;
    const trX = flying ? R + (impX - R) * fk : 0;
    const trY = flying ? R + (impY - R) * fk - Math.sin(Math.PI * fk) * R * 0.5 : 0;
    const landed = flying && fk >= 1;
    const mirage = (now / (cond.wind.from === 'right' ? -40 : 40)) % 28;
    const ticks = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.fixed}>
          {header}
          <View style={styles.stats}>
            <Stat label="DIALED UP" tone={colors.text} value={`${aim.dial.toFixed(1)} mil`} sub={aim.learned ? 'your data card' : 'the book (no hit yet)'} styles={styles} />
            <Stat
              label="YOUR HOLD"
              tone="#f0a24a"
              value={`${Math.abs(ax).toFixed(1)} ${sideOf(ax)} · ${Math.abs(ay).toFixed(1)} ${upOf(ay)}`}
              sub="drag the scope to hold off"
              styles={styles}
            />
          </View>
          <View style={{ alignItems: 'center' }} {...(mode === 'scope' ? pan.panHandlers : {})}>
            <Svg
              width={scopeSize}
              height={scopeSize}
              accessibilityLabel={`The scope on the ${plate.dist} yard plate. Holding ${Math.abs(ax).toFixed(1)} mils ${ax >= 0 ? 'right' : 'left'} and ${Math.abs(ay).toFixed(1)} ${ay >= 0 ? 'up' : 'down'}.`}
            >
              <Defs>
                <ClipPath id="lens">
                  <Circle cx={R} cy={R} r={R - 6} />
                </ClipPath>
              </Defs>
              <Circle cx={R} cy={R} r={R} fill="#050507" />
              <G clipPath="url(#lens)">
                <Rect x={0} y={0} width={scopeSize} height={scopeSize} fill={moon ? '#8b8d95' : '#a8996e'} />
                <Rect x={0} y={0} width={scopeSize} height={py - plateR * 2.4} fill={moon ? '#05060a' : '#8a7b5e'} />
                {!moon &&
                  [0.25, 0.45, 0.65, 0.85].map((k, i) => (
                    <Path
                      key={i}
                      d={`M${((i * 70 + mirage) % 56) - 56} ${scopeSize * k} q7 -3 14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0 t14 0`}
                      stroke="#c9bb8c"
                      strokeWidth={1.2}
                      fill="none"
                      opacity={0.45}
                    />
                  ))}
                <Line x1={px} y1={py} x2={px} y2={py + plateR * 2.2} stroke="#4a4232" strokeWidth={Math.max(1.5, plateR * 0.3)} />
                <Circle cx={px} cy={py} r={plateR} fill={aim.size >= 48 && cond.gold === plate.dist && cond.bounty ? '#ffd34d' : '#f4f1e8'} stroke="#2f2f2f" strokeWidth={1.2} />
                <Circle cx={px} cy={py} r={plateR / 3} fill="none" stroke="#bdb6a2" strokeWidth={1} />
                {flying && fk > 0.02 && !landed && <Circle cx={trX} cy={trY} r={2.4} fill="#ffe27a" />}
                {landed && shot && (
                  <G>
                    <Circle cx={impX} cy={impY} r={shot.hit ? 4 : 6} fill={shot.hit ? '#3a3a3a' : '#c9b48a'} opacity={0.9} />
                    <Circle cx={impX} cy={impY} r={shot.hit ? 12 : 10} fill="none" stroke={shot.hit ? (shot.gold ? '#ffd34d' : '#f08a24') : '#e9dcc0'} strokeWidth={2.5} />
                  </G>
                )}
              </G>
              {/* The reticle: mil hashes, numbered. */}
              <G stroke="#111" strokeWidth={1.5}>
                <Line x1={10} y1={R} x2={scopeSize - 10} y2={R} />
                <Line x1={R} y1={10} x2={R} y2={scopeSize - 10} />
                {ticks.map((k) => (
                  <G key={k}>
                    <Line x1={R + k * pxPerMil} y1={R - 6} x2={R + k * pxPerMil} y2={R + 6} />
                    <Line x1={R - 6} y1={R + k * pxPerMil} x2={R + 6} y2={R + k * pxPerMil} />
                  </G>
                ))}
              </G>
              {[1, 2, 3, 4].map((k) => (
                <G key={`n${k}`}>
                  <SvgText fontFamily={font.headingSemibold} x={R - k * pxPerMil - 3} y={R + 17} fontSize={10} fontWeight="700" fill="#111">
                    {k}
                  </SvgText>
                  <SvgText fontFamily={font.headingSemibold} x={R + 9} y={R + k * pxPerMil + 4} fontSize={10} fontWeight="700" fill="#111">
                    {k}
                  </SvgText>
                </G>
              ))}
              <Circle cx={R} cy={R} r={2.6} fill="#f08a24" />
              <Circle cx={R} cy={R} r={R - 3} fill="none" stroke="#000" strokeWidth={8} />
            </Svg>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.under}>
          {!moon && (
            <Text style={styles.line}>
              Flags {Math.abs(windMid) < 2 ? 'hanging nearly still' : `out ${windMid > 0 ? 'to the right' : 'to the left'}`}: about {Math.round(Math.abs(windMid))} mph from the{' '}
              {windMid >= 0 ? 'left' : 'right'}.
            </Text>
          )}
          {row && (
            <Text style={styles.small}>
              Your card at {yd(plate.dist)}: {row.elev.toFixed(1)} up{!moon ? ` · 10 mph full-value ≈ ${row.wind10.toFixed(1)} mil` : ''} · {row.tof.toFixed(1)} s to get there.
            </Text>
          )}
          <View>
            <View style={styles.breathHead}>
              <Text style={styles.boxHead}>BREATH</Text>
              <Text style={[styles.boxHead, { color: br.phase === 'pause' ? '#8fd8a8' : br.tired ? '#f08a6a' : withAlpha(colors.text, 0.6) }]}>
                {br.phase === 'pause' ? 'NATURAL PAUSE: FIRE NOW' : br.tired ? 'ARMS TIRING: SWAY GROWS' : 'BREATHING'}
              </Text>
            </View>
            <View style={styles.breathBar}>
              <View style={[styles.breathPause, { left: `${(2800 / 4500) * 100}%`, width: `${(1400 / 4500) * 100}%` }]} />
              <View style={[styles.breathMark, { left: `${br.k * 100}%` }]} />
            </View>
          </View>
        </ScrollView>
        <View style={[styles.pinned, { flexDirection: 'row' }]}>
          <Pressable onPress={() => setHold({ x: 0, y: 0 })} disabled={mode !== 'scope'} style={styles.reset} accessibilityRole="button">
            <Text style={styles.resetText}>Reset hold</Text>
          </Pressable>
          <Pressable
            onPress={fire}
            disabled={mode !== 'scope' || busy}
            style={[styles.act, { flex: 1 }, mode === 'scope' ? { backgroundColor: '#f08a24' } : styles.actOff]}
            accessibilityRole="button"
          >
            <Text style={[styles.actText, { color: mode === 'scope' ? '#1b1205' : colors.text }]}>{mode === 'scope' ? 'Fire' : landed ? (shot?.hit ? 'Clang!' : 'Miss') : 'In flight…'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── The shot ──
  if (mode === 'shot' && shot) {
    const plateBox = 132;
    const scale = (plateBox / 2 - 10) / Math.max(shot.size / 2, Math.hypot(shot.impact.xIn, shot.impact.yIn) + 2);
    const ix = plateBox / 2 + shot.impact.xIn * scale;
    const iy = plateBox / 2 - shot.impact.yIn * scale;
    const sideW = width - 56;
    const apex = Math.min(52, 14 + shot.dropMil * 0.9);
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.under}>
          {header}
          <View>
            <Text style={styles.kicker}>{yd(shot.dist)} · {shot.size} IN PLATE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <Text style={[styles.big, { color: shot.hit ? '#ffd34d' : colors.text }]}>{shot.gold ? 'The gold plate!' : shot.center ? 'Center!' : shot.hit ? 'Clang!' : 'Miss'}</Text>
              {shot.points > 0 && (
                <Text style={styles.plus}>
                  +{shot.points}
                  {shot.coldBore ? ` (${game.settings.coldBore} for the cold bore)` : ''}
                  {shot.gold ? ` · ${shot.goldBones} Bones` : ''}
                </Text>
              )}
            </View>
            <Text style={styles.line}>
              {shot.hit
                ? `${Math.round(Math.hypot(shot.impact.xIn, shot.impact.yIn))} in from center, ${shot.tof.toFixed(2)} s after you fired.`
                : `${Math.round(Math.abs(shot.impact.yIn))} in ${shot.impact.yIn > 0 ? 'high' : 'low'} and ${Math.round(Math.abs(shot.impact.xIn))} in ${shot.impact.xIn > 0 ? 'right' : 'left'}. ${Math.abs(shot.impact.yMil) > Math.abs(shot.impact.xMil) ? `Next time hold ${Math.abs(shot.impact.yMil).toFixed(1)} ${shot.impact.yMil > 0 ? 'lower' : 'higher'}.` : `Next time hold ${Math.abs(shot.impact.xMil).toFixed(1)} more ${shot.impact.xMil > 0 ? 'left' : 'right'}.`}`}
            </Text>
          </View>

          <View style={styles.box}>
            <Text style={styles.boxHead}>THE ROUND’S FLIGHT, FROM THE SIDE</Text>
            <Svg width={sideW} height={110} accessibilityLabel={`From ${fmt(shot.muzzle)} feet per second at the muzzle to ${fmt(shot.vEnd)} at the plate, in ${shot.tof.toFixed(2)} seconds`}>
              <Rect x={0} y={0} width={sideW} height={110} rx={10} fill={moon ? '#05060a' : '#2b3a4f'} />
              <Rect x={0} y={82} width={sideW} height={28} fill={moon ? '#8b8d95' : '#9a8a62'} />
              <Line x1={16} y1={74} x2={sideW - 18} y2={74} stroke="#c9d3e3" strokeWidth={1} strokeDasharray="4 4" />
              <Path d={`M16 74 Q ${sideW * 0.55} ${74 - apex * 2} ${sideW - 22} ${shot.hit ? 70 : 76}`} fill="none" stroke="#f08a24" strokeWidth={3} />
              <Line x1={sideW - 22} y1={60} x2={sideW - 22} y2={82} stroke="#4a4232" strokeWidth={3} />
              <Circle cx={sideW - 22} cy={68} r={8} fill={shot.gold ? '#ffd34d' : '#f4f1e8'} stroke="#2f2f2f" strokeWidth={1.4} />
              <SvgText fontFamily={font.headingSemibold} x={22} y={100} fontSize={10} fontWeight="700" fill={moon ? '#2a2b31' : '#3d3524'}>
                {fmt(shot.muzzle)} fps
              </SvgText>
              <SvgText fontFamily={font.headingSemibold} x={sideW - 90} y={100} fontSize={10} fontWeight="700" fill={moon ? '#2a2b31' : '#3d3524'}>
                {fmt(shot.vEnd)} fps
              </SvgText>
              <SvgText fontFamily={font.headingSemibold} x={sideW * 0.4} y={20} fontSize={10} fontWeight="700" fill="#f2f3f7">
                {shot.dropMil.toFixed(1)} mil drop · {shot.tof.toFixed(2)} s
              </SvgText>
            </Svg>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={[styles.plateBox, { width: plateBox, height: plateBox, backgroundColor: moon ? '#8b8d95' : '#a8996e' }]}>
              <Svg width={plateBox} height={plateBox} accessibilityLabel={shot.hit ? 'Your hit on the plate' : 'Where it went past the plate'}>
                <Circle cx={plateBox / 2} cy={plateBox / 2} r={(shot.size / 2) * scale} fill="#f4f1e8" stroke="#2f2f2f" strokeWidth={2} />
                <Circle cx={plateBox / 2} cy={plateBox / 2} r={(shot.size / 6) * scale} fill="none" stroke="#bdb6a2" strokeWidth={2} />
                <Circle cx={ix} cy={iy} r={4} fill={shot.hit ? '#3a3a3a' : '#7d6f52'} />
                <Circle cx={ix} cy={iy} r={8} fill="none" stroke="#f08a24" strokeWidth={2} />
              </Svg>
            </View>
            <View style={{ flex: 1, gap: 5 }}>
              <Pair k="Dialed" v={`${shot.dial.toFixed(1)} mil`} styles={styles} />
              <Pair k="Held" v={`${Math.abs(shot.hold.x).toFixed(1)} ${sideOf(shot.hold.x)} · ${Math.abs(shot.hold.y).toFixed(1)} ${upOf(shot.hold.y)}`} styles={styles} />
              {!moon && <Pair k="Wind as it flew" v={`${shot.windMph.toFixed(1)} mph`} styles={styles} />}
              <Pair k="Sway at the shot" v={`${Math.hypot(shot.sway.x, shot.sway.y).toFixed(2)} mil`} styles={styles} />
              <Pair k="Total" v={`${fmt(shot.total)} points`} styles={styles} />
            </View>
          </View>
          {shot.learned != null && <Text style={[styles.small, { color: '#8fd8a8' }]}>Your data card now says {shot.learned.toFixed(1)} mil up at {yd(shot.dist)}.</Text>}
          <DataCard game={game} highlight={shot.dist} styles={styles} />
        </ScrollView>
        <View style={[styles.pinned, { flexDirection: 'row' }]}>
          <Pressable onPress={() => setMode('range')} style={styles.reset} accessibilityRole="button">
            <Text style={styles.resetText}>The range</Text>
          </Pressable>
          <Pressable
            onPress={() => takeAim(shot.dist)}
            disabled={shot.left < 1 || busy}
            style={[styles.act, { flex: 1 }, shot.left > 0 ? { backgroundColor: colors.green } : styles.actOff]}
            accessibilityRole="button"
          >
            <Text style={[styles.actText, shot.left < 1 && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>
              {shot.left > 0 ? `Next round · ${shot.left} left` : 'No rounds left today'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// The best plate to start on: the nearest not rung today.
function pickPlate(g: LongShotGame): number | null {
  return (g.plates.find((p) => !p.hitToday) ?? g.plates[0])?.dist ?? null;
}

function Stat({ label, tone, value, sub, styles }: { label: string; tone: string; value: string; sub: string; styles: Styles }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: tone }]}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statSub} numberOfLines={2}>
        {sub}
      </Text>
    </View>
  );
}

function Pair({ k, v, styles }: { k: string; v: string; styles: Styles }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
      <Text style={styles.small}>{k}</Text>
      <Text style={styles.pairV}>{v}</Text>
    </View>
  );
}

function DataCard({ game, highlight, styles }: { game: LongShotGame; highlight: number | null; styles: Styles }) {
  const rifle = game.rifles.find((r) => r.id === game.me.caliber);
  const moon = game.conditions.world === 'moon';
  return (
    <View style={styles.box}>
      <Text style={styles.boxHead}>
        YOUR DATA CARD · {rifle?.name.toUpperCase()} · {game.me.barrel} IN{moon ? ' · MOON' : ` · ${PLACE_NAMES[game.conditions.place].toUpperCase()}`}
      </Text>
      <View style={styles.cardRow}>
        <Text style={[styles.cardCell, styles.cardHead]}>Plate</Text>
        <Text style={[styles.cardCell, styles.cardHead]}>Up</Text>
        <Text style={[styles.cardCell, styles.cardHead]}>{moon ? 'Time' : '10 mph'}</Text>
      </View>
      {game.card.map((c) => {
        const on = c.dist === highlight;
        return (
          <View key={c.dist} style={styles.cardRow}>
            <Text style={[styles.cardCell, on && styles.cardOn]}>{fmt(c.dist)}</Text>
            <Text style={[styles.cardCell, on && styles.cardOn, !c.learned && styles.cardBook]}>
              {c.elev.toFixed(1)}
              {c.learned ? '' : ' book'}
            </Text>
            <Text style={[styles.cardCell, on && styles.cardOn]}>{moon ? `${c.tof.toFixed(1)} s` : c.wind10.toFixed(1)}</Text>
          </View>
        );
      })}
      <Text style={styles.small}>Book numbers are sea level and 59°F. A hit replaces one with what really worked here.</Text>
    </View>
  );
}

function RifleRack({
  visible,
  game,
  styles,
  colors,
  onClose,
  onPick,
}: {
  visible: boolean;
  game: LongShotGame;
  styles: Styles;
  colors: Palette;
  onClose: () => void;
  onPick: (r: LongShotRifle, barrel: number) => void;
}) {
  const [pick, setPick] = useState(game.me.caliber);
  const [barrel, setBarrel] = useState(game.me.barrel);
  useEffect(() => {
    if (visible) {
      setPick(game.me.caliber);
      setBarrel(game.me.barrel);
    }
  }, [visible, game.me.caliber, game.me.barrel]);
  const r = game.rifles.find((x) => x.id === pick) ?? game.rifles[0];
  const b = r && r.barrels.includes(barrel) ? barrel : r?.refBarrel ?? 24;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBack} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Your rifle</Text>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }}>
          <View style={[styles.rackRow, { backgroundColor: 'transparent' }]}>
            <Text style={[styles.rackCell, styles.cardHead, { flex: 1.6 }]}>CALIBER</Text>
            <Text style={[styles.rackCell, styles.cardHead]}>1,000 UP</Text>
            <Text style={[styles.rackCell, styles.cardHead]}>WIND 10</Text>
            <Text style={[styles.rackCell, styles.cardHead]}>STAYS FAST</Text>
          </View>
          {game.rifles.map((x) => {
            const on = x.id === pick;
            return (
              <Pressable
                key={x.id}
                onPress={() => x.unlocked && setPick(x.id)}
                style={[styles.rackRow, on && styles.rackOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !x.unlocked }}
              >
                <View style={{ flex: 1.6 }}>
                  <Text style={[styles.rackName, !x.unlocked && { color: withAlpha(colors.text, 0.6) }]}>
                    {!x.unlocked && <LockSimpleIcon size={11} color={withAlpha(colors.text, 0.6)} />} {x.name}
                  </Text>
                  <Text style={styles.small}>{x.unlocked ? x.bullet : `${fmt(game.me.gameSteps)} / ${fmt(x.unlockSteps)} steps`}</Text>
                </View>
                <Text style={styles.rackCell}>{x.at1000.drop.toFixed(1)}</Text>
                <Text style={styles.rackCell}>{x.at1000.wind10.toFixed(1)}</Text>
                <Text style={styles.rackCell}>{x.subsonicAt ? `to ${fmt(x.subsonicAt)}` : 'all the way'}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.small}>“Stays fast” is the first plate where it’s slower than sound. Past that it wobbles and hits scatter wider.</Text>
        </ScrollView>
        {r && (
          <View style={{ gap: 6 }}>
            <Text style={styles.boxHead}>BARREL · {r.name.toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {r.barrels.map((len) => {
                const on = len === b;
                return (
                  <Pressable key={len} onPress={() => setBarrel(len)} style={[styles.barrel, on && styles.rackOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={styles.rackName}>{len} in</Text>
                    <Text style={styles.small}>{fmt(r.mv + r.fpsInch * (len - r.refBarrel))} fps</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.small}>Each inch adds about {r.fpsInch} fps: less drop and drift, but a heavier rifle sways more.</Text>
          </View>
        )}
        <Pressable onPress={() => r && onPick(r, b)} style={[styles.act, { backgroundColor: colors.green }]} accessibilityRole="button">
          <Text style={styles.actText}>
            Use the {r?.name} · {b} in
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    fixed: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
    under: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    big: { fontFamily: font.headingSemibold, fontSize: 32, color: colors.text },
    plus: { fontFamily: font.headingSemibold, fontSize: 16, color: '#8fd8a8' },
    small: { fontSize: 12, lineHeight: 16, color: withAlpha(colors.text, 0.68) },
    line: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.88) },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: colors.surface },
    statLabel: { fontFamily: font.headingSemibold, fontSize: 10, letterSpacing: 0.6 },
    statValue: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    statSub: { fontSize: 10.5, color: withAlpha(colors.text, 0.65) },
    scene: { borderRadius: 16, overflow: 'hidden' },
    sceneChips: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
    sceneChip: {
      fontFamily: font.headingSemibold,
      fontSize: 11,
      color: '#f2f3f7',
      backgroundColor: 'rgba(18,20,28,0.85)',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      overflow: 'hidden',
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { minHeight: 34, paddingHorizontal: 11, borderRadius: 17, justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.08) },
    chipOn: { backgroundColor: '#f08a24' },
    chipGold: { backgroundColor: '#3a3214' },
    chipHit: { backgroundColor: '#24402f' },
    chipText: { fontFamily: font.headingSemibold, fontSize: 12.5, color: withAlpha(colors.text, 0.88) },
    box: { borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.surface },
    boxHead: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.62) },
    cardRow: { flexDirection: 'row' },
    cardCell: { flex: 1, fontSize: 13, color: colors.text },
    cardHead: { fontSize: 11, color: withAlpha(colors.text, 0.6) },
    cardOn: { color: '#ffd34d', fontFamily: font.headingSemibold },
    cardBook: { color: withAlpha(colors.text, 0.6) },
    pairV: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.text },
    plateBox: { borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    breathHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
    breathBar: { height: 10, borderRadius: 5, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    breathPause: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#3a7d55' },
    breathMark: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: '#f2f3f7' },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    rifleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 28 },
    rifleName: { fontFamily: font.headingSemibold, fontSize: 13, color: '#8fd8a8' },
    act: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 18, color: '#0e1a12', textAlign: 'center' },
    reset: {
      width: 112,
      minHeight: 54,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    resetText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    sheetBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30, gap: 10 },
    rackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, padding: 9, backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent' },
    rackOn: { borderColor: '#f08a24', backgroundColor: '#2c2416' },
    rackName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    rackCell: { flex: 1, fontSize: 12.5, color: colors.text },
    barrel: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent' },
  });
}
