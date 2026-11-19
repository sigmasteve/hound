import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import type { ChallengeShare } from '../share/ShareCard';
import { ArrowSquareOutIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { usePinnedAction } from './PinnedAction';
import { Avatar } from './Avatar';
import { PresentedBy, SponsorLogo, openSponsor } from './SponsorLine';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { derbyPos, getDerbyBoard, type DerbyBoard as Board, type DerbyLive, type DerbyRow, type DerbyTab } from '../challenges/derbyApi';
import { recordSponsorViews, sponsorColor, type ChallengeSponsor, type SponsorPlacement } from '../challenges/globalChallenges';

// The Hound Home Run Derby (0211) on its challenge page: where you stand,
// "Step up to the plate", then Top 25 / Friends / My club, today's
// longest, the sponsor's sign hits and the prizes. Once it's over: the
// podium, the longest home run, your Derby and its Bones, and the
// sponsor's thanks.

const TABS: { id: DerbyTab; name: string }[] = [
  { id: 'top', name: 'Top 25' },
  { id: 'friends', name: 'Friends' },
  { id: 'club', name: 'My club' },
];
const ME_COLOR = '#ffd8b0';
const GOLD = '#f0c24a';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function DerbyBoard({
  challengeId,
  name,
  live,
  sponsor,
  onBat,
  onPrizes,
  onShare,
}: {
  challengeId: string;
  name: string;
  // Your day at the plate (derby_live); null until it's loaded.
  live: DerbyLive | null;
  sponsor: ChallengeSponsor | null;
  onBat: () => void;
  // Every prize, for the banner's "All prizes" sheet.
  onPrizes?: (prizes: Board['prizes']) => void;
  // Share my finish as a picture (the share card); without it, text.
  onShare?: (content: ChallengeShare) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currency = useCurrencyName();
  const [tab, setTab] = useState<DerbyTab>('top');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  // The 10th place's home runs, from the Top 25 (kept while another tab shows).
  const [tenth, setTenth] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await getDerbyBoard(challengeId, tab);
      setBoard(b);
      if (tab === 'top') {
        const row = b.rows.find((r) => r.pos === 10) ?? (b.rows.length >= 10 ? b.rows[9] : null);
        setTenth(row ? row.hrs : null);
      }
      onPrizes?.(b.prizes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the leaderboard.');
    }
  }, [challengeId, tab]);
  // Again when your day moves (back from the plate).
  useEffect(() => {
    load();
  }, [load, live]);

  useEffect(() => {
    if (!sponsor) return;
    const seen: SponsorPlacement[] = ['board'];
    if (sponsor.presented) seen.push('presented');
    if (sponsor.prizes) seen.push('prizes');
    recordSponsorViews(challengeId, seen);
  }, [sponsor, challengeId]);

  // Swings ready: pinned to the bottom of the page (PinnedAction.tsx).
  const batNow = !!board && !!live && live.joined && board.status === 'live' && (live.canSwing || !!live.pending);
  const batPinned = usePinnedAction(
    batNow && live
      ? {
          label: live.pending
            ? 'Finish your swing'
            : `Step up to the plate · ${live.swingsLeft} ${live.swingsLeft === 1 ? 'swing' : 'swings'}`,
          onPress: () => onBat(),
        }
      : null,
  );

  if (!board) {
    return (
      <Card elevated={false}>
        {error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
      </Card>
    );
  }

  const final = board.status === 'final';
  const me = board.me;
  const sColor = sponsorColor(sponsor);
  const p = board.prizes;
  const places = p.places.filter((b) => b > 0);
  const prizeLine = [
    places.length ? `${places.map((b, i) => `${ordinal(i + 1)} ${b.toLocaleString()}`).join(' · ')} ${currency}` : null,
    p.top10 > 0 ? `4th–10th ${p.top10.toLocaleString()}` : null,
    p.longest > 0 ? `the longest home run ${p.longest.toLocaleString()}` : null,
    p.tenPlus > 0 ? `10+ home runs ${p.tenPlus}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // C (Steve's pick): the prizes you can still reach, how close you are,
  // and what to beat. Not at the end (the results say what you won).
  const nextPrizes: { key: string; label: string; bones: number; state: string; good: boolean; progress: number | null }[] = [];
  if (me && board.joined && board.status !== 'final') {
    if (p.tenPlus > 0) {
      const got = me.hrs >= 10;
      nextPrizes.push({ key: 'ten', label: '10+ home runs', bones: p.tenPlus, state: got ? 'Earned' : `${10 - me.hrs} to go`, good: true, progress: got ? null : Math.min(1, me.hrs / 10) });
    }
    if (p.top10 > 0) {
      const inTop = me.pos != null && me.pos <= 10;
      const state = inTop ? 'You\u2019re in' : tenth != null ? `#10 has ${tenth}` : board.field < 10 ? 'Any home run gets you in' : '';
      if (state) nextPrizes.push({ key: 'top', label: 'Top 10', bones: p.top10, state, good: inTop, progress: null });
    }
    if (p.longest > 0) {
      const lw = board.longestWeek;
      const holds = !!lw && me.longestFt > 0 && me.longestFt >= lw.ft;
      nextPrizes.push({ key: 'long', label: 'Longest home run', bones: p.longest, state: holds ? 'You hold it' : lw ? `to beat: ${lw.ft} ft` : 'No home runs yet', good: holds, progress: null });
    }
  }
  const endsText = board.endsAt ? new Date(board.endsAt).toLocaleDateString(undefined, { weekday: 'long' }) : null;
  const sub = [
    board.days > 0 ? `${board.days} days` : null,
    `${board.field.toLocaleString()} ${board.field === 1 ? 'hound' : 'hounds'} in`,
    final ? 'final' : board.status === 'upcoming' ? 'starts soon' : endsText ? `ends ${endsText}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const swingsLeft = live?.swingsLeft ?? 0;
  const canBat = !!live && live.joined && board.status === 'live' && (live.canSwing || !!live.pending);
  const batLabel = !live
    ? 'Step up to the plate'
    : live.pending
      ? 'Finish your swing'
      : canBat
        ? `Step up to the plate · ${swingsLeft} ${swingsLeft === 1 ? 'swing' : 'swings'}`
        : live.reason ?? 'No swings ready';

  const share = () => {
    if (!me) return;
    const myId = board.rows.find((r) => r.isMe)?.userId ?? null;
    const where = me.pos != null ? `${derbyPos(me.pos, me.tied)} of ${board.field.toLocaleString()}` : 'the Derby';
    const line = `I hit ${me.hrs} ${me.hrs === 1 ? 'home run' : 'home runs'} in ${name} on Hound${me.longestFt ? `, the longest ${me.longestFt} ft` : ''}: ${where}.`;
    // The picture card: your place, on the podium when you're top 3.
    if (onShare && me.pos != null) {
      onShare({
        kind: 'challenge',
        name,
        outcome: { type: 'ranked', rank: me.pos, of: Math.max(board.swung, me.pos), metric: `${me.hrs} ${me.hrs === 1 ? 'home run' : 'home runs'}` },
        line: me.pos === 1 ? `I won ${name} on Hound with ${me.hrs} ${me.hrs === 1 ? 'home run' : 'home runs'}! ⚾🏆` : line,
        podium: board.podium.map((p) => ({
          place: p.place,
          name: p.name,
          initials: p.initials,
          iconId: p.iconId,
          score: `${p.hrs} HR`,
          me: p.userId === myId,
        })),
      });
      return;
    }
    Share.share({ message: line }).catch(() => {});
  };

  const note = (r: DerbyRow) => {
    const bits = [];
    if (r.isFriend && !r.isMe) bits.push('Friend');
    if (r.isClub && !r.isMe) bits.push('Your club');
    if (r.longestFt >= 475) bits.push('Moonshot');
    return bits.join(' · ');
  };

  const rowsBlock = (
    <View style={{ gap: 10 }}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.board}>
        <View style={styles.headRow}>
          <Text style={[styles.headCell, { width: 38 }]}>#</Text>
          <Text style={[styles.headCell, { flex: 1, marginLeft: 34 }]}>HOUND</Text>
          <Text style={[styles.headCell, { width: 40, textAlign: 'right' }]}>HR</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.headCell, { width: 78, textAlign: 'right' }]}>LONGEST</Text>
        </View>
        {tab === 'club' && board.club && (
          <Text style={styles.gap}>
            {board.club.name} · {board.club.playing.toLocaleString()} in
          </Text>
        )}
        {tab === 'club' && !board.club && <Text style={styles.gap}>Join a club on the Clubs tab to see your club here.</Text>}
        {tab === 'friends' && board.rows.length <= 1 && <Text style={styles.gap}>None of your friends have joined yet.</Text>}
        {board.rows.map((r, i) => {
          const prev = board.rows[i - 1];
          const showGap = tab === 'top' && r.isMe && board.more != null && board.more > 0 && !!prev && !prev.isMe;
          const sub2 = note(r);
          return (
            <View key={r.userId}>
              {showGap && <Text style={styles.gap}>{board.more!.toLocaleString()} more</Text>}
              <View style={[styles.row, r.isMe && styles.rowMe]}>
                <Text style={[styles.pos, r.pos === 1 && { color: ME_COLOR }]}>{derbyPos(r.pos, r.tied)}</Text>
                <View style={[styles.ring, { borderColor: r.isMe ? ME_COLOR : 'transparent' }]}>
                  <Avatar initials={r.initials} tint="#33384f" size={30} fontSize={11} frameId={r.frameId} backgroundId={r.backgroundId} iconId={r.iconId} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.isMe ? 'You' : r.name}
                  </Text>
                  {!!sub2 && (
                    <Text style={styles.where} numberOfLines={1}>
                      {sub2}
                    </Text>
                  )}
                </View>
                <Text style={styles.hr}>{r.hrs}</Text>
                <Text style={styles.ft}>{r.longestFt ? `${r.longestFt} ft` : '–'}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={styles.kicker}>{final ? 'FINAL' : 'GLOBAL HOUND CHALLENGE'} · HOME RUN DERBY</Text>
        {sponsor?.presented && <PresentedBy challengeId={challengeId} sponsor={sponsor} />}
        <Text style={styles.sub}>{sub}</Text>
      </View>

      {final ? (
        <>
          {board.podium.length > 0 && (
            <View style={styles.podium}>
              {[1, 0, 2].map((k) => {
                const pd = board.podium[k];
                if (!pd) return <View key={k} style={{ flex: 1 }} />;
                const champ = k === 0;
                return (
                  <View key={pd.userId} style={[styles.step, champ ? styles.stepChamp : null, { minHeight: champ ? 150 : k === 1 ? 128 : 116 }]}>
                    {champ && <Text style={styles.champ}>CHAMPION</Text>}
                    <Avatar initials={pd.initials} tint="#33384f" size={champ ? 46 : 38} fontSize={champ ? 15 : 13} iconId={pd.iconId} />
                    <Text style={styles.stepName} numberOfLines={1}>
                      {pd.name.split(' ')[0]}
                    </Text>
                    <Text style={styles.stepScore}>
                      {derbyPos(pd.place, pd.tied)} · {pd.hrs} HR
                    </Text>
                    {pd.bones > 0 && (
                      <Text style={styles.stepBones}>
                        {pd.bones.toLocaleString()} {currency}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {board.longestWinner && (
            <Card style={styles.card} elevated={false}>
              <Text style={styles.kicker}>LONGEST HOME RUN</Text>
              <Text style={styles.big}>
                {board.longestWinner.name} · {board.longestWinner.ft} ft
                {board.longestWinner.ft >= 475 ? ' Moonshot' : ''}
                {board.longestWinner.bones > 0 ? ` · ${board.longestWinner.bones} ${currency}` : ''}
              </Text>
            </Card>
          )}
          {me && (
            <View style={styles.place}>
              <View style={styles.placeTop}>
                <View style={styles.posBig}>
                  <Text style={styles.posBigText}>{derbyPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You finished ${derbyPos(me.pos, me.tied)} of ${board.field.toLocaleString()}` : 'You didn’t take a swing'}
                  </Text>
                  {me.pos != null && (
                    <Text style={styles.placeLine}>
                      {me.hrs} {me.hrs === 1 ? 'home run' : 'home runs'}
                      {me.longestFt ? ` · longest ${me.longestFt} ft` : ''}
                      {me.moonshots ? ` · ${me.moonshots} ${me.moonshots === 1 ? 'Moonshot' : 'Moonshots'}` : ''}
                      {me.signHits ? ` · hit the sign ${me.signHits === 1 ? 'once' : `${me.signHits} times`}` : ''}
                    </Text>
                  )}
                </View>
              </View>
              {board.myBones && board.myBones.total > 0 && (
                <View style={styles.pills}>
                  {board.myBones.place > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.place} for your place</Text>}
                  {board.myBones.longest > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.longest} longest home run</Text>}
                  {board.myBones.tenPlus > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.tenPlus} for 10+ home runs</Text>}
                  {board.myBones.sign > 0 && (
                    <Text style={[styles.pill, { backgroundColor: withAlpha(sColor, 0.18), color: ME_COLOR }]}>
                      +{board.myBones.sign} from {sponsor?.name ?? 'the sponsor'}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
          {sponsor && (
            <View style={[styles.prizes, { borderColor: withAlpha(sColor, 0.45), backgroundColor: withAlpha(sColor, 0.08) }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <SponsorLogo sponsor={sponsor} size={28} />
                <Text style={[styles.rowText, { flex: 1 }]}>
                  Thanks to <Text style={{ fontFamily: font.headingSemibold }}>{sponsor.name}</Text>
                  {board.signHitsTotal > 0 ? `, whose sign was hit ${board.signHitsTotal.toLocaleString()} times.` : '.'}
                </Text>
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={styles.place}>
          {me && board.joined ? (
            <>
              <View style={styles.placeTop}>
                <View style={styles.posBig}>
                  <Text style={styles.posBigText}>{derbyPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You're ${derbyPos(me.pos, me.tied)} · ${me.hrs} ${me.hrs === 1 ? 'home run' : 'home runs'}` : 'You haven’t swung yet'}
                  </Text>
                  <Text style={styles.placeLine}>
                    {me.pos != null
                      ? [
                          me.moved > 0 ? `up ${me.moved} ${me.moved === 1 ? 'place' : 'places'} today` : me.moved < 0 ? `down ${-me.moved} today` : null,
                          me.longestFt ? `longest ${me.longestFt} ft` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || `of ${board.field.toLocaleString()}`
                      : 'Your steps today buy the swings: one every 1,000.'}
                  </Text>
                </View>
              </View>
              {nextPrizes.length > 0 && (
                <View style={styles.next}>
                  <Text style={styles.nextKicker}>YOUR NEXT PRIZES</Text>
                  {nextPrizes.map((n) => (
                    <View key={n.key} style={{ gap: 5 }}>
                      <View style={styles.nextRow}>
                        <Text style={styles.nextLabel}>
                          <Text style={styles.nextStrong}>{n.label}</Text> · {n.bones.toLocaleString()} {currency}
                        </Text>
                        <Text style={[styles.nextState, n.good && styles.nextStateGood]}>{n.state}</Text>
                      </View>
                      {n.progress != null && (
                        <View style={styles.bar}>
                          <View style={[styles.barFill, { width: `${Math.round(n.progress * 100)}%` }]} />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {board.status === 'live' && !batPinned && (
                <Pressable onPress={onBat} disabled={!canBat} style={[styles.play, !canBat && styles.playOff]} accessibilityRole="button">
                  <Text style={[styles.playText, !canBat && { color: withAlpha(colors.text, 0.6), fontSize: 13.5 }]}>{batLabel}</Text>
                </Pressable>
              )}
              {live && live.joined && board.status === 'live' && (
                <Text style={styles.placeLine}>
                  {live.steps.toLocaleString()} steps today · {live.swingsEarned} of {live.cap} swings earned
                  {live.nextSwingAt != null ? ` · next at ${live.nextSwingAt.toLocaleString()}` : ''}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.placeLine}>{board.joined ? 'Loading your Derby…' : 'Join the Derby to swing. Swings count from the day you join.'}</Text>
          )}
        </View>
      )}

      {(board.longestToday || board.signHitsTotal > 0) && !final && (
        <Card style={styles.card} elevated={false}>
          {board.longestToday && (
            <>
              <Text style={[styles.kicker, { color: ME_COLOR }]}>LONGEST TODAY</Text>
              <Text style={styles.big}>
                {board.longestToday.name} · {board.longestToday.ft} ft{board.longestToday.ft >= 475 ? ' Moonshot' : ''}
              </Text>
            </>
          )}
          {board.signHitsTotal > 0 && sponsor && (
            <Text style={styles.small}>
              {board.signHitsTotal.toLocaleString()} {board.signHitsTotal === 1 ? 'hit' : 'hits'} on the {sponsor.name} sign so far.
            </Text>
          )}
        </Card>
      )}

      {(!final || showFull) && rowsBlock}

      {sponsor?.prizes ? (
        <View style={[styles.prizes, { borderColor: withAlpha(sColor, 0.45), backgroundColor: withAlpha(sColor, 0.08) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SponsorLogo sponsor={sponsor} size={22} />
            <Text style={[styles.prizesKicker, { color: sColor }]} numberOfLines={1}>
              PRIZES FROM {sponsor.name.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.rowText}>
            {prizeLine}
            {sponsor.prizeNote ? `. ${sponsor.prizeNote}` : ''}
          </Text>
          {sponsor.url && (
            <Pressable onPress={() => openSponsor(challengeId, sponsor.url!, 'prizes')} style={styles.visit} accessibilityRole="link" accessibilityLabel={`Visit ${sponsor.name}`}>
              <Text style={styles.visitText}>Visit {sponsor.name}</Text>
              <ArrowSquareOutIcon size={13} color={colors.text} />
            </Pressable>
          )}
        </View>
      ) : null}

      {final && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setShowFull((v) => !v)} style={styles.outline} accessibilityRole="button">
            <Text style={styles.outlineText}>{showFull ? 'Hide leaderboard' : 'Full leaderboard'}</Text>
          </Pressable>
          {me && me.pos != null && (
            <Pressable onPress={share} style={styles.shareBtn} accessibilityRole="button">
              <Text style={styles.shareText}>Share my Derby</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: '#e0b56a' },
    sub: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    note: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.7) },
    big: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    place: { borderRadius: 16, padding: 14, gap: 10, backgroundColor: withAlpha(colors.accent, 0.14) },
    placeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    next: { borderRadius: 12, padding: 12, gap: 9, backgroundColor: colors.surface },
    nextKicker: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nextLabel: { flex: 1, fontSize: 13.5, color: colors.text },
    nextStrong: { fontFamily: font.headingSemibold },
    nextState: { fontSize: 13, color: withAlpha(colors.text, 0.72) },
    nextStateGood: { fontFamily: font.headingSemibold, color: colors.text },
    bar: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: '#7fd39b' },
    posBig: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: ME_COLOR, alignItems: 'center', justifyContent: 'center' },
    posBigText: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    placeTitle: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    placeLine: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.72) },
    play: { minHeight: 48, borderRadius: 12, backgroundColor: '#7fd39b', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
    playOff: { backgroundColor: withAlpha(colors.text, 0.1) },
    playText: { fontFamily: font.headingSemibold, fontSize: 15, color: '#161826', textAlign: 'center' },
    tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 12, backgroundColor: colors.surface },
    tab: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.text },
    tabText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    tabTextOn: { color: colors.bg },
    board: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.surface },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    headCell: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55) },
    gap: { textAlign: 'center', fontSize: 12, color: withAlpha(colors.text, 0.5), paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    rowMe: { backgroundColor: withAlpha(ME_COLOR, 0.1), marginHorizontal: -12, paddingHorizontal: 12, borderRadius: 10 },
    pos: { width: 38, fontFamily: font.headingSemibold, fontSize: 13, color: withAlpha(colors.text, 0.62) },
    ring: { borderWidth: 2, borderRadius: 18, padding: 1 },
    name: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    where: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    hr: { width: 40, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
    ft: { width: 78, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.72), fontVariant: ['tabular-nums'] },
    card: { gap: 6 },
    rowText: { flexShrink: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
    small: { flexShrink: 1, fontSize: 12, color: withAlpha(colors.text, 0.65) },
    prizes: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
    prizesKicker: { flexShrink: 1, fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8 },
    visit: { minHeight: 40, borderRadius: 10, backgroundColor: withAlpha(colors.text, 0.08), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    visitText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    podium: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    step: { flex: 1, borderRadius: 14, padding: 10, gap: 3, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: colors.surface },
    stepChamp: { borderWidth: 2, borderColor: '#e0b56a', backgroundColor: withAlpha(colors.accent, 0.14) },
    champ: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.8, color: '#e0b56a' },
    stepName: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    stepScore: { fontSize: 12, color: withAlpha(colors.text, 0.72) },
    stepBones: { fontFamily: font.headingSemibold, fontSize: 11.5, color: ME_COLOR },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: { fontSize: 12, fontFamily: font.headingSemibold, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden', color: colors.text },
    pillGood: { backgroundColor: withAlpha('#7fd39b', 0.16), color: '#a6e3b8' },
    outline: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.18), alignItems: 'center', justifyContent: 'center' },
    outlineText: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
    shareBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
    shareText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
  });
}
