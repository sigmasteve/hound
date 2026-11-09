import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient as SvgLinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { groundPath, perspective, project, sizeAt } from './perspective';
import { PauseIcon, PlayIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { DayCard, groupLines } from './DayCard';
import { PickRow } from './PickRow';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import {
  formatSteps,
  inningLabel,
  isAtBat,
  isHit,
  ordinal,
  PLAY_SHORT,
  playWords,
  POSITION_NAMES,
  POSITION_SHORT,
  seedOf,
  ZONE_NAMES,
  type BaseballPos,
  type BaseballZone,
} from '../challenges/baseball';
import {
  awayTeam,
  baseballSide,
  baseballTeamOf,
  otherTeam,
  type BaseballGame,
  type BaseballInning,
  type BaseballPickField,
  type BaseballPicks,
  type BaseballPlay,
  type BaseballPlayer,
  type BaseballTeam,
} from '../challenges/baseballApi';

// Whoever's on the field: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type FieldPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

const GRASS = '#3e8a4f';
const GRASS_DARK = '#357a45';
const DIRT = '#c9a273';
const CHALK = 'rgba(255,255,255,0.9)';
const ZONE_ON = 'rgba(255, 214, 102, 0.32)';

// The field on a 560 × 400 grid, home plate at the bottom middle: the
// fence a 300 arc from home, the infield a 170 arc, three zones split at
// 75° and 105° (the doc's drawing).
const HOME = { x: 280, y: 372 };
const W = 560;
const H = 400;
const AT: Record<BaseballPos, { x: number; y: number }> = {
  p: { x: 280, y: 312 },
  // Behind and beside the plate, so the frame keeps its label.
  c: { x: 236, y: 372 },
  '1b': { x: 380, y: 266 },
  '2b': { x: 326, y: 212 },
  ss: { x: 234, y: 212 },
  '3b': { x: 180, y: 266 },
  lf: { x: 177, y: 198 },
  cf: { x: 280, y: 162 },
  rf: { x: 383, y: 198 },
};
const BASE = {
  first: { x: 351, y: 301 },
  second: { x: 280, y: 231 },
  third: { x: 209, y: 301 },
};
// Where a ball to each zone lands in the outfield (and over the fence).
const ZONE_SPOT: Record<BaseballZone, { x: number; y: number; over: { x: number; y: number } }> = {
  left: { x: 160, y: 185, over: { x: 92, y: 120 } },
  center: { x: 280, y: 140, over: { x: 280, y: 52 } },
  right: { x: 400, y: 185, over: { x: 468, y: 120 } },
};

function sideName(game: BaseballGame, team: BaseballTeam, people: FieldPerson[], userId: string | null | undefined): string {
  const members = baseballSide(game, team);
  const mine = baseballTeamOf(game, userId) === team;
  if (mine) return members.length === 1 ? 'You' : `Your side (${members.length})`;
  const names = members.map((m) => people.find((p) => p.userId === m.playerId)?.name ?? (m.joined ? 'Player' : 'Invited'));
  return names.length <= 2 ? names.join(' & ') : `${names[0]} +${names.length - 1}`;
}

export interface FieldMoment {
  // Who bats now (the fielding side is the other one).
  battingTeam: BaseballTeam;
  onFirst: string | null;
  onSecond: string | null;
  onThird: string | null;
  // The ball's path in a replay: to a fielder, or over the fence.
  ball?: { to: BaseballPos | null; aim: BaseballZone | null; kind: BaseballPlay['kind'] } | null;
}

// The field from behind home plate: the three zones (today's aim lit),
// the fielding side at their positions, and runners on the bases.
export function BaseballField({
  game,
  people,
  userId,
  moment,
  litZone,
  onZone,
  compact,
}: {
  game: BaseballGame;
  people: FieldPerson[];
  userId: string | null | undefined;
  moment: FieldMoment;
  litZone?: BaseballZone | null;
  onZone?: (z: BaseballZone) => void;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const size = compact ? 20 : 26;
  const ft = otherTeam(moment.battingTeam);
  const fielding = baseballSide(game, ft);
  const playerAt = (pos: BaseballPos) => fielding.find((p) => p.positions.includes(pos));

  const avatar = (p: BaseballPlayer | undefined, s: number, ring?: boolean) => {
    if (!p) return null;
    const person = people.find((x) => x.userId === p.playerId);
    const isMe = p.playerId === userId;
    return (
      <View style={[styles.ring, ring && styles.ringOn, { width: s + 4, height: s + 4, borderRadius: (s + 4) / 2 }]}>
        {p.joined && person ? (
          <Avatar
            initials={person.initials}
            tint={isMe ? TINT_A : p.botId ? colors.neutral800 : TINT_N}
            size={s}
            fontSize={compact ? 9 : 11}
            frameId={person.frameId}
            backgroundId={person.backgroundId}
            iconId={person.iconId}
          />
        ) : (
          <View style={[styles.ghost, { width: s, height: s, borderRadius: s / 2 }]}>
            <View style={styles.ghostDot} />
          </View>
        )}
      </View>
    );
  };
  const runner = (id: string | null) => game.players.find((p) => p.playerId === id);

  // The ballpark in 2.5D (perspective.ts), from behind home plate: the
  // same 560 x 400 ground as before (AT, BASE, ZONE_SPOT), every point
  // put through project(), so tapping a zone, the fielders, runners and
  // the ball all line up with the drawing.
  const hgt = width * (compact ? 0.82 : 0.9);
  const v = useMemo(() => perspective(width, hgt, { stand: hgt * 0.14, near: hgt * 0.1, botW: width * 1.02, a: 0.7, b: 0.82 }), [width, hgt]);
  const G2 = (x: number, y: number): [number, number] => [x / W, y / H];
  const P = (x: number, y: number) => project(v, x / W, y / H);
  const path = (pts: [number, number][], close = true) => groundPath(v, pts.map(([x, y]) => G2(x, y)), close);
  const arc = (r: number, from: { x: number; y: number }, to: { x: number; y: number }, n = 28): [number, number][] => {
    const a0 = Math.atan2(from.y - HOME.y, from.x - HOME.x);
    const a1 = Math.atan2(to.y - HOME.y, to.x - HOME.x);
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [HOME.x + Math.cos(a) * r, HOME.y + Math.sin(a) * r];
    });
  };
  const FL = { x: 68, y: 160 };
  const FR = { x: 492, y: 160 };
  const fence = arc(300, FL, FR, 48);
  const zonePts: Record<BaseballZone, [number, number][]> = {
    left: [[160, 252], [68, 160], ...arc(300, FL, { x: 202, y: 82 }), [236, 208], ...arc(170, { x: 236, y: 208 }, { x: 160, y: 252 }, 10)],
    center: [[236, 208], [202, 82], ...arc(300, { x: 202, y: 82 }, { x: 358, y: 82 }), [324, 208], ...arc(170, { x: 324, y: 208 }, { x: 236, y: 208 }, 10)],
    right: [[324, 208], [358, 82], ...arc(300, { x: 358, y: 82 }, FR), [400, 252], ...arc(170, { x: 400, y: 252 }, { x: 324, y: 208 }, 10)],
  };
  const wallH = compact ? 8 : 13;
  const wallTop = fence.map(([x, y]) => {
    const q = P(x, y);
    return `${q.x.toFixed(1)},${(q.y - wallH * q.s).toFixed(1)}`;
  });
  const wallBase = fence.map(([x, y]) => {
    const q = P(x, y);
    return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  });
  // Fans in the bleachers beyond the wall.
  const crowd = useMemo(() => {
    const out: { x: number; y: number; c: string; r: number }[] = [];
    if (!width) return out;
    const colors = ['#e5484d', '#ffd23f', '#4f7ae5', '#ffffff', '#f08a24', '#8b6fd6', '#3fb37f'];
    for (let gy = 6; gy < 150; gy += compact ? 13 : 10) {
      for (let gx = 4; gx < W; gx += compact ? 15 : 11) {
        const dy = gx - HOME.x;
        const fenceY = HOME.y - Math.sqrt(Math.max(0, 300 * 300 - dy * dy));
        if (gy > fenceY - 16) continue;
        const q = project(v, (gx + ((gy * 7) % 5)) / W, gy / H);
        out.push({ x: q.x, y: q.y, c: colors[(gx * 3 + gy) % colors.length], r: 2.6 * q.s });
      }
    }
    return out;
  }, [v, width, compact]);
  const stripes = Array.from({ length: 12 }, (_, i) => 72 + i * 26);

  const ball = moment.ball;
  const ballEnd = ball
    ? ball.kind === 'home_run' && !ball.to
      ? ZONE_SPOT[ball.aim ?? 'center'].over
      : ball.to
        ? AT[ball.to]
        : null
    : null;
  const home = P(HOME.x, HOME.y);
  const end = ballEnd ? P(ballEnd.x, ballEnd.y) : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: 1 / (compact ? 0.82 : 0.9) }}>
      {width > 0 && (
        <>
          <Svg width={width} height={hgt}>
            <Defs>
              <ClipPath id="fair">
                <Path d={path([[HOME.x, HOME.y], ...fence])} />
              </ClipPath>
              <SvgLinearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0.16" />
                <Stop offset="0.55" stopColor="#000000" stopOpacity="0" />
              </SvgLinearGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={hgt} rx={16} fill="#2a2f45" />
            <Rect x={0} y={0} width={width} height={v.stand * 0.45} fill="#1d2133" />
            {/* The bleachers: the ground beyond the wall, full of fans. */}
            <Path d={path([[0, 0], [W, 0], [W, 140], ...[...fence].reverse(), [0, 140]])} fill="#3a4060" />
            {crowd.map((c, i) => (
              <Circle key={i} cx={c.x} cy={c.y} r={c.r} fill={c.c} opacity={0.85} />
            ))}
            {/* Foul ground, then fair ground mown in stripes. */}
            <Path d={path([[0, 140], ...fence, [W, 140], [W, H], [0, H]])} fill={GRASS_DARK} />
            <Rect x={0} y={v.y1 - 1} width={width} height={hgt - v.y1 + 1} fill={GRASS_DARK} />
            <Path d={path([[HOME.x, HOME.y], ...fence])} fill={GRASS} />
            <G clipPath="url(#fair)">
              {stripes.map((y, i) =>
                i % 2 ? <Path key={y} d={path([[0, y], [W, y], [W, y + 26], [0, y + 26]])} fill={GRASS_DARK} opacity={0.55} /> : null,
              )}
            </G>
            {(['left', 'center', 'right'] as BaseballZone[]).map((z) => (
              <Path
                key={z}
                d={path(zonePts[z])}
                fill={litZone === z ? ZONE_ON : 'rgba(0,0,0,0.001)'}
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={1.2}
                onPress={onZone ? () => onZone(z) : undefined}
              />
            ))}
            {/* The infield: dirt, the grass diamond, chalk lines to the poles. */}
            <Path d={path([[HOME.x, HOME.y], [160, 252], ...arc(170, { x: 160, y: 252 }, { x: 400, y: 252 }, 24)])} fill={DIRT} />
            <Path d={path([[HOME.x, HOME.y], [BASE.first.x, BASE.first.y], [BASE.second.x, BASE.second.y], [BASE.third.x, BASE.third.y]])} fill={GRASS} />
            <Path d={path([[HOME.x, HOME.y], [FL.x, FL.y]], false)} stroke={CHALK} strokeWidth={1.6} />
            <Path d={path([[HOME.x, HOME.y], [FR.x, FR.y]], false)} stroke={CHALK} strokeWidth={1.6} />
            <Path d={path(Array.from({ length: 21 }, (_, i): [number, number] => [AT.p.x + Math.cos((i / 20) * Math.PI * 2) * 13, AT.p.y + 4 + Math.sin((i / 20) * Math.PI * 2) * 11]))} fill={DIRT} />
            <Path d={path(Array.from({ length: 21 }, (_, i): [number, number] => [HOME.x + Math.cos((i / 20) * Math.PI * 2) * 26, HOME.y - 2 + Math.sin((i / 20) * Math.PI * 2) * 20]))} fill={DIRT} />
            {[-1, 1].map((side) => (
              <Path key={side} d={path([[HOME.x + side * 9, HOME.y - 12], [HOME.x + side * 22, HOME.y - 12], [HOME.x + side * 22, HOME.y + 10], [HOME.x + side * 9, HOME.y + 10]])} fill="none" stroke={CHALK} strokeWidth={1.2} />
            ))}
            {[BASE.first, BASE.second, BASE.third].map((b, i) => (
              <Path key={i} d={path([[b.x, b.y - 7], [b.x + 7, b.y], [b.x, b.y + 7], [b.x - 7, b.y]])} fill="#ffffff" />
            ))}
            <Path d={path([[HOME.x - 7, HOME.y - 4], [HOME.x + 7, HOME.y - 4], [HOME.x + 7, HOME.y + 2], [HOME.x, HOME.y + 8], [HOME.x - 7, HOME.y + 2]])} fill="#ffffff" />
            {/* The outfield wall, standing up, and the foul poles. */}
            <Polygon points={[...wallBase, ...[...wallTop].reverse()].join(' ')} fill="#1f4e35" />
            <Path d={`M ${wallTop.join(' L ')}`} fill="none" stroke="#ffd23f" strokeWidth={compact ? 1.5 : 2.2} />
            {[FL, FR].map((f, i) => {
              const q = P(f.x, f.y);
              return <Line key={i} x1={q.x} y1={q.y} x2={q.x} y2={q.y - 46 * q.s} stroke="#ffd23f" strokeWidth={compact ? 2 : 3} />;
            })}
            <Rect x={0} y={v.y0} width={width} height={hgt - v.y0} fill="url(#dusk)" />
            {!compact &&
              (['left', 'center', 'right'] as BaseballZone[]).map((z) => {
                const q = P(z === 'left' ? 128 : z === 'center' ? 280 : 432, z === 'center' ? 112 : 150);
                return (
                  <SvgText key={z} x={q.x} y={q.y} fontSize={14 * q.s + 2} fontWeight="bold" fill="rgba(255,255,255,0.9)" textAnchor="middle">
                    {ZONE_NAMES[z]}
                  </SvgText>
                );
              })}
            {ball && end && (
              <G>
                <Path
                  d={`M ${home.x} ${home.y - 6} Q ${(home.x + end.x) / 2} ${Math.min(home.y, end.y) - (ball.kind === 'home_run' ? 70 : 24) * end.s} ${end.x} ${end.y}`}
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  strokeDasharray="6 5"
                  fill="none"
                />
                <Circle cx={end.x} cy={end.y} r={6 * end.s} fill="#ffffff" stroke="#c0392b" strokeWidth={1.5} />
              </G>
            )}
          </Svg>
          {(Object.keys(AT) as BaseballPos[]).map((pos) => {
            const p = playerAt(pos);
            const q = P(AT[pos].x, AT[pos].y);
            const s = sizeAt(v, q.s, size);
            return (
              <View key={pos} pointerEvents="none" style={[styles.spot, { left: q.x - (s + 4) / 2, top: q.y - (s + 4) / 2 }]}>
                <View style={[styles.shadow, { width: s * 0.8, height: s * 0.2, borderRadius: s, top: s + 2 }]} />
                {p ? avatar(p, s, moment.ball?.to === pos) : <View style={[styles.empty, { width: s, height: s, borderRadius: s / 2 }]} />}
                {!compact && <Text style={styles.posTag}>{POSITION_SHORT[pos]}</Text>}
              </View>
            );
          })}
          {(
            [
              [moment.onFirst, BASE.first],
              [moment.onSecond, BASE.second],
              [moment.onThird, BASE.third],
            ] as [string | null, { x: number; y: number }][]
          ).map(([id, at], i) => {
            if (!id) return null;
            const q = P(at.x, at.y);
            const s = sizeAt(v, q.s, compact ? 16 : 22);
            return (
              <View key={i} pointerEvents="none" style={[styles.spot, { left: q.x - (s + 4) / 2, top: q.y - s - 8 }]}>
                {avatar(runner(id), s, true)}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

// The line score: runs by inning, then R and H.
export function BaseballLineScore({
  game,
  innings,
  people,
  userId,
}: {
  game: BaseballGame;
  innings: BaseballInning[];
  people: FieldPerson[];
  userId: string | null | undefined;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const away = awayTeam(game);
  const home = game.homeTeam;
  const shown = Math.max(game.innings, innings.length ? innings[innings.length - 1].inning : 0);
  const cols = Array.from({ length: shown }, (_, i) => i + 1);
  const row = (team: BaseballTeam) => {
    const isAway = team === away;
    const runs = team === 'a' ? game.runsA : game.runsB;
    const hits = team === 'a' ? game.hitsA : game.hitsB;
    const won = game.status === 'final' && game.winnerTeam === team;
    return (
      <View key={team} style={styles.lineRow}>
        <Text style={styles.lineName} numberOfLines={1}>
          {sideName(game, team, people, userId)}
          {won ? '  🏆' : ''}
        </Text>
        {cols.map((c) => {
          const inn = innings.find((x) => x.inning === c);
          const v = !inn ? '' : isAway ? String(inn.awayRuns) : inn.homeRuns == null ? 'X' : String(inn.homeRuns);
          return (
            <Text key={c} style={[styles.lineCell, game.status === 'active' && c === game.inning && styles.lineCellNow]}>
              {v}
            </Text>
          );
        })}
        <Text style={[styles.lineCell, styles.lineTotal]}>{runs}</Text>
        <Text style={[styles.lineCell, styles.lineHits]}>{hits}</Text>
      </View>
    );
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.line}>
        <View style={styles.lineRow}>
          <Text style={[styles.lineName, styles.lineHead]}> </Text>
          {cols.map((c) => (
            <Text key={c} style={[styles.lineCell, styles.lineHead]}>
              {c}
            </Text>
          ))}
          <Text style={[styles.lineCell, styles.lineHead]}>R</Text>
          <Text style={[styles.lineCell, styles.lineHead]}>H</Text>
        </View>
        {row(away)}
        {row(home)}
      </View>
    </ScrollView>
  );
}

export function baseballResultLine(game: BaseballGame, people: FieldPerson[], userId: string | null | undefined): string {
  if (game.status !== 'final') return '';
  const a = game.runsA;
  const b = game.runsB;
  if (game.winnerTeam == null) return `A tie, ${a}–${b}, after ${game.inning - 1} innings.`;
  const w = game.winnerTeam;
  const mine = baseballTeamOf(game, userId) === w;
  const who = mine ? 'Your side' : sideName(game, w, people, userId);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const extra = game.inning - 1 > game.innings ? ` in ${game.inning - 1} innings` : '';
  return `${who} won ${hi}–${lo}${extra}.`;
}

// A compact score for Home's pinned challenge: "Your side 3, Rex & Bo 2 ·
// after the 4th".
export function baseballHeadline(name: string, game: BaseballGame | null, userId: string | null): string {
  if (!game) return name;
  if (game.status === 'final') return `${name}: ${baseballResultLine(game, [], userId)}`;
  const mine = baseballTeamOf(game, userId) ?? 'a';
  const us = mine === 'a' ? game.runsA : game.runsB;
  const them = mine === 'a' ? game.runsB : game.runsA;
  const done = game.inning - 1;
  return done === 0 ? `${name}: first pitch tomorrow morning` : `${name}: ${us}–${them} after the ${ordinal(done)}`;
}

const ZONES: BaseballZone[] = ['left', 'center', 'right'];

export function BaseballCard({
  game,
  innings,
  plays,
  picks,
  onPick,
  participants,
  userId,
  stepsToday,
  onShowField,
}: {
  game: BaseballGame | null;
  innings: BaseballInning[];
  plays: BaseballPlay[];
  picks: BaseballPicks;
  onPick: (field: BaseballPickField, value: string | null) => Promise<void>;
  participants: FieldPerson[];
  userId: string | undefined;
  stepsToday: number | null;
  // A replay started from a card further down: bring the field into view.
  onShowField?: (field: View | null) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState<BaseballPickField | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The report shows the last three innings until asked for the rest.
  const [allInnings, setAllInnings] = useState(false);

  // The inning being replayed: any inning, from its card in the report;
  // the last one played until then.
  const lastInning = plays.length ? plays[plays.length - 1].inning : null;
  const [replayInning, setReplayInning] = useState<number | null>(null);
  const showInning = replayInning ?? lastInning;
  const night = useMemo(() => plays.filter((p) => p.inning === showInning), [plays, showInning]);
  // Bumped to start a replay over, even of the same inning.
  const [replayGo, setReplayGo] = useState(0);
  const fieldRef = useRef<View>(null);
  const startReplay = (inning: number) => {
    setReplayInning(inning);
    setStep(null);
    setPlaying(true);
    setReplayGo((g) => g + 1);
    onShowField?.(fieldRef.current);
  };
  const stopReplay = () => {
    setPlaying(false);
    setStep(null);
    setReplayInning(null);
  };

  useEffect(() => {
    if (!playing) return;
    const next = () =>
      setStep((s) => {
        const n = (s ?? -1) + 1;
        if (n >= night.length) {
          setPlaying(false);
          return night.length - 1;
        }
        return n;
      });
    next();
    timer.current = setInterval(next, 1400);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, night.length, replayGo]);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Baseball</Text>
        <Text style={styles.note}>This game never got set up. Delete it and start another.</Text>
      </Card>
    );
  }

  const nameOf = (id: string | null | undefined) =>
    id === userId ? 'You' : (participants.find((p) => p.userId === id)?.name ?? (game.players.find((p) => p.playerId === id)?.botId ? 'Bot' : 'Someone'));
  const me = game.players.find((p) => p.playerId === userId);
  const myTeam = me?.team ?? null;
  const ourTeam = myTeam ?? awayTeam(game);
  const iCatch = !!me?.positions.includes('c');
  const iPitch = !!me?.positions.includes('p');
  const done = game.inning - 1;
  const waiting = game.players.filter((p) => !p.joined).length;
  const showing = step != null ? night[step] : null;
  const moment: FieldMoment = showing
    ? {
        battingTeam: showing.battingTeam,
        onFirst: showing.onFirst,
        onSecond: showing.onSecond,
        onThird: showing.onThird,
        ball:
          showing.aim || showing.fielderPos
            ? {
                // A home run over the fence has no fielder; an inside-the-park one does.
                to: showing.kind === 'home_run' && !showing.lateThrow ? null : showing.fielderPos && showing.fielderPos !== 'c' ? showing.fielderPos : null,
                aim: showing.aim,
                kind: showing.kind,
              }
            : null,
      }
    : { battingTeam: myTeam ? otherTeam(myTeam) : awayTeam(game), onFirst: null, onSecond: null, onThird: null };

  const pick = async (field: BaseballPickField, value: string | null) => {
    setBusy(field);
    try {
      await onPick(field, value);
    } finally {
      setBusy(null);
    }
  };

  // "The 4th inning · Pitcher, catcher · bats 3rd · 4,210 steps today"
  const statusLine = () => {
    if (!me) return '';
    const where = done === 0 ? 'First pitch tomorrow morning' : `The ${inningLabel(game.inning, game.innings)} inning`;
    const roles = me.positions.map((x) => POSITION_NAMES[x]).join(', ') || 'No position yet';
    const steps = stepsToday == null ? 'steps loading' : `${formatSteps(stepsToday)} today`;
    return `${where} · ${roles} · bats ${ordinal(me.seat)} · ${steps}`;
  };
  // Your picks, short, for the row: "Swinging left · shift right · stealing"
  const anyPick = !!(picks.aim || (iCatch && picks.shift) || (iPitch && picks.approach) || picks.steal);
  const shortPicks = () => {
    if (!anyPick) return 'No picks yet';
    const out: string[] = [];
    if (picks.aim) out.push(`Swinging ${ZONE_NAMES[picks.aim].toLowerCase()}`);
    if (iCatch && picks.shift) out.push(`shift ${ZONE_NAMES[picks.shift].toLowerCase()}`);
    if (iPitch && picks.approach) out.push(picks.approach === 'power' ? 'pitching power' : 'pitching finesse');
    if (picks.steal) out.push('stealing');
    const line = out.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  };

  // The box score: each batter's line over the whole game.
  const box = new Map<string, { ab: number; h: number; hr: number; rbi: number; bb: number; k: number; team: BaseballTeam }>();
  for (const p of plays) {
    if (!p.batterId || p.kind === 'stolen_base' || p.kind === 'caught_stealing' || p.kind === 'out_at_home') continue;
    const r = box.get(p.batterId) ?? { ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, k: 0, team: p.battingTeam };
    if (isAtBat(p.kind)) r.ab += 1;
    if (isHit(p.kind)) r.h += 1;
    if (p.kind === 'home_run') r.hr += 1;
    if (p.kind === 'walk') r.bb += 1;
    if (p.kind === 'strikeout') r.k += 1;
    if (p.kind !== 'double_play') r.rbi += p.runs;
    box.set(p.batterId, r);
  }

  // The innings played, newest first, for the report.
  const played = [...innings].filter((i) => plays.some((p) => p.inning === i.inning)).sort((a, b) => b.inning - a.inning);
  const playerOf = (p: BaseballPlay) => (p.kind === 'out_at_home' || p.kind === 'stolen_base' || p.kind === 'caught_stealing' ? p.runnerId : p.batterId);

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>Baseball</Text>
        <Text style={styles.meta}>
          {game.innings} innings · one a day · {sideName(game, game.homeTeam, participants, userId)} at home
        </Text>
      </View>

      <BaseballLineScore game={game} innings={innings} people={participants} userId={userId} />

      <View ref={fieldRef} collapsable={false}>
        <BaseballField
          game={game}
          people={participants}
          userId={userId}
          moment={moment}
          litZone={showing ? showing.aim : game.status === 'active' ? picks.aim : null}
          onZone={game.status === 'active' && me?.joined && !showing ? (z) => pick('aim', picks.aim === z ? null : z) : undefined}
        />
      </View>

      {showing && (
        <View style={styles.playNow}>
          <Text style={styles.playNowHead}>
            {showing.half === 'top' ? 'Top' : 'Bottom'} of the {inningLabel(showing.inning, game.innings)} · {showing.outs} out · play {(step ?? 0) + 1} of {night.length}
          </Text>
          <Text style={styles.playNowText}>
            {nameOf(playerOf(showing))} {playWords(showing.kind, showing.fielderPos, showing.aim, showing.lateThrow, showing.runs, seedOf(showing.id))}
          </Text>
        </View>
      )}

      {step != null && (
        <View style={styles.replayRow}>
          <Pressable
            style={styles.replayBtn}
            onPress={() => {
              if (playing) setPlaying(false);
              else if (showInning != null) startReplay(showInning);
            }}
            accessibilityRole="button"
          >
            {playing ? <PauseIcon size={14} color={colors.accent} weight="fill" /> : <PlayIcon size={14} color={colors.accent} weight="fill" />}
            <Text style={styles.replayText}>{playing ? 'Pause' : 'Replay again'}</Text>
          </Pressable>
          <Pressable onPress={stopReplay} hitSlop={8} accessibilityRole="button">
            <Text style={styles.replayDone}>Back to today</Text>
          </Pressable>
        </View>
      )}

      {/* Where things stand, in one line. */}
      {me && game.status === 'active' && (
        <Text style={styles.status}>
          {statusLine()}
          {waiting > 0 ? ` · ${waiting} haven’t joined` : ''}
        </Text>
      )}

      {game.status === 'active' && me?.joined && !showing && (
        <PickRow
          title="Today’s picks"
          value={shortPicks()}
          picked={anyPick}
          busy={busy !== null}
          note={`For the ${inningLabel(game.inning, game.innings)}, played tomorrow morning`}
          sheetTitle={`Picks for the ${inningLabel(game.inning, game.innings)}`}
          sheetNote="Your steps today count for every at-bat and play you're in. Picks stay hidden from the other side until it's played."
        >
          {(close) => (
            <>
              <Text style={styles.pickLabel}>Aim your swing (or tap the field)</Text>
              <View style={styles.pickRow}>
                {ZONES.map((z) => (
                  <Pressable key={z} style={[styles.pickChip, picks.aim === z && styles.pickChipOn]} onPress={() => pick('aim', picks.aim === z ? null : z)} disabled={busy !== null}>
                    <Text style={[styles.pickText, picks.aim === z && styles.pickTextOn]}>{ZONE_NAMES[z]}</Text>
                  </Pressable>
                ))}
              </View>
              {iCatch && (
                <>
                  <Text style={styles.pickLabel}>Your call as catcher: shift the field</Text>
                  <View style={styles.pickRow}>
                    {ZONES.map((z) => (
                      <Pressable key={z} style={[styles.pickChip, picks.shift === z && styles.pickChipOn]} onPress={() => pick('shift', picks.shift === z ? null : z)} disabled={busy !== null}>
                        <Text style={[styles.pickText, picks.shift === z && styles.pickTextOn]}>{ZONE_NAMES[z]}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {iPitch && (
                <>
                  <Text style={styles.pickLabel}>How you pitch</Text>
                  <View style={styles.pickRow}>
                    {(['power', 'finesse'] as const).map((a) => (
                      <Pressable key={a} style={[styles.pickChip, picks.approach === a && styles.pickChipOn]} onPress={() => pick('approach', picks.approach === a ? null : a)} disabled={busy !== null}>
                        <Text style={[styles.pickText, picks.approach === a && styles.pickTextOn]}>{a === 'power' ? 'Power' : 'Finesse'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.meta}>Power: more strikeouts, harder contact. Finesse: softer contact, more walks.</Text>
                </>
              )}
              <Pressable style={styles.stealRow} onPress={() => pick('steal', picks.steal ? 'off' : 'on')} disabled={busy !== null} accessibilityRole="switch" accessibilityState={{ checked: picks.steal }}>
                <View style={[styles.toggle, picks.steal && styles.toggleOn]}>
                  <View style={[styles.knob, picks.steal && styles.knobOn]} />
                </View>
                <Text style={styles.note}>Steal when you're on base (your steps against the catcher's)</Text>
              </Pressable>
              <View style={styles.doneRow}>
                {busy ? <ActivityIndicator color={colors.accent} /> : <View />}
                <Pressable onPress={close} style={styles.doneBtn} accessibilityRole="button">
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
            </>
          )}
        </PickRow>
      )}

      {game.status === 'final' && <Text style={styles.result}>{baseballResultLine(game, participants, userId)}</Text>}
      {game.status === 'active' && done === 0 && !me?.joined && <Text style={styles.note}>First pitch is tomorrow morning.</Text>}

      {played.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.sectionTitle}>Game report</Text>
          {played.slice(0, allInnings ? undefined : 3).map((inn, i) => {
            const rows = plays.filter((p) => p.inning === inn.inning);
            const away = awayTeam(game);
            const runsOf = (t: BaseballTeam) => (t === away ? inn.awayRuns : (inn.homeRuns ?? 0));
            const hitsOf = (t: BaseballTeam) => (t === away ? inn.awayHits : (inn.homeHits ?? 0));
            const them = otherTeam(ourTeam);
            const side = (t: BaseballTeam) => `${runsOf(t)} run${runsOf(t) === 1 ? '' : 's'} on ${hitsOf(t)} hit${hitsOf(t) === 1 ? '' : 's'}`;
            // Who brought runs in, and any home runs: the inning's headline.
            const scored = (t: BaseballTeam) =>
              groupLines(rows.filter((p) => p.battingTeam === t && p.runs > 0 && p.kind !== 'double_play').map((p) => `${nameOf(playerOf(p))} ${PLAY_SHORT[p.kind]}`)).join(', ');
            const ours = scored(ourTeam);
            const theirs = scored(them);
            const summary = !ours && !theirs ? `No runs. Yours: ${hitsOf(ourTeam)} H · Theirs: ${hitsOf(them)} H` : `Yours: ${ours || 'none'} · Theirs: ${theirs || 'none'}`;
            return (
              <DayCard
                key={inn.inning}
                title={`The ${inningLabel(inn.inning, game.innings)}`}
                score={`${runsOf(ourTeam)}–${runsOf(them)}`}
                summary={summary}
                defaultOpen={i === 0}
                replaying={step != null && showInning === inn.inning}
                onReplay={rows.length > 0 ? () => startReplay(inn.inning) : undefined}
              >
                <Text style={styles.playSteps}>
                  Your side {side(ourTeam)} · theirs {side(them)}
                </Text>
                {(['top', 'bottom'] as const).map((half) => {
                  const hr = rows.filter((p) => p.half === half);
                  if (hr.length === 0) return null;
                  return (
                    <View key={half} style={styles.half}>
                      <Text style={styles.halfHead}>
                        {half === 'top' ? 'Top' : 'Bottom'} · {sideName(game, hr[0].battingTeam, participants, userId)} bat
                      </Text>
                      {hr.map((p) => (
                        <View key={p.id} style={styles.playRow}>
                          <View style={[styles.chip, chipStyle(p, styles)]}>
                            <Text style={[styles.chipText, (p.kind === 'home_run' || p.runs > 0) && styles.chipTextBig]}>{PLAY_SHORT[p.kind]}</Text>
                          </View>
                          <Text style={styles.playText} numberOfLines={2}>
                            {nameOf(playerOf(p))} {playWords(p.kind, p.fielderPos, p.aim, p.lateThrow, p.runs, seedOf(p.id))}
                            {p.batterSteps != null && p.pitcherSteps != null && p.kind !== 'out_at_home' ? (
                              <Text style={styles.playSteps}>
                                {'  '}
                                {p.batterSteps.toLocaleString()} vs {p.pitcherSteps.toLocaleString()}
                              </Text>
                            ) : null}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </DayCard>
            );
          })}
          {!allInnings && played.length > 3 && (
            <Pressable onPress={() => setAllInnings(true)} style={styles.earlier} accessibilityRole="button">
              <Text style={styles.earlierText}>Earlier innings ({played.length - 3})</Text>
            </Pressable>
          )}
        </View>
      )}

      {box.size > 0 && (
        <DayCard title="Box score">
          <View style={styles.boxRow}>
            <Text style={[styles.boxName, styles.lineHead]}>Batting</Text>
            {['AB', 'H', 'HR', 'RBI', 'BB', 'K'].map((h) => (
              <Text key={h} style={[styles.boxNum, styles.lineHead]}>
                {h}
              </Text>
            ))}
          </View>
          {([awayTeam(game), game.homeTeam] as BaseballTeam[]).map((t) =>
            baseballSide(game, t)
              .filter((p) => box.has(p.playerId))
              .map((p) => {
                const r = box.get(p.playerId)!;
                return (
                  <View key={p.playerId} style={styles.boxRow}>
                    <Text style={styles.boxName} numberOfLines={1}>
                      {nameOf(p.playerId)} <Text style={styles.boxPos}>{p.positions.map((x) => POSITION_SHORT[x]).join(' ')}</Text>
                    </Text>
                    {[r.ab, r.h, r.hr, r.rbi, r.bb, r.k].map((v, k) => (
                      <Text key={k} style={styles.boxNum}>
                        {v}
                      </Text>
                    ))}
                  </View>
                );
              }),
          )}
        </DayCard>
      )}
    </Card>
  );
}

function chipStyle(p: BaseballPlay, styles: ReturnType<typeof makeStyles>) {
  if (p.kind === 'home_run') return styles.chipHomer;
  if (isHit(p.kind) || p.kind === 'walk' || p.kind === 'stolen_base') return styles.chipOn;
  return null;
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18, flexShrink: 1 },
    result: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    spot: { position: 'absolute', alignItems: 'center' },
    shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.2)' },
    ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    ringOn: { borderColor: colors.amber },
    // Someone who hasn't accepted yet: a small dot, not a big '?'.
    ghost: { alignItems: 'center', justifyContent: 'center' },
    ghostDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
    empty: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', borderStyle: 'dashed' },
    posTag: {
      marginTop: 1,
      fontSize: 9,
      fontFamily: font.headingSemibold,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 4,
      borderRadius: 4,
      overflow: 'hidden',
    },
    line: { gap: 2, minWidth: '100%' },
    lineRow: { flexDirection: 'row', alignItems: 'center' },
    lineName: { width: 118, fontFamily: font.heading, fontSize: 13, color: colors.text, paddingRight: 6 },
    lineHead: { fontSize: 11, color: withAlpha(colors.text, 0.5), fontFamily: font.headingSemibold },
    lineCell: { width: 24, textAlign: 'center', fontSize: 13.5, color: colors.text, fontVariant: ['tabular-nums'] },
    lineCellNow: { backgroundColor: withAlpha(colors.accent, 0.18), borderRadius: 4 },
    lineTotal: { fontFamily: font.headingSemibold, width: 30 },
    lineHits: { color: withAlpha(colors.text, 0.6), width: 26 },
    playNow: { gap: 2, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.accent, 0.1) },
    playNowHead: { fontSize: 11.5, color: withAlpha(colors.text, 0.6), fontFamily: font.headingSemibold },
    playNowText: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    status: { fontSize: 12.5, color: withAlpha(colors.text, 0.62) },
    earlier: { alignSelf: 'center', paddingVertical: 8 },
    earlierText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    doneBtn: { paddingVertical: 8, paddingHorizontal: 22, borderRadius: 999, backgroundColor: colors.accent },
    doneText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#ffffff' },
    replayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: withAlpha(colors.accent, 0.12) },
    replayText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    replayDone: { fontFamily: font.heading, fontSize: 13, color: withAlpha(colors.text, 0.6) },
    pickLabel: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.text, marginTop: 2 },
    pickRow: { flexDirection: 'row', gap: 8 },
    pickChip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.15) },
    pickChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pickText: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    pickTextOn: { color: '#ffffff', fontFamily: font.headingSemibold },
    stealRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
    toggle: { width: 40, height: 24, borderRadius: 12, backgroundColor: withAlpha(colors.text, 0.2), padding: 2 },
    toggleOn: { backgroundColor: colors.accent },
    knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff' },
    knobOn: { transform: [{ translateX: 16 }] },
    sectionTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    half: { gap: 6, paddingTop: 4 },
    halfHead: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    playRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    playText: { flex: 1, fontSize: 13, color: colors.text },
    playSteps: { fontSize: 11.5, color: withAlpha(colors.text, 0.5) },
    chip: { minWidth: 34, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.text, 0.08), paddingHorizontal: 6 },
    chipOn: { backgroundColor: withAlpha(colors.accent, 0.28) },
    chipHomer: { backgroundColor: colors.amber },
    chipText: { fontFamily: font.heading, fontSize: 11.5, color: colors.text },
    chipTextBig: { fontFamily: font.headingSemibold },
    boxRow: { flexDirection: 'row', alignItems: 'center' },
    boxName: { flex: 1, fontSize: 13, color: colors.text },
    boxPos: { fontSize: 11, color: withAlpha(colors.text, 0.5) },
    boxNum: { width: 32, textAlign: 'center', fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
  });
}
