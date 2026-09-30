import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Share, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import {
  AndroidLogoIcon,
  AppleLogoIcon,
  CaretRightIcon,
  EnvelopeSimpleIcon,
  HourglassIcon,
  QrCodeIcon,
  UserPlusIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { LoadingView } from '../components/LoadingView';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { FRIENDS } from '../data/sampleData';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import { friendCodeUrl, type Friend } from '../friends/types';
import { feedAction, getFriendActivityFeed, groupFeed, timeAgo, type FeedItem } from '../friends/activityFeed';
import { useLabels } from '../labels/LabelsContext';
import { useAuth } from '../auth/AuthContext';
import { FindPeopleCard } from '../components/FindPeopleCard';
import { getDiscoveryConfig, inviteMessage, type DiscoveryConfig } from '../friends/discovery';

type AddMode = 'email' | 'myCode' | 'enterCode';

// The three ways to add someone, always on screen as tiles — the viewer
// picks one and only that one's panel opens.
const ADD_OPTIONS: { id: AddMode; label: string; Icon: typeof UserPlusIcon }[] = [
  { id: 'email', label: 'Invite by email', Icon: EnvelopeSimpleIcon },
  { id: 'myCode', label: 'Share my code', Icon: QrCodeIcon },
  { id: 'enterCode', label: 'Enter a code', Icon: UserPlusIcon },
];

// Fixed row height so the list box can cap itself at exactly
// MAX_VISIBLE_FRIENDS rows and scroll past that.
const FRIEND_ROW_HEIGHT = 52;
const MAX_VISIBLE_FRIENDS = 10;
// The feed shows the most recent few; older items live on in each
// friend's own profile (badges) and the challenge results themselves.
const MAX_FEED_ITEMS = 8;

export function FriendsScreen({ onOpenFriend }: { onOpenFriend: (friend: Friend) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // null = still showing the sample fallback (either Supabase isn't
  // configured, or the real fetch hasn't resolved yet); once set, it
  // fully replaces the sample list — same "never break the screen, just
  // fall back" convention as ChallengesScreen.
  const [liveFriends, setLiveFriends] = useState<Friend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which add-a-friend panel is open, if any — nothing opens until the
  // viewer picks an option tile.
  const [addMode, setAddMode] = useState<AddMode | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);

  // Friend activity (0073_friend_activity_feed.sql). null = not loaded,
  // or couldn't be — the card just stays hidden rather than erroring.
  const { user } = useAuth();
  const { labelsForOrg } = useLabels();
  const labels = labelsForOrg(user?.organizationId);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  // Admin → Find people (0080). Null until loaded, or before 0080 runs —
  // the Find people card stays hidden either way.
  const [discovery, setDiscovery] = useState<DiscoveryConfig | null>(null);
  // Feed rows the viewer has already cheered this session.
  const [cheered, setCheered] = useState<Set<string>>(new Set());
  const cheer = async (item: FeedItem) => {
    setCheered((cur) => new Set(cur).add(item.id));
    try {
      await supabaseFriendsProvider.giveKudos(item.userId);
    } catch {
      setCheered((cur) => {
        const next = new Set(cur);
        next.delete(item.id);
        return next;
      });
    }
  };

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [friends, code] = await Promise.all([
        supabaseFriendsProvider.listFriends(),
        supabaseFriendsProvider.getMyFriendCode(),
      ]);
      setLiveFriends(friends);
      setMyCode(code);
      getFriendActivityFeed()
        .then((events) => setFeed(groupFeed(events).slice(0, MAX_FEED_ITEMS)))
        .catch(() => setFeed(null));
      getDiscoveryConfig().then(setDiscovery);
    } catch {
      // Stay on the sample fallback on any failure — this screen never
      // shows an error state for the list itself, it just quietly
      // doesn't upgrade.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvite = async () => {
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);
    try {
      await supabaseFriendsProvider.inviteByEmail(inviteEmail);
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}.`);
      setInviteEmail('');
      await load();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Could not send that invite — try again.');
    } finally {
      setInviting(false);
    }
  };

  const copyMyLink = async () => {
    if (!myCode) return;
    await Clipboard.setStringAsync(friendCodeUrl(myCode));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareMyLink = () => {
    if (!myCode) return;
    Share.share({ message: inviteMessage(myCode) }).catch(() => {});
  };

  const redeemCode = async () => {
    setRedeemError(null);
    setRedeemSuccess(null);
    setRedeeming(true);
    try {
      await supabaseFriendsProvider.addFriendByCode(redeemInput);
      setRedeemSuccess("You're now friends!");
      setRedeemInput('');
      await load();
    } catch (e) {
      setRedeemError(e instanceof Error ? e.message : 'Could not add that — try again.');
    } finally {
      setRedeeming(false);
    }
  };

  const respond = async (friendshipId: string, action: 'accept' | 'remove') => {
    setBusyId(friendshipId);
    try {
      if (action === 'accept') await supabaseFriendsProvider.acceptFriendRequest(friendshipId);
      else await supabaseFriendsProvider.removeFriendship(friendshipId);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (liveFriends === null) {
    // A real backend exists but its first fetch hasn't resolved yet —
    // same "one real spinner, then never again" shape as ChallengesScreen's
    // own challengesLoading. Every tab switch away from Friends unmounts
    // this screen (MainScreen only renders the active tab), so without
    // this, coming back always re-ran load() and, for that first instant,
    // showed the sample fallback below instead of a loading state — easy
    // to mistake for real data.
    if (isSupabaseConfigured) {
      return (
        <View style={styles.loadingScreen}>
          <LoadingView />
        </View>
      );
    }

    // No backend configured at all — there's no fetch to wait on, so
    // this goes straight to the honest sample fallback instead of
    // spinning forever.
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={text.h2}>Friends</Text>

        <Card style={styles.inviteCard} elevated={false}>
          <UserPlusIcon size={17} color={colors.accentActive} />
          <Text style={styles.inviteText}>Send one link. It works on iPhone and Android.</Text>
          <Text style={styles.inviteLink}>hound.app/u/jordan</Text>
          <Button label="Copy" variant="primary" small />
        </Card>

        {FRIENDS.map((f) => (
          <Card key={f.name} style={styles.friendRow} elevated={false}>
            <Avatar initials={f.initials} tint={f.tint} />
            <View style={{ flex: 1, gap: 2, minWidth: 120 }}>
              <Text style={styles.friendName}>{f.name}</Text>
              <Text style={styles.friendSub}>{f.sub}</Text>
            </View>
            <View style={styles.platformBadge}>
              {f.platform === 'Apple Health' ? (
                <AppleLogoIcon size={12} color={colors.neutral200} weight="fill" />
              ) : (
                <AndroidLogoIcon size={12} color={colors.neutral200} />
              )}
              <Text style={styles.platformText}>{f.platform}</Text>
            </View>
            <View style={styles.syncRow}>
              <View style={[styles.dot, { backgroundColor: f.syncColor }]} />
              <Text style={[styles.syncText, { color: f.syncColor }]}>{f.sync}</Text>
            </View>
            <Button label="Challenge" small />
          </Card>
        ))}

        <Text style={styles.pendingLabel}>Pending</Text>
        <Card style={styles.pendingRow} elevated={false}>
          <View style={styles.pendingAvatar}>
            <HourglassIcon size={15} color={colors.neutral500} />
          </View>
          <Text style={styles.pendingEmail}>kate.n@gmail.com</Text>
          <Text style={styles.pendingMeta}>Invited 3 days ago</Text>
          <Button label="Resend" variant="ghost" small />
        </Card>
      </ScrollView>
    );
  }

  const accepted = liveFriends
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => a.name.localeCompare(b.name));
  const receivedInvites = liveFriends.filter((f) => f.status === 'pending' && !f.requestedByMe);
  const sentInvites = liveFriends.filter((f) => f.status === 'pending' && f.requestedByMe);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Friends</Text>

      {/* Ahead of every invite/QR/code card below — a friend request is
          the one thing here that actually needs a response from someone
          else, so it shouldn't be buried under UI the viewer doesn't
          need to touch just to accept or decline one. */}
      {receivedInvites.length > 0 && (
        <>
          <Text style={styles.pendingLabel}>Friend requests</Text>
          {receivedInvites.map((f) => (
            <Card key={f.friendshipId} style={styles.pendingRow} elevated={false}>
              <Avatar initials={f.initials} tint={TINT_A} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
              <Text style={styles.friendName}>{f.name}</Text>
              <Text style={styles.pendingMeta}>wants to be friends</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button
                  label="Accept"
                  variant="primary"
                  small
                  disabled={busyId === f.friendshipId}
                  onPress={() => respond(f.friendshipId, 'accept')}
                />
                <Button
                  label="Decline"
                  small
                  disabled={busyId === f.friendshipId}
                  onPress={() => respond(f.friendshipId, 'remove')}
                />
              </View>
            </Card>
          ))}
        </>
      )}

      {discovery && (
        <FindPeopleCard
          searchEnabled={discovery.searchEnabled}
          suggestionsEnabled={discovery.suggestionsEnabled}
          onChanged={load}
        />
      )}

      {/* Every way to add someone is one tap away, side by side — the
          options themselves are always visible, and only the one actually
          picked opens its panel below, rather than all three hiding behind
          a single collapsed header. */}
      <Card style={{ gap: 12 }} elevated={false}>
        <View style={{ gap: 2 }}>
          <Text style={styles.sectionTitle}>Enjoy with Friends</Text>
          <Text style={styles.footNote}>Pick how you want to connect.</Text>
        </View>
        <View style={styles.optionRow}>
          {ADD_OPTIONS.map(({ id, label, Icon }) => {
            const on = addMode === id;
            return (
              <Pressable
                key={id}
                onPress={() => setAddMode(on ? null : id)}
                style={[styles.optionTile, on && styles.optionTileOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Icon size={20} color={colors.accentActive} weight={on ? 'fill' : 'regular'} />
                <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {addMode === 'email' && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TextField
                label="Their email"
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="friend@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                style={{ flex: 1 }}
              />
              <View style={styles.inlineAction}>
                <Button
                  label={inviting ? 'Sending…' : 'Send'}
                  variant="primary"
                  small
                  disabled={inviting || !inviteEmail.trim()}
                  onPress={sendInvite}
                />
              </View>
            </View>
            {inviteError && <Text style={styles.errorNote}>{inviteError}</Text>}
            {inviteSuccess && !inviteError && <Text style={styles.successNote}>{inviteSuccess}</Text>}
          </View>
        )}

        {addMode === 'myCode' && (
          <View style={{ gap: 12 }}>
            {myCode && (
              <View style={styles.qrWrap}>
                <QRCode value={friendCodeUrl(myCode)} size={140} color={colors.text} backgroundColor={colors.surface} />
              </View>
            )}
            <Text style={[styles.inviteLink, { textAlign: 'center' }]}>{myCode ? friendCodeUrl(myCode) : '—'}</Text>
            {myCode && (
              <Text style={[styles.footNote, { textAlign: 'center' }]}>
                Your code: <Text style={styles.codeText}>{myCode}</Text>. The link helps friends without Hound get the
                beta first, then add you.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
              <Button label={copied ? 'Copied!' : 'Copy link'} small disabled={!myCode} onPress={copyMyLink} />
              <Button label="Share" variant="primary" small disabled={!myCode} onPress={shareMyLink} />
            </View>
          </View>
        )}

        {addMode === 'enterCode' && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <TextField
                label="Friend's code or link"
                value={redeemInput}
                onChangeText={setRedeemInput}
                placeholder="e.g. Ab3xK9pQ"
                autoCapitalize="none"
                style={{ flex: 1 }}
              />
              <View style={styles.inlineAction}>
                <Button
                  label={redeeming ? 'Adding…' : 'Add'}
                  variant="primary"
                  small
                  disabled={redeeming || !redeemInput.trim()}
                  onPress={redeemCode}
                />
              </View>
            </View>
            {redeemError && <Text style={styles.errorNote}>{redeemError}</Text>}
            {redeemSuccess && !redeemError && <Text style={styles.successNote}>{redeemSuccess}</Text>}
          </View>
        )}
      </Card>

      {/* One card, one scroll box — at most MAX_VISIBLE_FRIENDS rows tall,
          scrolling within itself past that, so a long friend list never
          pushes Pending (below) off the page. */}
      <Card style={{ gap: 8 }} elevated={false}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Friends</Text>
          {accepted.length > 0 && <Text style={styles.footNote}>{accepted.length}</Text>}
        </View>
        {accepted.length === 0 ? (
          <Text style={styles.footNote}>No friends yet — pick an option above to add someone.</Text>
        ) : (
          <ScrollView style={{ maxHeight: FRIEND_ROW_HEIGHT * MAX_VISIBLE_FRIENDS }} nestedScrollEnabled>
            {accepted.map((f, i) => (
              <Pressable
                key={f.friendshipId}
                onPress={() => onOpenFriend(f)}
                style={[styles.friendListRow, i > 0 && styles.friendListRowDivider]}
              >
                <Avatar initials={f.initials} tint={TINT_N} frameId={f.frameId} backgroundId={f.backgroundId} iconId={f.iconId} />
                <Text style={[styles.friendName, { flex: 1 }]} numberOfLines={1}>
                  {f.name}
                </Text>
                <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
              </Pressable>
            ))}
          </ScrollView>
        )}
        {accepted.length > MAX_VISIBLE_FRIENDS && (
          <Text style={styles.footNote}>Scroll to see all {accepted.length}.</Text>
        )}
      </Card>

      {/* Recent highlights from friends — wins and unlocked badges.
          Tap a row to open that friend; 👏 sends them kudos. */}
      {accepted.length > 0 && feed !== null && (
        <Card style={{ gap: 4 }} elevated={false}>
          <Text style={styles.sectionTitle}>Friend activity</Text>
          {feed.length === 0 ? (
            <Text style={[styles.footNote, { paddingVertical: 4 }]}>
              Nothing new yet — when friends win challenges or unlock achievements, it shows up here.
            </Text>
          ) : (
            feed.map((item, i) => {
              const friend = accepted.find((f) => f.userId === item.userId);
              const sent = cheered.has(item.id);
              return (
                <View key={item.id} style={[styles.feedRow, i > 0 && styles.friendListRowDivider]}>
                  <Pressable
                    style={styles.feedMain}
                    disabled={!friend}
                    onPress={() => friend && onOpenFriend(friend)}
                  >
                    {/* Fixed-width slot so rows with and without a frame
                        (which widens the avatar) keep their text aligned. */}
                    <View style={styles.feedAvatar}>
                      <Avatar
                        initials={item.initials}
                        tint={TINT_N}
                        size={32}
                        fontSize={11}
                        frameId={item.frameId}
                        backgroundId={item.backgroundId}
                        iconId={item.iconId}
                      />
                    </View>
                    <Text style={styles.feedText}>
                      <Text style={styles.feedName}>{item.name}</Text> {feedAction(item, labels)}
                      <Text style={styles.feedTime}>{`  ·  ${timeAgo(item.occurredAt)}`}</Text>
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => cheer(item)}
                    disabled={sent}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={sent ? 'Kudos sent' : `Send ${item.name} kudos`}
                    style={[styles.cheer, sent && styles.cheerSent]}
                  >
                    <Text style={styles.cheerText}>{sent ? '✓ 👏' : '👏'}</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </Card>
      )}

      {sentInvites.length > 0 && (
        <>
          <Text style={styles.pendingLabel}>Pending</Text>
          {sentInvites.map((f) => (
            <Card key={f.friendshipId} style={styles.pendingRow} elevated={false}>
              <View style={styles.pendingAvatar}>
                <HourglassIcon size={15} color={colors.neutral500} />
              </View>
              <Text style={styles.pendingEmail}>{f.name}</Text>
              <Text style={styles.pendingMeta}>Invite sent</Text>
              <Button
                label="Cancel"
                variant="ghost"
                small
                disabled={busyId === f.friendshipId}
                onPress={() => respond(f.friendshipId, 'remove')}
              />
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    codeText: { fontFamily: font.heading, color: colors.text },
    container: { padding: 16, gap: 12, paddingBottom: 48 },
    feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    feedMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    feedAvatar: { width: 38, alignItems: 'center' },
    feedText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.85) },
    feedName: { fontFamily: font.heading, color: colors.text },
    feedTime: { fontSize: 12, color: withAlpha(colors.text, 0.45) },
    cheer: {
      paddingHorizontal: 10,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.5),
    },
    cheerSent: { borderColor: colors.divider, opacity: 0.6 },
    cheerText: { fontSize: 13 },
    loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // An accent wash over this theme's own colors, not a fixed dark
    // background — same "spotlight card that actually follows the theme"
    // reasoning as Home's huntCard (see that file's own comment).
    inviteCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
      flexWrap: 'wrap',
    },
    sectionTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    optionRow: { flexDirection: 'row', gap: 8 },
    optionTile: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      paddingHorizontal: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    optionTileOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.12) },
    optionLabel: { fontSize: 12, textAlign: 'center', color: withAlpha(colors.text, 0.75) },
    optionLabelOn: { color: colors.text },
    listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    friendListRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: FRIEND_ROW_HEIGHT },
    friendListRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    inviteText: { flex: 1, minWidth: 150, fontSize: 13.5, color: colors.text },
    inviteLink: { fontFamily: font.body, fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
    // Button pins itself to alignSelf: 'flex-start', so this wrapper is
    // what lines it up with the text input beside it, not the label.
    inlineAction: { marginBottom: 7 },
    qrWrap: { alignItems: 'center', paddingVertical: 4 },
    errorNote: { fontSize: 12.5, color: colors.amber },
    successNote: { fontSize: 12.5, color: colors.green },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    friendName: { fontSize: 14.5, color: colors.text },
    friendSub: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
    platformBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: colors.neutral800,
    },
    platformText: { fontSize: 10.5, color: colors.neutral200 },
    syncRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    syncText: { fontSize: 11.5 },
    pendingLabel: { fontSize: 15, color: withAlpha(colors.text, 0.7), marginTop: 6 },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: withAlpha(colors.surface, 0.6),
      flexWrap: 'wrap',
    },
    pendingAvatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.neutral600,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingEmail: { flex: 1, fontSize: 14, color: colors.text, minWidth: 120 },
    pendingMeta: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
  });
}
