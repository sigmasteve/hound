import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, LockKeyOpenIcon, ProhibitIcon, TrashIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { banUser, deleteUser, getUserOverview, isBanned, unbanUser, type AdminUserOverview } from '../admin/adminApi';

type BanDurationChoice = '1' | '7' | '30' | 'forever';

const BAN_DURATION_OPTIONS: { value: BanDurationChoice; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'forever', label: 'Forever' },
];

// "Ban this account for 1 day?" reads right; "Ban this account for
// forever?" doesn't — forever skips the "for".
function banDurationPhrase(choice: BanDurationChoice): string {
  if (choice === 'forever') return 'forever';
  const label = BAN_DURATION_OPTIONS.find((o) => o.value === choice)?.label.toLowerCase() ?? '';
  return `for ${label}`;
}

// Same "how long ago" shape as SettingsScreen's own timeAgo(), extended
// with days/weeks — that one only ever formats a just-synced device (at
// most a few hours old), while last_active_at / last_health_sync_at here
// can easily be weeks stale for an inactive account.
function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

export function AdminUserDetailScreen({
  userId,
  name,
  initials,
  email,
  lastActiveAt,
  createdAt,
  onBack,
}: {
  userId: string;
  name: string;
  initials: string;
  email: string;
  // Carried over from the search result that opened this screen (same
  // as FriendDetailScreen taking friendName/friendInitials as params)
  // rather than re-fetched — admin_user_overview only covers the two
  // stats profiles.select can't already answer on its own.
  lastActiveAt: string | null;
  createdAt: string;
  onBack: () => void;
}) {
  const { user: currentUser } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isSelf = currentUser?.id === userId;

  const [overview, setOverview] = useState<AdminUserOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [banning, setBanning] = useState(false);
  const [showBanPicker, setShowBanPicker] = useState(false);
  const [banDuration, setBanDuration] = useState<BanDurationChoice>('forever');
  const banned = overview ? isBanned(overview.bannedUntil) : false;

  useEffect(() => {
    let cancelled = false;
    getUserOverview(userId)
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load this user’s activity.');
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const confirmUnban = () => {
    Alert.alert('Unban this account?', `${name} will be able to sign in again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unban',
        onPress: async () => {
          setBanning(true);
          try {
            await unbanUser(userId);
            setOverview((o) => (o ? { ...o, bannedUntil: null } : o));
          } catch (e) {
            Alert.alert('Could not unban', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBanning(false);
          }
        },
      },
    ]);
  };

  const confirmBan = () => {
    const durationDays = banDuration === 'forever' ? undefined : Number(banDuration);
    Alert.alert(
      `Ban this account ${banDurationPhrase(banDuration)}?`,
      `${name} will be signed out immediately and won't be able to sign back in until unbanned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ban',
          style: 'destructive',
          onPress: async () => {
            setBanning(true);
            try {
              await banUser(userId, durationDays);
              setOverview((o) => (o ? { ...o, bannedUntil: 'infinity' } : o));
              setShowBanPicker(false);
            } catch (e) {
              Alert.alert('Could not ban', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setBanning(false);
            }
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete this account?',
      `${name}'s Hound account, and everything tied to it — challenges they've joined, friendships, kudos — will be permanently deleted. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteUser(userId);
              onBack();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Admin" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={styles.headerRow}>
          <Avatar initials={initials} tint={TINT_A} size={56} fontSize={18} />
          <View style={{ flex: 1 }}>
            <Text style={text.h2}>{name}</Text>
            <Text style={styles.footNote}>{email}</Text>
            <Text style={styles.footNote}>
              Joined {new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
            {banned && <Text style={styles.bannedBadge}>Banned</Text>}
          </View>
        </View>

        {loadError && <Text style={styles.errorNote}>{loadError}</Text>}

        <Card style={{ gap: 14, padding: 18 }} elevated={false}>
          <Text style={text.h4}>Activity</Text>
          {overview ? (
            <>
              <View style={styles.statRow}>
                <Stat label="Last login" value={timeAgo(lastActiveAt)} styles={styles} />
                <Stat label="Active challenges" value={String(overview.activeChallengesCount)} styles={styles} />
                <Stat label="Last health sync" value={timeAgo(overview.lastHealthSyncAt)} styles={styles} />
              </View>
              <Text style={styles.footNote}>
                Last health sync is approximate — the most recent day this account synced progress into any
                challenge, not a direct read of their device connection.
              </Text>
            </>
          ) : !loadError ? (
            <ActivityIndicator color={colors.accent} />
          ) : null}
        </Card>

        {isSelf ? (
          <Text style={[styles.footNote, { textAlign: 'center' }]}>You can't ban or delete your own account from here.</Text>
        ) : (
          <>
            {banned ? (
              <Pressable onPress={confirmUnban} disabled={banning} style={styles.deleteRow}>
                <LockKeyOpenIcon size={14} color={colors.accent} />
                <Text style={[styles.deleteLabel, { color: colors.accent }]}>{banning ? 'Unbanning…' : 'Unban account'}</Text>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                <Pressable onPress={() => setShowBanPicker((v) => !v)} style={styles.deleteRow}>
                  <ProhibitIcon size={14} color={colors.amber} />
                  <Text style={styles.deleteLabel}>Ban account</Text>
                </Pressable>
                {showBanPicker && (
                  <View style={{ gap: 10 }}>
                    <SegmentedControl options={BAN_DURATION_OPTIONS} value={banDuration} onChange={setBanDuration} />
                    <Button label={banning ? 'Banning…' : 'Confirm ban'} onPress={confirmBan} disabled={banning} block />
                  </View>
                )}
              </View>
            )}
            <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteRow}>
              <TrashIcon size={14} color={colors.amber} />
              <Text style={styles.deleteLabel}>{deleting ? 'Deleting…' : 'Delete account'}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: AdminUserDetailStyles }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    statRow: { flexDirection: 'row', gap: 16 },
    statTile: { flex: 1, gap: 4 },
    statLabel: { fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.6) },
    statValue: { fontFamily: font.heading, fontSize: 22, color: colors.text },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    bannedBadge: { fontSize: 11, fontFamily: font.heading, color: colors.amber, marginTop: 2 },
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

type AdminUserDetailStyles = ReturnType<typeof makeStyles>;
