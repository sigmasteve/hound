import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, TrashIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, TINT_A, withAlpha, type Palette } from '../theme/tokens';
import { getHeadToHeadRecord, type HeadToHeadRecord } from '../friends/friendStats';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { KudosCounts } from '../friends/types';
import { listAchievements, listEarnedAchievements, type Achievement } from '../achievements/achievementsApi';
import { achievementIcon } from '../achievements/achievementIcons';
import { myRecentNudges, nudgeAgainLabel, sendNudge } from '../social/social';

export function FriendDetailScreen({
  friendshipId,
  friendUserId,
  friendName,
  friendInitials,
  friendFrameId,
  friendBackgroundId,
  friendIconId,
  onBack,
}: {
  friendshipId: string;
  friendUserId: string;
  friendName: string;
  friendInitials: string;
  friendFrameId?: string | null;
  friendBackgroundId?: string | null;
  friendIconId?: string | null;
  onBack: () => void;
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
      setKudos((k) => (k ? { ...k, given: k.given + 1 } : k));
    } catch (e) {
      Alert.alert('Could not send kudos', e instanceof Error ? e.message : 'Try again.');
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
      <ScrollView contentContainerStyle={styles.container}>
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
          <Text style={text.h2}>{friendName}</Text>
        </View>

        {loadError && <Text style={styles.errorNote}>{loadError}</Text>}

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
              <Button label={givingKudos ? 'Sending…' : 'Give kudos 👏'} variant="primary" disabled={givingKudos} onPress={sendKudos} />
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
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
