import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { getUserOverview, type AdminUserOverview } from '../admin/adminApi';

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
  onBack: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [overview, setOverview] = useState<AdminUserOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Admin" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={styles.headerRow}>
          <Avatar initials={initials} tint={TINT_A} size={56} fontSize={18} />
          <View style={{ flex: 1 }}>
            <Text style={text.h2}>{name}</Text>
            <Text style={styles.footNote}>{email}</Text>
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
    errorNote: { fontSize: 12.5, color: colors.amber },
  });
}

type AdminUserDetailStyles = ReturnType<typeof makeStyles>;
