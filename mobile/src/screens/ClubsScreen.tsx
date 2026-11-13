import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BellSlashIcon, CaretRightIcon, FireIcon, MagnifyingGlassIcon, MegaphoneIcon, SparkleIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { CodeJoinCard } from '../components/CodeJoinCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  getClubStatus,
  getMyClubs,
  getMyClubInvites,
  acceptClubInvite,
  declineClubInvite,
  joinClub,
  listCommunityChallenges,
  searchClubs,
  type Club,
  type ClubInvite,
  type ClubSport,
  type ClubStatus,
  type CommunityListing,
} from '../clubs/clubsApi';
import { CLUB_SPORTS, ClubBadge, clubMeta } from '../clubs/clubLook';
import { ClubJoinCard } from '../clubs/ClubJoinCard';
import { confirmCommunityAge } from '../challenges/communityApi';
import { CLUB_USERNAME_WHY, useUsernameAsk } from '../profiles/UsernameAsk';
import { PackActivitiesCard } from '../packFun/PackActivitiesCard';
import { currentPackFuns, myPackFuns, type MyPackFun } from '../packFun/packFunApi';

// The Clubs tab (0185): your clubs and finding one, and community
// challenges (0152), which had no home of their own before.
export function ClubsScreen({
  onOpenClub,
  onStartClub,
  onOpenChallenge,
  onJoinCode,
  onPublish,
  onOpenPackFun,
  onStartPackFun,
}: {
  onOpenClub: (clubId: string) => void;
  onStartClub: () => void;
  onOpenChallenge: (challengeId: string) => void;
  // A community challenge's Join card, by its code.
  onJoinCode: (code: string) => void;
  onPublish: () => void;
  onOpenPackFun: (packId: string) => void;
  onStartPackFun: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [part, setPart] = useState<'clubs' | 'community'>('clubs');
  const [status, setStatus] = useState<ClubStatus | null>(null);
  const [mine, setMine] = useState<Club[] | null>(null);
  // 0187: clubs your friends invited you to.
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<ClubSport | null>(null);
  const [found, setFound] = useState<Club[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [community, setCommunity] = useState<{ featured: CommunityListing[]; popular: CommunityListing[] } | null>(null);
  const askUsername = useUsernameAsk();

  // Pack Activities on now or coming up: yours, and ones your clubs opened.
  const [packActivities, setPackActivities] = useState<MyPackFun[]>([]);

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    myPackFuns()
      .then((l) => setPackActivities(currentPackFuns(l)))
      .catch(() => {});
    Promise.all([getClubStatus(), getMyClubs()])
      .then(([s, m]) => {
        setStatus(s);
        setMine(m);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error && /my_club_status|my_clubs/.test(e.message) ? 'Clubs aren’t switched on yet.' : e instanceof Error ? e.message : 'Could not load your clubs.'),
      );
    getMyClubInvites()
      .then(setInvites)
      .catch(() => setInvites([]));
    listCommunityChallenges()
      .then(setCommunity)
      .catch(() => setCommunity({ featured: [], popular: [] }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Find a club: a moment after typing stops.
  useEffect(() => {
    if (!status?.searchOn) return;
    const t = setTimeout(() => {
      searchClubs(query, sport)
        .then(setFound)
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query, sport, status?.searchOn]);

  const startClub = () => {
    // No username yet: pick one here, then on to Start a club.
    if (status?.createProblem && /username/i.test(status.createProblem)) {
      askUsername('Clubs show usernames, not names. Pick one to start your club; friends still see your name.', () => {
        setStatus((s) => (s ? { ...s, createProblem: null } : s));
        onStartClub();
      });
      return;
    }
    if (status?.createProblem) {
      Alert.alert('Not yet', status.createProblem);
      return;
    }
    onStartClub();
  };

  const join = async (c: Club) => {
    if (c.role) {
      onOpenClub(c.id);
      return;
    }
    setJoiningId(c.id);
    try {
      await joinClub(c.id);
      onOpenClub(c.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Try again in a moment.';
      if (/13 or older/.test(msg)) {
        Alert.alert('Are you 13 or older?', 'Clubs are open to people you don’t know, so they’re for ages 13 and up.', [
          { text: 'No', style: 'cancel' },
          { text: 'I’m 13 or older', onPress: () => confirmCommunityAge().then(() => join(c)).catch(() => {}) },
        ]);
      } else if (/username/.test(msg)) {
        askUsername(CLUB_USERNAME_WHY, () => void join(c));
      } else {
        Alert.alert('Couldn’t join', msg);
      }
    } finally {
      setJoiningId(null);
    }
  };

  // Join from an invite, asking for a username or the 13+ check in place.
  const acceptInvite = async (c: ClubInvite) => {
    setAnswering(c.id);
    try {
      await acceptClubInvite(c.id);
      setInvites((list) => list.filter((x) => x.id !== c.id));
      onOpenClub(c.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Try again in a moment.';
      if (/13 or older/.test(msg)) {
        Alert.alert('Are you 13 or older?', 'Clubs are open to people you don’t know, so they’re for ages 13 and up.', [
          { text: 'No', style: 'cancel' },
          { text: 'I’m 13 or older', onPress: () => confirmCommunityAge().then(() => acceptInvite(c)).catch(() => {}) },
        ]);
      } else if (/username/.test(msg)) {
        askUsername(CLUB_USERNAME_WHY, () => void acceptInvite(c));
      } else {
        Alert.alert('Couldn’t join', msg);
      }
    } finally {
      setAnswering(null);
    }
  };

  const declineInvite = (c: ClubInvite) => {
    setInvites((list) => list.filter((x) => x.id !== c.id));
    declineClubInvite(c.id).catch(() => {});
  };

  const joinButton = (label: string, onPress: () => void, busy = false) => (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.join, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.joinText}>{label}</Text>}
    </Pressable>
  );

  const listing = (c: CommunityListing) => {
    const type = CHALLENGE_TYPES.find((t) => t.id === c.kind);
    const starts = new Date(c.startsAt);
    return (
      <View key={c.id} style={styles.row}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.rowName}>{c.name}</Text>
          <Text style={styles.rowMeta} numberOfLines={2}>
            {type?.name ?? c.kind} · {c.durationDays} days ·{' '}
            {starts > new Date() ? `starts ${starts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'on now'}
          </Text>
          <Text style={styles.rowSub}>
            {c.players} joined{c.creator ? ` · by @${c.creator}` : ''}
          </Text>
        </View>
        {c.joined ? (
          <Pressable onPress={() => onOpenChallenge(c.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${c.name}`}>
            <CaretRightIcon size={16} color={withAlpha(colors.text, 0.45)} />
          </Pressable>
        ) : (
          joinButton('Join', () => onJoinCode(c.code))
        )}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <SegmentedControl
        options={[
          { value: 'clubs', label: 'Clubs' },
          { value: 'community', label: 'Community challenges' },
        ]}
        value={part}
        onChange={setPart}
      />

      {part === 'clubs' && (
        <>
          <PackActivitiesCard list={packActivities} onOpen={onOpenPackFun} onStart={onStartPackFun} />
          {invites.length > 0 && (
            <Card style={[{ gap: 0 }, styles.featured]} elevated={false}>
              <Text style={[styles.kicker, { color: colors.accentActive }]}>CLUB INVITES</Text>
              {invites.map((c) => (
                <View key={c.id} style={styles.row}>
                  <ClubBadge sport={c.sport} color={c.color} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName}>{c.name}</Text>
                    <Text style={styles.rowMeta}>
                      {c.invitedBy ? `${c.invitedBy} invited you · ` : ''}
                      {clubMeta(c)}
                    </Text>
                    <View style={styles.inviteButtons}>
                      {joinButton('Join', () => acceptInvite(c), answering === c.id)}
                      <Pressable onPress={() => declineInvite(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`No thanks to ${c.name}`}>
                        <Text style={styles.decline}>No thanks</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          )}
          {error ? (
            <Card elevated={false}>
              <Text style={styles.note}>{error}</Text>
            </Card>
          ) : !mine ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Card style={{ gap: 0 }} elevated={false}>
              <View style={styles.head}>
                <Text style={styles.kicker}>YOUR CLUBS</Text>
                <Pressable onPress={startClub} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>+ Start a club</Text>
                </Pressable>
              </View>
              {mine.length === 0 ? (
                <Text style={[styles.note, { paddingTop: 8 }]}>
                  No clubs yet. Find one below, use a club&rsquo;s code, or start your own: a run club, a cycling group, the
                  Saturday walkers.
                </Text>
              ) : (
                mine.map((c) => (
                  <Pressable key={c.id} onPress={() => onOpenClub(c.id)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]} accessibilityRole="button">
                    <ClubBadge sport={c.sport} color={c.color} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.rowName}>{c.name}</Text>
                      <Text style={styles.rowMeta}>
                        {clubMeta(c)}
                        {c.role === 'owner' ? ' · owner' : c.role === 'organizer' ? ' · organizer' : ''}
                      </Text>
                      {(c.fresh > 0 || c.open > 0) && (
                        <Text style={styles.news}>
                          {c.fresh > 0 ? `${c.fresh} new ${c.fresh === 1 ? 'challenge' : 'challenges'}` : `${c.open} open ${c.open === 1 ? 'challenge' : 'challenges'}`}
                        </Text>
                      )}
                    </View>
                    {c.muted && <BellSlashIcon size={14} color={withAlpha(colors.text, 0.4)} />}
                    {c.fresh > 0 && (
                      <View style={styles.dot}>
                        <Text style={styles.dotText}>{c.fresh}</Text>
                      </View>
                    )}
                    <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
                  </Pressable>
                ))
              )}
            </Card>
          )}

          {status?.searchOn && (
            <Card style={{ gap: 10 }} elevated={false}>
              <Text style={styles.kicker}>FIND A CLUB</Text>
              <View style={styles.search}>
                <MagnifyingGlassIcon size={16} color={withAlpha(colors.text, 0.5)} />
                <TextInput
                  maxFontSizeMultiplier={1.3}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Name or city"
                  placeholderTextColor={withAlpha(colors.text, 0.45)}
                  style={styles.searchInput}
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
              <View style={styles.chips}>
                {CLUB_SPORTS.map(({ id, name, Icon }) => {
                  const on = sport === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setSport(on ? null : id)}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Icon size={13} color={on ? colors.accentActive : colors.text} />
                      <Text style={[styles.chipText, on && { color: colors.accentActive }]}>{name}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {found === null ? (
                <ActivityIndicator color={colors.accent} />
              ) : found.length === 0 ? (
                <Text style={styles.note}>{query || sport ? 'No public clubs match. Try another name or city.' : 'No public clubs yet. Start the first one!'}</Text>
              ) : (
                found.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <ClubBadge sport={c.sport} color={c.color} size={36} />
                    <Pressable style={{ flex: 1, gap: 2 }} onPress={() => onOpenClub(c.id)} accessibilityRole="button">
                      <Text style={styles.rowName}>{c.name}</Text>
                      <Text style={styles.rowMeta}>{clubMeta(c)}</Text>
                    </Pressable>
                    {joinButton(c.role ? 'Open' : 'Join', () => join(c), joiningId === c.id)}
                  </View>
                ))
              )}
            </Card>
          )}

          <ClubJoinCard onJoined={onOpenClub} />
          <View style={styles.hintRow}>
            <BellSlashIcon size={13} color={withAlpha(colors.text, 0.5)} />
            <Text style={styles.hint}>Each club&rsquo;s pushes can be turned off on its page.</Text>
          </View>
        </>
      )}

      {part === 'community' && (
        <>
          {!community ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              {community.featured.length > 0 && (
                <Card style={[{ gap: 0 }, styles.featured]} elevated={false}>
                  <View style={styles.kickRow}>
                    <SparkleIcon size={14} color={colors.accentActive} weight="fill" />
                    <Text style={[styles.kicker, { color: colors.accentActive }]}>FEATURED BY HOUND</Text>
                  </View>
                  {community.featured.map(listing)}
                </Card>
              )}
              {status?.communityListOn !== false && (
                <Card style={{ gap: 0 }} elevated={false}>
                  <View style={styles.kickRow}>
                    <FireIcon size={14} color={colors.amber} weight="fill" />
                    <Text style={styles.kicker}>POPULAR THIS WEEK</Text>
                  </View>
                  {community.popular.length === 0 ? (
                    <Text style={[styles.note, { paddingTop: 8 }]}>Nothing popular yet. Community challenges show here once a few people join.</Text>
                  ) : (
                    community.popular.map(listing)
                  )}
                </Card>
              )}
            </>
          )}
          <CodeJoinCard onJoined={onOpenChallenge} />
          <Pressable onPress={onPublish} style={({ pressed }) => [styles.publish, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <MegaphoneIcon size={22} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>Publish your own</Text>
              <Text style={styles.rowMeta}>Anyone with its code can join. Pick &ldquo;Anyone with the code&rdquo; when you make it.</Text>
            </View>
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    kicker: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    kickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    link: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accentActive },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    rowName: { fontFamily: font.heading, fontSize: 15.5, color: colors.text },
    rowMeta: { fontSize: 12.5, color: withAlpha(colors.text, 0.62) },
    rowSub: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    news: { fontFamily: font.headingSemibold, fontSize: 12, color: colors.accentActive },
    dot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#e5484d', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    dotText: { color: '#fff', fontSize: 11, fontFamily: font.headingSemibold },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.divider, borderRadius: 10, paddingHorizontal: 10 },
    searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 9 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: colors.divider },
    chipOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.16) },
    chipText: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.text },
    join: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, minWidth: 56, alignItems: 'center' },
    joinText: { color: '#fff', fontFamily: font.headingSemibold, fontSize: 13 },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
    hint: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    featured: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.35) },
    inviteButtons: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
    decline: { fontFamily: font.headingSemibold, fontSize: 13, color: withAlpha(colors.text, 0.55) },
    publish: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.surface },
  });
}
