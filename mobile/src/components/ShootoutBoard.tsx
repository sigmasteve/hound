import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import { ArrowSquareOutIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { usePinnedAction } from './PinnedAction';
import { Avatar } from './Avatar';
import { PresentedBy, SponsorLogo, openSponsor } from './SponsorLine';
import { ShootoutGoal } from './ShootoutGoal';
import type { ChallengeShare } from '../share/ShareCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import {
  conversion,
  getShootoutBoard,
  shootoutPos,
  type ShootoutBoard as Board,
  type ShootoutLive,
  type ShootoutPrizes,
  type ShootoutRow,
  type ShootoutTab,
} from '../challenges/shootoutApi';
import { recordSponsorViews, sponsorColor, type ChallengeSponsor, type SponsorPlacement } from '../challenges/globalChallenges';

// The Hound Shootout (0221) on its challenge page: where you stand, "Step
// up to the spot" (pinned to the bottom when you've kicks), the goal with
// where the top five score most, then Top 25 / Friends / My club and the
// prizes. Once it's over: the podium, the longest scoring streak, your
// Shootout and its Bones, and the sponsor's thanks.

const TABS: { id: ShootoutTab; name: string }[] = [
  { id: 'top', name: 'Top 25' },
  { id: 'friends', name: 'Friends' },
  { id: 'club', name: 'My club' },
];
const ME_COLOR = '#ffd8b0';
const GOLD = '#f0c24a';
const DOTS = ['#f0892a', '#4f7be0', '#3f9a6b', '#c2410c', '#8b6fd6'];

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// All the prizes, for the banner's "All prizes" sheet.
export function shootoutPrizeRows(p: ShootoutPrizes, currency: string): { label: string; value: string }[] {
  const rows = [
    { label: '1st', b: p.first },
    { label: '2nd', b: p.second },
    { label: '3rd', b: p.third },
    { label: '4th to 10th', b: p.top10 },
    { label: 'The longest scoring streak', b: p.streak },
    { label: 'Everyone with 15+ goals', b: p.fifteen },
  ];
  return rows.filter((r) => r.b > 0).map((r) => ({ label: r.label, value: `${r.b.toLocaleString()} ${currency}` }));
}

export function ShootoutBoard({
  challengeId,
  name,
  live,
  sponsor,
  onKick,
  onPrizes,
  onShare,
}: {
  challengeId: string;
  name: string;
  // Your day at the spot (shootout_live); null until it's loaded.
  live: ShootoutLive | null;
  sponsor: ChallengeSponsor | null;
  onKick: () => void;
  onPrizes?: (prizes: ShootoutPrizes) => void;
  // Share my finish as a picture (the share card); without it, text.
  onShare?: (content: ChallengeShare) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currency = useCurrencyName();
  const [tab, setTab] = useState<ShootoutTab>('top');
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [top5, setTop5] = useState<ShootoutRow[]>([]);

  const load = useCallback(async () => {
    try {
      const b = await getShootoutBoard(challengeId, tab);
      setBoard(b);
      if (tab === 'top') setTop5(b.rows.filter((r) => r.pos != null).slice(0, 5));
      onPrizes?.(b.prizes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the leaderboard.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId, tab]);
  // Again when your day moves (back from the spot).
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

  // Kicks ready: pinned to the bottom of the page (PinnedAction.tsx).
  const kickNow = !!board && !!live && live.joined && board.status === 'live' && live.canKick && live.kicksLeft > 0;
  const kickPinned = usePinnedAction(
    kickNow && live ? { label: `Step up to the spot · ${live.kicksLeft} ${live.kicksLeft === 1 ? 'kick' : 'kicks'}`, onPress: () => onKick() } : null,
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
  const prizeLine = [
    [p.first, p.second, p.third].some((b) => b > 0)
      ? `${[p.first, p.second, p.third].map((b, i) => `${ordinal(i + 1)} ${b.toLocaleString()}`).join(' · ')} ${currency}`
      : null,
    p.top10 > 0 ? `4th–10th ${p.top10.toLocaleString()}` : null,
    p.streak > 0 ? `the longest scoring streak ${p.streak.toLocaleString()}` : null,
    p.fifteen > 0 ? `15+ goals ${p.fifteen}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const endsText = board.endsAt ? new Date(board.endsAt).toLocaleDateString(undefined, { weekday: 'long' }) : null;
  const sub = [
    board.days > 0 ? `${board.days} days` : null,
    `${board.field.toLocaleString()} ${board.field === 1 ? 'hound' : 'hounds'} in`,
    final ? 'final' : board.status === 'upcoming' ? 'starts soon' : endsText ? `ends ${endsText}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const canKick = !!live && live.joined && board.status === 'live' && live.canKick && live.kicksLeft > 0;
  const kickLabel = !live
    ? 'Step up to the spot'
    : canKick
      ? `Step up to the spot · ${live.kicksLeft} ${live.kicksLeft === 1 ? 'kick' : 'kicks'}`
      : (live.reason ?? 'No kicks ready');

  // The prizes you can still reach, and how close you are.
  const nextPrizes: { key: string; label: string; bones: number; state: string; good: boolean; progress: number | null }[] = [];
  if (me && board.joined && !final) {
    if (p.fifteen > 0) {
      const got = me.points >= 15;
      nextPrizes.push({ key: 'fifteen', label: '15+ goals', bones: p.fifteen, state: got ? 'Earned' : `${15 - me.points} to go`, good: got, progress: got ? null : Math.min(1, me.points / 15) });
    }
    if (p.top10 > 0) {
      const inTop = me.pos != null && me.pos <= 10;
      nextPrizes.push({ key: 'top', label: 'Top 10', bones: p.top10, state: inTop ? 'You’re in' : board.kicked < 10 ? 'Any goal gets you in' : 'Keep shooting', good: inTop, progress: null });
    }
    if (p.streak > 0) {
      const bs = board.bestStreak;
      const holds = !!bs && me.bestStreak > 0 && me.bestStreak >= bs.streak;
      nextPrizes.push({
        key: 'streak',
        label: 'Longest scoring streak',
        bones: p.streak,
        state: holds ? 'You hold it' : bs ? `to beat: ${bs.streak} in a row` : 'No goals yet',
        good: holds,
        progress: null,
      });
    }
  }

  const share = () => {
    if (!me) return;
    const where = me.pos != null ? `${shootoutPos(me.pos, me.tied)} of ${board.kicked.toLocaleString()}` : 'the Shootout';
    const goals = `${me.points} ${me.points === 1 ? 'goal' : 'goals'}`;
    const line = `I scored ${goals} in ${name} on Hound (${conversion(me.goals, me.kicks)} of my penalties): ${where}.`;
    // The picture card: your place, on the podium when you're top 3.
    if (onShare && me.pos != null) {
      const myId = board.rows.find((r) => r.isMe)?.userId ?? null;
      onShare({
        kind: 'challenge',
        name,
        outcome: { type: 'ranked', rank: me.pos, of: Math.max(board.kicked, me.pos), metric: goals },
        line: me.pos === 1 ? `I won ${name} on Hound with ${goals}! ⚽🏆` : line,
        podium: board.podium.map((p) => ({
          place: p.place,
          name: p.name,
          initials: p.initials,
          iconId: p.iconId,
          score: `${p.points} ${p.points === 1 ? 'goal' : 'goals'}`,
          me: p.userId === myId,
        })),
      });
      return;
    }
    Share.share({ message: line }).catch(() => {});
  };

  const note = (r: ShootoutRow) => {
    const bits = [];
    if (r.isFriend && !r.isMe) bits.push('Friend');
    if (r.isClub && !r.isMe) bits.push('Your club');
    if (r.topBins > 0) bits.push(`${r.topBins} top bins`);
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
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.headCell, { width: 58, textAlign: 'right' }]}>SCORED</Text>
          <Text style={[styles.headCell, { width: 46, textAlign: 'right' }]}>GOALS</Text>
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
                <Text style={[styles.pos, r.pos === 1 && { color: ME_COLOR }]}>{shootoutPos(r.pos, r.tied)}</Text>
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
                <Text style={styles.rate}>{conversion(r.goals, r.kicks)}</Text>
                <Text style={styles.goals}>{r.points}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.small}>Most goals wins; ties go to the best conversion. Top bins count 2.</Text>
    </View>
  );

  const spots = top5
    .filter((r) => r.favZone != null)
    .map((r, i) => ({ zone: r.favZone as number, initials: r.initials, me: r.isMe, color: r.isMe ? '#9184d9' : DOTS[i % DOTS.length] }));

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={styles.kicker}>{final ? 'FINAL' : 'GLOBAL HOUND CHALLENGE'} · HOUND SHOOTOUT</Text>
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
                      {shootoutPos(pd.place, pd.tied)} · {pd.points} goals
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
          {board.streakWinner && (
            <Card style={styles.card} elevated={false}>
              <Text style={styles.kicker}>LONGEST SCORING STREAK</Text>
              <Text style={styles.big}>
                {board.streakWinner.name} · {board.streakWinner.streak} in a row
                {board.streakWinner.bones > 0 ? ` · ${board.streakWinner.bones} ${currency}` : ''}
              </Text>
            </Card>
          )}
          {me && (
            <View style={styles.place}>
              <View style={styles.placeTop}>
                <View style={styles.posBig}>
                  <Text style={styles.posBigText}>{shootoutPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You finished ${shootoutPos(me.pos, me.tied)} of ${board.kicked.toLocaleString()}` : 'You didn’t take a kick'}
                  </Text>
                  {me.pos != null && (
                    <Text style={styles.placeLine}>
                      {me.points} {me.points === 1 ? 'goal' : 'goals'} · {conversion(me.goals, me.kicks)} scored
                      {me.topBins ? ` · ${me.topBins} top bins` : ''}
                      {me.bestStreak > 1 ? ` · ${me.bestStreak} in a row at best` : ''}
                    </Text>
                  )}
                </View>
              </View>
              {board.myBones && board.myBones.total > 0 && (
                <View style={styles.pills}>
                  {board.myBones.place > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.place} for your place</Text>}
                  {board.myBones.streak > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.streak} longest streak</Text>}
                  {board.myBones.fifteen > 0 && <Text style={[styles.pill, styles.pillGood]}>+{board.myBones.fifteen} for 15+ goals</Text>}
                </View>
              )}
            </View>
          )}
          {sponsor && (
            <View style={[styles.prizes, { borderColor: withAlpha(sColor, 0.45), backgroundColor: withAlpha(sColor, 0.08) }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <SponsorLogo sponsor={sponsor} size={28} />
                <Text style={[styles.rowText, { flex: 1 }]}>
                  Thanks to <Text style={{ fontFamily: font.headingSemibold }}>{sponsor.name}</Text>, on the boards and the keeper’s shirt all week.
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
                  <Text style={styles.posBigText}>{shootoutPos(me.pos, me.tied)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeTitle}>
                    {me.pos != null ? `You're ${shootoutPos(me.pos, me.tied)} · ${me.points} ${me.points === 1 ? 'goal' : 'goals'}` : 'You haven’t kicked yet'}
                  </Text>
                  <Text style={styles.placeLine}>
                    {me.pos != null
                      ? [
                          me.moved > 0 ? `up ${me.moved} ${me.moved === 1 ? 'place' : 'places'} today` : me.moved < 0 ? `down ${-me.moved} today` : null,
                          `${conversion(me.goals, me.kicks)} scored`,
                          me.curStreak > 1 ? `${me.curStreak} in a row` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'Your steps today buy the kicks: one every 1,000.'}
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
              {board.status === 'live' && !kickPinned && (
                <Pressable onPress={onKick} disabled={!canKick} style={[styles.play, !canKick && styles.playOff]} accessibilityRole="button">
                  <Text style={[styles.playText, !canKick && { color: withAlpha(colors.text, 0.6), fontSize: 13.5 }]}>{kickLabel}</Text>
                </Pressable>
              )}
              {live && live.joined && board.status === 'live' && (
                <Text style={styles.placeLine}>
                  {live.steps.toLocaleString()} steps today · {live.kicksEarned} of {live.cap} kicks earned
                  {live.nextKickAt != null ? ` · next at ${live.nextKickAt.toLocaleString()}` : ''}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.placeLine}>{board.joined ? 'Loading your Shootout…' : 'Join the Shootout to kick. Kicks count from the day you join.'}</Text>
          )}
        </View>
      )}

      {!final && spots.length > 0 && (
        <View style={{ gap: 6 }}>
          <ShootoutGoal spots={spots} board={sponsor?.name ?? 'Hound'} keeperColor={sponsor?.color && /^#[0-9a-fA-F]{6}$/.test(sponsor.color) ? sponsor.color : '#e0a94f'} />
          <Text style={styles.small}>Each dot: where one of the top five scores most.</Text>
        </View>
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
      ) : (
        <Card style={styles.card} elevated={false}>
          <Text style={styles.kicker}>PRIZES</Text>
          <Text style={styles.rowText}>{prizeLine}</Text>
        </Card>
      )}

      {final && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setShowFull((v) => !v)} style={styles.outline} accessibilityRole="button">
            <Text style={styles.outlineText}>{showFull ? 'Hide leaderboard' : 'Full leaderboard'}</Text>
          </Pressable>
          {me && me.pos != null && (
            <Pressable onPress={share} style={styles.shareBtn} accessibilityRole="button">
              <Text style={styles.shareText}>Share my Shootout</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 14, color: withAlpha(colors.text, 0.7) },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.6) },
    sub: { fontSize: 13, color: withAlpha(colors.text, 0.7) },
    big: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    place: { borderRadius: 16, padding: 12, gap: 10, backgroundColor: colors.surface },
    placeTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    posBig: { minWidth: 52, height: 52, borderRadius: 14, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(ME_COLOR, 0.16) },
    posBigText: { fontFamily: font.headingSemibold, fontSize: 20, color: ME_COLOR },
    placeTitle: { fontFamily: font.headingSemibold, fontSize: 15.5, color: colors.text },
    placeLine: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.72) },
    next: { gap: 8, borderRadius: 12, padding: 10, backgroundColor: withAlpha(colors.text, 0.05) },
    nextKicker: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    nextRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nextLabel: { flex: 1, fontSize: 13, color: withAlpha(colors.text, 0.8) },
    nextStrong: { fontFamily: font.headingSemibold, color: colors.text },
    nextState: { fontFamily: font.headingSemibold, fontSize: 12, color: withAlpha(colors.text, 0.65) },
    nextStateGood: { color: '#a6e3b8' },
    bar: { height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: '#7fd39b' },
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
    rate: { width: 58, textAlign: 'right', fontSize: 12.5, color: withAlpha(colors.text, 0.72), fontVariant: ['tabular-nums'] },
    goals: { width: 46, textAlign: 'right', fontFamily: font.headingSemibold, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
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
