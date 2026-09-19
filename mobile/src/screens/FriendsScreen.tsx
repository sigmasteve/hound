import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AndroidLogoIcon, AppleLogoIcon, HourglassIcon, UserPlusIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import { FRIENDS } from '../data/sampleData';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';

export function FriendsScreen() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // null = still showing the sample fallback (either Supabase isn't
  // configured, or the real fetch hasn't resolved yet); once set, it
  // fully replaces the sample list — same "never break the screen, just
  // fall back" convention as ChallengesScreen.
  const [liveFriends, setLiveFriends] = useState<Friend[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setLiveFriends(await supabaseFriendsProvider.listFriends());
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

  if (!isSupabaseConfigured || liveFriends === null) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={text.h2}>Friends</Text>

        <Card style={styles.inviteCard} elevated={false}>
          <UserPlusIcon size={17} color={colors.accent300} />
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

  const accepted = liveFriends.filter((f) => f.status === 'accepted');
  const receivedInvites = liveFriends.filter((f) => f.status === 'pending' && !f.requestedByMe);
  const sentInvites = liveFriends.filter((f) => f.status === 'pending' && f.requestedByMe);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={text.h2}>Friends</Text>

      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.inviteHeader}>
          {/* Unlike the sample fallback's inviteCard above (a fixed dark
              chip regardless of theme), this Card has no background
              override — it's this theme's own (possibly light) surface,
              so the icon needs accentActive rather than the raw
              accent300 that's fine on a fixed dark chip. */}
          <UserPlusIcon size={17} color={colors.accentActive} />
          <Text style={styles.inviteText}>Invite by email</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <TextField
            label="Email"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="friend@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            style={{ flex: 1 }}
          />
          <Button
            label={inviting ? 'Sending…' : 'Send'}
            variant="primary"
            small
            disabled={inviting || !inviteEmail.trim()}
            onPress={sendInvite}
          />
        </View>
        {inviteError && <Text style={styles.errorNote}>{inviteError}</Text>}
        {inviteSuccess && !inviteError && <Text style={styles.successNote}>{inviteSuccess}</Text>}
      </Card>

      {receivedInvites.map((f) => (
        <Card key={f.friendshipId} style={styles.pendingRow} elevated={false}>
          <Avatar initials={f.initials} tint={TINT_A} />
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

      {accepted.map((f) => (
        <Card key={f.friendshipId} style={styles.friendRow} elevated={false}>
          <Avatar initials={f.initials} tint={TINT_N} />
          <View style={{ flex: 1, gap: 2, minWidth: 120 }}>
            <Text style={styles.friendName}>{f.name}</Text>
          </View>
        </Card>
      ))}
      {accepted.length === 0 && receivedInvites.length === 0 && sentInvites.length === 0 && (
        <Text style={styles.footNote}>No friends yet — invite someone above.</Text>
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
    container: { padding: 16, gap: 12, paddingBottom: 48 },
    inviteCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2a2540', flexWrap: 'wrap' },
    inviteHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inviteText: { flex: 1, minWidth: 150, fontSize: 13.5, color: colors.text },
    inviteLink: { fontFamily: font.body, fontSize: 12.5, color: withAlpha(colors.text, 0.7) },
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
