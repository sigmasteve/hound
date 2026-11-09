import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { Text } from './Text';
import { crowdDots, perspective, project, sizeAt, type Perspective } from './perspective';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import type { Participant } from '../challenges/types';
import {
  formatRallyDue,
  formatRallyTimeLeft,
  formatSteps,
  RALLY_GAME_POINTS,
  RALLY_GAMES_TO_WIN,
  rallyWindowLabel,
} from '../challenges/rally';
import { armRallySmash, rallyTeamMembers, rallyTeamOf, type RallyGame, type RallyTeam } from '../challenges/rallyApi';

// Whoever's on the court: the fields Participant and BoardEntry both
// carry, so the detail screen and Home can each hand over what they have.
export type CourtPerson = Pick<Participant, 'userId' | 'name' | 'initials'> &
  Partial<Pick<Participant, 'frameId' | 'backgroundId' | 'iconId' | 'level'>>;

// The court itself, in perspective (perspective.ts) like every sport:
// seen from behind the viewer's baseline, the far end narrower, a stand
// of fans behind it and the net standing up across the middle. One
// hound's avatar per player with a shadow (a dot for a player who hasn't
// accepted yet), and the shuttle beside whoever has to return it. Shared
// by the full card below and Home's compact preview.
//
// Every spot is a share of the court's width (x, the doubles sidelines
// at 0 and 1) and length (y, 0 at the far baseline), put through
// project() so the lines and the players line up.
const NET_Y = 0.5;
// Where each team stands: the far one past their short service line, the
// near one in front of ours.
const TEAM_Y = { far: 0.2, near: 0.79 };

export function RallyCourt({
  game,
  people,
  userId,
  compact,
  now = Date.now(),
}: {
  game: RallyGame;
  people: CourtPerson[];
  userId: string | null | undefined;
  compact?: boolean;
  now?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [w, setW] = useState(0);
  const h = Math.round(w * (compact ? 0.78 : 1.12));
  const view = useMemo(() => perspective(w, h, { stand: h * (compact ? 0.13 : 0.14), botW: w * 0.74, near: h * 0.05, a: 0.62, b: 0.8 }), [w, h, compact]);
  const myTeam = rallyTeamOf(game, userId) ?? 'a';
  const farTeam: RallyTeam = myTeam === 'a' ? 'b' : 'a';
  const need = (game.targetSteps ?? 0) * (game.smashArmed ? 2 : 1);
  const size = compact ? 26 : 40;

  const renderTeam = (team: RallyTeam, far: boolean) => {
    const members = rallyTeamMembers(game, team);
    const slots = members.length > 0 ? members : [null];
    return slots.map((p, i) => {
      const at = project(view, slots.length === 1 ? 0.5 : i === 0 ? 0.3 : 0.7, far ? TEAM_Y.far : TEAM_Y.near);
      const sz = sizeAt(view, at.s, size);
      const person = p ? people.find((x) => x.userId === p.playerId) : undefined;
      const isMe = !!p && p.playerId === userId;
      const isBot = !!p?.botId;
      const hasShuttle = !!p && game.status === 'active' && game.sideUserId === p.playerId;
      const label = !p ? 'Open' : !p.joined ? 'Invited' : isMe ? 'You' : (person?.name ?? 'Player');
      const slotW = Math.min(130, (view.botW * at.s) / slots.length);
      const ring = sz + 6;
      return (
        <View
          key={p?.playerId ?? `slot-${team}-${i}`}
          pointerEvents="none"
          style={[styles.slot, { left: at.x - slotW / 2, top: at.y - ring / 2, width: slotW, zIndex: far ? 1 : 3 }]}
        >
          <View style={[styles.shadow, { width: sz * 0.8, height: sz * 0.16, borderRadius: sz, top: ring - sz * 0.24, left: (slotW - sz * 0.8) / 2 }]} />
          <View style={[styles.avatarRing, hasShuttle && styles.avatarRingOn, { width: ring, height: ring, borderRadius: ring / 2 }]}>
            {p?.joined && person ? (
              <Avatar
                initials={person.initials}
                tint={isMe ? TINT_A : isBot ? colors.neutral800 : TINT_N}
                size={sz}
                fontSize={compact ? 10 : 13}
                frameId={person.frameId}
                backgroundId={person.backgroundId}
                iconId={person.iconId}
              />
            ) : (
              <View style={[styles.ghost, { width: sz, height: sz, borderRadius: sz / 2 }]}>
                <View style={styles.ghostDot} />
              </View>
            )}
            {hasShuttle && (
              <View style={[styles.shuttle, far ? { bottom: -6 } : { top: -10 }, { right: -sz * 0.5 }]}>
                <Shuttlecock size={compact ? 14 : 20} />
              </View>
            )}
          </View>
          {!compact && (
            <Text style={[styles.playerName, hasShuttle && styles.playerNameOn]} numberOfLines={1}>
              {label}
            </Text>
          )}
          {hasShuttle && !compact && (
            <Text style={styles.playerShot} numberOfLines={1}>
              {formatSteps(need)} · {formatRallyTimeLeft(game.dueAt, now)}
            </Text>
          )}
        </View>
      );
    });
  };

  return (
    <View
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      style={[styles.court, compact && styles.courtCompact, { height: h || undefined, aspectRatio: w ? undefined : compact ? 1.28 : 0.9 }]}
    >
      {w > 0 && (
        <>
          <CourtArt view={view} compact={!!compact} part="floor" />
          {renderTeam(farTeam, true)}
          {/* The net goes over the far team and under ours. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 2 }]}>
            <CourtArt view={view} compact={!!compact} part="net" />
          </View>
          {renderTeam(myTeam, false)}
        </>
      )}
    </View>
  );
}

// The hall: the stand and its fans, the floor, the court and its lines
// (part 'floor'), and the net with its posts (part 'net').
function CourtArt({ view: v, compact, part }: { view: Perspective; compact: boolean; part: 'floor' | 'net' }) {
  const P = (x: number, y: number) => project(v, x, y);
  const quad = (x0: number, y0: number, x1: number, y1: number) =>
    [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lw = compact ? 1.1 : 1.6;
  const crowd = useMemo(() => crowdDots(v.w, v.stand, compact), [v.w, v.stand, compact]);

  if (part === 'net') {
    const l = P(-0.04, NET_Y);
    const r = P(1.04, NET_Y);
    const hgt = (compact ? 0.1 : 0.12) * v.botW * l.s;
    const top = 0.9 * hgt;
    const cols = compact ? 18 : 30;
    return (
      <Svg width={v.w} height={v.h}>
        {/* Its shadow on the floor, then the mesh, the tape and the posts. */}
        <Polygon points={`${l.x},${l.y} ${r.x},${r.y} ${r.x},${r.y + 3} ${l.x},${l.y + 3}`} fill="rgba(0,0,0,0.18)" />
        <Rect x={l.x} y={l.y - hgt} width={r.x - l.x} height={hgt - (hgt - top) - 2} fill="rgba(20,24,30,0.32)" />
        {Array.from({ length: cols }, (_, i) => {
          const x = l.x + ((r.x - l.x) * (i + 1)) / (cols + 1);
          return <Line key={i} x1={x} y1={l.y - hgt + 3} x2={x} y2={l.y - hgt + top} stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />;
        })}
        {[0.35, 0.6].map((k) => (
          <Line key={k} x1={l.x} y1={l.y - hgt + top * k} x2={r.x} y2={l.y - hgt + top * k} stroke="rgba(255,255,255,0.3)" strokeWidth={0.6} />
        ))}
        <Rect x={l.x} y={l.y - hgt} width={r.x - l.x} height={compact ? 2 : 3} fill="#ffffff" />
        {[l, r].map((p, i) => (
          <G key={i}>
            <Rect x={p.x - 1.5} y={p.y - hgt - 1} width={3} height={hgt + 1} fill="#e9ecf2" />
            <Ellipse cx={p.x} cy={p.y} rx={4} ry={1.6} fill="#9aa3b5" />
          </G>
        ))}
      </Svg>
    );
  }

  const ln = (x0: number, y0: number, x1: number, y1: number, key: string) => {
    const a = P(x0, y0);
    const b = P(x1, y1);
    return <Line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={LINE} strokeWidth={lw} />;
  };
  return (
    <Svg width={v.w} height={v.h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="hallLight" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity="0.2" />
          <Stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.06" />
        </LinearGradient>
      </Defs>
      {/* The stand behind the far baseline, and the fans in it. */}
      <Rect x={0} y={0} width={v.w} height={v.stand} fill="#2a2f45" />
      <Rect x={0} y={0} width={v.w} height={v.stand * 0.22} fill="#1d2133" />
      {crowd.map((c, i) => (
        <Circle key={i} cx={c.x} cy={c.y} r={compact ? 1.8 : 2.4} fill={c.c} opacity={0.85} />
      ))}
      <Rect x={0} y={v.stand} width={v.w} height={v.y0 - v.stand} fill="#4f7ae5" />
      <Rect x={v.w * 0.36} y={v.stand} width={v.w * 0.28} height={v.y0 - v.stand} fill="#ffd23f" />
      {/* The hall floor, the run-off round the court, then the court. */}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill={HALL} />
      <Polygon points={quad(-0.14, -0.04, 1.14, 1.08)} fill={RUNOFF} />
      <Polygon points={quad(0, 0, 1, 1)} fill={COURT} />
      {/* Lines: the doubles and singles sidelines, the baselines and the
          doubles long service lines, the short service lines and the
          centre lines. */}
      <Polygon points={quad(0, 0, 1, 1)} fill="none" stroke={LINE} strokeWidth={lw} />
      {ln(0.075, 0, 0.075, 1, 'sl')}
      {ln(0.925, 0, 0.925, 1, 'sr')}
      {ln(0, 0.057, 1, 0.057, 'lf')}
      {ln(0, 0.943, 1, 0.943, 'ln')}
      {ln(0, 0.352, 1, 0.352, 'sf')}
      {ln(0, 0.648, 1, 0.648, 'sn')}
      {ln(0.5, 0, 0.5, 0.352, 'cf')}
      {ln(0.5, 0.648, 0.5, 1, 'cn')}
      <Rect x={0} y={v.y0} width={v.w} height={v.h - v.y0} fill="url(#hallLight)" />
    </Svg>
  );
}

// A shuttlecock: the cork at the front, the feather skirt flaring back,
// lying on its side.
export function Shuttlecock({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <G rotation={-35} origin="20,20">
        <Path d="M 14 24 L 6 4 L 34 4 L 26 24 Z" fill="#ffffff" stroke="#c9ced8" strokeWidth={1.2} strokeLinejoin="round" />
        {[11, 16, 20, 24, 29].map((x, i) => (
          <Line key={i} x1={x} y1={4} x2={14 + ((x - 6) * 12) / 28} y2={24} stroke="#c9ced8" strokeWidth={0.9} />
        ))}
        <Path d="M 7.5 8 L 32.5 8" stroke="#c9ced8" strokeWidth={0.9} />
        <Rect x={13.5} y={22} width={13} height={4} rx={1} fill="#e5484d" />
        <Path d="M 14 26 L 26 26 Q 26 36 20 36 Q 14 36 14 26 Z" fill="#f2e3c6" stroke="#cdb48a" strokeWidth={1} />
      </G>
    </Svg>
  );
}

// Games and points for both teams, with the shuttle marked on the side
// it's on.
export function RallyScore({
  game,
  people,
  userId,
  compact,
}: {
  game: RallyGame;
  people: CourtPerson[];
  userId: string | null | undefined;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const teamLabel = (team: RallyTeam) => {
    const members = rallyTeamMembers(game, team);
    if (members.length === 0) return 'Waiting…';
    return members
      .map((m) => (m.playerId === userId ? 'You' : (people.find((x) => x.userId === m.playerId)?.name ?? (m.joined ? 'Player' : 'Invited'))))
      .join(' & ');
  };
  const rows: { team: RallyTeam; games: number; points: number }[] = [
    { team: 'a', games: game.gamesA, points: game.pointsA },
    { team: 'b', games: game.gamesB, points: game.pointsB },
  ];
  return (
    <View style={styles.score}>
      <View style={styles.scoreHead}>
        <Text style={[styles.scoreHeadLabel, styles.scoreHeadName]}>Game {game.gameNo}</Text>
        <Text style={styles.scoreHeadLabel}>Games</Text>
        <Text style={styles.scoreHeadLabel}>Points</Text>
      </View>
      {rows.map((r) => {
        const hasShuttle = game.status === 'active' && game.sideTeam === r.team;
        const won = (game.status === 'won' || game.status === 'draw') && game.winnerTeam === r.team;
        return (
          <View key={r.team} style={[styles.scoreRow, hasShuttle && styles.scoreRowOn]}>
            <View style={styles.scoreName}>
              <Text style={[styles.scoreNameText, compact && styles.scoreNameCompact]} numberOfLines={1}>
                {teamLabel(r.team)}
              </Text>
              {hasShuttle && <Text style={styles.shuttleInline}>🏸</Text>}
              {won && <Text style={styles.shuttleInline}>🏆</Text>}
            </View>
            <Text style={[styles.scoreNum, compact && styles.scoreNumCompact]}>{r.games}</Text>
            <Text style={[styles.scoreNum, styles.scorePoints, compact && styles.scoreNumCompact]}>{r.points}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function RallyCard({
  game,
  participants,
  userId,
  myTotalSteps,
  now,
  onChanged,
}: {
  game: RallyGame | null;
  participants: CourtPerson[];
  userId: string | undefined;
  // The viewer's own total steps for this challenge, from the board —
  // the same number the server measures a return from.
  myTotalSteps: number;
  now: number;
  onChanged: () => Promise<void> | void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [arming, setArming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Rally</Text>
        <Text style={styles.note}>This match never got set up. Delete it and start another.</Text>
      </Card>
    );
  }

  const myTeam = rallyTeamOf(game, userId);
  const mySide = !!userId && game.sideUserId === userId;
  const myTeamHasIt = !!myTeam && game.sideTeam === myTeam;
  const nameOf = (id: string | null) => (id === userId ? 'you' : (participants.find((p) => p.userId === id)?.name ?? 'your opponent'));
  const otherTeam: RallyTeam | null = myTeam ? (myTeam === 'a' ? 'b' : 'a') : null;
  const otherTeamName = otherTeam
    ? rallyTeamMembers(game, otherTeam)
        .map((m) => participants.find((p) => p.userId === m.playerId)?.name ?? 'your opponent')
        .join(' and ')
    : 'your opponent';
  const need = (game.targetSteps ?? 0) * (game.smashArmed ? 2 : 1);
  const walked = Math.max(0, Math.floor(myTotalSteps - (game.sideStartTotal ?? 0)));
  const left = Math.max(0, need - walked);
  const begun = !!game.sideSince && new Date(game.sideSince).getTime() <= now;
  const smashesLeft = myTeam === 'a' ? game.smashALeft : myTeam === 'b' ? game.smashBLeft : 0;
  const timeLeft = formatRallyTimeLeft(game.dueAt, now);
  const waitingFor = game.players.filter((p) => !p.joined).length;
  const gamesMine = myTeam === 'b' ? game.gamesB : game.gamesA;
  const gamesTheirs = myTeam === 'b' ? game.gamesA : game.gamesB;

  const arm = async () => {
    setArming(true);
    setError(null);
    try {
      await armRallySmash(game.challengeId);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not arm the smash.');
    } finally {
      setArming(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>Rally · {game.doubles ? 'doubles' : 'singles'}</Text>
        <Text style={styles.meta}>
          to {RALLY_GAME_POINTS} · best of {RALLY_GAMES_TO_WIN * 2 - 1} · serve {formatSteps(game.serveSteps)} ·{' '}
          {rallyWindowLabel(game.windowHours).toLowerCase()}
        </Text>
      </View>

      <RallyCourt game={game} people={participants} userId={userId} now={now} />
      <RallyScore game={game} people={participants} userId={userId} />

      {game.status === 'waiting' && (
        <Text style={styles.note}>
          Waiting for {waitingFor === 1 ? 'one more player' : `${waitingFor} more players`} to accept. Your team serves
          first, so the shuttle lands on their side.
        </Text>
      )}

      {game.status === 'active' && mySide && !begun && (
        <Text style={styles.note}>The shuttle lands on your side when the challenge starts.</Text>
      )}

      {game.status === 'active' && mySide && begun && (
        <View style={styles.shot}>
          <View style={styles.shotHead}>
            <Text style={styles.shotTitle}>{game.smashArmed ? 'Smash armed' : 'Your return'}</Text>
            <Text style={[styles.shotClock, left === 0 && { color: colors.green }]}>{timeLeft}</Text>
          </View>
          <Text style={styles.shotBig}>
            {formatSteps(walked)} <Text style={styles.shotOf}>of {formatSteps(need)}</Text>
          </Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.min(100, need > 0 ? (walked / need) * 100 : 0)}%` }]} />
          </View>
          <Text style={styles.note}>
            {left === 0
              ? 'Returned. Your next sync sends it back over the net.'
              : `${formatSteps(left)} to go ${formatRallyDue(game.dueAt, new Date(now))}. Miss it and ${otherTeamName} take the point.`}
          </Text>
          {game.smashArmed ? (
            <Text style={styles.note}>Land this double and {otherTeamName}&rsquo;s next return doubles too.</Text>
          ) : smashesLeft > 0 && left > 0 ? (
            <View style={styles.smashRow}>
              <Text style={[styles.note, { flex: 1 }]}>
                Smash: walk {formatSteps(need * 2)} instead and their next return doubles too. One a game.
              </Text>
              <Button label="Smash" variant="ghost" small onPress={arm} disabled={arming} />
            </View>
          ) : null}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      )}

      {game.status === 'active' && !mySide && myTeamHasIt && begun && (
        <Text style={styles.note}>
          Your partner {nameOf(game.sideUserId)} has the return: {formatSteps(need)} {formatRallyDue(game.dueAt, new Date(now))}.
          You&rsquo;re up next.
        </Text>
      )}

      {game.status === 'active' && !myTeamHasIt && (
        <Text style={styles.note}>
          Shuttle&rsquo;s on {otherTeamName}&rsquo;s side: {nameOf(game.sideUserId)} needs {formatSteps(need)}{' '}
          {formatRallyDue(game.dueAt, new Date(now))}
          {game.smashArmed ? ', smash armed' : ''}. {timeLeft ? `${timeLeft} left.` : ''}
        </Text>
      )}

      {game.status === 'won' && (
        <Text style={styles.note}>
          {game.winnerTeam === myTeam ? 'You won' : `${otherTeamName} won`} the match {game.winnerTeam === myTeam ? `${gamesMine}–${gamesTheirs}` : `${gamesTheirs}–${gamesMine}`}
          {game.endedReason === 'time_up' ? ', on time' : ''}.
        </Text>
      )}
      {game.status === 'draw' && <Text style={styles.note}>Time ran out level — a draw.</Text>}
    </Card>
  );
}

// Court colours are fixed, not themed: a green court with white lines
// reads as a court in both themes, the way the Hound'opoly board keeps
// its own colours.
const COURT = '#2f7a5b';
const LINE = 'rgba(255,255,255,0.88)';
const HALL = '#3a3550';
const RUNOFF = '#4a5470';

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { gap: 2 },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    error: { fontSize: 12.5, color: colors.amber },
    court: { borderRadius: 12, overflow: 'hidden', backgroundColor: HALL },
    courtCompact: { borderRadius: 10 },
    slot: { position: 'absolute', alignItems: 'center', gap: 1 },
    shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.25)' },
    avatarRing: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    avatarRingOn: { borderColor: colors.amber, backgroundColor: 'rgba(255,255,255,0.18)' },
    // Someone who hasn't accepted yet: a small dot, not a big '?'.
    ghost: { alignItems: 'center', justifyContent: 'center' },
    ghostDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
    shuttle: { position: 'absolute' },
    shuttleInline: { fontSize: 13 },
    playerName: {
      marginTop: 2,
      color: '#ffffff',
      fontSize: 12,
      fontFamily: font.heading,
      maxWidth: '100%',
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowRadius: 3,
      textShadowOffset: { width: 0, height: 1 },
    },
    playerNameOn: { color: '#ffe3a3' },
    playerShot: {
      color: '#ffffff',
      fontSize: 11,
      fontVariant: ['tabular-nums'],
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 6,
      borderRadius: 999,
      overflow: 'hidden',
    },
    score: { gap: 4 },
    scoreHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
    scoreHeadName: { flex: 1, width: undefined, textAlign: 'left' },
    scoreHeadLabel: { fontSize: 11, color: withAlpha(colors.text, 0.5), textTransform: 'uppercase', letterSpacing: 0.5, width: 56, textAlign: 'center' },
    scoreRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
    scoreRowOn: { backgroundColor: withAlpha(colors.accent, 0.12) },
    scoreName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    scoreNameText: { fontFamily: font.heading, fontSize: 15, color: colors.text, flexShrink: 1 },
    scoreNameCompact: { fontSize: 13 },
    scoreNum: { width: 56, textAlign: 'center', fontFamily: font.heading, fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] },
    scorePoints: { color: colors.accentActive },
    scoreNumCompact: { fontSize: 15 },
    smashRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    shot: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    shotHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    shotTitle: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    shotClock: { fontFamily: font.heading, fontSize: 13, color: colors.amber },
    shotBig: { fontFamily: font.heading, fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] },
    shotOf: { fontSize: 14, color: withAlpha(colors.text, 0.6) },
    bar: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.12), overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  });
}
