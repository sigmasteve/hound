import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { ArrowSquareOutIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Avatar } from './Avatar';
import { GolfHole, type GolfFlight } from './GolfHole';
import { PresentedBy, SponsorLogo, openSponsor } from './SponsorLine';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { ordinal, toParText } from '../challenges/golf';
import {
  getGolfShots,
  getOpenBoard,
  openPos,
  type GolfGame,
  type GolfSpot,
  type OpenBoard as Board,
  type OpenRow,
  type OpenTab,
} from '../challenges/golfApi';
import { recordSponsorViews, sponsorColor, type ChallengeSponsor, type SponsorPlacement } from '../challenges/globalChallenges';

// The Hound Open (0202): Golf as a Global Hound Challenge. Everyone plays
// the same course, stroke play, and this is the leaderboard: your place,
// Play, then Top / Friends / My club, the prizes, and tap anyone to watch
// their hole. Once it's over: the podium, your finish and the shots of the
// week. With a sponsor (0203): "presented by" under the title, and "Prizes
// from …" on the prizes.

const TABS: { id: OpenTab; name: string }[] = [
  { id: 'top', name: 'Top' },
  { id: 'friends', name: 'Friends' },
  { id: 'club', name: 'My club' },
];
const ME_COLOR = '#ffd8b0';

type Watch = { row: OpenRow; hole: number; shots: { from: GolfSpot; to: GolfSpot; putt: boolean }[]; at: number };

export function OpenBoard({
  challengeId,
  name,
  game,
  sponsor,
  onPlay,
}: {
  challengeId: string;
  name: string;
  // Your game (golf_view): banks, today's limit, the course. Null until
  // you've joined.
  game: GolfGame | null;
  sponsor: ChallengeSponsor | null;
  onPlay: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currency = useCurrencyName();
  const [tab, setTab] = useState<OpenTab>('top');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [flight, setFlight] = useState<GolfFlight | null>(null);
  const watchRef = useRef(watch);
  watchRef.current = watch;

  const load = useCallback(async () => {
    try {
      setBoard(await getOpenBoard(challengeId, tab));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the leaderboard.');
    }
  }, [challengeId, tab]);
  // Again when your game moves (back from a hole).
  useEffect(() => {
    load();
  }, [load, game]);

  // The sponsor, counted for their report.
  useEffect(() => {
    if (!sponsor) return;
    const seen: SponsorPlacement[] = ['board'];
    if (sponsor.presented) seen.push('presented');
    if (sponsor.prizes) seen.push('prizes');
    recordSponsorViews(challengeId, seen);
  }, [sponsor, challengeId]);

  const holeOf = (n: number) => (game ? game.course.holes[(n - 1) % Math.max(1, game.course.holes.length)] : null);

  const startWatch = async (row: OpenRow, holeNo?: number) => {
    if (!game) {
      Alert.alert('The Hound Open', 'Join the Open to watch other players’ holes.');
      return;
    }
    const n = holeNo ?? (row.strokesOnHole > 0 || row.thru === 0 ? row.hole : Math.max(1, row.hole - 1));
    try {
      const rows = await getGolfShots(challengeId, row.userId, n);
      if (rows.length === 0) {
        Alert.alert('The Hound Open', `${row.isMe ? 'You haven’t' : `${row.name.split(' ')[0]} hasn’t`} hit a shot there yet.`);
        return;
      }
      const shots = rows.map((r) => ({ from: r.from, to: r.to, putt: r.club === 'putter' }));
      setWatch({ row, hole: n, shots, at: 0 });
      setFlight({ ...shots[0], carry: 0, key: Date.now() });
    } catch (e) {
      Alert.alert('The Hound Open', e instanceof Error ? e.message : 'Try again.');
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

  if (!board) {
    return (
      <Card elevated={false}>
        {error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </Card>
    );
  }

  const final = board.status === 'final';
  const me = board.me;
  const myGame = game?.players.find((p) => p.userId === game.me) ?? null;
  const prizes = board.prizes.filter((b) => b > 0);
  const prizeLine = prizes.length
    ? prizes.map((b, i) => (i === 0 ? `1st ${b.toLocaleString()}` : `${ordinal(i + 1)} ${b.toLocaleString()}`)).join(' · ') + ` ${currency}`
    : null;
  const finishLine = board.finishBones > 0 ? `${board.finishBones} for finishing` : null;
  const endsText = board.endsAt
    ? new Date(board.endsAt).toLocaleDateString(undefined, { weekday: 'long' })
    : null;
  const sub = [
    board.course.name,
    `${board.holes} holes, stroke play`,
    `${board.field.toLocaleString()} playing`,
    final ? 'final' : board.status === 'upcoming' ? 'starts soon' : endsText ? `ends ${endsText}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const note = (r: OpenRow): string => {
    if (r.finished) return r.best && r.best.diff <= -2 ? `Finished · ${bestWord(r.best.diff)} on ${r.best.hole}` : 'Finished';
    if (r.best && r.best.diff <= -2) return `${bestWord(r.best.diff)} on ${r.best.hole}`;
    if (r.thru === 0 && r.strokesOnHole === 0) return 'Hasn’t teed off';
    if (r.strokesOnHole > 0) return `On the ${ordinal(r.hole)}`;
    return `On the ${ordinal(r.hole)} tee`;
  };

  const placeLine = () => {
    if (!me) return null;
    const bits = [`${toParText(me.toPar)} thru ${me.thru}`];
    if (me.moved > 0) bits.push(`up ${me.moved} ${me.moved === 1 ? 'place' : 'places'} today`);
    else if (me.moved < 0) bits.push(`down ${-me.moved} today`);
    if (me.behindTop10 && me.behindTop10 > 0) bits.push(`${me.behindTop10} ${me.behindTop10 === 1 ? 'shot' : 'shots'} off the top 10`);
    return bits.join(' · ');
  };

  const canStart = !!game && (game.today.canStart || (myGame?.strokesOnHole ?? 0) > 0);
  const playable = !!game && !!me && !me.finished && board.status === 'live';
  const playLabel = !canStart ? `That’s ${game?.holesPerDay ?? 3} holes today` : `Play hole ${me?.hole ?? 1}`;

  const share = () => {
    if (!me) return;
    const where = me.pos != null ? `${openPos(me.pos, me.tied)} of ${board.swung.toLocaleString()}` : 'the course';
    Share.share({ message: `I finished ${name} on Hound: ${where}, ${me.total} strokes (${toParText(me.toPar)}).` }).catch(() => {});
  };

  const myBirdies = myGame
    ? myGame.scores.reduce<number>((n, s, i) => {
        const h = game?.course.holes[i % Math.max(1, game.course.holes.length)];
        return s != null && h && s < h.par ? n + 1 : n;
      }, 0)
    : 0;

  const watchedHole = watch ? holeOf(watch.hole) : null;
  const watchBall = watch ? (watch.at === 0 ? watch.shots[0].from : watch.shots[Math.min(watch.at, watch.shots.length) - 1].to) : null;
  const sColor = sponsorColor(sponsor);

  const rowsBlock = (
    <View style={{ gap: 10 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.board}>
        <View style={styles.headRow}>
          <Text style={[styles.headCell, { width: 38 }]}>POS</Text>
          <Text style={[styles.headCell, { flex: 1, marginLeft: 42 }]}>PLAYER</Text>
          <Text style={[styles.headCell, { width: 40, textAlign: 'right' }]}>THRU</Text>
          <Text style={[styles.headCell, { width: 40, textAlign: 'right' }]}>PAR</Text>
        </View>
        {tab === 'club' && board.club && (
          <Text style={styles.gap}>
            {board.club.name} · {board.club.playing.toLocaleString()} playing
          </Text>
        )}
        {tab === 'club' && !board.club && <Text style={styles.gap}>Join a club on the Clubs tab to see your club here.</Text>}
        {tab === 'friends' && board.rows.length <= 1 && <Text style={styles.gap}>None of your friends have joined yet.</Text>}
        {board.rows.map((r, i) => {
          const prev = board.rows[i - 1];
          const showGap = tab === 'top' && r.isMe && board.more != null && board.more > 0 && !!prev && !prev.isMe;
          return (
            <View key={r.userId}>
              {showGap && <Text style={styles.gap}>{board.more!.toLocaleString()} more</Text>}
              <Pressable
                onPress={() => startWatch(r)}
                style={[styles.row, r.isMe && styles.rowMe]}
                accessibilityRole="button"
                accessibilityHint={r.isMe ? 'Watch your hole' : 'Watch their hole'}
              >
                <Text style={styles.pos}>{openPos(r.pos, r.tied)}</Text>
                <View style={[styles.ring, { borderColor: r.isMe ? ME_COLOR : 'transparent' }]}>
                  <Avatar initials={r.initials} tint="#33384f" size={30} fontSize={11} frameId={r.frameId} backgroundId={r.backgroundId} iconId={r.iconId} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.isMe ? 'You' : r.name}
                  </Text>
                  <Text style={styles.where} numberOfLines={1}>
                    {r.isFriend && !r.isMe ? 'Friend · ' : ''}
                    {note(r)}
                  </Text>
                </View>
                <Text style={styles.thru}>{r.finished ? 'F' : r.thru === 0 ? '–' : r.thru}</Text>
                <Text style={[styles.toPar, r.toPar < 0 && styles.under, r.toPar === 0 && r.thru > 0 && styles.even]}>
                  {r.thru === 0 ? '–' : toParText(r.toPar)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      {/* The title. */}
      <View style={{ gap: 4 }}>
        <Text style={styles.kicker}>{final ? 'FINAL' : 'GLOBAL HOUND CHALLENGE'} · GOLF</Text>
        {sponsor?.presented && <PresentedBy challengeId={challengeId} sponsor={sponsor} />}
        <Text style={styles.sub}>{sub}</Text>
      </View>

      {final ? (
        <>
          {/* The podium: 2nd, 1st, 3rd. */}
          {board.podium.length > 0 && (
            <View style={styles.podium}>
              {[1, 0, 2].map((k) => {
                const p = board.podium[k];
                if (!p) return <View key={k} style={{ flex: 1 }} />;
                const champ = k === 0;
                return (
                  <View key={p.userId} style={[styles.step, champ ? styles.stepChamp : null, { minHeight: champ ? 150 : k === 1 ? 128 : 116 }]}>
                    {champ && <Text style={styles.champ}>CHAMPION</Text>}
                    <Avatar initials={p.initials} tint="#33384f" size={champ ? 46 : 38} fontSize={champ ? 15 : 13} iconId={p.iconId} />
                    <Text style={styles.stepName} numberOfLines={1}>
                      {p.name.split(' ')[0]}
                    </Text>
                    <Text style={styles.stepScore}>
                      {openPos(p.place, p.tied)} · {toParText(p.toPar)}
                    </Text>
                    {p.bones > 0 && (
                      <Text style={styles.stepBones}>
                        {p.bones.toLocaleString()} {currency}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Your finish. */}
          {me && (
            <View style={styles.place}>
              <View style={styles.placeTop}>
                <View style={styles.posBig}>
                  <Text style={styles.posBigText}>{openPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You finished ${openPos(me.pos, me.tied)} of ${board.swung.toLocaleString()}` : 'You didn’t tee off'}
                  </Text>
                  {me.pos != null && (
                    <Text style={styles.placeLine}>
                      {me.total} strokes, {toParText(me.toPar)}
                    </Text>
                  )}
                </View>
              </View>
              {me.pos != null && (
                <View style={styles.stats}>
                  <View style={styles.stat}>
                    <Text style={styles.statBig}>{myBirdies}</Text>
                    <Text style={styles.statLabel}>{myBirdies === 1 ? 'birdie' : 'birdies'}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statBig}>{me.thru}</Text>
                    <Text style={styles.statLabel}>holes played</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statBig}>{me.finished && board.finishBones > 0 ? `+${board.finishBones}` : '–'}</Text>
                    <Text style={styles.statLabel}>{currency} for finishing</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Shots of the week. */}
          {board.highlights.length > 0 && (
            <Card style={styles.card} elevated={false}>
              <Text style={styles.kicker}>SHOTS OF THE WEEK</Text>
              {board.highlights.map((h, i) => (
                <View key={`${h.userId}:${h.hole}:${i}`} style={styles.rowBetween}>
                  <Text style={styles.rowText} numberOfLines={2}>
                    {h.name} · {h.kind === 'ace' ? `hole-in-one, the ${ordinal(h.hole)}` : h.kind === 'eagle' ? `eagle on the ${ordinal(h.hole)}` : `${h.feet ?? ''} ft putt, the ${ordinal(h.hole)}`}
                  </Text>
                  <Pressable
                    onPress={() =>
                      startWatch(
                        { userId: h.userId, name: h.name, hole: h.hole, strokesOnHole: 1, thru: 1, isMe: false } as OpenRow,
                        h.hole,
                      )
                    }
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Watch ${h.name}'s ${ordinal(h.hole)}`}
                  >
                    <Text style={styles.link}>Watch</Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </>
      ) : (
        // Your place and Play.
        <View style={styles.place}>
          {me ? (
            <>
              <View style={styles.placeTop}>
                <View style={styles.posBig}>
                  <Text style={styles.posBigText}>{openPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You're ${openPos(me.pos, me.tied)} of ${board.swung.toLocaleString()}` : 'You haven’t teed off yet'}
                  </Text>
                  <Text style={styles.placeLine}>
                    {me.pos != null ? placeLine() : 'Your steps since you joined are yards. Pull back on the 1st tee to start.'}
                  </Text>
                </View>
                {me.pos != null && <Text style={[styles.placeScore, me.toPar < 0 && styles.under]}>{toParText(me.toPar)}</Text>}
              </View>
              {playable && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={onPlay}
                    disabled={!canStart}
                    style={[styles.play, !canStart && styles.playOff]}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.playText, !canStart && { color: withAlpha(colors.text, 0.6) }]}>{playLabel}</Text>
                  </Pressable>
                  <View style={styles.yards}>
                    <Text style={styles.yardsBig}>{(game?.banks.yards ?? 0).toLocaleString()} yd</Text>
                    <Text style={styles.yardsLabel}>banked</Text>
                  </View>
                </View>
              )}
              {me.finished && <Text style={styles.placeLine}>You’ve finished. The results are in when the Open ends.</Text>}
            </>
          ) : (
            <Text style={styles.placeLine}>
              {board.joined ? 'Loading your round…' : 'Join the Open to play. Steps count from the day you join.'}
            </Text>
          )}
        </View>
      )}

      {/* Watching a hole. */}
      {watch && watchedHole && watchBall && game && (
        <Card style={styles.card} elevated={false}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>
              {(watch.row.isMe ? 'You' : watch.row.name.split(' ')[0]).toUpperCase()} · HOLE {watch.hole} · PAR {watchedHole.par}
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
            houndIcon={watch.row.iconId}
            cameraAt={watch.shots[0].from}
            height={260}
            compact
            sponsor={
              sponsor && (sponsor.boards || sponsor.hole === ((watch.hole - 1) % 9) + 1)
                ? {
                    name: sponsor.name,
                    color: sColor,
                    boards: !!sponsor.boards,
                    holeSign: sponsor.hole === ((watch.hole - 1) % 9) + 1,
                    holeLabel: `HOLE ${watch.hole} · PAR ${watchedHole.par}`,
                  }
                : null
            }
          />
          <View style={styles.rowBetween}>
            <Text style={styles.small}>
              {watch.at >= watch.shots.length ? `${watch.shots.length} ${watch.shots.length === 1 ? 'shot' : 'shots'}` : `Shot ${watch.at + 1} of ${watch.shots.length}`}
            </Text>
            {watch.at >= watch.shots.length && (
              <Pressable onPress={() => startWatch(watch.row, watch.hole)} hitSlop={12} accessibilityRole="button">
                <Text style={styles.link}>Watch again</Text>
              </Pressable>
            )}
          </View>
        </Card>
      )}

      {(!final || showFull) && rowsBlock}

      {/* The prizes: "Prizes from …" with a sponsor, else one line. */}
      {sponsor?.prizes ? (
        <View style={[styles.prizes, { borderColor: withAlpha(sColor, 0.45), backgroundColor: withAlpha(sColor, 0.08) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SponsorLogo sponsor={sponsor} size={22} />
            <Text style={[styles.prizesKicker, { color: sColor }]} numberOfLines={1}>
              PRIZES FROM {sponsor.name.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.rowText}>
            {[prizeLine, finishLine].filter(Boolean).join(' · ')}
            {sponsor.prizeNote ? `. ${sponsor.prizeNote}` : ''}
          </Text>
          {sponsor.url && (
            <Pressable
              onPress={() => openSponsor(challengeId, sponsor.url!, 'prizes')}
              style={styles.visit}
              accessibilityRole="link"
              accessibilityLabel={`Visit ${sponsor.name}`}
            >
              <Text style={styles.visitText}>Visit {sponsor.name}</Text>
              <ArrowSquareOutIcon size={13} color={colors.text} />
            </Pressable>
          )}
        </View>
      ) : (
        (prizeLine || finishLine) && (
          <View style={styles.rowBetween}>
            <Text style={styles.small}>{[prizeLine, finishLine].filter(Boolean).join(' · ')}</Text>
            {!final && <Text style={styles.hint}>Tap a player to watch</Text>}
          </View>
        )
      )}

      {final && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setShowFull((v) => !v)} style={styles.outline} accessibilityRole="button">
            <Text style={styles.outlineText}>{showFull ? 'Hide leaderboard' : 'Full leaderboard'}</Text>
          </Pressable>
          {me && me.pos != null && (
            <Pressable onPress={share} style={styles.shareBtn} accessibilityRole="button">
              <Text style={styles.shareText}>Share my round</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function bestWord(diff: number): string {
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  return 'Birdie';
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: '#e0b56a' },
    sub: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.7) },
    place: { borderRadius: 16, padding: 14, gap: 10, backgroundColor: withAlpha(colors.accent, 0.14) },
    placeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    posBig: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: ME_COLOR, alignItems: 'center', justifyContent: 'center' },
    posBigText: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    placeTitle: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    placeLine: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.72) },
    placeScore: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    under: { color: '#ff8a8f' },
    even: { color: '#7fd39b' },
    play: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#7fd39b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    playOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    playText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826', textAlign: 'center' },
    yards: { minHeight: 46, borderRadius: 12, backgroundColor: withAlpha(colors.text, 0.08), paddingHorizontal: 12, justifyContent: 'center' },
    yardsBig: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    yardsLabel: { fontSize: 11.5, color: withAlpha(colors.text, 0.7) },
    tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 12, backgroundColor: colors.surface },
    tab: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.text },
    tabText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    tabTextOn: { color: colors.bg },
    board: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.surface },
    headRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    headCell: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55) },
    gap: { textAlign: 'center', fontSize: 12, color: withAlpha(colors.text, 0.5), paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 48,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.12),
    },
    rowMe: { backgroundColor: withAlpha(ME_COLOR, 0.1), marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 10 },
    pos: { width: 38, fontFamily: font.headingSemibold, fontSize: 13, color: withAlpha(colors.text, 0.62) },
    ring: { borderWidth: 2, borderRadius: 18, padding: 1 },
    name: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    where: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    thru: { width: 40, textAlign: 'right', fontSize: 13, color: withAlpha(colors.text, 0.75), fontVariant: ['tabular-nums'] },
    toPar: { width: 40, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
    card: { gap: 10 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    rowText: { flexShrink: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
    small: { flexShrink: 1, fontSize: 12, color: withAlpha(colors.text, 0.65) },
    hint: { fontFamily: font.headingSemibold, fontSize: 12, color: colors.accentActive },
    link: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.accentActive },
    prizes: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
    prizesKicker: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8 },
    visit: {
      minHeight: 40,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.text, 0.08),
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    visitText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    podium: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    step: { flex: 1, borderRadius: 14, padding: 10, gap: 3, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: colors.surface },
    stepChamp: { borderWidth: 2, borderColor: '#e0b56a', backgroundColor: withAlpha(colors.accent, 0.14) },
    champ: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.8, color: '#e0b56a' },
    stepName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    stepScore: { fontSize: 12, color: withAlpha(colors.text, 0.72) },
    stepBones: { fontFamily: font.headingSemibold, fontSize: 11.5, color: ME_COLOR },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, borderRadius: 10, padding: 8, backgroundColor: withAlpha(colors.text, 0.06) },
    statBig: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    statLabel: { fontSize: 11.5, color: withAlpha(colors.text, 0.65) },
    outline: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), alignItems: 'center', justifyContent: 'center' },
    outlineText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    shareBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#9184d9', alignItems: 'center', justifyContent: 'center' },
    shareText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
  });
}
