import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CalendarBlankIcon, DiceFiveIcon, TrophyIcon, XIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Card } from './Card';
import { HoundopolyBoard, type BoardPlayer } from './HoundopolyBoard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { Challenge, Participant } from '../challenges/types';
import {
  CARD_ORDER,
  CARD_TEXT,
  GROUP_COLORS,
  GROUP_NAMES,
  HOUNDOPOLY_BOARD,
  dayNumber,
  describeFeedDay,
  diceFor,
  eventLine,
  netWorth,
  ownerOf,
  ownsWholeGroup,
  reachableFrom,
  rentFor,
  squareAt,
  stepsToNextDie,
  type HoundopolyGame,
} from '../challenges/houndopoly';
import { localDayKey } from '../goals/goals';

const PIECE_COLORS = ['#e0b84f', '#7fd39b', '#4f8fe0', '#f2a7c3', '#e07b2a', '#8b6fd6', '#9aa0ab', '#d94a4a'];

// Everything a Hound'opoly challenge shows on its detail screen: the
// board with tonight's dice, the square waiting on your decision, the
// overnight feed, and the standings by net worth. Tapping a square
// opens its deed.
export function HoundopolySection({
  challenge,
  game,
  participants,
  myUserId,
  stepsToday,
  deciding,
  onDecide,
}: {
  challenge: Challenge;
  game: HoundopolyGame;
  participants: Participant[];
  myUserId: string | null;
  // Today's steps so far on this phone; null until known.
  stepsToday: number | null;
  deciding: boolean;
  onDecide: (buy: boolean) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [deedIdx, setDeedIdx] = useState<number | null>(null);

  const byId = useMemo(() => new Map(participants.map((p) => [p.userId, p])), [participants]);
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Someone';
  const me = game.players.find((p) => p.userId === myUserId) ?? null;

  // Pieces: the viewer gold, everyone else by join order.
  const boardPlayers: BoardPlayer[] = useMemo(() => {
    const others = game.players.filter((p) => p.userId !== myUserId).sort((a, b) => a.userId.localeCompare(b.userId));
    const ordered = me ? [me, ...others] : others;
    return ordered.map((p, i) => {
      const who = byId.get(p.userId);
      return {
        userId: p.userId,
        position: p.position,
        initials: who?.initials ?? '?',
        frameId: who?.frameId,
        backgroundId: who?.backgroundId,
        iconId: who?.iconId,
        color: PIECE_COLORS[i % PIECE_COLORS.length],
      };
    });
  }, [game.players, myUserId, me, byId]);
  const colorOf = (id: string) => boardPlayers.find((p) => p.userId === id)?.color ?? colors.accent;

  const todayKey = localDayKey(new Date());
  const firstDay = challenge.startDay ?? localDayKey(new Date(challenge.startsAt));
  const day = dayNumber(firstDay, todayKey, challenge.durationDays);
  const dice = stepsToday !== null ? diceFor(stepsToday, game.settings) : null;
  const highlight = useMemo(() => new Set(me && dice ? reachableFrom(me.position, dice) : []), [me, dice]);
  const next = stepsToday !== null ? stepsToNextDie(stepsToday, game.settings) : null;

  const pending = me?.pendingIdx !== null && me?.pendingIdx !== undefined ? squareAt(me.pendingIdx) : null;
  const pendingOwned = pending ? ownerOf(pending.idx, game.deeds) !== null : false;

  const standings = useMemo(
    () => game.players.map((p) => ({ player: p, worth: netWorth(p, game.deeds) })).sort((a, b) => b.worth - a.worth),
    [game.players, game.deeds],
  );
  const topWorth = standings[0]?.worth ?? 1;

  const lastDay = game.rolledDays[0] ?? null;
  const feed = lastDay ? game.events.filter((e) => e.day === lastDay) : [];
  const today = game.events.filter((e) => e.day === todayKey && e.kind !== 'moved' && lastDay !== todayKey);

  const deed = deedIdx !== null ? squareAt(deedIdx) : null;
  const deedOwner = deed ? ownerOf(deed.idx, game.deeds) : null;
  const deedRent = deed ? rentFor(deed.idx, game.deeds) : 0;
  const groupCount = (g: string) => HOUNDOPOLY_BOARD.filter((q) => q.group === g).length;
  const groupOwned = (g: string, owner: string) => game.deeds.filter((d) => d.ownerId === owner && squareAt(d.idx).group === g).length;

  return (
    <>
      <Card style={{ gap: 12 }} elevated={false}>
        <Text style={styles.eyebrow}>
          Hound&rsquo;opoly · Day {day} of {challenge.durationDays}
        </Text>
        <HoundopolyBoard players={boardPlayers} deeds={game.deeds} myUserId={myUserId} highlight={highlight} onPressSquare={setDeedIdx}>
          <Text style={styles.centreTitle}>HOUND&rsquo;OPOLY</Text>
          {me ? (
            <>
              <Text style={styles.centreLabel}>Your cash</Text>
              <Text style={styles.centreCash}>{me.cash.toLocaleString()}</Text>
              <Text style={styles.centreLabel}>
                {game.deeds.filter((d) => d.ownerId === me.userId).length} squares · worth{' '}
                {(netWorth(me, game.deeds) - me.cash).toLocaleString()}
              </Text>
              {me.bankrupt && <Text style={[styles.centreLabel, { color: colors.amber }]}>Bankrupt</Text>}
            </>
          ) : (
            <Text style={styles.centreLabel}>Join to play</Text>
          )}
        </HoundopolyBoard>
        <Text style={styles.footNote}>Tap a square to see who owns it and the rent.</Text>
      </Card>

      {me && pending && (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={styles.eyebrow}>You landed here last night</Text>
          {pendingOwned ? (
            <Text style={styles.body}>
              <Text style={styles.bold}>{pending.name}</Text> was bought before you decided. It&rsquo;s gone.
            </Text>
          ) : (
            <Text style={styles.body}>
              Buy <Text style={styles.bold}>{pending.name}</Text> for {pending.price}? You have {me.cash.toLocaleString()} cash. Decide before
              the next roll or it stays for sale.
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!pendingOwned && (
              <Button
                label={deciding ? 'Buying…' : `Buy for ${pending.price}`}
                variant="primary"
                style={{ flex: 1 }}
                disabled={deciding || me.bankrupt || (pending.price ?? 0) > me.cash}
                onPress={() => onDecide(true)}
              />
            )}
            <Button label={pendingOwned ? 'OK' : 'Pass'} variant="secondary" style={{ flex: 1 }} disabled={deciding} onPress={() => onDecide(false)} />
          </View>
          {!pendingOwned && (pending.price ?? 0) > me.cash && <Text style={styles.footNote}>Not enough cash for this one.</Text>}
        </Card>
      )}

      {me && !me.bankrupt && day <= challenge.durationDays && (
        <Card style={{ gap: 8 }} elevated={false}>
          <Text style={styles.eyebrow}>Your move tonight</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={styles.dice}>
              {dice === null ? (
                <DiceFiveIcon size={22} color={colors.bg} weight="fill" />
              ) : (
                <Text style={styles.diceText}>{dice === 0 ? '—' : `${dice}d`}</Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.body}>
                {stepsToday === null
                  ? 'Checking today’s steps…'
                  : dice === 0
                    ? `${stepsToday.toLocaleString()} steps so far · no roll yet`
                    : `${stepsToday.toLocaleString()} steps so far · ${dice} ${dice === 1 ? 'die' : 'dice'} tonight`}
              </Text>
              <Text style={styles.footNote}>
                {next
                  ? `${next.steps.toLocaleString()} more steps for ${next.dice === 1 ? 'a roll' : `${next.dice} dice`}. `
                  : 'Top tier: three dice. '}
                Rolls once the day is over everywhere. Under {game.settings.dogHouseSteps.toLocaleString()} steps and you stay in.
              </Text>
            </View>
          </View>
          {dice !== null && dice > 0 && (
            <Text style={styles.footNote}>Tonight you can land anywhere from {dice} to {dice * 6} squares ahead; they&rsquo;re outlined on the board.</Text>
          )}
        </Card>
      )}

      {(feed.length > 0 || today.length > 0) && (
        <Card style={{ gap: 10 }} elevated={false}>
          <View style={styles.header}>
            <CalendarBlankIcon size={16} color={colors.accent} />
            <Text style={text.h4}>{lastDay ? `Last night · ${describeFeedDay(lastDay)}` : 'Today'}</Text>
          </View>
          {[...today, ...feed].map((e) => {
            const line = eventLine(e, nameOf, myUserId);
            const who = byId.get(e.userId);
            return (
              <View key={e.id} style={styles.feedRow}>
                <Avatar
                  initials={who?.initials ?? '?'}
                  tint={colorOf(e.userId)}
                  size={24}
                  fontSize={9}
                  frameId={who?.frameId}
                  backgroundId={who?.backgroundId}
                  iconId={who?.iconId}
                />
                <Text style={[styles.body, { flex: 1 }]}>{line.text}</Text>
                {line.amount && (
                  <Text style={[styles.amount, line.tone === 'plus' && { color: colors.green }, line.tone === 'minus' && { color: colors.amber }]}>
                    {line.amount}
                  </Text>
                )}
              </View>
            );
          })}
        </Card>
      )}

      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.header}>
          <TrophyIcon size={16} color={colors.accent} />
          <Text style={text.h4}>Standings · net worth</Text>
        </View>
        {standings.map(({ player, worth }) => {
          const who = byId.get(player.userId);
          return (
            <View key={player.userId} style={styles.standRow}>
              <Avatar
                initials={who?.initials ?? '?'}
                tint={colorOf(player.userId)}
                size={28}
                fontSize={10}
                frameId={who?.frameId}
                backgroundId={who?.backgroundId}
                iconId={who?.iconId}
                level={who?.level}
              />
              <Text style={styles.standName} numberOfLines={1}>
                {player.userId === myUserId ? 'You' : nameOf(player.userId)}
                {player.bankrupt ? ' · bankrupt' : ''}
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.max(3, (worth / topWorth) * 100)}%` }]} />
              </View>
              <Text style={styles.standWorth}>{worth.toLocaleString()}</Text>
            </View>
          );
        })}
        <Text style={styles.footNote}>Cash plus what your squares are worth. Highest on the last day wins.</Text>
      </Card>

      <Card style={{ gap: 8 }} elevated={false}>
        <Text style={styles.eyebrow}>Fetch! cards in this game</Text>
        {CARD_ORDER.map((c) => (
          <Text key={c} style={styles.body}>
            · {CARD_TEXT[c]}
          </Text>
        ))}
        <Text style={styles.footNote}>
          Under {game.settings.dogHouseSteps.toLocaleString()} steps: no roll. {game.settings.dogHouseSteps.toLocaleString()} to{' '}
          {(game.settings.twoDiceSteps - 1).toLocaleString()}: one die. {game.settings.twoDiceSteps.toLocaleString()} to{' '}
          {(game.settings.threeDiceSteps - 1).toLocaleString()}: two. {game.settings.threeDiceSteps.toLocaleString()} and up: three. Passing
          Start pays {game.settings.passStartCash}; the Vet costs {game.settings.vetCost}. Rent is a tenth of the price, doubled with a whole
          colour group.
        </Text>
      </Card>

      <Modal visible={deed !== null} transparent animationType="fade" onRequestClose={() => setDeedIdx(null)}>
        <Pressable style={styles.dim} onPress={() => setDeedIdx(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {deed && (
              <ScrollView contentContainerStyle={{ gap: 12 }}>
                <View style={[styles.deedTop, { backgroundColor: deed.group ? GROUP_COLORS[deed.group] : withAlpha(colors.text, 0.12) }]}>
                  <Text style={[styles.deedTitle, !deed.group && { color: colors.text }]}>{deed.name}</Text>
                  <Pressable onPress={() => setDeedIdx(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                    <XIcon size={18} color={deed.group ? '#161826' : colors.text} />
                  </Pressable>
                </View>
                {deed.kind === 'property' && deed.group && deed.price ? (
                  <View style={{ gap: 6 }}>
                    <Row label="Group" value={`${GROUP_NAMES[deed.group]} · ${groupCount(deed.group)} squares`} styles={styles} />
                    <Row label="Price" value={String(deed.price)} styles={styles} />
                    <Row label="Rent" value={`${Math.floor(deed.price / 10)} · ${Math.floor(deed.price / 5)} with the whole group`} styles={styles} />
                    <Row
                      label="Owner"
                      value={
                        deedOwner
                          ? `${deedOwner === myUserId ? 'You' : nameOf(deedOwner)} · ${groupOwned(deed.group, deedOwner)} of ${groupCount(deed.group)} in the group${
                              ownsWholeGroup(deedOwner, deed.group, game.deeds) ? ' · rent doubled' : ''
                            }`
                          : 'For sale'
                      }
                      styles={styles}
                    />
                    {deedOwner && deedOwner !== myUserId && (
                      <Text style={styles.footNote}>Land here and you pay {deedRent}.</Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.body}>
                    {deed.kind === 'start' && `Pass or land here and collect ${game.settings.passStartCash}.`}
                    {deed.kind === 'fetch' && 'Draw a Fetch! card, tied to how your day went.'}
                    {deed.kind === 'dog_house' && 'Just visiting, unless a card sent you here. A quiet corner either way.'}
                    {deed.kind === 'dog_park' && 'A free rest. Nothing happens here.'}
                    {deed.kind === 'vet' && `A check-up: pay ${game.settings.vetCost}.`}
                    {deed.kind === 'water_bowl' && 'A free stop for a drink.'}
                  </Text>
                )}
                {me && pending && pending.idx === deed.idx && !pendingOwned && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      label={deciding ? 'Buying…' : `Buy for ${deed.price}`}
                      variant="primary"
                      style={{ flex: 1 }}
                      disabled={deciding || me.bankrupt || (deed.price ?? 0) > me.cash}
                      onPress={() => {
                        setDeedIdx(null);
                        onDecide(true);
                      }}
                    />
                    <Button
                      label="Pass"
                      variant="secondary"
                      style={{ flex: 1 }}
                      disabled={deciding}
                      onPress={() => {
                        setDeedIdx(null);
                        onDecide(false);
                      }}
                    />
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    eyebrow: { fontSize: 11, letterSpacing: 0.8, fontFamily: font.heading, color: colors.accentActive, textTransform: 'uppercase' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    body: { fontSize: 13.5, lineHeight: 19, color: colors.text },
    bold: { fontFamily: font.headingSemibold },
    footNote: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.55) },
    centreTitle: { fontFamily: font.headingSemibold, fontSize: 13, letterSpacing: 0.5, color: colors.text },
    centreLabel: { fontSize: 10.5, color: withAlpha(colors.text, 0.65), textAlign: 'center' },
    centreCash: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.amber, fontVariant: ['tabular-nums'] },
    dice: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.accentActive, alignItems: 'center', justifyContent: 'center' },
    diceText: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.bg },
    feedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    amount: { fontFamily: font.heading, fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
    standRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    standName: { width: 92, fontSize: 13, color: colors.text },
    bar: { flex: 1, height: 6, borderRadius: 999, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 999 },
    standWorth: { width: 56, textAlign: 'right', fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
    dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      padding: 16,
      paddingBottom: 34,
      maxHeight: '70%',
    },
    deedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12 },
    deedTitle: { fontFamily: font.headingSemibold, fontSize: 16, color: '#161826' },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    rowLabel: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
    rowValue: { flex: 1, textAlign: 'right', fontSize: 13, color: colors.text },
  });
}
