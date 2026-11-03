import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, BoneIcon, GiftIcon, PawPrintIcon, TrashIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { getHeadToHeadRecord, type HeadToHeadRecord } from '../friends/friendStats';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import { KUDOS_LIMIT_MESSAGE, type KudosCounts } from '../friends/types';
import { listAchievements, listEarnedAchievements, type Achievement } from '../achievements/achievementsApi';
import { achievementIcon } from '../achievements/achievementIcons';
import { myRecentNudges, nudgeAgainLabel, sendNudge } from '../social/social';
import { isSupabaseConfigured } from '../lib/supabase';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { HoundArt } from '../kennel/HoundArt';
import { AboutCard } from '../growth/AboutCard';
import { getFriendHoundProfile, type HoundProfile } from '../growth/growth';
import { localDayKey } from '../water/water';
import { friendMoodLine, getFriendKennel, getKennel, type FriendKennel, type Kennel } from '../kennel/kennelApi';
import { YardScene } from '../kennel/YardArt';
import { PorchScene } from '../kennel/PorchArt';
import { GiftSheet } from '../kennel/GiftSheet';
import { getFriendYard, leavePawprint, tossYardTreat, type Yard } from '../kennel/yardApi';
import { TREAT_BONES } from '../kennel/kennelItems';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { TROPHIES } from '../kennel/yardItems';

export function FriendDetailScreen({
  friendshipId,
  friendUserId,
  friendName,
  friendInitials,
  friendFrameId,
  friendBackgroundId,
  friendIconId,
  onBack,
  onChallenge,
}: {
  friendshipId: string;
  friendUserId: string;
  friendName: string;
  friendInitials: string;
  friendFrameId?: string | null;
  friendBackgroundId?: string | null;
  friendIconId?: string | null;
  onBack: () => void;
  // Create, with this friend already invited.
  onChallenge: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [record, setRecord] = useState<HeadToHeadRecord | null>(null);
  const [kudos, setKudos] = useState<KudosCounts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // This friend's earned badges (readable because you're friends — see
  // 0072_achievements.sql's select policy). null until loaded; stays null
  // (card just shows nothing) if it can't load, without failing the page.
  const [friendBadges, setFriendBadges] = useState<{ earned: Achievement[]; total: number } | null>(null);
  // Their hound (0105_kennel_friends_coats.sql). The card just doesn't
  // show if it can't load.
  const [hound, setHound] = useState<FriendKennel | null>(null);
  // And their yard (0148_yard.sql), to look around; without it (before
  // 0148 has run) the card shows just the hound, as before.
  const [yard, setYard] = useState<Yard | null>(null);
  const [yardWidth, setYardWidth] = useState(0);
  // While a finger is throwing the toy, the page holds still.
  const [throwing, setThrowing] = useState(false);
  // Your own hound, which tags along when you visit (0150).
  const [myHound, setMyHound] = useState<Kennel | null>(null);
  const [yardBusy, setYardBusy] = useState<'pawprint' | 'treat' | null>(null);
  // Sending them a gift (0157).
  const [gifting, setGifting] = useState(false);
  // Their hound's age, fitness, traits and birthday (0165).
  const [growth, setGrowth] = useState<HoundProfile | null>(null);
  const loadYard = () => {
    getFriendHoundProfile(friendUserId, localDayKey())
      .then(setGrowth)
      .catch(() => setGrowth(null));
    getFriendKennel(friendUserId)
      .then(setHound)
      .catch(() => {});
    getFriendYard(friendUserId)
      .then(setYard)
      .catch(() => setYard(null));
  };
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    loadYard();
    getKennel()
      .then(setMyHound)
      .catch(() => setMyHound(null));
  }, [friendUserId]);

  const visit = async (what: 'pawprint' | 'treat') => {
    setYardBusy(what);
    try {
      if (what === 'pawprint') {
        await leavePawprint(friendUserId);
      } else {
        await tossYardTreat(friendUserId);
        notifyBonesChanged();
      }
      loadYard();
    } catch (e) {
      Alert.alert(what === 'pawprint' ? "Couldn't leave a pawprint" : "Couldn't toss a treat", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setYardBusy(null);
    }
  };

  useEffect(() => {
    Promise.all([listAchievements(), listEarnedAchievements(friendUserId)])
      .then(([all, theirs]) => setFriendBadges({ earned: all.filter((a) => theirs.has(a.id)), total: all.length }))
      .catch(() => setFriendBadges(null));
  }, [friendUserId]);
  const [givingKudos, setGivingKudos] = useState(false);
  // Nudge (0082_nudges_reactions.sql) — once per 20 hours.
  const [lastNudgedAt, setLastNudgedAt] = useState<string | undefined>(undefined);
  const [nudging, setNudging] = useState(false);
  const [nudgeNote, setNudgeNote] = useState<string | null>(null);
  useEffect(() => {
    myRecentNudges()
      .then((m) => setLastNudgedAt(m.get(friendUserId)))
      .catch(() => {});
  }, [friendUserId]);
  const nudgeWait = nudgeAgainLabel(lastNudgedAt);
  const nudge = async () => {
    setNudging(true);
    try {
      const { pushed } = await sendNudge(friendUserId);
      setLastNudgedAt(new Date().toISOString());
      setNudgeNote(
        pushed
          ? `Nudged ${friendName} 👋`
          : `Nudged ${friendName} — they can’t get notifications yet, so they’ll see it next time they open Hound.`,
      );
    } catch (e) {
      Alert.alert('Could not nudge', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setNudging(false);
    }
  };
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHeadToHeadRecord(friendUserId), supabaseFriendsProvider.getKudosCounts(friendUserId)])
      .then(([r, k]) => {
        if (cancelled) return;
        setRecord(r);
        setKudos(k);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Could not load this friend’s stats.');
      });
    return () => {
      cancelled = true;
    };
  }, [friendUserId]);

  const sendKudos = async () => {
    setGivingKudos(true);
    try {
      await supabaseFriendsProvider.giveKudos(friendUserId);
      // Updates the count immediately instead of waiting on a re-fetch —
      // the insert already succeeded, so there's nothing this round-trip
      // would tell us that we don't already know.
      setKudos((k) => (k ? { ...k, given: k.given + 1, givenRecently: true } : k));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Try again.';
      if (message.includes(KUDOS_LIMIT_MESSAGE)) {
        setKudos((k) => (k ? { ...k, givenRecently: true } : k));
        return;
      }
      Alert.alert('Could not send kudos', message);
    } finally {
      setGivingKudos(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      'Remove this friend?',
      `You and ${friendName} will no longer be connected on Hound. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await supabaseFriendsProvider.removeFriendship(friendshipId);
              onBack();
            } catch (e) {
              Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.');
              setRemoving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView scrollEnabled={!throwing} contentContainerStyle={styles.container}>
        <Button label="Friends" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={styles.headerRow}>
          <Avatar
            initials={friendInitials}
            tint={TINT_A}
            size={56}
            fontSize={18}
            frameId={friendFrameId}
            backgroundId={friendBackgroundId}
            iconId={friendIconId}
          />
          {/* A long name shrinks to fit, then truncates, instead of running
              off the screen. */}
          <Text style={[text.h2, styles.headerName]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
            {friendName}
          </Text>
        </View>

        {loadError && <Text style={styles.errorNote}>{loadError}</Text>}

        {hound && yard && (
          <Card style={styles.yardCard} elevated={false}>
            <View onLayout={(e) => setYardWidth(Math.floor(e.nativeEvent.layout.width))}>
              {yardWidth > 0 && (
                <YardScene
                  onGesture={setThrowing}
                  stage={growth?.stage}
                  fitness={growth?.fitness}
                  birthday={!!growth?.isBirthday}
                  yard={yard}
                  tricks={yard.tricks}
                  width={yardWidth}
                  guest={
                    myHound
                      ? {
                          hound: {
                            name: myHound.name,
                            rank: rankForLevel(levelProgressForXp(myHound.xpTotal).level).id,
                            mood: myHound.mood,
                            neckId: myHound.neckId,
                            headId: myHound.headId,
                            faceId: myHound.faceId,
                            coatId: myHound.coatId,
                            breedId: myHound.breedId,
                            bodyId: myHound.bodyId,
                            feetId: myHound.feetId,
                            ears: myHound.ears,
                            tail: myHound.tail,
                            markings: myHound.markings,
                          },
                          label: `${myHound.name} · yours`,
                          line: `Hi, ${hound.name}!`,
                        }
                      : null
                  }
                  hound={{
                    name: hound.name,
                    rank: rankForLevel(levelProgressForXp(hound.xpTotal).level).id,
                    mood: hound.mood,
                    neckId: hound.neckId,
                    headId: growth?.isBirthday ? 'hat_party' : hound.headId,
                    faceId: hound.faceId,
                    coatId: hound.coatId,
                    breedId: hound.breedId,
                    bodyId: hound.bodyId,
                    feetId: hound.feetId,
                    ears: hound.ears,
                    tail: hound.tail,
                    markings: hound.markings,
                  }}
                />
              )}
              {/* Their Porch (0157), once they've unlocked it. */}
              {yardWidth > 0 && yard.porch && (
                <View style={{ marginTop: 8 }}>
                  <PorchScene items={yard.porch} width={yardWidth} hound={{
                    name: hound.name,
                    rank: rankForLevel(levelProgressForXp(hound.xpTotal).level).id,
                    mood: hound.mood,
                    neckId: hound.neckId,
                    headId: hound.headId,
                    faceId: hound.faceId,
                    coatId: hound.coatId,
                    breedId: hound.breedId,
                    bodyId: hound.bodyId,
                    feetId: hound.feetId,
                    ears: hound.ears,
                    tail: hound.tail,
                    markings: hound.markings,
                  }} />
                </View>
              )}
            </View>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={text.h4}>{hound.name}’s yard</Text>
                {(() => {
                  const rank = rankForLevel(levelProgressForXp(hound.xpTotal).level);
                  return (
                    <View style={[styles.houndRank, { backgroundColor: withAlpha(rank.color, 0.18) }]}>
                      <Text style={[styles.houndRankText, { color: rank.color }]}>{rank.name}</Text>
                    </View>
                  );
                })()}
              </View>
              <Text style={styles.footNote}>{friendMoodLine(hound.name, hound.mood)}</Text>
              {yard.mine && (
                <View style={styles.yardActions}>
                  <Button
                    label={yard.mine.pawprint ? 'Pawprint left' : yardBusy === 'pawprint' ? '…' : 'Leave a pawprint'}
                    variant={yard.mine.pawprint ? 'ghost' : 'primary'}
                    small
                    icon={<PawPrintIcon size={13} color={colors.accent} weight="fill" />}
                    disabled={yard.mine.pawprint || yardBusy !== null}
                    onPress={() => visit('pawprint')}
                  />
                  <Button
                    label={yard.mine.treat ? 'Treat tossed' : yardBusy === 'treat' ? '…' : `Toss a treat · ${TREAT_BONES}`}
                    variant="ghost"
                    small
                    icon={<BoneIcon size={13} color={colors.accent} weight="fill" />}
                    disabled={yard.mine.treat || yardBusy !== null}
                    onPress={() => visit('treat')}
                  />
                  <Button
                    label="Send a gift"
                    variant="ghost"
                    small
                    icon={<GiftIcon size={13} color={colors.accent} weight="fill" />}
                    onPress={() => setGifting(true)}
                  />
                </View>
              )}
              {yard.trophies.some((t) => TROPHIES[t.kind]) && (
                <Text style={styles.footNote}>
                  Trophies:{' '}
                  {yard.trophies
                    .filter((t) => TROPHIES[t.kind])
                    .map((t) => `${TROPHIES[t.kind].name}${t.wins > 1 ? ` ×${t.wins}` : ''}`)
                    .join(' · ')}
                </Text>
              )}
            </View>
          </Card>
        )}

        {growth && <AboutCard profile={growth} today={localDayKey()} />}

        {hound && !yard && (
          <Card style={styles.houndCard} elevated={false}>
            <View style={styles.houndArt}>
              <HoundArt
                rank={rankForLevel(levelProgressForXp(hound.xpTotal).level).id}
                mood={hound.mood}
                neckId={hound.neckId}
                headId={hound.headId}
                faceId={hound.faceId}
                coatId={hound.coatId}
                ears={hound.ears}
                tail={hound.tail}
                markings={hound.markings}
                breedId={hound.breedId}
                bodyId={hound.bodyId}
                feetId={hound.feetId}
                size={84}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={text.h4}>{hound.name}</Text>
              {(() => {
                const rank = rankForLevel(levelProgressForXp(hound.xpTotal).level);
                return (
                  <View style={[styles.houndRank, { backgroundColor: withAlpha(rank.color, 0.18) }]}>
                    <Text style={[styles.houndRankText, { color: rank.color }]}>{rank.name}</Text>
                  </View>
                );
              })()}
              <Text style={styles.footNote}>{friendMoodLine(hound.name, hound.mood)}</Text>
            </View>
          </Card>
        )}

        <Card style={{ gap: 14, padding: 18 }} elevated={false}>
          <Text style={text.h4}>Head-to-head</Text>
          {record ? (
            <>
              <View style={styles.statRow}>
                <Stat label="Challenges together" value={String(record.together)} styles={styles} />
                <Stat
                  label="Record"
                  value={`${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`}
                  styles={styles}
                />
              </View>
              <Text style={styles.footNote}>
                {record.wins + record.losses + record.ties === 0
                  ? 'No finished challenges between you yet — still-running ones don’t count toward the record.'
                  : `${record.wins}W – ${record.losses}L${record.ties ? ` – ${record.ties}T` : ''} across the challenges you’ve both finished.`}
              </Text>
            </>
          ) : !loadError ? (
            <ActivityIndicator color={colors.accent} />
          ) : null}
        </Card>

        {friendBadges && (
          <Card style={{ gap: 12, padding: 18 }} elevated={false}>
            <View style={styles.badgeHeader}>
              <Text style={text.h4}>Achievements</Text>
              <Text style={styles.footNote}>
                {friendBadges.earned.length} of {friendBadges.total}
              </Text>
            </View>
            {friendBadges.earned.length === 0 ? (
              <Text style={styles.footNote}>No achievements yet.</Text>
            ) : (
              <View style={styles.badgeGrid}>
                {friendBadges.earned.map((a) => {
                  const Icon = achievementIcon(a.id);
                  return (
                    <View key={a.id} style={styles.badgeCell}>
                      <View style={styles.badge}>
                        <Icon size={20} color={color.gold} weight="fill" />
                      </View>
                      <Text style={styles.badgeName} numberOfLines={2}>
                        {a.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        )}

        {/* The obvious next step with a friend. */}
        <Button label={`Start a challenge with ${friendName.split(' ')[0]}`} variant="primary" block onPress={onChallenge} />

        <Card style={{ gap: 14, padding: 18 }} elevated={false}>
          <Text style={text.h4}>Kudos</Text>
          {kudos ? (
            <View style={styles.statRow}>
              <Stat label="You've given" value={String(kudos.given)} styles={styles} />
              <Stat label="You've received" value={String(kudos.received)} styles={styles} />
            </View>
          ) : !loadError ? (
            <ActivityIndicator color={colors.accent} />
          ) : null}
          <View style={styles.cheerButtons}>
            <View style={{ flex: 1 }}>
              {/* Once per friend a day (0089). */}
              <Button
                label={givingKudos ? 'Sending…' : kudos?.givenRecently ? 'Kudos sent ✓' : 'Give kudos 👏'}
                variant="primary"
                disabled={givingKudos || !!kudos?.givenRecently}
                onPress={sendKudos}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={nudging ? 'Nudging…' : nudgeWait ? 'Nudged' : 'Nudge 👋'}
                variant="secondary"
                disabled={nudging || !!nudgeWait}
                onPress={nudge}
              />
            </View>
          </View>
          <Text style={styles.footNote}>
            {nudgeNote ?? nudgeWait ?? 'A nudge sends them a push to get moving — once a day.'}
          </Text>
        </Card>

        <Pressable onPress={confirmRemove} disabled={removing} style={styles.deleteRow}>
          <TrashIcon size={14} color={colors.amber} />
          <Text style={styles.deleteLabel}>{removing ? 'Removing…' : 'Remove friend'}</Text>
        </Pressable>
      </ScrollView>
      {gifting && hound && (
        <GiftSheet
          friendUserId={friendUserId}
          friendName={friendName}
          houndName={hound.name}
          hasPorch={!!yard?.porch}
          balance={myHound?.bonesBalance ?? null}
          onClose={() => setGifting(false)}
          onSent={(left) => {
            setGifting(false);
            setMyHound((h) => (h ? { ...h, bonesBalance: left } : h));
          }}
        />
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: FriendDetailStyles }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    houndCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
    yardCard: { gap: 10, padding: 12 },
    yardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    houndArt: {
      width: 92,
      height: 104,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.08),
      overflow: 'hidden',
    },
    houndRank: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
    houndRankText: { fontFamily: font.headingSemibold, fontSize: 12.5 },
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    headerName: { flex: 1, minWidth: 0 },
    statRow: { flexDirection: 'row', gap: 16 },
    cheerButtons: { flexDirection: 'row', gap: 10 },
    badgeHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
    badgeCell: { width: '25%', alignItems: 'center', gap: 5, paddingHorizontal: 2 },
    badge: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(color.gold, 0.16),
      borderWidth: 1,
      borderColor: withAlpha(color.gold, 0.5),
    },
    badgeName: { fontSize: 11, textAlign: 'center', color: withAlpha(colors.text, 0.75) },
    statTile: { flex: 1, gap: 4 },
    statLabel: { fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    statValue: { fontFamily: font.heading, fontSize: 24, color: colors.text },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    errorNote: { fontSize: 12.5, color: colors.amber },
    deleteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      marginTop: 4,
    },
    deleteLabel: { fontSize: 13, color: colors.amber, fontFamily: font.heading },
  });
}

type FriendDetailStyles = ReturnType<typeof makeStyles>;
