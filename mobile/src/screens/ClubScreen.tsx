import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeftIcon, BellIcon, BellSlashIcon, DotsThreeIcon, LockSimpleIcon, MapPinIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { Tag } from '../components/Tag';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { localDayKey } from '../water/water';
import { codeLink, confirmCommunityAge } from '../challenges/communityApi';
import {
  getClubPage,
  joinClub,
  joinClubChallenge,
  leaveClub,
  newClubCode,
  removeClubMember,
  removeClubPost,
  setClubMuted,
  setClubRole,
  type ClubChallenge,
  type ClubMember,
  type ClubPage,
} from '../clubs/clubsApi';
import { CLUB_COLORS, ClubBadge, sportName } from '../clubs/clubLook';
import { formatClubCode } from '../clubs/ClubJoinCard';
import { ClubInviteFriends } from '../clubs/ClubInviteFriends';
import { CLUB_USERNAME_WHY, useUsernameAsk } from '../profiles/UsernameAsk';
import { PackActivitiesCard } from '../packFun/PackActivitiesCard';
import { currentPackFuns, myPackFuns, type MyPackFun } from '../packFun/packFunApi';

// This week's Monday, on the phone.
function weekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDayKey(d);
}

const mi = (n: number) => `${n.toFixed(n >= 100 ? 0 : 1)} mi`;

// A club's page (0185): what's on to join, how the club's doing this
// week, and who's in it. Someone not in a public club sees enough to
// decide, and a Join button.
export function ClubScreen({
  clubId,
  onBack,
  onOpenChallenge,
  onPostChallenge,
  onStartPackFun,
  onOpenPackFun,
  onEdit,
}: {
  clubId: string;
  onBack: () => void;
  onOpenChallenge: (challengeId: string) => void;
  onPostChallenge: () => void;
  onStartPackFun?: () => void;
  onOpenPackFun?: (packId: string) => void;
  onEdit: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [club, setClub] = useState<ClubPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const askUsername = useUsernameAsk();

  // This club's Pack Activities, on now or coming up.
  const [packActivities, setPackActivities] = useState<MyPackFun[]>([]);
  const load = useCallback(() => {
    myPackFuns()
      .then((l) => setPackActivities(currentPackFuns(l).filter((p) => p.clubId === clubId)))
      .catch(() => {});
    getClubPage(clubId, weekStart())
      .then((c) => {
        setClub(c);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the club.'));
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const member = !!club?.role;
  const organizer = club?.role === 'owner' || club?.role === 'organizer';

  const asks = (msg: string, retry: () => void) => {
    if (/13 or older/.test(msg)) {
      Alert.alert('Are you 13 or older?', 'Clubs are open to people you don’t know, so they’re for ages 13 and up.', [
        { text: 'No', style: 'cancel' },
        { text: 'I’m 13 or older', onPress: () => confirmCommunityAge().then(retry).catch(() => {}) },
      ]);
    } else if (/username/.test(msg)) {
      askUsername(CLUB_USERNAME_WHY, retry);
    } else {
      Alert.alert('Couldn’t do that', msg);
    }
  };

  const join = async () => {
    setBusy('join');
    try {
      await joinClub(clubId);
      load();
    } catch (e) {
      asks(e instanceof Error ? e.message : 'Try again.', join);
    } finally {
      setBusy(null);
    }
  };

  const joinChallenge = async (c: ClubChallenge) => {
    if (c.joined) {
      onOpenChallenge(c.id);
      return;
    }
    setBusy(c.id);
    try {
      await joinClubChallenge(clubId, c.id);
      onOpenChallenge(c.id);
    } catch (e) {
      Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again.');
      load();
    } finally {
      setBusy(null);
    }
  };

  const toggleMute = () => {
    if (!club) return;
    const next = !club.muted;
    setClub({ ...club, muted: next });
    setClubMuted(clubId, next).catch(() => setClub({ ...club, muted: !next }));
  };

  const shareInvite = () => {
    if (!club?.code) return;
    Share.share({
      message: `Join ${club.name} on Hound: ${codeLink(club.code)} (or enter club code ${formatClubCode(club.code)} on the Clubs tab)`,
    }).catch(() => {});
  };

  const more = () => {
    if (!club) return;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (organizer) {
      buttons.push({ text: 'Edit the club', onPress: onEdit });
      buttons.push({
        text: 'Get a new code',
        onPress: () =>
          newClubCode(clubId)
            .then(() => load())
            .catch((e) => Alert.alert('Couldn’t change the code', e instanceof Error ? e.message : 'Try again.')),
      });
    }
    buttons.push({
      text: 'Leave the club',
      style: 'destructive',
      onPress: () =>
        Alert.alert(
          `Leave ${club.name}?`,
          club.role === 'owner'
            ? 'The club passes to the longest-standing organizer (or member). If you’re the last one in, it closes.'
            : 'You can join again later.',
          [
            { text: 'Stay', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => leaveClub(clubId).then(onBack).catch(() => {}) },
          ],
        ),
    });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(club.name, undefined, buttons);
  };

  const memberActions = (m: ClubMember) => {
    if (!club || m.me || m.role === 'owner' || !organizer) return;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (club.role === 'owner') {
      buttons.push(
        m.role === 'organizer'
          ? { text: 'Make a member', onPress: () => setClubRole(clubId, m.userId, 'member').then(load).catch(() => {}) }
          : { text: 'Make an organizer', onPress: () => setClubRole(clubId, m.userId, 'organizer').then(load).catch(() => {}) },
      );
    }
    if (club.role === 'owner' || m.role === 'member') {
      buttons.push({
        text: 'Remove from the club',
        style: 'destructive',
        onPress: () => removeClubMember(clubId, m.userId).then(load).catch((e) => Alert.alert('Couldn’t remove them', e instanceof Error ? e.message : '')),
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(m.name, m.role === 'organizer' ? 'Organizer' : 'Member', buttons);
  };

  const takeDown = (c: ClubChallenge) => {
    if (!c.postedByMe && !organizer) return;
    Alert.alert('Take it off the club?', `${c.name} stays as it is; it just won’t show here.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Take it off', style: 'destructive', onPress: () => removeClubPost(clubId, c.id).then(load).catch(() => {}) },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View style={styles.bar}>
        <Button label="Clubs" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <View style={{ flex: 1 }} />
        {member && (
          <Pressable onPress={toggleMute} hitSlop={8} style={styles.barIcon} accessibilityRole="button" accessibilityLabel={club?.muted ? 'Turn this club’s pushes on' : 'Mute this club’s pushes'}>
            {club?.muted ? <BellSlashIcon size={20} color={withAlpha(colors.text, 0.6)} /> : <BellIcon size={20} color={colors.text} />}
          </Pressable>
        )}
        {member && (
          <Pressable onPress={more} hitSlop={8} style={styles.barIcon} accessibilityRole="button" accessibilityLabel="More">
            <DotsThreeIcon size={22} color={colors.text} weight="bold" />
          </Pressable>
        )}
      </View>
      {error ? (
        <View style={styles.container}>
          <Card elevated={false}>
            <Text style={styles.note}>{error}</Text>
          </Card>
        </View>
      ) : !club ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.hero}>
            <ClubBadge sport={club.sport} color={club.color} size={58} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[text.h2, { fontSize: 23 }]}>{club.name}</Text>
              <View style={styles.metaRow}>
                {club.city ? <MapPinIcon size={12} color={withAlpha(colors.text, 0.55)} /> : null}
                <Text style={styles.meta}>
                  {[sportName(club.sport), club.city, `${club.members} ${club.members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {!club.isPublic && (
                <View style={styles.metaRow}>
                  <LockSimpleIcon size={12} color={withAlpha(colors.text, 0.55)} />
                  <Text style={styles.meta}>Private: joined with its code</Text>
                </View>
              )}
            </View>
          </View>
          {club.description ? <Text style={styles.desc}>{club.description}</Text> : null}

          {!member ? (
            <Card style={{ gap: 10 }} elevated={false}>
              <Text style={styles.note}>
                {club.openNames.length > 0
                  ? `On now: ${club.openNames.slice(0, 3).join(', ')}${club.openNames.length > 3 ? ` and ${club.openNames.length - 3} more` : ''}. Join to see them and take part.`
                  : 'Join to see the club’s challenges and take part.'}
              </Text>
              {club.problem && club.problem !== 'age' && club.problem !== 'username' ? (
                <Text style={styles.warn}>{club.problem}</Text>
              ) : (
                <Button label={busy === 'join' ? 'Joining…' : 'Join the club'} variant="primary" disabled={busy === 'join'} onPress={join} />
              )}
            </Card>
          ) : (
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label="Post a challenge" variant="primary" small onPress={onPostChallenge} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={inviteOpen ? 'Hide invite' : 'Invite'} variant="secondary" small onPress={() => setInviteOpen((o) => !o)} />
              </View>
            </View>
          )}
          {member && onStartPackFun && onOpenPackFun && (
            <PackActivitiesCard
              list={packActivities}
              onOpen={onOpenPackFun}
              onStart={onStartPackFun}
              startLabel="Start one with the club"
              showClub={false}
              emptyNote="Heading out together? Start a Pack Activity for the club: everyone gets a push to join."
            />
          )}

          {member && inviteOpen && club.code && (
            <Card style={styles.invite} elevated={false}>
              <View style={styles.qr}>
                <QRCode value={codeLink(club.code)} size={96} color="#161826" backgroundColor="#ffffff" quietZone={0} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.kicker}>CLUB CODE</Text>
                <Text style={styles.code}>{formatClubCode(club.code)}</Text>
                <Text style={styles.note}>Scan it, or enter it on the Clubs tab.</Text>
                <Button label="Share the link" variant="secondary" small onPress={shareInvite} />
              </View>
            </Card>
          )}
          {/* 0187: straight from your friends list, private clubs too. */}
          {member && inviteOpen && <ClubInviteFriends clubId={club.id} clubName={club.name} />}

          <Card style={{ gap: 8 }} elevated={false}>
            <View style={styles.head}>
              <Text style={styles.kicker}>THIS WEEK TOGETHER</Text>
              <Text style={styles.side}>Last week {mi(club.week.lastMi)}</Text>
            </View>
            <Text style={styles.big}>{mi(club.week.mi)}</Text>
            <Text style={styles.meta}>
              by {club.week.people} {club.week.people === 1 ? 'member' : 'members'}
              {club.week.lastMi > 0 ? ` · ${club.week.mi >= club.week.lastMi ? 'up' : 'down'} ${Math.round((Math.abs(club.week.mi - club.week.lastMi) / club.week.lastMi) * 100)}% on last week` : ''}
            </Text>
            <View style={styles.meter}>
              <View
                style={[
                  styles.meterFill,
                  { width: `${Math.min(100, club.week.lastMi > 0 ? (club.week.mi / club.week.lastMi) * 100 : club.week.mi > 0 ? 100 : 0)}%`, backgroundColor: CLUB_COLORS[club.color] },
                ]}
              />
            </View>
            {member && club.top.length > 0 && (
              <Text style={styles.meta}>Most this week: {club.top.map((t) => `${t.me ? 'You' : t.name} ${t.mi.toFixed(1)}`).join(' · ')}</Text>
            )}
          </Card>

          {member && (
            <Card style={{ gap: 0 }} elevated={false}>
              <Text style={styles.kicker}>OPEN CHALLENGES</Text>
              {club.challenges.length === 0 ? (
                <Text style={[styles.note, { paddingTop: 8 }]}>
                  Nothing posted yet. Start a challenge and share it with the club (or tap Post a challenge).
                </Text>
              ) : (
                club.challenges.map((c) => {
                  const type = CHALLENGE_TYPES.find((t) => t.id === c.kind);
                  const starts = new Date(c.startsAt);
                  return (
                    <Pressable key={c.id} onLongPress={() => takeDown(c)} onPress={() => c.joined && onOpenChallenge(c.id)} style={styles.row}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <View style={styles.nameRow}>
                          <Text style={styles.rowName}>{c.name}</Text>
                          <Tag label={type?.name ?? c.kind} />
                        </View>
                        <Text style={styles.meta}>
                          {c.durationDays} days · {starts > new Date() ? `starts ${starts.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'on now'}
                        </Text>
                        <View style={styles.nameRow}>
                          <View style={{ flexDirection: 'row' }}>
                            {c.faces.map((f, i) => (
                              <View key={i} style={[styles.face, i > 0 && { marginLeft: -6 }]}>
                                <Avatar initials={f.initials} tint={TINT_N} size={20} fontSize={8} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                              </View>
                            ))}
                          </View>
                          <Text style={styles.sub}>
                            {c.clubPlayers} from the club · {c.players} in all{c.postedBy ? ` · posted by ${c.postedByMe ? 'you' : c.postedBy}` : ''}
                          </Text>
                        </View>
                      </View>
                      {c.joined ? (
                        <Text style={styles.joined}>Joined</Text>
                      ) : (
                        <Pressable onPress={() => joinChallenge(c)} disabled={busy === c.id} style={({ pressed }) => [styles.join, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Join ${c.name}`}>
                          {busy === c.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.joinText}>Join</Text>}
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })
              )}
            </Card>
          )}

          {member && (
            <Card style={{ gap: 10 }} elevated={false}>
              <View style={styles.head}>
                <Text style={styles.kicker}>MEMBERS</Text>
                <Text style={styles.side}>{club.members}</Text>
              </View>
              <View style={styles.members}>
                {club.memberList.map((m) => (
                  <Pressable key={m.userId} onPress={() => memberActions(m)} style={styles.member} accessibilityRole="button" accessibilityLabel={m.name}>
                    <Avatar initials={m.initials} tint={m.me ? TINT_A : TINT_N} size={34} fontSize={11} frameId={m.frameId} backgroundId={m.backgroundId} iconId={m.iconId} />
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.me ? 'You' : m.name}
                    </Text>
                    {m.role !== 'member' && <Text style={styles.role}>{m.role === 'owner' ? 'Owner' : 'Organizer'}</Text>}
                  </Pressable>
                ))}
              </View>
              {organizer && <Text style={styles.sub}>Tap someone to make them an organizer or remove them.</Text>}
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, gap: 6 },
    barIcon: { padding: 6 },
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    meta: { fontSize: 12.5, color: withAlpha(colors.text, 0.62) },
    desc: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.8) },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    warn: { fontSize: 13, color: colors.amber },
    actions: { flexDirection: 'row', gap: 8 },
    invite: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    qr: { padding: 8, borderRadius: 12, backgroundColor: '#ffffff' },
    code: { fontFamily: font.heading, fontSize: 22, letterSpacing: 2, color: colors.text },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    side: { fontFamily: font.headingSemibold, fontSize: 12, color: withAlpha(colors.text, 0.6) },
    big: { fontFamily: font.heading, fontSize: 28, color: colors.text },
    meter: { height: 8, borderRadius: 4, backgroundColor: withAlpha(colors.text, 0.08), overflow: 'hidden' },
    meterFill: { height: 8, borderRadius: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    rowName: { fontFamily: font.heading, fontSize: 15.5, color: colors.text },
    sub: { fontSize: 12, color: withAlpha(colors.text, 0.58), flexShrink: 1 },
    face: { borderRadius: 12, borderWidth: 1.5, borderColor: colors.surface },
    join: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, minWidth: 56, alignItems: 'center' },
    joinText: { color: '#fff', fontFamily: font.headingSemibold, fontSize: 13 },
    joined: { fontFamily: font.headingSemibold, fontSize: 12.5, color: colors.green },
    members: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    member: { width: 64, alignItems: 'center', gap: 3 },
    memberName: { fontSize: 11.5, color: colors.text, maxWidth: 64 },
    role: { fontSize: 10, fontFamily: font.headingSemibold, color: colors.accentActive },
  });
}
