import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { useHealthProvider } from '../health/HealthContext';
import { localDayKey } from '../goals/goals';
import {
  BET_CHOICES,
  HIT_RATE,
  LINES,
  LINE_CHOICES,
  LINE_COLORS,
  PAYTABLE,
  STRIPS,
  STRIP_LEN,
  ordinal,
  teamName,
  winName,
  type SlotBet,
  type SlotLines,
  type SlotSymbol,
  type SlotWin,
} from '../challenges/slots';
import { buySlots, getSlots, spinSlots, type SlotsGame } from '../challenges/slotsApi';
import { SlotSymbolArt } from '../components/SlotSymbol';
import { BoardLink } from '../components/BoardLink';

// Paw Slots' machine (0242; mockup claude.ai/artifact/PQ5Sv4xveiiTj5T9o39Jzh).
// Spins come from steps (and a workout, and Paw Coins); pick 1, 3 or 5
// lines and a bet a line, and Spin. The server has picked where the reels
// stop before they've started: tapping a reel only stops it sooner.

// The machine is drawn on a 358 × 300 box, scaled to the screen.
const VW = 358;
const VH = 300;
const CELL = 64;
const CENTER_Y = 130;
const RX = [20, 130, 240];
const ROW_Y = [98, 162, 226];
const CXR = [69, 179, 289];
const SPEED = 0.024; // cells a millisecond
const STOP_MS = 420;
const AUTO = [1000, 1400, 1800];

const mod = (a: number, n: number) => ((a % n) + n) % n;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const easeBack = (k: number) => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

type Reel =
  | { mode: 'still'; pos: number; shift: number }
  | { mode: 'spin'; p0: number; t0: number; shift: number }
  | { mode: 'stop'; from: number; to: number; t0: number; shift: number };

function posOf(r: Reel, now: number): number {
  if (r.mode === 'spin') return r.p0 + SPEED * (now - r.t0);
  if (r.mode === 'stop') return r.from + (r.to - r.from) * easeBack(Math.min(1, (now - r.t0) / STOP_MS));
  return r.pos;
}

function lineD(rows: [number, number, number]): string {
  return `M18 ${ROW_Y[rows[0]]} L${CXR[0]} ${ROW_Y[rows[0]]} L${CXR[1]} ${ROW_Y[rows[1]]} L${CXR[2]} ${ROW_Y[rows[2]]} L340 ${ROW_Y[rows[2]]}`;
}

export function SlotsScreen({ challengeId, onBack }: { challengeId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { width } = useWindowDimensions();
  const [game, setGame] = useState<SlotsGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<SlotLines>(1);
  const [bet, setBet] = useState<SlotBet>(1);
  const [busy, setBusy] = useState(false);
  const [reels, setReels] = useState<Reel[]>(() => [0, 1, 2].map((r) => ({ mode: 'still', pos: 2 + r * 3, shift: 0 }) as Reel));
  const [spinning, setSpinning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [last, setLast] = useState<{ wins: SlotWin[]; won: number; base: number; bet: number; lines: number } | null>(null);
  const [flashAt, setFlashAt] = useState(0);
  const reelsRef = useRef(reels);
  reelsRef.current = reels;
  // Where the server says the reels stop, once it's answered.
  const result = useRef<{ stops: [number, number, number]; wins: SlotWin[]; won: number; base: number; coins: number; left: number } | null>(null);
  const spinT0 = useRef(0);
  const spunWith = useRef<{ lines: number; bet: number }>({ lines: 1, bet: 1 });

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
      const g = await getSlots(challengeId, await todaySteps());
      setGame(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the machine.');
    }
  }, [challengeId, todaySteps]);

  useEffect(() => {
    load();
  }, [load]);

  const stopReel = useCallback((rs: Reel[], r: number, t: number): Reel[] => {
    const res = result.current;
    const st = rs[r];
    if (!res || st.mode !== 'spin') return rs;
    const from = posOf(st, t);
    const to = Math.floor(from) + 3;
    const copy = rs.slice();
    // Turn the strip under the blur so the reel lands where the server said.
    copy[r] = { mode: 'stop', from, to, t0: t, shift: mod(res.stops[r] - to, STRIP_LEN) };
    return copy;
  }, []);

  // The animation: spinning reels, auto stops, landing.
  useEffect(() => {
    if (!spinning && Date.now() - flashAt > 1800) return;
    let raf = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (spinning) {
        let rs = reelsRef.current;
        if (result.current) {
          for (let r = 0; r < 3; r++) if (rs[r].mode === 'spin' && t - spinT0.current >= AUTO[r]) rs = stopReel(rs, r, t);
        }
        rs = rs.map((st) => (st.mode === 'stop' && t - st.t0 >= STOP_MS ? { mode: 'still', pos: st.to, shift: st.shift } : st));
        if (rs !== reelsRef.current) setReels(rs);
        if (rs.every((st) => st.mode === 'still') && result.current) {
          const res = result.current;
          result.current = null;
          setSpinning(false);
          setLast({ wins: res.wins, won: res.won, base: res.base, bet: spunWith.current.bet, lines: spunWith.current.lines });
          setGame((g) => (g ? { ...g, me: { ...g.me, coins: res.coins }, today: { ...g.today, left: res.left } } : g));
          if (res.wins.some((w) => w.n >= 25)) {
            setFlashAt(t);
            buzz('success');
          } else if (res.won > 0) buzz('light');
          load();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, flashAt, stopReel, load]);

  const cost = lines * bet;
  const left = game?.today.left ?? 0;
  const live = !!game && !game.over && game.me.joined && game.dayNo >= 1 && game.dayNo <= game.days;

  const spin = async () => {
    if (!game || busy || spinning || !live || left < cost) return;
    setBusy(true);
    const t = Date.now();
    spinT0.current = t;
    spunWith.current = { lines, bet };
    result.current = null;
    setLast(null);
    setFlashAt(0);
    setReels((rs) => rs.map((st) => ({ mode: 'spin', p0: posOf(st, t), t0: t, shift: st.shift })));
    setSpinning(true);
    buzz('light');
    try {
      const res = await spinSlots(challengeId, lines, bet);
      result.current = res;
      // A slow answer: the reels stop from when it came.
      if (Date.now() - spinT0.current > AUTO[0]) spinT0.current = Date.now() - AUTO[0] + 300;
    } catch (e) {
      const t2 = Date.now();
      setReels((rs) => rs.map((st) => ({ mode: 'still', pos: Math.round(posOf(st, t2)), shift: st.shift })));
      setSpinning(false);
      Alert.alert('Paw Slots', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const tapReel = (r: number) => {
    if (!spinning || !result.current) return;
    setReels((rs) => stopReel(rs, r, Date.now()));
  };

  const stopNext = () => {
    if (!spinning || !result.current) return;
    const r = reelsRef.current.findIndex((st) => st.mode === 'spin');
    if (r >= 0) setReels((rs) => stopReel(rs, r, Date.now()));
  };

  const buy = async () => {
    if (!game || busy || spinning) return;
    const n = Math.min(5, game.today.buyLeft);
    if (n <= 0) return;
    setBusy(true);
    try {
      const r = await buySlots(challengeId, n);
      setGame({ ...game, me: { ...game.me, coins: r.coins }, today: { ...game.today, left: r.left, bought: game.today.bought + n, buyLeft: game.today.buyLeft - n } });
      buzz('light');
    } catch (e) {
      Alert.alert('Paw Slots', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
        </View>
        <View style={styles.center}>{error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}</View>
      </SafeAreaView>
    );
  }

  const s = game.settings;
  const W = Math.min(VW, width - 32);
  const k = W / VW;
  const flashing = flashAt > 0 && now - flashAt < 1800;
  const blink = Math.floor(now / 160) % 2 === 0;
  const lit = Math.floor(now / (spinning ? 110 : 450));
  const won = !spinning && last && last.won > 0 ? last : null;
  const wonLines = new Set((won?.wins ?? []).map((w) => w.line));
  const winCells = new Map<string, { x: number; y: number }>();
  for (const w of won?.wins ?? []) {
    const rows = LINES[w.line - 1];
    for (let q = 0; q < w.k; q++) winCells.set(`${q}:${rows[q]}`, { x: RX[q] + 2, y: 66 + rows[q] * CELL + 2 });
  }
  const bigWin = won?.wins.reduce((m, w) => Math.max(m, w.n), 0) ?? 0;
  const buyN = Math.min(5, game.today.buyLeft);
  const buyOff = !live || spinning || busy || buyN <= 0 || game.me.coins < buyN * s.buyPrice;
  const capped = game.today.fromSteps >= s.maxStepSpins;
  const toNext = game.today.nextAt != null ? Math.max(0, game.today.nextAt - game.today.steps) : null;

  let msgTitle: string;
  let msgText: string;
  if (!live) {
    msgTitle = game.over ? 'It’s over' : game.dayNo < 1 ? 'Starts soon' : 'Join to play';
    msgText = game.over ? 'The Bones are paid by place when it’s settled.' : 'Every 500 steps on the day is a spin.';
  } else if (spinning) {
    msgTitle = 'Spinning…';
    msgText = 'Tap a reel to stop it, or let them stop on their own. Where they land was set when you pressed Spin.';
  } else if (!last) {
    msgTitle = `Every ${fmt(s.stepsPerSpin)} steps is a spin`;
    msgText = `Play 1, 3 or 5 lines and bet up to ×5 a line. A press uses lines × bet spins, and every line pays on its own. Three Golden Hounds pays 250.`;
  } else if (won) {
    const tail = `${last.bet > 1 ? ` × ${last.bet} = ${fmt(last.won)}` : ''} Paw Coins.`;
    if (won.wins.length === 1) {
      msgTitle = `${winName(won.wins[0])}!`;
      msgText = `${last.lines > 1 ? `Line ${won.wins[0].line}: ` : ''}${won.wins[0].n}${tail}`;
    } else {
      msgTitle = `${won.wins.length} lines won!`;
      msgText = `${won.wins.map((w) => `Line ${w.line}: ${w.n}`).join(' + ')} = ${last.base}${tail}`;
    }
  } else {
    msgTitle = 'No win this time';
    msgText = `Some win comes up about ${HIT_RATE[lines]} presses on ${lines} ${lines === 1 ? 'line' : 'lines'}.`;
  }

  const label = !live
    ? msgTitle
    : spinning
      ? 'Stop'
      : left >= cost
        ? `Spin · uses ${cost} of ${left}`
        : left > 0
          ? `Fewer lines or a lower bet: ${left} left`
          : capped
            ? buyN > 0
              ? 'Out of spins: buy more above'
              : 'Out of spins: back tomorrow'
            : `Walk ${fmt(toNext ?? s.stepsPerSpin)} steps, or buy spins above`;
  const canAct = live && (spinning || left >= cost);

  const pill = (on: boolean, off: boolean) => [styles.pill, on && styles.pillOn, off && !on && { opacity: 0.45 }];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ paddingBottom: 4 }}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BoardLink challengeId={challengeId}>
              <Text style={styles.kicker} numberOfLines={1}>
                PAW SLOTS{game.dayNo >= 1 && game.dayNo <= game.days ? ` · DAY ${game.dayNo} OF ${game.days}` : ''}
                {game.me.team ? ` · ${teamName(game.me.team).toUpperCase()}` : ''}
              </Text>
            </BoardLink>
            <Text style={styles.title}>The machine</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Svg width={20} height={20} viewBox="0 0 20 20">
                <Circle cx={10} cy={10} r={9.5} fill="#f0c24a" />
                <Circle cx={10} cy={10} r={7} fill="none" stroke="#b8862a" strokeWidth={1.2} />
                <G fill="#7a5a14">
                  <Ellipse cx={10} cy={12} rx={3} ry={2.4} />
                  <Ellipse cx={6.6} cy={8.6} rx={1.2} ry={1.6} />
                  <Ellipse cx={9} cy={6.8} rx={1.2} ry={1.6} />
                  <Ellipse cx={11.6} cy={6.8} rx={1.2} ry={1.6} />
                  <Ellipse cx={13.8} cy={8.6} rx={1.2} ry={1.6} />
                </G>
              </Svg>
              <Text style={styles.title}>{fmt(game.me.coins)}</Text>
            </View>
            <Text style={styles.small}>
              {game.teams >= 2 ? 'Paw Coins' : `${ordinal(game.me.rank)} of ${fmt(game.players)}`}
            </Text>
          </View>
        </View>

        <View style={styles.spins}>
          <View style={{ alignItems: 'center', minWidth: 54 }}>
            <Text style={styles.spinsN}>{left}</Text>
            <Text style={styles.spinsLabel}>SPINS</Text>
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={styles.spinsLine}>
              {game.today.fromSteps} from {fmt(game.today.steps)} steps
              {game.today.workoutSpins ? `, ${game.today.workoutSpins} for your workout` : ''}
              {game.today.carried ? `, ${game.today.carried} carried` : ''}
              {game.today.bought ? `, ${game.today.bought} bought` : ''}
              {game.today.used ? ` · ${game.today.used} used` : ''}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${capped ? 100 : Math.round((100 * (game.today.steps % s.stepsPerSpin)) / s.stepsPerSpin)}%` }]} />
            </View>
            <Text style={styles.small}>
              {capped
                ? `All ${s.maxStepSpins} from steps today. More with Paw Coins: ${s.buyPrice} a spin, up to ${s.buyCap}.`
                : `${fmt(toNext ?? 0)} steps to the next · up to ${s.maxStepSpins} a day from steps`}
            </Text>
          </View>
          <Pressable
            onPress={buy}
            disabled={buyOff}
            style={[styles.buy, buyOff ? styles.buyOff : styles.buyOn]}
            accessibilityRole="button"
            accessibilityLabel={buyN > 0 ? `Buy ${buyN} spins for ${buyN * s.buyPrice} Paw Coins` : 'Bought the most for today'}
          >
            <Text style={[styles.buyTop, buyOff && { color: withAlpha(colors.text, 0.55) }]}>{buyN > 0 ? `Buy ${buyN}` : `Bought ${s.buyCap}`}</Text>
            <Text style={[styles.buySub, buyOff && { color: withAlpha(colors.text, 0.55) }]}>{buyN > 0 ? `${buyN * s.buyPrice} coins` : 'max today'}</Text>
          </Pressable>
        </View>

        <View style={{ width: W, height: (W * VH) / VW, alignSelf: 'center' }}>
          <Svg width={W} height={(W * VH) / VW} viewBox={`0 0 ${VW} ${VH}`} accessibilityLabel="The Paw Slots reels">
            <Rect x={1.5} y={1.5} width={355} height={297} rx={22} fill="#23263a" stroke="#f0c24a" strokeWidth={3} />
            <Rect x={16} y={62} width={326} height={200} rx={10} fill="#0f1019" />
            {RX.map((x) => (
              <Rect key={x} x={x} y={66} width={98} height={192} rx={6} fill="#f6f1e4" />
            ))}
            {reels.map((st, r) => {
              const pos = posOf(st, now);
              const base = Math.floor(pos);
              const cells = [];
              for (let q = -2; q <= 2; q++) {
                const i = base + q;
                const y = CENTER_Y + CELL * (pos - i);
                const sym = STRIPS[r][mod(i + st.shift, STRIP_LEN)];
                cells.push(
                  <G key={`${r}:${q}`} transform={`translate(${RX[r] + 21} ${(y + 4).toFixed(1)})`} opacity={st.mode === 'spin' ? 0.7 : 1}>
                    <SlotSymbolArt sym={sym} />
                  </G>,
                );
              }
              return <G key={r}>{cells}</G>;
            })}
            {RX.map((x) => (
              <G key={`sh${x}`}>
                <Rect x={x} y={66} width={98} height={32} fill="#161826" opacity={0.22} />
                <Rect x={x} y={98} width={98} height={32} fill="#161826" opacity={0.08} />
                <Rect x={x} y={194} width={98} height={32} fill="#161826" opacity={0.08} />
                <Rect x={x} y={226} width={98} height={32} fill="#161826" opacity={0.22} />
              </G>
            ))}
            <Rect x={0} y={0} width={358} height={66} rx={22} fill="#23263a" />
            <Rect x={0} y={40} width={358} height={26} fill="#23263a" />
            <Path d="M2 258 H356 V278 Q356 298 336 298 H22 Q2 298 2 278 Z" fill="#23263a" />
            <Rect x={1.5} y={1.5} width={355} height={297} rx={22} fill="none" stroke="#f0c24a" strokeWidth={3} />
            <Rect x={64} y={9} width={230} height={34} rx={10} fill="#2f2340" stroke="#f0c24a" strokeWidth={1.5} />
            <SvgText fontFamily={font.headingSemibold} x={179} y={33} textAnchor="middle" fontSize={19} fontWeight="800" letterSpacing={3} fill="#f0c24a">
              PAW SLOTS
            </SvgText>
            {Array.from({ length: 14 }, (_, b) => {
              const on = flashing ? (Math.floor(now / 90) + b) % 3 === 0 : (lit + b) % 2 === 0;
              return <Circle key={b} cx={22 + b * 24.2} cy={53} r={3.2} fill={on ? '#ffe08a' : '#5a4a2a'} />;
            })}
            {[...winCells.values()].map((c) => (
              <Rect key={`${c.x}:${c.y}`} x={c.x} y={c.y} width={94} height={60} rx={8} fill="none" stroke="#f0c24a" strokeWidth={4} opacity={flashing && !blink ? 0.35 : 1} />
            ))}
            {LINES.map((rows, i) => {
              const on = i < (spinning ? spunWith.current.lines : lines);
              const w = wonLines.has(i + 1);
              return (
                <Path
                  key={`l${i}`}
                  d={lineD(rows)}
                  fill="none"
                  stroke={LINE_COLORS[i]}
                  strokeWidth={w ? 4 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={!on ? 0 : w ? 1 : spinning ? 0.25 : won ? 0.15 : 0.45}
                />
              );
            })}
            {LINES.map((rows, i) => {
              const right = i >= 3;
              const y = right ? ROW_Y[rows[2]] : ROW_Y[rows[0]];
              const x = right ? 349 : 9;
              const on = i < (spinning ? spunWith.current.lines : lines);
              return (
                <G key={`m${i}`}>
                  <Circle cx={x} cy={y} r={6.5} fill={on ? LINE_COLORS[i] : '#3a3d52'} />
                  <SvgText fontFamily={font.headingSemibold} x={x} y={y + 3} textAnchor="middle" fontSize={9} fontWeight="800" fill="#161826">
                    {String(i + 1)}
                  </SvgText>
                </G>
              );
            })}
            <SvgText fontFamily={font.headingSemibold} x={22} y={284} fontSize={11} fontWeight="800" letterSpacing={1} fill="#9a9ba6">
              WIN
            </SvgText>
            <SvgText fontFamily={font.headingSemibold} x={52} y={285} fontSize={16} fontWeight="800" fill="#f0c24a">
              {fmt(last?.won ?? 0)}
            </SvgText>
            <SvgText fontFamily={font.headingSemibold} x={179} y={284} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#9a9ba6">
              {spinning ? 'TAP A REEL' : ''}
            </SvgText>
            <SvgText fontFamily={font.headingSemibold} x={336} y={284} textAnchor="end" fontSize={13} fontWeight="800" fill="#ffd2a6">
              {`${lines} ${lines === 1 ? 'LINE' : 'LINES'} · ×${bet}`}
            </SvgText>
          </Svg>
          {RX.map((x, r) => (
            <Pressable
              key={`tap${r}`}
              onPress={() => tapReel(r)}
              disabled={!spinning}
              accessibilityRole="button"
              accessibilityLabel={`Stop reel ${r + 1}`}
              style={{ position: 'absolute', left: x * k, top: 66 * k, width: 98 * k, height: 192 * k }}
            />
          ))}
          {flashing && won && (
            <View pointerEvents="none" style={styles.flash}>
              <Text style={styles.flashText}>
                {bigWin >= 250 ? 'JACKPOT' : bigWin >= 50 ? 'BIG WIN' : 'WIN'} · {fmt(won.won)}
              </Text>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 3, gap: 4 }}>
            <Text style={styles.pillHead}>LINES</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {LINE_CHOICES.map((n) => {
                const on = n === lines;
                const off = spinning || (left < n * bet && !on);
                return (
                  <Pressable key={n} onPress={() => !off && setLines(n)} disabled={off} style={pill(on, off)} accessibilityRole="button" accessibilityLabel={`${n} ${n === 1 ? 'line' : 'lines'}`} accessibilityState={{ selected: on }}>
                    <Text style={[styles.pillText, on && { color: '#ffd2a6' }]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ flex: 4, gap: 4 }}>
            <Text style={styles.pillHead}>BET PER LINE</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {BET_CHOICES.map((n) => {
                const on = n === bet;
                const off = spinning || (left < n * lines && !on);
                return (
                  <Pressable key={n} onPress={() => !off && setBet(n)} disabled={off} style={pill(on, off)} accessibilityRole="button" accessibilityLabel={`Bet ${n} a line`} accessibilityState={{ selected: on }}>
                    <Text style={[styles.pillText, on && { color: '#ffd2a6' }]}>×{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.msg}>
          <Text style={styles.msgTitle}>{msgTitle}</Text>
          <Text style={styles.msgText}>{msgText}</Text>
        </View>

        <View style={styles.pays}>
          <Text style={styles.pillHead}>WHAT A LINE PAYS (× YOUR BET)</Text>
          {PAYTABLE.map((p) => (
            <View key={p.name} style={styles.payRow}>
              <Svg width={p.count * 26 + 4} height={24} viewBox={`0 0 ${p.count * 60} 56`}>
                {Array.from({ length: p.count }, (_, q) => (
                  <G key={q} transform={`translate(${q * 60} 0)`}>
                    <Rect x={0} y={0} width={56} height={56} rx={10} fill={p.sym === 'any' ? '#3a3d52' : '#f6f1e4'} />
                    {p.sym !== 'any' && <SlotSymbolArt sym={p.sym} />}
                  </G>
                ))}
              </Svg>
              <Text style={styles.payName}>{p.name}</Text>
              <Text style={styles.payN}>{p.pays}</Text>
              <Text style={styles.payOdds}>{p.odds}</Text>
            </View>
          ))}
          <Text style={styles.small}>
            The Collar is wild (not for the Golden Hound) and doubles a win. A spin wins back about {s.buyPrice} coins on average. Spins can’t be bought with money, and Bones never go in.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.pinned}>
        <Pressable
          onPress={spinning ? stopNext : spin}
          disabled={!canAct || (busy && !spinning)}
          style={[styles.act, spinning ? { backgroundColor: '#e9e9ed' } : canAct ? { backgroundColor: '#f08a24' } : styles.actOff]}
          accessibilityRole="button"
        >
          <Text style={[styles.actText, !canAct && { color: withAlpha(colors.text, 0.7), fontSize: 14 }]}>{label}</Text>
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
    note: { fontSize: 14.5, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 11.5, lineHeight: 16, color: withAlpha(colors.text, 0.65) },
    spins: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 10, backgroundColor: colors.surface },
    spinsN: { fontFamily: font.headingSemibold, fontSize: 26, lineHeight: 28, color: colors.text },
    spinsLabel: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6, color: '#c99a1a', marginTop: 2 },
    spinsLine: { fontSize: 12.5, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.85) },
    bar: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 3, backgroundColor: '#f0c24a' },
    buy: { minWidth: 78, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    buyOn: { backgroundColor: '#f0c24a' },
    buyOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    buyTop: { fontFamily: font.headingSemibold, fontSize: 13, color: '#161826' },
    buySub: { fontSize: 10.5, fontFamily: font.headingSemibold, color: '#161826', opacity: 0.85 },
    flash: { position: 'absolute', alignSelf: 'center', top: '40%', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#f0c24a' },
    flashText: { fontFamily: font.headingSemibold, fontSize: 22, color: '#161826' },
    pillHead: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    pill: {
      flex: 1,
      height: 44,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: withAlpha(colors.text, 0.14),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pillOn: { borderColor: '#f08a24', backgroundColor: '#3a2a1a' },
    pillText: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    msg: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 4, backgroundColor: colors.surface },
    msgTitle: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    msgText: { fontSize: 12.5, lineHeight: 18, color: withAlpha(colors.text, 0.78) },
    pays: { borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.surface },
    payRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    payName: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.85) },
    payN: { width: 40, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 13, color: '#c99a1a' },
    payOdds: { width: 76, textAlign: 'right', fontSize: 12, color: withAlpha(colors.text, 0.6) },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
    act: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 17, color: '#161826', textAlign: 'center' },
  });
}
