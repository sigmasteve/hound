import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
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

// The court itself: a badminton court seen from above, the viewer's team
// at the near end, one avatar per player (a dashed outline for a player
// who hasn't accepted yet) and the shuttle beside whoever has to return
// it. Shared by the full card below and Home's compact preview.
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
  const myTeam = rallyTeamOf(game, userId) ?? 'a';
  const farTeam: RallyTeam = myTeam === 'a' ? 'b' : 'a';
  const need = (game.targetSteps ?? 0) * (game.smashArmed ? 2 : 1);
  const size = compact ? 30 : 42;

  const renderHalf = (team: RallyTeam, far: boolean) => {
    const members = rallyTeamMembers(game, team);
    const slots = members.length > 0 ? members : [null];
    return (
      <View style={[styles.half, far ? styles.halfFar : styles.halfNear]}>
        <View style={[styles.serviceLine, far ? styles.serviceLineFar : styles.serviceLineNear]} />
        <View style={styles.centreLine} />
        <View style={styles.players}>
          {slots.map((p, i) => {
            const person = p ? people.find((x) => x.userId === p.userId) : undefined;
            const isMe = !!p && p.userId === userId;
            const hasShuttle = !!p && game.status === 'active' && game.sideUserId === p.userId;
            const label = !p ? 'Open' : !p.joined ? 'Invited' : isMe ? 'You' : (person?.name ?? 'Player');
            return (
              <View key={p?.userId ?? `slot-${i}`} style={styles.player}>
                <View style={[styles.avatarRing, hasShuttle && styles.avatarRingOn, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2 }]}>
                  {p?.joined && person ? (
                    <Avatar
                      initials={person.initials}
                      tint={isMe ? TINT_A : TINT_N}
                      size={size}
                      fontSize={compact ? 11 : 14}
                      frameId={person.frameId}
                      backgroundId={person.backgroundId}
                      iconId={person.iconId}
                    />
                  ) : (
                    <View style={[styles.ghost, { width: size, height: size, borderRadius: size / 2 }]}>
                      <Text style={styles.ghostText}>?</Text>
                    </View>
                  )}
                  {hasShuttle && <Text style={[styles.shuttle, far ? styles.shuttleFar : styles.shuttleNear]}>🏸</Text>}
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
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.court, compact && styles.courtCompact]}>
      <View style={styles.alleyLeft} />
      <View style={styles.alleyRight} />
      {renderHalf(farTeam, true)}
      <View style={styles.net}>
        {Array.from({ length: 14 }).map((_, i) => (
          <View key={i} style={styles.netMesh} />
        ))}
      </View>
      {renderHalf(myTeam, false)}
    </View>
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
      .map((m) => (m.userId === userId ? 'You' : (people.find((x) => x.userId === m.userId)?.name ?? (m.joined ? 'Player' : 'Invited'))))
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
        .map((m) => participants.find((p) => p.userId === m.userId)?.name ?? 'your opponent')
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
            <View style={{ gap: 6 }}>
              <Button label="Smash" variant="ghost" small onPress={arm} disabled={arming} />
              <Text style={styles.note}>
                One per team per game. Your return needs double ({formatSteps(need * 2)}); land it and their next return
                doubles too.
              </Text>
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
const COURT_FAR = '#2a6e52';
const LINE = 'rgba(255,255,255,0.85)';

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { gap: 2 },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.7), lineHeight: 18 },
    error: { fontSize: 12.5, color: colors.amber },
    court: { borderRadius: 12, overflow: 'hidden', backgroundColor: COURT, borderWidth: 2, borderColor: LINE },
    courtCompact: { borderRadius: 10 },
    alleyLeft: { position: 'absolute', top: 0, bottom: 0, left: '8%', width: 1.5, backgroundColor: LINE },
    alleyRight: { position: 'absolute', top: 0, bottom: 0, right: '8%', width: 1.5, backgroundColor: LINE },
    half: { paddingVertical: 10, paddingHorizontal: 16 },
    halfFar: { backgroundColor: COURT_FAR },
    halfNear: {},
    serviceLine: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: LINE },
    serviceLineFar: { bottom: 14 },
    serviceLineNear: { top: 14 },
    centreLine: { position: 'absolute', left: '50%', width: 1.5, top: 0, bottom: 0, backgroundColor: LINE, opacity: 0.6 },
    net: { height: 8, flexDirection: 'row', justifyContent: 'space-evenly', backgroundColor: 'rgba(0,0,0,0.35)', borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: LINE },
    netMesh: { width: 1, height: 8, backgroundColor: LINE, opacity: 0.5 },
    players: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start', gap: 12 },
    player: { alignItems: 'center', gap: 3, minWidth: 64, maxWidth: 120 },
    avatarRing: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
    avatarRingOn: { borderColor: colors.amber, backgroundColor: 'rgba(255,255,255,0.18)' },
    ghost: { borderWidth: 2, borderStyle: 'dashed', borderColor: LINE, alignItems: 'center', justifyContent: 'center' },
    ghostText: { color: LINE, fontFamily: font.heading, fontSize: 16 },
    shuttle: { position: 'absolute', fontSize: 16, right: -14 },
    shuttleFar: { bottom: -8 },
    shuttleNear: { top: -8 },
    shuttleInline: { fontSize: 13 },
    playerName: { color: '#ffffff', fontSize: 12, fontFamily: font.heading, maxWidth: 110 },
    playerNameOn: { color: '#ffe3a3' },
    playerShot: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontVariant: ['tabular-nums'] },
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
