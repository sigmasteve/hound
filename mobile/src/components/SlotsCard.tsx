import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { usePinnedAction } from './PinnedAction';
import { TEAM_COLOR, ordinal, teamName, winName, type SlotTeam } from '../challenges/slots';
import { slotsWaiting, type SlotsGame } from '../challenges/slotsApi';

// Paw Slots on the challenge page (0242): the prize pool and what each
// place (or team) would win, the standings (or the teams and your pack),
// and today's big wins. The machine is SlotsScreen; "Play · N spins
// ready" pins to the bottom of the page.
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function SlotsCard({ game, onPlay }: { game: SlotsGame | null; onPlay: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ready = slotsWaiting(game);
  const live = !!game && !game.over && game.dayNo >= 1 && game.dayNo <= game.days;

  const pinned = usePinnedAction(ready > 0 ? { label: `Play · ${ready} ${ready === 1 ? 'spin' : 'spins'} ready`, onPress: onPlay } : null);

  if (!game) {
    return (
      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={text.h4}>Paw Slots</Text>
        <ActivityIndicator color={colors.accent} />
      </Card>
    );
  }

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const team = game.teams >= 2;
  const p = game.prizes;
  const ladder = team
    ? game.teamPrizes.map((b, i) => ({ place: `${ordinal(i + 1).toUpperCase()} TEAM`, bones: b })).filter((x, i) => i < 3 || x.bones > 0)
    : [
        ...p.places.slice(0, 3).map((b, i) => ({ place: ordinal(i + 1).toUpperCase(), bones: b })),
        ...(p.places.length > 3 ? [{ place: p.places.length > 4 ? `4TH–${ordinal(p.places.length).toUpperCase()}` : '4TH', bones: p.places[3] }] : []),
      ];
  const note = team
    ? `Teams are ranked by Paw Coins per hound, so a small team can win. A team’s Bones are split by what each hound won. Anyone who spins on ${game.settings.finishDays} days gets at least ${p.restMin}.`
    : p.rest != null
      ? `${fmt(p.rest)} more shared by everyone else who spins on ${game.settings.finishDays} days (at least ${p.restMin} each). Paw Coins never turn into Bones: only your place counts.`
      : `Paid by place when it ends. Paw Coins never turn into Bones: only your place counts.`;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={text.h4}>Paw Slots</Text>
          <Text style={styles.small}>
            {game.over ? 'It’s over: final standings.' : live ? `Day ${game.dayNo} of ${game.days}` : game.dayNo < 1 ? 'Starts soon' : 'Results tomorrow'}
            {team ? ` · ${game.teams} packs` : ''} · {fmt(game.players)} {game.players === 1 ? 'hound' : 'hounds'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.coins}>{fmt(game.me.coins)}</Text>
          <Text style={styles.small}>{team ? `Paw Coins · ${teamName(game.me.team)}` : `Paw Coins · ${ordinal(game.me.rank)}`}</Text>
        </View>
      </View>

      <View style={styles.prize}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={styles.pool}>{fmt(game.pool)} Bones</Text>
          <Text style={styles.prizeSub}>prize pool · paid when it ends</Text>
        </View>
        <View style={styles.ladder}>
          {ladder.map((l) => (
            <View key={l.place} style={styles.rung}>
              <Text style={styles.rungPlace}>{l.place}</Text>
              <Text style={styles.rungBones}>{fmt(l.bones)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.prizeNote}>{note}</Text>
      </View>

      {!team && (
        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, { width: 34 }]}>#</Text>
            <Text style={[styles.th, { flex: 1 }]}>HOUND</Text>
            <Text style={[styles.th, { width: 78, textAlign: 'right' }]}>PAW COINS</Text>
            <Text style={[styles.th, { width: 56, textAlign: 'right' }]}>BONES</Text>
          </View>
          {game.board.map((r, i) => {
            const gap = i > 0 && r.rank > game.board[i - 1].rank + 1 && game.board[i - 1].rank <= 10;
            const bones = r.rank <= p.places.length ? fmt(p.places[r.rank - 1]) : p.rest != null ? `${p.restMin}+` : '';
            return (
              <React.Fragment key={r.userId}>
                {gap && <Text style={styles.gap}>…</Text>}
                <View style={[styles.tr, r.me && styles.trMe]}>
                  <Text style={[styles.td, { width: 34, color: withAlpha(colors.text, 0.6) }]}>
                    {r.tied ? 'T' : ''}
                    {r.rank}
                  </Text>
                  <Text style={[styles.td, { flex: 1 }]} numberOfLines={1}>
                    {r.me ? 'You' : r.name}
                  </Text>
                  <Text style={[styles.td, { width: 78, textAlign: 'right' }]}>{fmt(r.coins)}</Text>
                  <Text style={[styles.td, styles.bones, { width: 56 }]}>{bones}</Text>
                </View>
              </React.Fragment>
            );
          })}
          {game.board.length === 0 && <Text style={[styles.small, { padding: 12 }]}>Nobody’s played yet.</Text>}
        </View>
      )}

      {team && (
        <>
          <View style={styles.table}>
            <View style={styles.thead}>
              <Text style={[styles.th, { width: 34 }]}>#</Text>
              <Text style={[styles.th, { flex: 1 }]}>PACK</Text>
              <Text style={[styles.th, { width: 86, textAlign: 'right' }]}>PER HOUND</Text>
              <Text style={[styles.th, { width: 56, textAlign: 'right' }]}>BONES</Text>
            </View>
            {game.teamBoard.map((t) => (
              <View key={t.team} style={[styles.tr, t.mine && styles.trMe]}>
                <Text style={[styles.td, { width: 34, color: withAlpha(colors.text, 0.6) }]}>{t.rank}</Text>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.dot, { backgroundColor: TEAM_COLOR[t.team as SlotTeam] ?? '#888' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.td}>{teamName(t.team)}</Text>
                    <Text style={styles.small}>
                      {t.members} {t.members === 1 ? 'hound' : 'hounds'} · {fmt(t.total)}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.td, { width: 86, textAlign: 'right' }]}>{fmt(t.avg)}</Text>
                <Text style={[styles.td, styles.bones, { width: 56 }]}>{t.bones > 0 ? fmt(t.bones) : `${p.restMin}+`}</Text>
              </View>
            ))}
          </View>
          {game.mates.length > 0 && (
            <View style={styles.mates}>
              <Text style={styles.matesHead}>Your pack: the {teamName(game.me.team)}</Text>
              {game.mates.slice(0, 8).map((m, i) => (
                <View key={`${m.name}${i}`} style={{ flexDirection: 'row' }}>
                  <Text style={[styles.mate, m.me && { fontFamily: font.headingSemibold }]} numberOfLines={1}>
                    {m.me ? 'You' : m.name}
                  </Text>
                  <Text style={styles.mateCoins}>{fmt(m.coins)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {game.feed.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={styles.th}>BIG WINS TODAY</Text>
          {game.feed.map((f, i) => {
            const best = f.wins.reduce((a, w) => (w.n > a.n ? w : a), f.wins[0]);
            const tag = f.best >= 250 ? 'JACKPOT' : f.bet > 1 ? `×${f.bet}` : best?.collar ? 'COLLAR' : 'BIG WIN';
            return (
              <View key={`${f.at}${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.tag, f.best >= 250 ? styles.tagGold : best?.collar ? styles.tagBlue : styles.tagOrange]}>{tag}</Text>
                <Text style={styles.feed} numberOfLines={2}>
                  {f.name}: {best ? lowerFirst(winName(best)) : 'a big win'}
                  {f.bet > 1 ? ` at ×${f.bet}` : ''}, {fmt(f.coins)} Paw Coins
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {live && game.me.joined && (ready === 0 || !pinned) && (
        <Pressable onPress={onPlay} style={styles.open} accessibilityRole="button">
          <Text style={styles.openText}>{ready > 0 ? `Play · ${ready} ${ready === 1 ? 'spin' : 'spins'} ready` : 'Open the machine'}</Text>
          <Text style={styles.small}>
            {game.today.nextAt != null
              ? `${fmt(Math.max(0, game.today.nextAt - game.today.steps))} steps to your next spin`
              : 'All of today’s spins from steps are in'}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    small: { fontSize: 12, lineHeight: 17, color: withAlpha(colors.text, 0.65) },
    coins: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    prize: { borderRadius: 14, padding: 12, gap: 8, backgroundColor: withAlpha('#f0c24a', 0.12), borderWidth: 1, borderColor: withAlpha('#f0c24a', 0.35) },
    pool: { fontFamily: font.headingSemibold, fontSize: 19, color: '#c99a1a' },
    prizeSub: { fontSize: 12, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.7) },
    ladder: { flexDirection: 'row', gap: 6 },
    rung: { flex: 1, borderRadius: 10, paddingVertical: 6, alignItems: 'center', backgroundColor: withAlpha(colors.text, 0.06) },
    rungPlace: { fontFamily: font.headingSemibold, fontSize: 10, letterSpacing: 0.4, color: withAlpha(colors.text, 0.65) },
    rungBones: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    prizeNote: { fontSize: 11.5, lineHeight: 16, color: withAlpha(colors.text, 0.7) },
    table: { borderRadius: 14, overflow: 'hidden', backgroundColor: withAlpha(colors.text, 0.04) },
    thead: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: withAlpha(colors.text, 0.15) },
    th: { fontFamily: font.headingSemibold, fontSize: 10.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7 },
    trMe: { backgroundColor: withAlpha('#f08a24', 0.16) },
    td: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.text },
    bones: { textAlign: 'right', color: '#c99a1a' },
    gap: { paddingHorizontal: 12, color: withAlpha(colors.text, 0.5) },
    dot: { width: 10, height: 10, borderRadius: 5 },
    mates: { borderRadius: 14, padding: 12, gap: 5, backgroundColor: withAlpha(colors.text, 0.04) },
    matesHead: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text },
    mate: { flex: 1, fontSize: 12.5, color: colors.text },
    mateCoins: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.text },
    tag: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontFamily: font.headingSemibold },
    tagGold: { backgroundColor: '#f0c24a', color: '#161826' },
    tagOrange: { backgroundColor: '#f08a24', color: '#161826' },
    tagBlue: { backgroundColor: '#4f7be0', color: '#ffffff' },
    feed: { flex: 1, fontSize: 12.5, color: withAlpha(colors.text, 0.8) },
    open: { borderRadius: 12, padding: 12, gap: 2, borderWidth: 1, borderColor: withAlpha(colors.text, 0.15), alignItems: 'center' },
    openText: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.accentActive },
  });
}
