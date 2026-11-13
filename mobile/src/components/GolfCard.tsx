import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { GolfHole, type GolfFlight } from './GolfHole';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { GOLF_FORMAT_NAME, GOLF_LIE_NAME, distanceText, ordinal, toParText } from '../challenges/golf';
import { getGolfShots, type GolfGame, type GolfPlayer, type GolfSpot } from '../challenges/golfApi';

const ME_COLOR = '#f08a24';

// Golf on the challenge page (0200): the field (who's where, to par,
// skins), your scorecard, your banks and where the power came from, Play,
// and watching a friend's hole played back on the course.
export function GolfCard({
  challengeId,
  game,
  onPlay,
}: {
  challengeId: string;
  game: GolfGame | null;
  onPlay: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [watch, setWatch] = useState<{ player: GolfPlayer; hole: number; shots: { from: GolfSpot; to: GolfSpot; putt: boolean }[]; at: number } | null>(null);
  const [flight, setFlight] = useState<GolfFlight | null>(null);
  const watchRef = useRef(watch);
  watchRef.current = watch;

  if (!game) {
    return (
      <Card elevated={false}>
        <Text style={styles.note}>Setting up the course…</Text>
      </Card>
    );
  }

  const me = game.players.find((p) => p.userId === game.me) ?? null;
  const pars = game.course.holes.map((h) => h.par);
  const parOf = (i: number) => pars[i % Math.max(1, pars.length)] ?? 4;
  const holeOf = (n: number) => game.course.holes[(n - 1) % Math.max(1, game.course.holes.length)];
  const nameOf = (p: GolfPlayer) => (p.userId === game.me ? 'You' : p.name.split(' ')[0]);
  const field = [...game.players].sort((a, b) =>
    game.format === 'skins' ? b.skins - a.skins || a.toPar - b.toPar : a.toPar - b.toPar || b.thru - a.thru,
  );
  const where = (p: GolfPlayer) => {
    if (p.done) return 'Finished';
    if (p.strokesOnHole === 0) return p.thru === 0 ? 'On the 1st tee' : `On the ${ordinal(p.hole)} tee`;
    const h = holeOf(p.hole);
    const left = h ? Math.hypot(h.pin.d - p.ball.d, h.pin.lat - p.ball.lat) : 0;
    return `${ordinal(p.hole)} · ${GOLF_LIE_NAME[p.lie] ?? p.lie}, ${distanceText(left)} out`;
  };

  const startWatch = async (p: GolfPlayer) => {
    // The hole they're on, or their last one if they haven't hit yet.
    const holeNo = p.strokesOnHole > 0 || p.thru === 0 ? p.hole : Math.max(1, p.hole - 1);
    try {
      const rows = await getGolfShots(challengeId, p.userId, holeNo);
      if (rows.length === 0) {
        Alert.alert('Golf', `${nameOf(p)} hasn’t hit a shot yet.`);
        return;
      }
      const shots = rows.map((r) => ({ from: r.from, to: r.to, putt: r.club === 'putter' }));
      setWatch({ player: p, hole: holeNo, shots, at: 0 });
      setFlight({ ...shots[0], carry: 0, key: Date.now() });
    } catch (e) {
      Alert.alert('Golf', e instanceof Error ? e.message : 'Try again.');
    }
  };
  const nextShot = () => {
    const w = watchRef.current;
    if (!w) return;
    const at = w.at + 1;
    setFlight(null);
    setWatch({ ...w, at });
    if (at < w.shots.length) setTimeout(() => setFlight({ ...w.shots[at], carry: 0, key: Date.now() }), 450);
  };

  const watchedHole = watch ? holeOf(watch.hole) : null;
  const watchBall = watch ? (watch.at === 0 ? watch.shots[0].from : watch.shots[Math.min(watch.at, watch.shots.length) - 1].to) : null;
  const canStart = game.today.canStart || (me?.strokesOnHole ?? 0) > 0;
  const playable = !!me && !me.done && game.status === 'live' && game.handsOn;

  return (
    <View style={{ gap: 12 }}>
      {/* The field. */}
      <View style={styles.board}>
        <View style={styles.boardHead}>
          <Text style={styles.boardKicker}>{game.course.name.toUpperCase()}</Text>
          <Text style={styles.boardKicker}>
            {GOLF_FORMAT_NAME[game.format].toUpperCase()} · {game.holes} HOLES
          </Text>
        </View>
        {field.map((p, i) => (
          <Pressable
            key={p.userId}
            onPress={() => (p.userId !== game.me ? startWatch(p) : undefined)}
            disabled={p.userId === game.me}
            style={styles.fieldRow}
            accessibilityRole={p.userId === game.me ? undefined : 'button'}
            accessibilityHint={p.userId === game.me ? undefined : 'Watch their hole'}
          >
            <Text style={styles.pos}>{i + 1}</Text>
            <View style={[styles.ring, { borderColor: p.userId === game.me ? ME_COLOR : 'transparent' }]}>
              <Avatar initials={p.initials} tint="#2a5a3a" size={34} fontSize={12} frameId={p.frameId} backgroundId={p.backgroundId} iconId={p.iconId} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldName} numberOfLines={1}>
                {nameOf(p)}
                {game.winner === p.userId ? ' · winner' : ''}
              </Text>
              <Text style={styles.fieldWhere} numberOfLines={1}>
                {where(p)}
                {game.format === 'match' && p.match ? ` · ${p.match}` : ''}
              </Text>
            </View>
            {game.format === 'skins' && (
              <Text style={styles.skins}>
                {p.skins} {p.skins === 1 ? 'skin' : 'skins'}
              </Text>
            )}
            <Text style={[styles.toPar, p.toPar < 0 && { color: '#7fd39b' }]}>{p.thru === 0 ? '–' : toParText(p.toPar)}</Text>
          </Pressable>
        ))}
        {game.players.length > 1 && <Text style={styles.boardHint}>Tap a friend to watch their hole.</Text>}
      </View>

      {/* Watching a friend's hole. */}
      {watch && watchedHole && watchBall && (
        <Card style={styles.card} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>
              {nameOf(watch.player).toUpperCase()} · HOLE {watch.hole} · PAR {watchedHole.par}
            </Text>
            <Pressable onPress={() => setWatch(null)} hitSlop={12} accessibilityRole="button">
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
          <GolfHole
            hole={watchedHole}
            course={game.course.id}
            ball={watchBall}
            plan={null}
            flight={flight}
            onLanded={nextShot}
            trail={watch.shots.slice(0, watch.at)}
            houndIcon={watch.player.iconId}
            cameraAt={watch.shots[0].from}
            height={260}
            compact
          />
          <View style={styles.rowBetween}>
            <Text style={styles.small}>
              {watch.at >= watch.shots.length ? `${watch.shots.length} ${watch.shots.length === 1 ? 'shot' : 'shots'}` : `Shot ${watch.at + 1} of ${watch.shots.length}`}
            </Text>
            {watch.at >= watch.shots.length && (
              <Pressable onPress={() => startWatch(watch.player)} hitSlop={12} accessibilityRole="button">
                <Text style={styles.link}>Watch again</Text>
              </Pressable>
            )}
          </View>
        </Card>
      )}

      {/* Your banks and Play. */}
      {me && game.status !== 'final' && !me.done && (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>YOUR BAG</Text>
          <View style={styles.banks}>
            <View style={styles.bank}>
              <Text style={styles.big}>{game.banks.yards.toLocaleString()}</Text>
              <Text style={styles.small}>yards, from {game.banks.steps.toLocaleString()} steps</Text>
            </View>
            <View style={styles.bank}>
              <Text style={styles.big}>{game.banks.power}</Text>
              <Text style={styles.small}>power from workouts</Text>
            </View>
          </View>
          {game.banks.powerFrom.length > 0 && (
            <Text style={styles.small}>
              {game.banks.powerFrom.map((p) => `${p.name} ${p.minutes} min${p.mult > 1 ? ` ×${p.mult}` : ''} = ${p.power}`).join(' · ')}
            </Text>
          )}
          {game.status === 'upcoming' ? (
            <Text style={styles.note}>Tee time is when the challenge starts.</Text>
          ) : !game.handsOn ? (
            <Text style={styles.note}>Your walks play this one: each Kennel walk of 10 minutes or more is a shot, played tonight.</Text>
          ) : !canStart ? (
            <Text style={styles.note}>That&rsquo;s {game.holesPerDay} holes today. More tomorrow.</Text>
          ) : (
            <Button
              variant="primary"
              block
              label={me.strokesOnHole > 0 ? `Play on: hole ${me.hole}` : `Play hole ${me.hole}`}
              onPress={onPlay}
              disabled={!playable}
            />
          )}
        </Card>
      )}

      {/* Your scorecard. */}
      {me && (
        <Card style={styles.card} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>YOUR CARD</Text>
            <Text style={styles.small}>
              {me.total > 0 ? `${me.total} · ${toParText(me.toPar)}` : ''}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={styles.cardRow}>
                <Text style={[styles.cell, styles.cellHead]}>Hole</Text>
                {me.scores.map((_, i) => (
                  <Text key={i} style={[styles.cell, styles.cellHead]}>
                    {i + 1}
                  </Text>
                ))}
              </View>
              <View style={styles.cardRow}>
                <Text style={[styles.cell, styles.cellLabel]}>Par</Text>
                {me.scores.map((_, i) => (
                  <Text key={i} style={styles.cell}>
                    {parOf(i)}
                  </Text>
                ))}
              </View>
              <View style={styles.cardRow}>
                <Text style={[styles.cell, styles.cellLabel]}>You</Text>
                {me.scores.map((s, i) => {
                  const d = s == null ? 0 : s - parOf(i);
                  return (
                    <View key={i} style={styles.cellBox}>
                      <View
                        style={[
                          styles.mark,
                          s != null && d <= -1 && styles.markCircle,
                          s != null && d <= -2 && styles.markDouble,
                          s != null && d >= 1 && styles.markSquare,
                          s != null && d >= 2 && styles.markDouble,
                        ]}
                      >
                        <Text style={[styles.score, s != null && d < 0 && { color: '#3fb37f' }]}>{s ?? (i + 1 === me.hole && !me.done ? '·' : '')}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
          <Text style={styles.small}>Circles are under par, squares over.</Text>
        </Card>
      )}

      {/* Skins, hole by hole. */}
      {game.format === 'skins' && game.skins.length > 0 && (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>SKINS</Text>
          {game.skins.map((s) => {
            const who = game.players.find((p) => p.userId === s.winner);
            return (
              <View key={s.hole} style={styles.rowBetween}>
                <Text style={styles.rowText}>Hole {s.hole}</Text>
                <Text style={styles.small}>
                  {who ? `${nameOf(who)} · ${s.bones} bones` : `Tied: ${s.carried + s.bones} carry on`}
                </Text>
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    board: { borderRadius: 16, padding: 12, gap: 4, backgroundColor: '#12261a' },
    boardHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    boardKicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.8, color: 'rgba(233,240,233,0.6)' },
    boardHint: { fontSize: 11.5, color: 'rgba(233,240,233,0.5)', marginTop: 4, textAlign: 'center' },
    fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
    pos: { width: 16, fontFamily: font.headingSemibold, fontSize: 13, color: 'rgba(233,240,233,0.6)', textAlign: 'center' },
    ring: { borderWidth: 2, borderRadius: 20, padding: 1 },
    fieldName: { color: '#f2f5f0', fontFamily: font.headingSemibold, fontSize: 14.5 },
    fieldWhere: { color: 'rgba(233,240,233,0.62)', fontSize: 12 },
    skins: { color: '#ffd8b0', fontFamily: font.headingSemibold, fontSize: 12.5 },
    toPar: { minWidth: 34, textAlign: 'right', color: '#f2f5f0', fontFamily: font.headingSemibold, fontSize: 17, fontVariant: ['tabular-nums'] },
    card: { gap: 10 },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    big: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.7) },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.62), fontVariant: ['tabular-nums'] },
    link: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.accentActive },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    rowText: { fontSize: 14.5, color: colors.text },
    banks: { flexDirection: 'row', gap: 10 },
    bank: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    cardRow: { flexDirection: 'row', alignItems: 'center' },
    cell: { width: 30, textAlign: 'center', fontSize: 12.5, color: withAlpha(colors.text, 0.7), paddingVertical: 3, fontVariant: ['tabular-nums'] },
    cellHead: { fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.5) },
    cellLabel: { width: 38, textAlign: 'left', fontFamily: font.headingSemibold },
    cellBox: { width: 30, alignItems: 'center', paddingVertical: 2 },
    mark: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    markCircle: { borderRadius: 12, borderWidth: 1.5, borderColor: '#3fb37f' },
    markSquare: { borderRadius: 3, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.45) },
    markDouble: { borderWidth: 3 },
    score: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
  });
}
