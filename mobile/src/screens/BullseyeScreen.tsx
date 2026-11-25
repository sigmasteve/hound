import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { useHealthProvider } from '../health/HealthContext';
import { localDayKey } from '../goals/goals';
import { BALLOON_COLOR, BowArt, ClothFlag, BullseyeFieldArt, FaceRings } from '../components/BullseyeField';
import { longshotFlagWind } from '../challenges/longshotApi';
import {
  aimBullseye,
  ARROWS,
  bullseyeBalloon,
  bullseyeDrawPhase,
  bullseyeSway,
  getBullseye,
  setBullseyeLoadout,
  shootBullseye,
  shootBullseyeVolley,
  targetName,
  type BullseyeAim,
  type BullseyeArrow,
  type BullseyeGame,
  type BullseyeResult,
} from '../challenges/bullseyeApi';
import { BoardLink } from '../components/BoardLink';

// Bullseye (0249): the field, drawing and aiming, the arrow's flight (the
// fun part: a slow-motion chase behind the arrow, the target growing as
// it closes in), and the end. The server flies every arrow; this screen
// draws the day's field and the pin's sway with the server's formulas.
// The field never scrolls away and the action stays pinned.

type Mode = 'field' | 'draw' | 'flight' | 'arrow';

const fmt = (n: number) => n.toLocaleString('en-US');
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const SLOW = 3;

export function BullseyeScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { width } = useWindowDimensions();
  const [game, setGame] = useState<BullseyeGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('field');
  const [target, setTarget] = useState<string | null>(null);
  const [aim, setAim] = useState<BullseyeAim | null>(null);
  const [hold, setHold] = useState({ x: 0, y: 0 });
  const [drawAt, setDrawAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [shot, setShot] = useState<BullseyeResult | null>(null);
  // A volley (0265): how many arrows off this draw, 1 to 3.
  const [volley, setVolley] = useState(1);
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
      const g = await getBullseye(challengeId, await todaySteps());
      setGame(g);
      setError(null);
      setTarget((t) => t ?? (g.targets.find((x) => x.kind === 'face' || x.kind === 'balloon') ?? g.targets[0])?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the field.');
    }
  }, [challengeId, todaySteps]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > (mode === 'field' ? 100 : 33)) {
        last = t;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const viewW = width - 32;
  const viewH = Math.round(Math.min(400, viewW * 1.02));
  // How many px a cm is at the target, for the aiming view.
  const pxPerCm = useMemo(() => {
    if (!aim) return 1;
    if (aim.kind === 'clout') return (viewW * 0.42) / 750;
    if (aim.kind === 'balloon' || aim.kind === 'gold') return viewW / (2 * (aim.conditions.drift?.amp ?? 40) + 140);
    return (viewW * 0.36) / (aim.face / 2);
  }, [aim, viewW]);
  const cmPerMil = (aim?.dist ?? 50) / 10;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragFrom.current = { ...holdRef.current };
        },
        onPanResponderMove: (_e, g) => {
          // Drag the pin where you want to aim.
          const x = Math.max(-60, Math.min(60, dragFrom.current.x + g.dx / pxPerCm / cmPerMil));
          const y = Math.max(-60, Math.min(60, dragFrom.current.y - g.dy / pxPerCm / cmPerMil));
          setHold({ x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 });
        },
      }),
    [pxPerCm, cmPerMil],
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
  const bow = game.bows.find((b) => b.id === game.me.bow) ?? game.bows[0];
  const sel = game.targets.find((t) => t.id === target) ?? null;
  const arrowNo = (game.today.used % game.settings.arrowsPerEnd) + 1;
  const endNo = Math.floor(game.today.used / game.settings.arrowsPerEnd) + 1;

  const stepUp = async (id: string | null = target) => {
    if (busy || !id) return;
    setBusy(true);
    try {
      const a = await aimBullseye(challengeId, id);
      setAim(a);
      setHold({ x: 0, y: 0 });
      setDrawAt(null);
      setShot(null);
      setMode('draw');
    } catch (e) {
      Alert.alert('Bullseye', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const loose = async () => {
    if (!aim || drawAt == null || busy) return;
    const t = Date.now() - drawAt;
    setBusy(true);
    try {
      const room = Math.min(3, game ? game.settings.arrowsPerEnd - (game.today.used % game.settings.arrowsPerEnd) : 1, game?.today.left ?? 1);
      const n = Math.max(1, Math.min(volley, room));
      let r: BullseyeResult;
      if (n > 1) {
        // The first arrow flies on screen; the round's line lists them all.
        const v = await shootBullseyeVolley(challengeId, aim.aimId, hold.x, hold.y, t, n);
        const first = v.arrows[0];
        const last = v.arrows[v.arrows.length - 1];
        const word = (a: BullseyeResult) => (a.popped ? 'pop' : a.kind === 'balloon' || a.kind === 'gold' ? 'miss' : a.kind === 'clout' ? `flag ${a.ring}` : a.ring > 0 ? String(a.ring) : 'off');
        r = {
          ...first,
          robin: v.arrows.some((a) => a.robin),
          gold: v.arrows.some((a) => a.gold),
          goldBones: v.arrows.reduce((n2, a) => n2 + a.goldBones, 0),
          points: v.points,
          message: `A volley of ${v.arrows.length}: ${v.arrows.map(word).join(' · ')}. ${v.arrows.some((a) => a.robin) ? 'And a Robin Hood! ' : ''}`,
          arrowNo: last.arrowNo,
          endTotal: last.endTotal,
          left: last.left,
          total: last.total,
        };
      } else {
        r = await shootBullseye(challengeId, aim.aimId, hold.x, hold.y, t);
      }
      const t0 = Date.now();
      setShot(r);
      setFlyAt(t0);
      setNow(t0);
      setMode('flight');
      buzz('light');
      const d = flightMs(r.tof);
      setTimeout(() => {
        if (r.ring >= 9 || r.popped || r.robin) buzz('success');
        setMode('arrow');
        load();
      }, d + 900);
    } catch (e) {
      Alert.alert('Bullseye', e instanceof Error ? e.message : 'Try again.');
      setMode('field');
      load();
    } finally {
      setDrawAt(null);
      setBusy(false);
    }
  };

  const header = (
    <View style={styles.head}>
      <Pressable
        onPress={mode === 'field' ? onBack : () => setMode('field')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={mode === 'field' ? 'Back' : 'Back to the field'}
        style={{ paddingBottom: 4 }}
      >
        <ArrowLeftIcon size={20} color={colors.accentActive} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <BoardLink challengeId={challengeId}>
          <Text style={styles.kicker} numberOfLines={1}>
            BULLSEYE{game.dayNo >= 1 && game.dayNo <= game.days ? ` · DAY ${game.dayNo} OF ${game.days}` : ''}
            {moon ? ' · MOON DAY' : cond.balloons ? ' · BALLOON DAY' : ''}
          </Text>
        </BoardLink>
        <Text style={styles.title}>
          {mode === 'field' ? (moon ? 'The Moon field' : 'The field') : mode === 'draw' ? 'Draw and aim' : aim ? targetName(aim) : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.title, { color: '#ffd23f' }]}>{fmt(game.me.points)}</Text>
        <Text style={styles.small}>
          points · {ord(game.me.rank)} of {fmt(game.players)}
        </Text>
      </View>
    </View>
  );

  // ── The field ──
  if (mode === 'field') {
    const sceneH = Math.round(viewW * 1.05);
    const toNext = game.today.nextAt != null ? game.today.nextAt - game.today.steps : null;
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.fixed}>
          {header}
          <View style={styles.stats}>
            <Stat label="ARROWS" tone="#8fd8a8" value={String(left)} sub={toNext != null ? `${fmt(toNext)} steps to 3 more` : `all ${game.settings.maxEnds} rounds earned today`} styles={styles} />
            <Stat
              label="YOUR ARMS"
              tone="#f0c27a"
              value={game.today.steady ? 'Steady' : 'Shaky'}
              sub={game.today.steady ? 'you worked out today' : `a ${game.settings.workoutMin}-min workout steadies them`}
              styles={styles}
            />
            <Stat label="BEST ROUND" tone="#b9b2f0" value={String(game.me.bestEnd)} sub={`${game.me.golds} bullseyes · ${game.me.robinHoods} Robin Hoods`} styles={styles} />
          </View>
          <View style={styles.scene}>
            <BullseyeFieldArt width={viewW} height={sceneH} conditions={cond} targets={game.targets} selected={target} onPick={setTarget} now={now} bow={game.me.bow} />
            <View style={styles.sceneChips} pointerEvents="none">
              <Text style={styles.sceneChip}>
                {moon ? '⅙ gravity · no air · no breeze' : `${cond.tempF}°F · ${Math.abs(longshotFlagWind(cond.wind, now, 'mid')) < 1 ? 'calm' : `breeze from the ${cond.wind.from}`}`}
              </Text>
              {cond.bounty && (
                <Text style={[styles.sceneChip, { color: '#ffd23f' }]}>
                  {game.goldTaker ? `Gold balloon popped by ${game.goldTaker.me ? 'you' : game.goldTaker.name}` : `Gold balloon: ${game.settings.bountyBones} Bones`}
                </Text>
              )}
            </View>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.under}>
          <View style={styles.chips}>
            {game.targets.map((t) => {
              const on = t.id === target;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTarget(t.id)}
                  style={[styles.chip, on ? styles.chipOn : t.kind === 'gold' ? styles.chipGold : t.bestToday != null && t.bestToday >= 9 ? styles.chipHit : null]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && { color: '#1b1205' }, !on && t.kind === 'gold' && { color: '#ffd23f' }]}>
                    {t.kind === 'face' ? `${t.dist} m` : t.kind === 'clout' ? `Flag ${t.dist} m` : t.kind === 'gold' ? `Gold balloon` : `Balloon ${t.dist} m`} · ×{t.stars}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.line}>
            {moon
              ? 'Moon day: gravity is weak (⅙ of Earth’s), there’s no air and no wind, and arrows fly 500 m. The far targets look tiny, so keep your arms steady.'
              : cond.balloons
                ? 'Balloon day: the wind blows the balloons back and forth. Aim where a balloon is going, not where it is. A pop scores its × times 5.'
                : `Everyone shoots the same field today. ${cond.bounty ? (game.goldTaker ? `The gold balloon went to ${game.goldTaker.me ? 'you' : game.goldTaker.name}.` : `Pop the gold balloon first for ${game.settings.bountyBones} Bones.`) : ''}`}
          </Text>
          <Text style={styles.small}>
            How it scores: each ring is 1 (outside) to 10 (the bullseye), times the target’s ×. The farther it is, the more it’s worth: a 9 at 70 m (×4) is {9 * 4}.
            The flag at 150 m is the longest shot: lob it high and land near the flag. Hit one of your own arrows already in the target this round and it splits: a Robin Hood, +
            {game.settings.robinHood}. You get a round of {game.settings.arrowsPerEnd} arrows for every {fmt(game.settings.stepsPerEnd)} steps, up to {game.settings.maxEnds} rounds a day.
          </Text>
          {game.ends.length > 0 && <EndsToday game={game} styles={styles} />}
          <SightTape game={game} highlight={target} styles={styles} />
        </ScrollView>
        <View style={styles.pinned}>
          <Pressable onPress={() => setRack(true)} style={styles.rifleRow} accessibilityRole="button" accessibilityLabel={`Bow: ${bow?.name}. Change it`}>
            <Text style={styles.small}>Bow</Text>
            <Text style={styles.rifleName}>
              {bow?.name} · {ARROWS.find((a) => a.id === game.me.arrow)?.name.toLowerCase()} arrows ›
            </Text>
          </Pressable>
          <Pressable
            onPress={() => stepUp()}
            disabled={!live || left < 1 || !sel || busy}
            style={[styles.act, live && left > 0 && sel ? { backgroundColor: moon ? '#b9b2f0' : colors.green } : styles.actOff]}
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
                  ? `No arrows: ${fmt(game.today.nextAt != null ? game.today.nextAt - game.today.steps : 0)} steps to 3 more arrows`
                  : `Shoot · round ${endNo}, arrow ${arrowNo} of ${game.settings.arrowsPerEnd}`}
            </Text>
          </Pressable>
        </View>
        <BowRack
          visible={rack}
          game={game}
          styles={styles}
          colors={colors}
          onClose={() => setRack(false)}
          onPick={async (b, a) => {
            try {
              await setBullseyeLoadout(challengeId, b, a);
              setRack(false);
              load();
            } catch (e) {
              Alert.alert('Bullseye', e instanceof Error ? e.message : 'Try again.');
            }
          }}
        />
      </SafeAreaView>
    );
  }

  // ── Draw and aim ──
  if (mode === 'draw' && aim) {
    const t = drawAt != null ? Math.max(0, now - drawAt) : 0;
    const sw = drawAt != null ? bullseyeSway(aim.seed, aim.amp, t) : { x: 0, y: 0 };
    const phase = drawAt != null ? bullseyeDrawPhase(t, aim.fullDrawMs) : null;
    const cx = viewW / 2;
    const cy = viewH * 0.52;
    const pinX = cx + (hold.x + sw.x) * cmPerMil * pxPerCm;
    const helperX = aim.helperXCm != null ? pinX + aim.helperXCm * pxPerCm : null;
    const balloon = aim.kind === 'balloon' || aim.kind === 'gold' ? bullseyeBalloon(aim.conditions, aim.target, now + aim.tof * 1000) : null;
    // The clout lies on the ground: up the screen is farther.
    const tanD = Math.max(0.05, (4 * Math.max(0.3, aim.apex)) / aim.dist);
    const pinY = aim.kind === 'clout' ? cy - (((hold.y + sw.y) * cmPerMil) / tanD) * pxPerCm * 0.35 : cy - (hold.y + sw.y) * cmPerMil * pxPerCm;
    const r = (aim.face / 2) * pxPerCm;
    const offCm = { x: Math.round(hold.x * cmPerMil), y: Math.round(hold.y * cmPerMil) };
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.fixed}>
          {header}
          <View style={styles.stats}>
            <Stat label="HOW HIGH TO AIM" tone={colors.text} value={aim.learned ? 'Locked in' : 'Your best guess'} sub={aim.learned ? 'from your bullseye here' : 'hit a 9 or 10 here to lock it in'} styles={styles} />
            <Stat
              label="YOUR AIM"
              tone="#f0a24a"
              value={offCm.x === 0 && offCm.y === 0 ? 'Center' : `${offCm.x === 0 ? '' : `${Math.abs(offCm.x)} cm ${offCm.x >= 0 ? 'right' : 'left'}`}${offCm.x !== 0 && offCm.y !== 0 ? ', ' : ''}${offCm.y === 0 ? '' : `${Math.abs(offCm.y)} cm ${offCm.y >= 0 ? 'up' : 'down'}`}`}
              sub={aim.kind === 'clout' ? 'drag the dot · up lands farther' : 'drag the dot to aim'}
              styles={styles}
            />
          </View>
          <View {...(drawAt == null ? pan.panHandlers : {})} style={{ borderRadius: 16, overflow: 'hidden' }}>
            <Svg width={viewW} height={viewH} accessibilityLabel={`Aiming at the ${targetName(aim)}`}>
              <Rect x={0} y={0} width={viewW} height={viewH} fill={moon ? '#8b8d95' : '#7cca69'} />
              <Rect x={0} y={0} width={viewW} height={viewH * 0.22} fill={moon ? '#05060a' : '#8cc8f0'} />
              {!moon && [0.08, 0.32, 0.6, 0.86].map((x, i) => <Ellipse key={i} cx={x * viewW} cy={viewH * 0.22} rx={viewW * 0.15} ry={viewH * 0.06} fill="#3f8a4f" />)}
              {aim.kind === 'face' && (
                <G>
                  <Line x1={cx - r * 0.75} y1={cy + r * 1.05} x2={cx - r * 0.95} y2={cy + r * 1.7} stroke="#5a4a33" strokeWidth={6} />
                  <Line x1={cx + r * 0.75} y1={cy + r * 1.05} x2={cx + r * 0.95} y2={cy + r * 1.7} stroke="#5a4a33" strokeWidth={6} />
                  <Rect x={cx - r * 1.15} y={cy - r * 1.15} width={r * 2.3} height={r * 2.3} fill="#d8b36a" />
                  <FaceRings cx={cx} cy={cy} r={r} />
                  <Circle cx={cx} cy={cy} r={r / 20} fill="none" stroke="#a37d10" strokeWidth={1} />
                </G>
              )}
              {aim.kind === 'clout' && (
                <G>
                  {[1, 2, 3, 4, 5].map((k) => (
                    <Ellipse key={k} cx={cx} cy={cy} rx={150 * k * pxPerCm} ry={150 * k * pxPerCm * 0.35} fill="none" stroke="#ffffff" strokeWidth={1.2} opacity={0.8} />
                  ))}
                  <Line x1={cx} y1={cy} x2={cx} y2={cy - 46} stroke="#5a4a33" strokeWidth={2.5} />
                  <ClothFlag x={cx} top={cy - 46} len={28} h={14} wind={longshotFlagWind(aim.conditions.wind, now, 'far')} now={now} />
                </G>
              )}
              {balloon && (
                <G>
                  <Line x1={cx + balloon.x * pxPerCm} y1={cy - balloon.y * pxPerCm + 15 * pxPerCm} x2={cx + balloon.x * pxPerCm * 0.6} y2={viewH} stroke="#ffffff" strokeWidth={1} />
                  <Ellipse cx={cx + balloon.x * pxPerCm} cy={cy - balloon.y * pxPerCm} rx={15 * pxPerCm} ry={18 * pxPerCm} fill={BALLOON_COLOR[aim.target] ?? '#e2412f'} />
                  <Ellipse cx={cx} cy={cy} rx={4} ry={4} fill="none" stroke="#ffffff" strokeDasharray="2 3" strokeWidth={1} />
                </G>
              )}
              {/* The bow on the left, the arrow to the pin. */}
              <BowArt bow={game.me.bow} x={(viewH + 16) * 0.17 + 18} top={-8} bottom={viewH + 8} bend={-1} s={2.4} string={false} />
              <Line x1={44} y1={viewH / 2 + 8} x2={pinX - 8} y2={pinY + 4} stroke="#9aa0b4" strokeWidth={2} opacity={drawAt != null ? 1 : 0.5} />
              {helperX != null && (
                <Circle cx={helperX} cy={pinY} r={9} fill="none" stroke="#ffffff" strokeWidth={1.6} strokeDasharray="3 3" />
              )}
              {aim.sight ? (
                <G>
                  <Circle cx={pinX} cy={pinY} r={11} fill="none" stroke="#f08a24" strokeWidth={1.4} strokeDasharray="3 3" />
                  <Circle cx={pinX} cy={pinY} r={6.5} fill="none" stroke="#111" strokeWidth={2.5} />
                  <Circle cx={pinX} cy={pinY} r={2} fill="#f08a24" />
                  <Line x1={pinX} y1={pinY + 7} x2={pinX} y2={pinY + 38} stroke="#111" strokeWidth={2} />
                </G>
              ) : (
                // A longbow has no sight: you aim with the arrow's tip.
                <Path d={`M${pinX - 10} ${pinY + 4} L${pinX} ${pinY} L${pinX - 10} ${pinY - 4}`} fill="#d9d4c4" stroke="#333" strokeWidth={1} />
              )}
              <SvgText x={viewW - 12} y={22} textAnchor="end" fontFamily={font.headingSemibold} fontSize={12} fill="#12141c">
                {`${targetName(aim)} · ×${aim.stars}`}
              </SvgText>
            </Svg>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.under}>
          {!moon && (
            <Text style={styles.line}>
              {Math.abs(longshotFlagWind(aim.conditions.wind, now, 'mid')) < 1.5
                ? 'The orange wind flags are hanging still: hardly any wind.'
                : `The orange wind flags say the wind is blowing from the ${aim.conditions.wind.from}, about ${Math.round(Math.abs(longshotFlagWind(aim.conditions.wind, now, 'mid')))} mph. It will push your arrow to the ${aim.conditions.wind.from === 'left' ? 'right' : 'left'}, so aim a little to the ${aim.conditions.wind.from}.`}
              {aim.helperXCm != null ? ' The dashed ring shows where the wind would take the arrow.' : ''}
            </Text>
          )}
          <View>
            <View style={styles.breathHead}>
              <Text style={styles.boxHead}>PULLING BACK THE STRING</Text>
              <Text style={[styles.boxHead, { color: phase === 'steady' ? '#8fd8a8' : phase === 'tiring' ? '#f08a6a' : withAlpha(colors.text, 0.6) }]}>
                {phase == null ? 'PRESS AND HOLD THE BUTTON' : phase === 'drawing' ? 'PULLING BACK… WAIT' : phase === 'steady' ? 'STEADY: LET GO NOW' : 'ARMS GETTING TIRED: IT SHAKES'}
              </Text>
            </View>
            <View style={styles.breathBar}>
              <View style={[styles.drawSteady, { left: `${(1200 / 6000) * 100}%`, width: `${(2300 / 6000) * 100}%` }]} />
              <View style={[styles.drawTired, { left: `${(3500 / 6000) * 100}%`, width: `${(2500 / 6000) * 100}%` }]} />
              {drawAt != null && <View style={[styles.breathMark, { left: `${Math.min(100, (t / 6000) * 100)}%` }]} />}
            </View>
            <View style={styles.drawLabels}>
              <Text style={styles.small}>pulling back</Text>
              <Text style={styles.small}>steady: let go</Text>
              <Text style={styles.small}>arms tired</Text>
            </View>
          </View>
        </ScrollView>
        <View style={styles.pinned}>
          {(() => {
            // A volley: 1 to 3 arrows off this draw, as many as are left in the round.
            const room = Math.min(3, game.settings.arrowsPerEnd - arrowNo + 1, game.today.left);
            if (room < 2 || drawAt != null) return null;
            return (
              <View style={styles.volleyRow}>
                <Text style={styles.small}>Arrows this draw</Text>
                {[1, 2, 3].filter((k) => k <= room).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => setVolley(k)}
                    style={[styles.volleyChip, volley === k && styles.volleyChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: volley === k }}
                    accessibilityLabel={k === 1 ? 'One arrow' : `A volley of ${k} arrows`}
                  >
                    <Text style={[styles.volleyText, volley === k && styles.volleyTextOn]}>{k}</Text>
                  </Pressable>
                ))}
                {volley > 1 && <Text style={[styles.small, { flex: 1 }]}>only the first follows your pin</Text>}
              </View>
            );
          })()}
          <Pressable
            onPressIn={() => {
              if (!busy) {
                setDrawAt(Date.now());
                buzz('light');
              }
            }}
            onPressOut={loose}
            disabled={busy}
            style={[styles.act, { backgroundColor: drawAt != null ? '#f08a24' : colors.green, minHeight: 60 }]}
            accessibilityRole="button"
            accessibilityLabel="Hold to pull back the string, let go to shoot"
          >
            <Text style={[styles.actText, { color: '#1b1205' }]}>
              {drawAt != null ? (volley > 1 && Math.min(3, game.settings.arrowsPerEnd - arrowNo + 1, game.today.left) > 1 ? `Let go: ${Math.min(volley, game.settings.arrowsPerEnd - arrowNo + 1, game.today.left)} arrows` : 'Let go to shoot') : 'Hold to pull back'}
            </Text>
            <Text style={[styles.small, { color: '#1b1205' }]}>{drawAt != null ? 'when the bar is in the green part' : `round ${endNo}, arrow ${arrowNo} of ${game.settings.arrowsPerEnd}`}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── The arrow's flight: chasing it in, slow motion ──
  if ((mode === 'flight' || mode === 'arrow') && shot && aim) {
    const D = flightMs(shot.tof);
    // The frame clock can be a frame behind the flight's start: never below 0
    // (Math.pow of a negative is NaN, and a NaN in an SVG crashes on a phone).
    const P = mode === 'arrow' ? 1.6 : Math.max(0, (now - flyAt) / D);
    const p = Math.min(1, P);
    const landed = P >= 1;
    const fW = viewW;
    const fH = Math.round(viewW * 1.08);
    const dist = shot.dist;
    const R = dist * (1 - p);
    const s = 520 / (R + 2.2);
    const cx = fW / 2;
    const cy = fH * 0.53;
    const h = Math.min(6, shot.apex) * 4 * p * (1 - p);
    const clout = shot.kind === 'clout';
    // At the clout the server gives metres from the flag (across, along);
    // everywhere else cm from the middle of the target.
    const ixM = clout ? shot.xCm : (shot.xCm - (shot.kind === 'balloon' || shot.kind === 'gold' ? shot.balloon.xCm : 0)) / 100;
    const iyM = clout ? 0 : (shot.yCm - (shot.kind === 'balloon' || shot.kind === 'gold' ? shot.balloon.yCm : 0)) / 100;
    const lat = ixM * Math.pow(p, 1.5);
    const tx = fin(cx - lat * s);
    const ty = fin(cy + h * s + (clout ? 0 : iyM * p * s));
    const horizonY = fH * 0.3 + h * 10;
    const faceR = fin((shot.face / 200) * s);
    const stripes: { y: number; hh: number }[] = [];
    const off = (p * dist) % 6;
    for (let k = 0; k < 10; k++) {
      const z = k * 6 - off + 1.2;
      if (z <= 0.3) continue;
      const y = horizonY + 240 / z;
      if (y < fH) stripes.push({ y, hh: Math.max(1, 60 / z) });
    }
    const spin = landed ? 0 : p * 9;
    const nock = landed ? { x: cx + 34, y: cy + 120 } : { x: cx + 30, y: fH - 30 };
    const tip = landed ? { x: cx + 2, y: cy + 4 } : { x: cx + 8, y: cy + 36 };
    const vanes = [0, 1, 2].map((i) => {
      const a = spin + (i * 2 * Math.PI) / 3;
      return { x: nock.x + 20 * Math.cos(a), y: nock.y + 20 * Math.sin(a) };
    });
    const sideW = viewW - 24;
    const bz = (k: number) => {
      const a = (1 - k) ** 2;
      const b = 2 * (1 - k) * k;
      const c = k * k;
      return { x: a * 16 + b * (sideW / 2) + c * (sideW - 20), y: a * 54 + b * -2 + c * 54 };
    };
    const dot = bz(p);
    const good = shot.ring >= 9 || shot.popped || shot.robin || (clout && shot.ring >= 3);
    const badge = shot.gold
      ? 'Gold balloon!'
      : shot.robin
        ? 'Robin Hood!'
        : shot.popped
          ? 'Pop!'
          : clout
            ? shot.ring > 0
              ? `${shot.ring} · by the flag`
              : 'Too far from the flag'
            : shot.x
              ? '10 · dead center!'
              : shot.ring >= 9
                ? `${shot.ring} · bullseye`
                : shot.ring > 0
                  ? `A ${shot.ring}`
                  : 'Missed the target';
    const end = game.ends.find((e) => e.endNo === shot.endNo);
    const endDone = shot.arrowNo >= game.settings.arrowsPerEnd;
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.under}>
          {header}
          <Text style={styles.kicker}>
            ROUND {shot.endNo} · ARROW {shot.arrowNo} OF {game.settings.arrowsPerEnd} · {landed ? 'IN' : `SLOW MOTION ×${SLOW}`}
          </Text>
          <View style={{ borderRadius: 16, overflow: 'hidden' }}>
            <Svg width={fW} height={fH} accessibilityLabel={landed ? shot.message : 'The arrow in flight'}>
              <Rect x={0} y={0} width={fW} height={fH} fill={moon ? '#05060a' : '#8cc8f0'} />
              <Rect x={0} y={horizonY - 18} width={fW} height={30} rx={14} fill={moon ? '#6b6d75' : '#3f8a4f'} />
              <Rect x={0} y={horizonY} width={fW} height={fH} fill={moon ? '#8b8d95' : '#6fbf5e'} />
              {stripes.map((st, i) => (
                <Rect key={i} x={0} y={st.y} width={fW} height={st.hh} fill={moon ? '#9a9ca4' : '#7cca69'} />
              ))}
              {clout && landed ? (
                <CloutLanding
                  w={fW}
                  h={fH}
                  moon={moon}
                  dist={dist}
                  apex={shot.apex}
                  mine={{ x: shot.xCm, along: shot.yCm }}
                  others={(end?.arrows ?? []).filter((a) => a.target === 'clout' && !(Math.abs(a.xCm - shot.xCm) < 0.05 && Math.abs(a.yCm - shot.yCm) < 0.05)).map((a) => ({ x: a.xCm, along: a.yCm }))}
                  wind={moon ? 0 : longshotFlagWind(game.conditions.wind, now, 'far')}
                  now={now}
                />
              ) : clout ? (
                <G>
                  {[1, 2, 3].map((k) => (
                    <Ellipse key={k} cx={tx} cy={ty + 30} rx={1.5 * k * s * 0.5} ry={1.5 * k * s * 0.12} fill="none" stroke="#ffffff" strokeWidth={1.2} />
                  ))}
                  <Line x1={tx} y1={ty + 30} x2={tx} y2={ty + 30 - 1.2 * s * 0.4} stroke="#5a4a33" strokeWidth={Math.max(1, 0.04 * s)} />
                  <Path d={`M${tx} ${ty + 30 - 1.2 * s * 0.4} l${0.5 * s * 0.4} ${0.15 * s * 0.4} l${-0.5 * s * 0.4} ${0.15 * s * 0.4} Z`} fill="#e2412f" />
                </G>
              ) : shot.kind === 'balloon' || shot.kind === 'gold' ? (
                !(landed && shot.popped) && <Ellipse cx={tx} cy={ty} rx={0.15 * s} ry={0.18 * s} fill={BALLOON_COLOR[shot.target] ?? '#e2412f'} />
              ) : (
                <G>
                  <Line x1={tx - faceR * 0.75} y1={ty + faceR * 1.05} x2={tx - faceR} y2={ty + faceR * 2.4} stroke="#5a4a33" strokeWidth={Math.max(1, 0.06 * s)} />
                  <Line x1={tx + faceR * 0.75} y1={ty + faceR * 1.05} x2={tx + faceR} y2={ty + faceR * 2.4} stroke="#5a4a33" strokeWidth={Math.max(1, 0.06 * s)} />
                  <Rect x={tx - faceR * 1.12} y={ty - faceR * 1.12} width={faceR * 2.24} height={faceR * 2.24} fill="#d8b36a" />
                  <FaceRings cx={tx} cy={ty} r={faceR} />
                </G>
              )}
              {landed && shot.popped && (
                <G>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <Line
                      key={i}
                      x1={tx + Math.cos((i * Math.PI) / 4) * 18}
                      y1={ty + Math.sin((i * Math.PI) / 4) * 18}
                      x2={tx + Math.cos((i * Math.PI) / 4) * 40}
                      y2={ty + Math.sin((i * Math.PI) / 4) * 40}
                      stroke={BALLOON_COLOR[shot.target] ?? '#ffd23f'}
                      strokeWidth={4}
                      strokeLinecap="round"
                    />
                  ))}
                </G>
              )}
              {!(clout && landed) && (
                <G>
                  <Line x1={nock.x} y1={nock.y} x2={tip.x} y2={tip.y} stroke="#2b2b2b" strokeWidth={5} strokeLinecap="round" />
                  <Line x1={nock.x} y1={nock.y} x2={vanes[0].x} y2={vanes[0].y} stroke="#f08a24" strokeWidth={7} strokeLinecap="round" />
                  <Line x1={nock.x} y1={nock.y} x2={vanes[1].x} y2={vanes[1].y} stroke="#f08a24" strokeWidth={7} strokeLinecap="round" />
                  <Line x1={nock.x} y1={nock.y} x2={vanes[2].x} y2={vanes[2].y} stroke="#ffffff" strokeWidth={7} strokeLinecap="round" />
                </G>
              )}
              {landed && (
                <G>
                  <Rect x={fW / 2 - 90} y={28} width={180} height={58} rx={16} fill="#12141c" opacity={0.92} />
                  <SvgText x={fW / 2} y={52} textAnchor="middle" fontFamily={font.headingSemibold} fontSize={13} fill="#f2f3f7">
                    {shot.popped ? 'POP' : clout ? 'THUD' : 'THUNK'}
                  </SvgText>
                  <SvgText x={fW / 2} y={76} textAnchor="middle" fontFamily={font.headingSemibold} fontSize={20} fill={good ? '#ffd23f' : '#f2f3f7'}>
                    {badge}
                  </SvgText>
                </G>
              )}
            </Svg>
          </View>
          <View style={styles.box}>
            <View style={styles.breathHead}>
              <Text style={styles.boxHead}>FROM THE SIDE</Text>
              <Text style={styles.boxHead}>
                {Math.round(dist * p)} of {dist} m · {(shot.tof * p).toFixed(2)} s
              </Text>
            </View>
            <Svg width={sideW} height={70}>
              <Rect x={0} y={0} width={sideW} height={70} rx={8} fill={moon ? '#05060a' : '#8cc8f0'} />
              <Rect x={0} y={54} width={sideW} height={16} fill={moon ? '#8b8d95' : '#7cca69'} />
              <Path d={`M16 54 Q ${sideW / 2} -2 ${sideW - 20} 54`} fill="none" stroke="#ffffff" strokeWidth={2} strokeDasharray="4 4" />
              <Circle cx={dot.x} cy={dot.y} r={4.5} fill="#12141c" />
              <Rect x={sideW - 22} y={34} width={10} height={20} fill="#d8b36a" />
            </Svg>
            <Text style={styles.small}>
              Left the bow at {Math.round(shot.fps * 0.6818)} mph · {shot.apex.toFixed(1)} m high at the top · {moon ? 'no air, no wind' : `wind ${shot.windMph.toFixed(0)} mph`}
              {shot.drawMs < game.settings.fullDrawMs ? ' · you let go too early, so it was slow and dropped' : ''}
            </Text>
          </View>
          {landed && (
            <View style={styles.box}>
              <Text style={[styles.title, { fontSize: 18 }]}>{plainWords(shot.message)}</Text>
              <Text style={styles.line}>
                {shot.points > 0 ? `+${shot.points}` : 'No points'} · this round {shot.endTotal} · total {fmt(shot.total)}
              </Text>
              {end && end.arrows.length > 0 && (
                <Text style={styles.small}>
                  This round: {end.arrows.map((a) => (a.popped ? 'pop' : a.target === 'clout' ? `flag ${a.ring}` : String(a.ring))).join(' · ')}
                </Text>
              )}
            </View>
          )}
        </ScrollView>
        {landed && (
          <View style={[styles.pinned, { flexDirection: 'row' }]}>
            <Pressable onPress={() => setMode('field')} style={styles.reset} accessibilityRole="button">
              <Text style={styles.resetText}>The field</Text>
            </Pressable>
            <Pressable
              onPress={() => stepUp(shot.target)}
              disabled={shot.left < 1 || busy}
              style={[styles.act, { flex: 1 }, shot.left > 0 ? { backgroundColor: colors.green } : styles.actOff]}
              accessibilityRole="button"
            >
              <Text style={[styles.actText, shot.left < 1 && { color: withAlpha(colors.text, 0.6), fontSize: 14 }]}>
                {shot.left < 1 ? 'No arrows left today' : endDone ? `Next round · ${shot.left} arrows` : `Next arrow · ${shot.left} left`}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  return null;
}

// A safety net for the drawing: a NaN or infinity in an SVG coordinate
// crashes react-native-svg on a phone, so anything not finite is drawn as 0.
const fin = (n: number) => (Number.isFinite(n) ? n : 0);

// Where clout arrows came down: the field seen from behind and above,
// the flag in the middle, its five rings (1.5 m apart) and each arrow
// stuck point-first in the grass, leaning back the way it came down
// (steeper the higher its arc). Metres from the flag: x across, along
// (+ is past the flag).
function CloutLanding({
  w,
  h,
  moon,
  dist,
  apex,
  mine,
  others,
  wind,
  now,
}: {
  w: number;
  h: number;
  moon: boolean;
  dist: number;
  apex: number;
  mine: { x: number; along: number };
  others: { x: number; along: number }[];
  wind: number;
  now: number;
}) {
  const cx = w / 2;
  const gy = h * 0.6;
  const far = Math.max(...[mine, ...others].map((a) => Math.hypot(a.x, a.along)), 1.5);
  // Fit the rings out to 4.5 m and every arrow.
  const m = fin(Math.min((w * 0.44) / 4.5, (w * 0.44) / (far + 0.8)));
  const squash = 0.34;
  const at = (a: { x: number; along: number }) => ({
    x: fin(Math.max(14, Math.min(w - 14, cx + a.x * m))),
    y: fin(Math.max(h * 0.32, Math.min(h - 14, gy - a.along * m * squash))),
  });
  // How steeply it came down (a parabola's end), drawn a little steeper
  // so it reads as standing in the grass.
  const fall = Math.atan((4 * Math.max(0.3, apex)) / Math.max(1, dist));
  const lean = Math.min(1.35, Math.max(0.75, fall * 1.8));
  const shaft = Math.max(40, 1.05 * m);
  const arrow = (a: { x: number; along: number }, key: string, me: boolean) => {
    const p = at(a);
    // The nock sticks up out of the grass and back toward the line.
    const nx = p.x + (a.x >= 0 ? 1 : -1) * shaft * 0.08;
    const ny = p.y - shaft * Math.sin(lean) + shaft * Math.cos(lean) * squash;
    return (
      <G key={key} opacity={me ? 1 : 0.75}>
        <Ellipse cx={p.x + shaft * 0.35} cy={p.y + 1.5} rx={shaft * 0.4} ry={2.2} fill="#000000" opacity={0.18} />
        <Ellipse cx={p.x} cy={p.y} rx={6} ry={2.4} fill={moon ? '#6b6d75' : '#6b5a33'} />
        <Line x1={p.x} y1={p.y} x2={nx} y2={ny} stroke="#2b2b2b" strokeWidth={me ? 3.5 : 3} strokeLinecap="round" />
        <Line x1={nx} y1={ny} x2={nx - 7} y2={ny + 5} stroke={me ? '#f08a24' : '#c9a27a'} strokeWidth={5} strokeLinecap="round" />
        <Line x1={nx} y1={ny} x2={nx + 7} y2={ny + 5} stroke={me ? '#f08a24' : '#c9a27a'} strokeWidth={5} strokeLinecap="round" />
        <Line x1={nx} y1={ny} x2={nx} y2={ny - 7} stroke="#ffffff" strokeWidth={4} strokeLinecap="round" />
      </G>
    );
  };
  return (
    <G>
      <Rect x={0} y={h * 0.28} width={w} height={h * 0.72} fill={moon ? '#8b8d95' : '#6fbf5e'} />
      {[5, 4, 3, 2, 1].map((k) => (
        <Ellipse key={k} cx={cx} cy={gy} rx={1.5 * k * m} ry={1.5 * k * m * squash} fill={k % 2 ? (moon ? '#9a9ca4' : '#7cca69') : moon ? '#8b8d95' : '#6fbf5e'} stroke="#ffffff" strokeWidth={1.2} />
      ))}
      <Line x1={cx} y1={gy} x2={cx} y2={gy - 1.6 * m * 0.7} stroke="#5a4a33" strokeWidth={4} />
      <ClothFlag x={cx} top={gy - 1.6 * m * 0.7} len={0.75 * m} h={0.44 * m} wind={wind} now={now} />
      {others.map((a, i) => arrow(a, `o${i}`, false))}
      {arrow(mine, 'me', true)}
    </G>
  );
}

// The server's line after an arrow, in the screen's words.
function plainWords(m: string): string {
  return m
    .replace(/^Gold! /, 'Bullseye! ')
    .replace(' at the clout, ', ' by the flag, ')
    .replace(/^Dead center! An X: /, 'Dead center! A 10: ')
    .replace(/^Off the face: /, 'Missed the target: ')
    .replace('Right into your own arrow', 'Your arrow split one of your own');
}

function flightMs(tof: number): number {
  return Math.max(1500, Math.min(4500, tof * 1000 * SLOW));
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

function EndsToday({ game, styles }: { game: BullseyeGame; styles: Styles }) {
  return (
    <View style={styles.box}>
      <Text style={styles.boxHead}>TODAY’S ROUNDS</Text>
      {game.ends.map((e) => (
        <View key={e.endNo} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.small}>
            Round {e.endNo}: {e.arrows.map((a) => (a.popped ? 'pop' : a.target === 'clout' ? `flag ${a.ring}` : String(a.ring))).join(' · ')}
            {e.arrows.some((a) => a.robin) ? ' · Robin Hood!' : ''}
          </Text>
          <Text style={styles.pairV}>{e.total}</Text>
        </View>
      ))}
    </View>
  );
}

function SightTape({ game, highlight, styles }: { game: BullseyeGame; highlight: string | null; styles: Styles }) {
  const faces = game.targets.filter((t) => t.kind === 'face' || t.kind === 'clout');
  const bow = game.bows.find((b) => b.id === game.me.bow);
  return (
    <View style={styles.box}>
      <Text style={styles.boxHead}>
        HOW HIGH TO AIM · {bow?.name.toUpperCase()} · {ARROWS.find((a) => a.id === game.me.arrow)?.name.toUpperCase()}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {faces.map((t) => (
          <View key={t.id} style={[styles.tapeCell, t.id === highlight && styles.tapeOn]}>
            <Text style={styles.tapeTop}>{t.kind === 'clout' ? 'Flag' : `${t.dist} m`}</Text>
            <Text style={styles.tapeV}>{t.learned ? '✓ locked in' : 'guess'}</Text>
            <Text style={styles.small}>{t.tof.toFixed(1)} s</Text>
          </View>
        ))}
      </View>
      <Text style={styles.small}>Your bow aims higher for farther targets. For each target it starts as a guess that can be a ring or two off; hit a 9 or 10 there and it’s locked in.</Text>
    </View>
  );
}

function BowRack({
  visible,
  game,
  styles,
  colors,
  onClose,
  onPick,
}: {
  visible: boolean;
  game: BullseyeGame;
  styles: Styles;
  colors: Palette;
  onClose: () => void;
  onPick: (bow: string, arrow: BullseyeArrow) => void;
}) {
  const [pick, setPick] = useState(game.me.bow);
  const [arrow, setArrow] = useState<BullseyeArrow>(game.me.arrow);
  useEffect(() => {
    if (visible) {
      setPick(game.me.bow);
      setArrow(game.me.arrow);
    }
  }, [visible, game.me.bow, game.me.arrow]);
  const b = game.bows.find((x) => x.id === pick);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBack} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Bows and arrows</Text>
        <View style={[styles.rackRow, { backgroundColor: 'transparent' }]}>
          <Text style={[styles.rackCell, styles.headCell, { flex: 1.6 }]}>BOW</Text>
          <Text style={[styles.rackCell, styles.headCell]}>SPEED</Text>
          <Text style={[styles.rackCell, styles.headCell]}>ARC AT 70 M</Text>
          <Text style={[styles.rackCell, styles.headCell]}>WIND PUSH</Text>
        </View>
        {game.bows.map((x) => {
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
                <Text style={styles.small}>
                  {!x.unlocked ? `${fmt(game.me.gameSteps)} / ${fmt(x.unlockSteps)} steps` : !x.sight ? 'old-school, no aiming sight · ×1 more' : x.id === 'youth' ? 'light and easy to hold' : x.id === 'compound' ? 'wheels on the ends: fastest, but heavy' : 'the bow in the Olympics'}
                </Text>
              </View>
              <Text style={styles.rackCell}>{Math.round(x.fps * 0.6818)} mph</Text>
              <Text style={styles.rackCell}>{x.at70.apex.toFixed(1)} m up</Text>
              <Text style={styles.rackCell}>{x.at70.wind10Cm} cm</Text>
            </Pressable>
          );
        })}
        <Text style={styles.small}>Arc: how high the arrow flies to reach 70 m. Wind push: how far a 10 mph side wind blows it off at 70 m. Less of both is easier.</Text>
        <Text style={styles.boxHead}>ARROWS</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {ARROWS.map((a) => {
            const on = a.id === arrow;
            return (
              <Pressable key={a.id} onPress={() => setArrow(a.id)} style={[styles.barrel, on && styles.rackOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={styles.rackName}>{a.name}</Text>
                <Text style={styles.small}>{a.note}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => b && onPick(b.id, arrow)} style={[styles.act, { backgroundColor: colors.green }]} accessibilityRole="button">
          <Text style={styles.actText}>
            Use the {b?.name.toLowerCase()} · {ARROWS.find((a) => a.id === arrow)?.name.toLowerCase()}
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
    pairV: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.text },
    tapeCell: { minWidth: 62, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: withAlpha(colors.text, 0.06), borderWidth: 1.5, borderColor: 'transparent' },
    tapeOn: { borderColor: '#ffd23f' },
    tapeTop: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text },
    tapeV: { fontSize: 12, color: '#8fd8a8' },
    // Wraps rather than run the two labels together at large text sizes.
    breathHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 10, rowGap: 2, marginBottom: 5 },
    breathBar: { height: 10, borderRadius: 5, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    drawSteady: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#3a7d55' },
    drawTired: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#5a2c2c' },
    breathMark: { position: 'absolute', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: '#f2f3f7' },
    drawLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    pinned: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    volleyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    volleyChip: { width: 38, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: withAlpha(colors.text, 0.2) },
    volleyChipOn: { backgroundColor: withAlpha('#f08a24', 0.18), borderColor: '#f08a24' },
    volleyText: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    volleyTextOn: { color: '#f08a24' },
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
    sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 30, gap: 8 },
    rackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, padding: 9, backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent' },
    rackOn: { borderColor: '#f08a24', backgroundColor: withAlpha('#f08a24', 0.14) },
    rackName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    rackCell: { flex: 1, fontSize: 12.5, color: colors.text },
    headCell: { fontSize: 10.5, color: withAlpha(colors.text, 0.6) },
    barrel: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 2, borderColor: 'transparent', padding: 4 },
  });
}
