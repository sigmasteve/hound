import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { crowdDots, perspective, project, type Perspective } from '../components/perspective';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { buzz } from '../celebrate/feedback';
import { useHealthProvider } from '../health/HealthContext';
import {
  BOT_NAME,
  FILES,
  PIECE_NAME,
  moveLine,
  parseFen,
  restingTag,
  resultLine,
  sqIndex,
  sqName,
  unlockRows,
  type ChessColor,
  type ChessPiece,
  type ChessPieceType,
} from '../challenges/chess';
import {
  claimChessSteps,
  getChess,
  getChessPuzzle,
  playChessMove,
  resignChess,
  tryChessPuzzle,
  type ChessGame,
  type ChessMoveOption,
  type ChessPuzzle,
} from '../challenges/chessApi';
import { BoardLink } from '../components/BoardLink';

// Hound Chess (0238; mockup claude.ai/artifact/HfDqdw7FaXZmCeDy68pJcX). The
// board in 2.5D, seen from behind your side with the stand past the far
// end, through perspective.ts and project(), like every field. The pieces
// are hounds: puppy pawns, leaping-hound knights, doghouse rooks, and a
// queen and king with gold crowns. Your steps today free your pieces;
// resting ones are dimmed with what they need. The server checks every
// move. mode 'puzzle' is the puzzle of the day on the same board.

const M = 0.035; // the board's margin on the ground

type Sel = { sq: number } | null;

function boardView(w: number, h: number, near = 0.02): Perspective {
  return perspective(w, h, { stand: h * 0.16, near: h * near, gap: h * 0.02, botW: w * 0.98, a: 0.6, b: 0.78 });
}

// A square's centre (or a point in it: fx, fy from 0 to 1) on screen, from
// the viewer's side.
function sqPoint(v: Perspective, sq: number, me: ChessColor, fx = 0.5, fy = 0.5) {
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  const col = me === 'b' ? 7 - file : file;
  const near = me === 'b' ? 7 - rank : rank;
  const x = M + ((col + fx) / 8) * (1 - 2 * M);
  const y = 1 - M - ((near + fy) / 8) * (1 - 2 * M);
  return project(v, x, y);
}

function unproject(v: Perspective, X: number, Y: number): { x: number; y: number } {
  const u = (Y - v.y0) / (v.y1 - v.y0);
  const y = u / (v.b + u * (1 - v.b));
  const s = v.a + (1 - v.a) * u;
  return { x: 0.5 + (X - v.w / 2) / (v.botW * s), y };
}

function squareAt(v: Perspective, X: number, Y: number, me: ChessColor): number | null {
  const g = unproject(v, X, Y);
  const col = Math.floor(((g.x - M) / (1 - 2 * M)) * 8);
  const near = Math.floor(((1 - M - g.y) / (1 - 2 * M)) * 8);
  if (col < 0 || col > 7 || near < 0 || near > 7) return null;
  const file = me === 'b' ? 7 - col : col;
  const rank = me === 'b' ? 7 - near : near;
  return rank * 8 + file;
}

function quad(v: Perspective, sq: number, me: ChessColor): string {
  return [sqPoint(v, sq, me, 0, 0), sqPoint(v, sq, me, 1, 0), sqPoint(v, sq, me, 1, 1), sqPoint(v, sq, me, 0, 1)]
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

const LIGHT = '#ecdcb8';
const DARK = '#9c7752';

// One hound piece, drawn at (0, 0) on its base, about 48 tall.
function HoundPiece({ type, color }: { type: ChessPieceType; color: ChessColor }) {
  const body = color === 'w' ? '#f6efe2' : '#373c58';
  const line = color === 'w' ? '#5a4a3a' : '#0f111a';
  const ear = color === 'w' ? '#c08a52' : '#20243a';
  const sw = 1.2;
  return (
    <G>
      <Ellipse cx={0} cy={1} rx={12} ry={3.6} fill="#000" opacity={0.28} />
      <Ellipse cx={0} cy={-1.5} rx={10.5} ry={3.4} fill={body} stroke={line} strokeWidth={sw} />
      {type === 'P' && (
        <G>
          <Ellipse cx={0} cy={-9} rx={7} ry={7.5} fill={body} stroke={line} strokeWidth={sw} />
          <Circle cx={0} cy={-19} r={6} fill={body} stroke={line} strokeWidth={sw} />
          <Ellipse cx={-5.5} cy={-18} rx={2.4} ry={4.8} fill={ear} />
          <Ellipse cx={5.5} cy={-18} rx={2.4} ry={4.8} fill={ear} />
          <Circle cx={0} cy={-16.5} r={1.3} fill={line} />
        </G>
      )}
      {type === 'N' && (
        <G>
          <Ellipse cx={0} cy={-10} rx={8} ry={9} fill={body} stroke={line} strokeWidth={sw} />
          <Path d="M2 -16 Q-12 -17 -15 -24 Q-14 -29 -6 -31 Q2 -36 7 -29 Q9 -21 2 -16 Z" fill={body} stroke={line} strokeWidth={sw} />
          <Ellipse cx={4} cy={-26} rx={2.6} ry={7} fill={ear} rotation={20} origin="4, -26" />
          <Circle cx={-14.5} cy={-25} r={1.6} fill={line} />
          <Circle cx={-5} cy={-27} r={1.2} fill={line} />
        </G>
      )}
      {type === 'B' && (
        <G>
          <Ellipse cx={0} cy={-12} rx={8} ry={12} fill={body} stroke={line} strokeWidth={sw} />
          <Circle cx={0} cy={-27} r={6} fill={body} stroke={line} strokeWidth={sw} />
          <Path d="M-6 -30 L0 -43 L6 -30 Z" fill={ear} stroke={line} strokeWidth={1} />
          <Circle cx={0} cy={-44} r={1.8} fill="#f0c24a" />
        </G>
      )}
      {type === 'R' && (
        <G>
          <Rect x={-10} y={-22} width={20} height={21} fill={body} stroke={line} strokeWidth={sw} />
          <Path d="M-13 -21 L0 -34 L13 -21 Z" fill={ear} stroke={line} strokeWidth={sw} />
          <Path d="M-4.5 -1 L-4.5 -10 Q0 -15 4.5 -10 L4.5 -1 Z" fill={line} />
        </G>
      )}
      {type === 'Q' && (
        <G>
          <Ellipse cx={0} cy={-12} rx={9} ry={13} fill={body} stroke={line} strokeWidth={sw} />
          <Circle cx={0} cy={-30} r={7} fill={body} stroke={line} strokeWidth={sw} />
          <Ellipse cx={-6.5} cy={-29} rx={2.6} ry={5.5} fill={ear} />
          <Ellipse cx={6.5} cy={-29} rx={2.6} ry={5.5} fill={ear} />
          <Path d="M-6 -36 L-4 -43 L-1.5 -38 L0 -45 L1.5 -38 L4 -43 L6 -36 Z" fill="#f0c24a" stroke="#8a6a1a" strokeWidth={0.8} />
          <Circle cx={0} cy={-27.5} r={1.4} fill={line} />
        </G>
      )}
      {type === 'K' && (
        <G>
          <Ellipse cx={0} cy={-13} rx={10} ry={14} fill={body} stroke={line} strokeWidth={sw} />
          <Circle cx={0} cy={-32} r={7.5} fill={body} stroke={line} strokeWidth={sw} />
          <Ellipse cx={-7} cy={-31} rx={2.8} ry={6} fill={ear} />
          <Ellipse cx={7} cy={-31} rx={2.8} ry={6} fill={ear} />
          <Path d="M-7.5 -38 L-7.5 -47 L-3.5 -42 L0 -49 L3.5 -42 L7.5 -47 L7.5 -38 Z" fill="#f0c24a" stroke="#8a6a1a" strokeWidth={0.8} />
          <Circle cx={0} cy={-29.5} r={1.5} fill={line} />
        </G>
      )}
    </G>
  );
}

const Board = React.memo(function Board({
  v,
  me,
  pieces,
  marks,
  dots,
  resting,
  restTag,
}: {
  v: Perspective;
  me: ChessColor;
  pieces: ChessPiece[];
  marks: { sq: number; fill: string }[];
  dots: { sq: number; cap: boolean }[];
  resting: (p: ChessPiece) => boolean;
  restTag: (p: ChessPiece) => string | null;
}) {
  const crowd = useMemo(() => crowdDots(v.w, v.stand, false), [v.w, v.stand]);
  const rim = useMemo(() => {
    const pts = [project(v, M * 0.2, M * 0.2), project(v, 1 - M * 0.2, M * 0.2), project(v, 1 - M * 0.2, 1 - M * 0.2), project(v, M * 0.2, 1 - M * 0.2)];
    return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }, [v]);
  // Far pieces first, so near ones stand in front.
  const order = [...pieces].sort((a, b) => sqPoint(v, a.sq, me).y - sqPoint(v, b.sq, me).y);
  // One tag per resting kind, on the first of each.
  const tagged = new Set<string>();
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#1c2034" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={3.6} fill={c.c} />
      ))}
      <Rect x={0} y={v.stand} width={v.w} height={v.h - v.stand} fill="#2d5a3a" />
      <Polygon points={rim} fill="#6b4a2e" />
      {Array.from({ length: 64 }, (_, sq) => (
        <Polygon key={sq} points={quad(v, sq, me)} fill={(Math.floor(sq / 8) + (sq % 8)) % 2 === 0 ? DARK : LIGHT} />
      ))}
      {marks.map((m, i) => (
        <Polygon key={`m${i}`} points={quad(v, m.sq, me)} fill={m.fill} />
      ))}
      {dots.map((d) => {
        const c = sqPoint(v, d.sq, me);
        return d.cap ? (
          <Ellipse key={`d${d.sq}`} cx={c.x} cy={c.y} rx={17 * c.s} ry={8 * c.s} fill="none" stroke="rgba(79,123,224,0.95)" strokeWidth={2.5} />
        ) : (
          <Ellipse key={`d${d.sq}`} cx={c.x} cy={c.y} rx={6.5 * c.s} ry={3.4 * c.s} fill="rgba(30,34,60,0.55)" />
        );
      })}
      {FILES.split('').map((l, i) => {
        const sq = me === 'b' ? 63 - i : i;
        const c = sqPoint(v, sq, me, 0.5, -0.25);
        return (
          <SvgText key={l} x={c.x} y={c.y + 8} textAnchor="middle" fontSize={10} fontWeight="700" fill="#d9c7a3">
            {FILES[sq % 8]}
          </SvgText>
        );
      })}
      {order.map((p) => {
        const c = sqPoint(v, p.sq, me, 0.5, 0.62);
        const k = c.s * (v.w / 358) * 1.22;
        const rest = resting(p);
        let tag: string | null = null;
        if (rest && !tagged.has(p.type)) {
          tagged.add(p.type);
          tag = restTag(p);
        }
        return (
          <G key={`${p.color}${p.type}${p.sq}`} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) scale(${k.toFixed(3)})`} opacity={rest ? 0.5 : 1}>
            <HoundPiece type={p.type} color={p.color} />
            {tag && (
              <G transform="translate(0 -58)">
                <Rect x={-17} y={-8} width={34} height={15} rx={7.5} fill="#161826" opacity={0.92} />
                <SvgText x={0} y={3} textAnchor="middle" fontSize={9} fontWeight="800" fill="#ffd27a">
                  {tag}
                </SvgText>
              </G>
            )}
          </G>
        );
      })}
    </Svg>
  );
});

// The same board as a picture, for the game's card on the challenge page:
// the position from your side, the last move and a king in check marked.
// Nothing on it is tappable; the card opens ChessScreen.
const NO_DOTS: { sq: number; cap: boolean }[] = [];
const NOT_RESTING = () => false;
const NO_TAG = () => null;
export function ChessBoardPicture({ fen, me, last, inCheck, width }: { fen: string; me: ChessColor; last: { from: string; to: string } | null; inCheck: boolean; width: number }) {
  // A little more room under the near edge than the board screen, so the
  // file letters (a to h) aren't cut off.
  const h = Math.round(width * 0.9);
  const v = useMemo(() => boardView(width, h, 0.07), [width, h]);
  const parsed = useMemo(() => parseFen(fen), [fen]);
  const marks: { sq: number; fill: string }[] = [];
  if (last) [last.from, last.to].forEach((s) => marks.push({ sq: sqIndex(s), fill: 'rgba(240,194,74,0.45)' }));
  if (inCheck) {
    const k = parsed.pieces.find((p) => p.type === 'K' && p.color === parsed.turn);
    if (k) marks.push({ sq: k.sq, fill: 'rgba(224,91,91,0.6)' });
  }
  return (
    <View style={{ width, height: h, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1a1e30' }}>
      <Board v={v} me={me} pieces={parsed.pieces} marks={marks} dots={NO_DOTS} resting={NOT_RESTING} restTag={NO_TAG} />
    </View>
  );
}

export function ChessScreen({ challengeId, mode = 'game', onBack }: { challengeId?: string; mode?: 'game' | 'puzzle'; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const [game, setGame] = useState<ChessGame | null>(null);
  const [puzzle, setPuzzle] = useState<ChessPuzzle | null>(null);
  const [puzzleFen, setPuzzleFen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Sel>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; good: boolean } | null>(null);
  const [lastPuzzleMove, setLastPuzzleMove] = useState<{ from: string; to: string } | null>(null);
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Read through a ref, so a new provider object never reloads the board.
  const healthRef = useRef(health);
  healthRef.current = health;
  const stepsToday = useCallback(async (): Promise<number | null> => {
    try {
      const s = await healthRef.current.getSnapshot();
      return s.stepsToday ?? null;
    } catch {
      return null;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const steps = await stepsToday();
      if (mode === 'puzzle') {
        const p = await getChessPuzzle(steps);
        setPuzzle(p);
        setPuzzleFen(p.fen);
      } else if (challengeId) {
        if (steps != null) await claimChessSteps(steps).catch(() => {});
        setGame(await getChess(challengeId));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the board.');
    }
  }, [challengeId, mode, stepsToday]);
  useEffect(() => {
    load();
  }, [load]);

  // Their move, live (Steve, Nov 2026: playing his daughter side by side).
  // While it's their turn and this screen is open with the app in front,
  // check every few seconds; when their move lands it shows, with a buzz.
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);
  const waitingOnThem = mode === 'game' && !!challengeId && !!game && !game.myTurn && game.status !== 'final' && !game.bot;
  useEffect(() => {
    if (!waitingOnThem || !appActive || !isFocused || !challengeId) return;
    const id = setInterval(() => {
      getChess(challengeId)
        .then((g) => {
          setGame((prev) => (prev && prev.plies === g.plies && prev.status === g.status ? prev : g));
          if (g.myTurn || g.status === 'final') {
            const theirs = g.history.slice(-1)[0];
            if (g.status === 'final') flash('Game over', false);
            else flash(theirs?.check ? 'Check! Your move' : 'Your move', true);
            buzz('light');
            setMsg(null);
          }
        })
        .catch(() => {
          // Try again on the next tick.
        });
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingOnThem, appActive, isFocused, challengeId]);

  const flash = (text: string, good: boolean) => {
    setBanner({ text, good });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBanner(null), 1600);
  };

  const v = useMemo(() => (size.w > 0 ? boardView(size.w, size.h) : null), [size.w, size.h]);
  const me: ChessColor = mode === 'puzzle' ? 'w' : game?.me ?? 'w';
  const fen = mode === 'puzzle' ? puzzleFen : game?.fen ?? null;
  const parsed = useMemo(() => (fen ? parseFen(fen) : null), [fen]);
  const options: ChessMoveOption[] = mode === 'puzzle' ? (puzzle?.moves ?? []) : game?.myTurn ? game.moves : [];
  const free = mode === 'puzzle' ? 'PKNBRQ' : game?.free ?? 'PK';
  const allFree = mode === 'puzzle' || !!game?.allFree;
  const canAct = mode === 'puzzle' ? !!puzzle?.open && !puzzle.solved && puzzle.tries < puzzle.maxTries && !busy : !!game?.myTurn && !busy;

  const isResting = useCallback(
    (p: ChessPiece) => mode === 'game' && !!game && game.status === 'active' && p.color === game.me && !allFree && !free.includes(p.type),
    [mode, game, allFree, free],
  );
  const restTag = useCallback((p: ChessPiece) => (game ? restingTag(p.type, game.needs) : null), [game]);

  const targets = sel ? options.filter((o) => sqIndex(o.from) === sel.sq) : [];

  const play = async (from: string, to: string) => {
    if (busy) return;
    setBusy(true);
    setSel(null);
    try {
      if (mode === 'puzzle') {
        const r = await tryChessPuzzle(from, to, 'q');
        setPuzzleFen(r.fenAfter);
        setLastPuzzleMove({ from, to });
        if (r.mate) {
          flash('Checkmate!', true);
          buzz('success');
          setMsg(`Mate! ${r.earned > 0 ? `+${r.earned} Bones. ` : ''}Your streak is ${r.streak} ${r.streak === 1 ? 'day' : 'days'}. Tomorrow’s opens at ${r.need.toLocaleString('en-US')} steps.`);
          setPuzzle(r);
        } else {
          flash(r.check ? 'Check, but not mate' : 'Not mate', false);
          const left = r.maxTries - r.tries;
          setMsg(left > 0 ? `${r.check ? 'It’s check, but Black gets out of it.' : 'No check: Black has time to breathe.'} ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That was your last try today. A new one tomorrow.');
          timer.current = setTimeout(() => {
            setPuzzle(r);
            setPuzzleFen(r.fen);
            setLastPuzzleMove(null);
          }, 1400);
        }
      } else if (challengeId) {
        const g = await playChessMove(challengeId, from, to, 'q');
        const mine = g.history.filter((h) => h.side === g.me).slice(-1)[0];
        const theirs = g.history.slice(-1)[0];
        if (g.status === 'final') {
          flash(g.method === 'mate' ? 'Checkmate!' : 'Game over', g.result !== 'draw' && (g.result === 'white') === (g.me === 'w'));
          buzz('success');
        } else if (theirs && theirs.side !== g.me && g.bot) {
          flash(theirs.check ? 'Check!' : 'Hound bot moved', false);
        } else if (mine?.captured) {
          flash('Takes!', true);
        }
        setGame(g);
        setMsg(null);
      }
    } catch (e) {
      Alert.alert('Hound Chess', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const onTap = (X: number, Y: number) => {
    if (!v || !parsed) return;
    const sq = squareAt(v, X, Y, me);
    // A tall piece covers the square behind it: hit-test pieces first, the
    // nearest in front.
    let hit: ChessPiece | null = null;
    let best = -1;
    for (const p of parsed.pieces) {
      if (p.color !== me) continue;
      const c = sqPoint(v, p.sq, me, 0.5, 0.62);
      const k = c.s * (v.w / 358) * 1.22;
      if (Math.abs(X - c.x) <= 12 * k && Y <= c.y + 4 * k && Y >= c.y - 48 * k && c.y > best) {
        best = c.y;
        hit = p;
      }
    }
    if (sel && sq != null) {
      const t = targets.find((o) => sqIndex(o.to) === sq);
      if (t) {
        play(t.from, t.to);
        return;
      }
    }
    if (!hit && sq != null) hit = parsed.pieces.find((p) => p.sq === sq && p.color === me) ?? null;
    if (!hit || !canAct) {
      setSel(null);
      return;
    }
    if (isResting(hit) && game) {
      const n = hit.type === 'Q' ? game.needs.queen : hit.type === 'R' ? game.needs.rook : game.needs.knightBishop;
      setSel(null);
      setMsg(
        `Your ${PIECE_NAME[hit.type]} is resting: it moves at ${n.toLocaleString('en-US')} steps${hit.type === 'Q' ? `, or after a ${game.needs.queenWorkout}-minute workout` : ''}. You’re ${Math.max(0, n - game.steps).toLocaleString('en-US')} away.`,
      );
      return;
    }
    if (!options.some((o) => sqIndex(o.from) === hit!.sq)) {
      setSel(null);
      setMsg(`That ${PIECE_NAME[hit.type]} has nowhere to go.`);
      return;
    }
    buzz('light');
    setSel({ sq: hit.sq });
  };

  const resign = () => {
    if (!challengeId) return;
    Alert.alert('Resign?', 'The game goes to your opponent.', [
      { text: 'Keep playing', style: 'cancel' },
      {
        text: 'Resign',
        style: 'destructive',
        onPress: async () => {
          try {
            setGame(await resignChess(challengeId));
          } catch (e) {
            Alert.alert('Hound Chess', e instanceof Error ? e.message : 'Try again.');
          }
        },
      },
    ]);
  };

  const loading = mode === 'puzzle' ? !puzzle : !game;
  if (loading) {
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

  // What's marked on the board.
  const marks: { sq: number; fill: string }[] = [];
  const last = mode === 'puzzle' ? lastPuzzleMove : game?.history.slice(-1)[0] ?? null;
  if (last) [last.from, last.to].forEach((s) => marks.push({ sq: sqIndex(s), fill: 'rgba(240,194,74,0.45)' }));
  if (sel) marks.push({ sq: sel.sq, fill: 'rgba(79,123,224,0.55)' });
  if (mode === 'game' && game?.inCheck && parsed) {
    const k = parsed.pieces.find((p) => p.type === 'K' && p.color === parsed.turn);
    if (k) marks.push({ sq: k.sq, fill: 'rgba(224,91,91,0.6)' });
  }
  if (mode === 'puzzle' && puzzle?.solved && parsed) {
    const k = parsed.pieces.find((p) => p.type === 'K' && p.color === 'b');
    if (k) marks.push({ sq: k.sq, fill: 'rgba(224,91,91,0.6)' });
  }
  const occupied = new Set(parsed?.pieces.map((p) => p.sq));
  const dots = targets.map((o) => ({ sq: sqIndex(o.to), cap: occupied.has(sqIndex(o.to)) }));

  // The words.
  const them = mode === 'game' && game ? (game.me === 'w' ? game.black : game.white) : null;
  const themName = them ? (game?.bot ? `Hound bot` : them.name.split(' ')[0]) : '';
  const hoursLeft = game?.deadline ? Math.max(0, Math.round((new Date(game.deadline).getTime() - Date.now()) / 3600000)) : null;
  let title: string;
  let kicker: string;
  let status: string;
  if (mode === 'puzzle' && puzzle) {
    kicker = 'PUZZLE OF THE DAY · MATE IN 1';
    title = puzzle.solved ? 'Solved!' : !puzzle.open ? 'Opens at 5,000 steps' : puzzle.tries >= puzzle.maxTries ? 'Out of tries' : 'White to mate';
    status = !puzzle.open
      ? `Opens at ${puzzle.need.toLocaleString('en-US')} steps`
      : puzzle.solved
        ? 'Back tomorrow'
        : puzzle.tries >= puzzle.maxTries
          ? 'Try again tomorrow'
          : sel
            ? 'Tap a dot to move'
            : 'Tap a piece to move';
  } else {
    const g = game!;
    kicker = `HOUND CHESS · YOU VS ${(g.bot ? `HOUND BOT (${BOT_NAME[g.bot].toUpperCase()})` : themName.toUpperCase())} · MOVE ${Math.floor(g.plies / 2) + 1}`;
    title = g.status === 'waiting' ? 'Waiting to start' : g.status === 'final' ? 'Game over' : g.myTurn ? (g.inCheck ? 'Check! Your move' : 'Your move') : `${themName}’s move`;
    status =
      g.status === 'waiting'
        ? 'Waiting for your opponent to join'
        : g.status === 'final'
          ? resultLine(g.result, g.method, g.me)
          : g.myTurn
            ? sel
              ? 'Tap a dot to move'
              : 'Tap a piece to move'
            : `${themName}’s turn${hoursLeft != null ? ` · ${hoursLeft}h left` : ''}`;
  }
  const lastLine =
    mode === 'game' && game && game.history.length > 0
      ? moveLine(game.history[game.history.length - 1], game.history[game.history.length - 1].side === game.me, themName)
      : null;
  const message =
    msg ??
    (mode === 'puzzle'
      ? puzzle?.open
        ? `Find the move that checks Black’s king with nowhere to run. ${puzzle.maxTries - puzzle.tries} ${puzzle.maxTries - puzzle.tries === 1 ? 'try' : 'tries'} left. First try: ${puzzle.bonesFirst} Bones.${hint && puzzle.theme ? ` Hint: ${puzzle.theme.toLowerCase()}.` : ''}`
        : `Walk to ${puzzle?.need.toLocaleString('en-US')} steps and today’s puzzle opens. You’re at ${puzzle?.steps.toLocaleString('en-US')}.`
      : game?.status === 'final'
        ? resultLine(game.result, game.method, game.me)
        : game?.allFree && game.myTurn
          ? `${game.inCheck ? 'You’re in check: ' : 'Nothing free could move: '}every piece is free this move.`
          : lastLine ?? `You’re White. Your steps today free your pieces: walk more and the rest join in.`);
  const rows = game ? unlockRows(game.free, game.steps, game.needs, game.freeToday) : [];
  const actOn = mode === 'puzzle' ? canAct : !!game?.myTurn;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.fixed}>
        <View style={styles.head}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ paddingBottom: 4 }}>
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <BoardLink challengeId={mode === 'game' ? challengeId : undefined}>
              <Text style={styles.kicker} numberOfLines={1}>
                {kicker}
              </Text>
            </BoardLink>
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.title}>
              {mode === 'puzzle' ? puzzle?.streak ?? 0 : `${(game?.me === 'b' ? -1 : 1) * (game?.material ?? 0) > 0 ? '+' : ''}${(game?.me === 'b' ? -1 : 1) * (game?.material ?? 0)}`}
            </Text>
            <Text style={styles.small}>{mode === 'puzzle' ? 'day streak' : 'material'}</Text>
          </View>
        </View>

        <View style={styles.field} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {v && parsed && (
            <Board v={v} me={me} pieces={parsed.pieces} marks={marks} dots={dots} resting={isResting} restTag={restTag} />
          )}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPressIn={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
            accessibilityRole="button"
            accessibilityLabel="The board: tap a piece, then a square to move it"
          />
          <Text style={[styles.chip, { left: 10 }]} pointerEvents="none">
            {mode === 'puzzle' ? 'You’re White · find mate' : `${(game?.steps ?? 0).toLocaleString('en-US')} steps today${(game?.workoutMin ?? 0) >= (game?.needs.queenWorkout ?? 20) ? ' · workout done' : ''}`}
          </Text>
          {mode === 'game' && game && them && (
            <Text style={[styles.chip, { right: 10, color: '#d6d0ff' }]} pointerEvents="none" numberOfLines={1}>
              {game.bot ? `Hound bot · ${BOT_NAME[game.bot]}` : `${themName} · ${(game.theirSteps ?? 0).toLocaleString('en-US')} steps`}
            </Text>
          )}
          {mode === 'puzzle' && puzzle && (
            <Text style={[styles.chip, { right: 10, color: '#ffd27a' }]} pointerEvents="none">
              {puzzle.solved ? 'Solved' : `${puzzle.maxTries - puzzle.tries} ${puzzle.maxTries - puzzle.tries === 1 ? 'try' : 'tries'} left`}
            </Text>
          )}
          {mode === 'puzzle' && puzzle && !puzzle.open && (
            <View style={styles.lock} pointerEvents="none">
              <Text style={styles.lockTitle}>Today’s puzzle opens at {puzzle.need.toLocaleString('en-US')} steps</Text>
              <Text style={styles.lockSub}>
                {puzzle.steps.toLocaleString('en-US')} so far · {Math.max(0, puzzle.need - puzzle.steps).toLocaleString('en-US')} to go
              </Text>
              <View style={styles.lockBar}>
                <View style={[styles.lockFill, { width: `${Math.min(100, Math.round((100 * puzzle.steps) / puzzle.need))}%` }]} />
              </View>
            </View>
          )}
          {banner && (
            <View pointerEvents="none" style={[styles.banner, { backgroundColor: banner.good ? '#7fd39b' : '#f2a3a3' }]}>
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          )}
        </View>

        {mode === 'game' && game && (
          <View style={styles.unlocks}>
            {rows.map((r) => (
              <View key={r.name} style={[styles.unlock, { backgroundColor: r.on ? withAlpha('#7fd39b', 0.18) : withAlpha('#f0c24a', 0.14) }]}>
                <Text style={styles.unlockName} numberOfLines={2}>
                  {r.name}
                </Text>
                <Text style={styles.unlockSub} numberOfLines={2}>
                  {r.sub}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.msg} numberOfLines={3}>
          {message}
        </Text>
      </View>

      <View style={styles.pinned}>
        {mode === 'game' && game?.status === 'active' && (
          <Pressable onPress={resign} style={styles.side} accessibilityRole="button">
            <Text style={styles.sideText}>Resign</Text>
          </Pressable>
        )}
        {mode === 'puzzle' && puzzle?.open && !puzzle.solved && puzzle.tries < puzzle.maxTries && (
          <Pressable onPress={() => setHint(true)} disabled={hint} style={[styles.side, hint && { opacity: 0.5 }]} accessibilityRole="button">
            <Text style={styles.sideText}>Hint</Text>
          </Pressable>
        )}
        <View style={[styles.act, actOn ? { backgroundColor: '#f08a24' } : styles.actOff]}>
          <Text style={[styles.actText, !actOn && { color: withAlpha(colors.text, 0.75), fontSize: 14 }]} numberOfLines={2}>
            {status}
          </Text>
        </View>
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
    fixed: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 8 },
    head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    field: { flex: 1, minHeight: 340, borderRadius: 16, overflow: 'hidden', backgroundColor: '#1a1e30' },
    chip: {
      position: 'absolute',
      top: 10,
      maxWidth: '48%',
      backgroundColor: 'rgba(15,17,28,0.85)',
      color: '#fff',
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      fontSize: 11.5,
      fontFamily: font.headingSemibold,
      overflow: 'hidden',
    },
    lock: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: 'rgba(15,17,28,0.78)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      padding: 24,
    },
    lockTitle: { fontFamily: font.headingSemibold, fontSize: 18, color: '#fff', textAlign: 'center' },
    lockSub: { fontSize: 13, color: '#c9cad3' },
    lockBar: { width: 220, height: 8, borderRadius: 4, backgroundColor: '#2a2c38', overflow: 'hidden' },
    lockFill: { height: '100%', borderRadius: 4, backgroundColor: '#f0c24a' },
    banner: { position: 'absolute', alignSelf: 'center', top: '22%', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
    bannerText: { fontFamily: font.headingSemibold, fontSize: 22, color: '#161826' },
    unlocks: { flexDirection: 'row', gap: 6 },
    unlock: { flex: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' },
    unlockName: { fontFamily: font.headingSemibold, fontSize: 11, color: colors.text, textAlign: 'center' },
    unlockSub: { fontSize: 10, color: withAlpha(colors.text, 0.7), marginTop: 2, textAlign: 'center' },
    msg: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.8), minHeight: 36 },
    pinned: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, flexDirection: 'row', gap: 8 },
    side: {
      width: 100,
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sideText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    act: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    actOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    actText: { fontFamily: font.headingSemibold, fontSize: 16, color: '#161826', textAlign: 'center' },
  });
}
