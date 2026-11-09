import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { localDayKey } from '../water/water';
import { getTagChase, type TagChase } from './tagChaseApi';
import type { RaceScene } from '../components/RaceCourse';
import { ItTimeline, TagReplayCard, TagStandingsCard, TagTodayCard, type TagPlayer } from './TagChase';

// A Tag chase (0181) on its challenge screen: today's IT, last night's
// chase on the track, the standings and who's been IT. Loaded each time
// the screen comes into view; loading also settles any day that's over.
export function TagChaseSection({
  challengeId,
  myUserId,
  startsAt,
  scene = 'track',
}: {
  challengeId: string;
  myUserId?: string;
  startsAt: Date;
  scene?: RaceScene;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [game, setGame] = useState<TagChase | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTagChase(challengeId, localDayKey())
        .then((g) => {
          setGame(g);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the game.'));
    }, [challengeId]),
  );

  if (error) {
    return (
      <Card elevated={false}>
        <Text style={styles.note}>{error}</Text>
      </Card>
    );
  }
  if (!game) return <ActivityIndicator color={colors.accent} />;

  const players: TagPlayer[] = game.players.map((p) => ({ ...p, me: p.id === myUserId }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const last = game.history[game.history.length - 1];
  const over = game.history.length >= game.days;
  const todayNo = Math.min(
    game.days,
    Math.max(1, Math.round((Date.parse(`${localDayKey()}T12:00:00`) - Date.parse(`${game.firstDay}T12:00:00`)) / 86_400_000) + 1),
  );
  const it = game.it ? byId.get(game.it) : undefined;
  const standings = game.standings
    .map((s) => ({ player: byId.get(s.user), tags: s.tags, escapes: s.escapes, daysIt: s.daysIt }))
    .filter((s): s is { player: TagPlayer; tags: number; escapes: number; daysIt: number } => !!s.player);
  const its: (TagPlayer | null)[] = Array.from({ length: game.days }, (_, i) => {
    const h = game.history[i];
    if (h) return byId.get(h.it) ?? null;
    return !over && i === game.history.length && it ? it : null;
  });
  const winner = over && standings.length ? [...standings].sort((a, b) => b.tags * 3 + b.escapes - (a.tags * 3 + a.escapes) || a.daysIt - b.daysIt)[0] : null;

  return (
    <>
      {!it && !over ? (
        <Card style={{ gap: 6 }} elevated={false}>
          <Text style={text.h4}>Who&rsquo;ll be IT?</Text>
          <Text style={styles.note}>
            It starts {startsAt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}. A random
            hound is IT on day 1, and everyone else gets a {game.headStart.toLocaleString()}-step head start.
          </Text>
        </Card>
      ) : over && winner ? (
        <Card style={[styles.winner, { gap: 8 }]} elevated={false}>
          <View style={styles.row}>
            <HoundArt {...winner.player.hound} mood="happy" size={70} animate />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.kicker}>THE CHASE IS OVER</Text>
              <Text style={text.h2}>{winner.player.me ? 'You win!' : `${winner.player.name} wins`}</Text>
              <Text style={styles.note}>
                {winner.tags * 3 + winner.escapes} points: {winner.tags} {winner.tags === 1 ? 'tag' : 'tags'} and {winner.escapes}{' '}
                {winner.escapes === 1 ? 'day' : 'days'} getting away.
              </Text>
            </View>
          </View>
        </Card>
      ) : it ? (
        <TagTodayCard
          day={todayNo}
          days={game.days}
          it={it}
          headStart={game.headStart}
          itSteps={game.today[it.id] ?? 0}
          mySteps={myUserId ? (game.today[myUserId] ?? 0) : 0}
          meIsIt={it.id === myUserId}
        />
      ) : null}

      {last && (
        <TagReplayCard
          key={last.dayNo}
          day={last.dayNo}
          last={over}
          scene={scene}
          players={players.filter((p) => p.id in last.steps || p.id === last.it)}
          itId={last.it}
          headStart={last.headStart}
          steps={last.steps}
        />
      )}

      {game.history.length > 0 && <TagStandingsCard rows={standings} />}
      {(it || game.history.length > 0) && <ItTimeline days={game.days} its={its} />}
    </>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    kicker: { fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55), fontFamily: font.heading },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    winner: { borderWidth: 1.5, borderColor: withAlpha(colors.gold, 0.6), backgroundColor: withAlpha(colors.gold, 0.08) },
  });
}
