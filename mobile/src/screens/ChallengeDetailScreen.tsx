import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, ArrowsClockwiseIcon, RobotIcon, TrashIcon, TrophyIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Tag';
import { TextField } from '../components/TextField';
import { ToggleRow } from '../components/Selectable';
import { text } from '../theme/text';
import { color, font, TINT_A, TINT_N } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { buildBoard } from '../challenges/board';
import { daysElapsedFraction } from '../challenges/botSimulation';
import { boardSortFor, usesDeviceSteps, usesWorkoutDistance } from '../challenges/scoring';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry } from '../challenges/types';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';

// The generic detail view for a real, Supabase-backed challenge of any
// kind — there's no per-kind template yet (HuntScreen is one specific
// hardcoded storyline, not reusable), so this renders the same for every
// kind: who's in it, who's logged what, and a way to log your own
// progress. A 'steps' challenge, and a 'hunt' scored on device steps or
// workout distance, are the exceptions — they have a real, unambiguous
// device number to draw from, so they auto-sync from HealthKit/Health
// Connect instead of showing the manual form. Fetches by id itself rather
// than taking pre-loaded data as props, so it works from any entry point.
export function ChallengeDetailScreen({
  challengeId,
  onBack,
  onGoHome,
}: {
  challengeId: string;
  onBack: () => void;
  onGoHome: () => void;
}) {
  const { user } = useAuth();
  const health = useHealthProvider();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [bots, setBots] = useState<ChallengeBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stepsInput, setStepsInput] = useState('');
  const [distanceInput, setDistanceInput] = useState('');
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState(false);

  const [deviceSyncing, setDeviceSyncing] = useState(false);
  const [deviceSyncedAt, setDeviceSyncedAt] = useState<Date | null>(null);
  const [deviceSyncError, setDeviceSyncError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, p, l, b] = await Promise.all([
        supabaseChallengesProvider.getChallenge(challengeId),
        supabaseChallengesProvider.listParticipants(challengeId),
        supabaseChallengesProvider.getLeaderboard(challengeId),
        supabaseChallengesProvider.listBots(challengeId),
      ]);
      setChallenge(c);
      setParticipants(p);
      setLeaderboard(l);
      setBots(b);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this challenge.');
    } finally {
      setLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    load();
  }, [load]);

  const [deleting, setDeleting] = useState(false);
  const [togglingHighlight, setTogglingHighlight] = useState(false);

  const toggleHighlight = async (next: boolean) => {
    setTogglingHighlight(true);
    try {
      await supabaseChallengesProvider.setHighlighted(challengeId, next);
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setTogglingHighlight(false);
    }
  };

  const confirmDelete = () => {
    if (!challenge) return;
    Alert.alert(
      'Delete this challenge?',
      `This removes "${challenge.name}" and everyone's progress in it for good. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await supabaseChallengesProvider.deleteChallenge(challengeId);
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

  // Reads a real device number and writes it as this challenge's progress
  // for today — the same upsert-by-day recordProgress() the manual form
  // uses, just filled in from the device instead of typed in. Which
  // number depends on what this challenge is scored on: a plain step
  // count, or distance summed from today's logged workouts. The health
  // abstraction has no true GPS-verified flag, so 'gps_distance' is
  // approximated as workouts whose name reads like a run or walk — a
  // treadmill session or a phone-in-a-drawer walk would still slip
  // through if its name happens to match, which is a real limitation,
  // not a hidden bug.
  const syncFromDevice = useCallback(async () => {
    if (!challenge) return;
    setDeviceSyncError(null);
    setDeviceSyncing(true);
    try {
      if (usesWorkoutDistance(challenge)) {
        const workouts = await health.getRecentWorkouts(30);
        const todayStr = new Date().toISOString().slice(0, 10);
        const todays = workouts.filter((w) => w.when.toISOString().slice(0, 10) === todayStr);
        const relevant =
          challenge.scoringMethod === 'gps_distance' ? todays.filter((w) => /run|walk|jog|hike/i.test(w.name)) : todays;
        const totalDistanceMi = relevant.reduce((sum, w) => sum + (w.distanceMi ?? 0), 0);
        await supabaseChallengesProvider.recordProgress(challengeId, 0, totalDistanceMi);
      } else {
        const snap = await health.getSnapshot();
        await supabaseChallengesProvider.recordProgress(challengeId, snap.stepsToday, snap.distanceTodayMi);
      }
      setDeviceSyncedAt(new Date());
      await load();
    } catch (e) {
      setDeviceSyncError(e instanceof Error ? e.message : 'Could not sync — try again.');
    } finally {
      setDeviceSyncing(false);
    }
  }, [challenge, challengeId, health, load]);

  // Auto-sync once whenever a challenge that draws from the device
  // finishes loading — keyed on id/kind/scoringMethod (not the whole
  // `challenge` object, which is a fresh reference every reload) so
  // syncFromDevice's own load() call doesn't re-trigger this.
  useEffect(() => {
    if (challenge && (usesDeviceSteps(challenge) || usesWorkoutDistance(challenge))) {
      syncFromDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.kind, challenge?.scoringMethod]);

  const logProgress = async () => {
    const steps = Number(stepsInput);
    if (!Number.isFinite(steps) || steps < 0) {
      setLogError('Enter a whole number of steps.');
      return;
    }
    const distanceMi = distanceInput.trim() ? Number(distanceInput) : 0;
    if (!Number.isFinite(distanceMi) || distanceMi < 0) {
      setLogError('Enter a valid distance, or leave it blank.');
      return;
    }
    setLogError(null);
    setLogSuccess(false);
    setLogging(true);
    try {
      await supabaseChallengesProvider.recordProgress(challengeId, Math.round(steps), distanceMi);
      setLogSuccess(true);
      setStepsInput('');
      setDistanceInput('');
      await load();
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.centered]}>
        <ActivityIndicator color={color.accent} />
      </SafeAreaView>
    );
  }

  if (loadError || !challenge) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container}>
          <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={color.accent} />} onPress={onBack} />
          <Text style={styles.loadError}>{loadError ?? 'This challenge could not be found.'}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const typeDef = CHALLENGE_TYPES.find((t) => t.id === challenge.kind);
  const Icon = CHALLENGE_KIND_ICON[challenge.kind];
  const daysElapsed = Math.min(
    challenge.durationDays,
    Math.max(1, Math.floor((Date.now() - new Date(challenge.startsAt).getTime()) / 86_400_000) + 1),
  );
  const endsLabel = new Date(challenge.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const myHighlighted = participants.find((p) => p.userId === user?.id)?.highlighted ?? false;

  const scoredByDistance = usesWorkoutDistance(challenge);
  const board = buildBoard(participants, leaderboard, bots, daysElapsedFraction(challenge), boardSortFor(challenge)).map((row) => ({
    ...row,
    name: row.userId === user?.id ? 'You' : row.name,
  }));

  const syncStatusText = deviceSyncing
    ? 'Syncing…'
    : deviceSyncError
      ? deviceSyncError
      : deviceSyncedAt
        ? 'Synced just now'
        : 'Not synced yet';

  const syncDescription =
    challenge.kind === 'hunt' && challenge.scoringMethod === 'gps_distance'
      ? `Distance from today’s runs and walks auto-syncs from ${health.platformLabel}.`
      : challenge.kind === 'hunt' && challenge.scoringMethod === 'any_workout'
        ? `Distance from every workout logged today auto-syncs from ${health.platformLabel}.`
        : `Steps auto-sync from ${health.platformLabel} — no manual entry needed.`;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.container}>
      <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={color.accent} />} onPress={onBack} />

      <View style={styles.headerRow}>
        <Pressable
          style={[styles.headerIcon, { backgroundColor: typeDef?.tint ?? TINT_N }]}
          onPress={onGoHome}
          hitSlop={8}
        >
          <Icon size={22} color={typeDef?.iconColor ?? '#e9e9ed'} weight={challenge.kind === 'hunt' ? 'fill' : 'regular'} />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[text.h2, { fontSize: 24 }]}>{challenge.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag label={typeDef?.name ?? challenge.kind} variant={challenge.kind === 'hunt' ? 'accent' : 'neutral'} />
            <Text style={styles.headerMeta}>
              Day {daysElapsed} of {challenge.durationDays} · ends {endsLabel}
            </Text>
          </View>
        </View>
      </View>

      <ToggleRow
        label="Highlight on Today screen"
        note="Feature this challenge on your Home screen"
        value={myHighlighted}
        onChange={togglingHighlight ? () => {} : toggleHighlight}
      />

      <Card style={{ gap: 12 }} elevated={false}>
        <View style={styles.leaderboardHeader}>
          <TrophyIcon size={16} color={color.accent} />
          <Text style={text.h4}>Leaderboard</Text>
        </View>
        {board.map((row, i) => (
          <View key={row.userId} style={styles.boardRow}>
            <Text style={styles.boardRank}>{i + 1}</Text>
            <Avatar initials={row.initials} tint={row.userId === user?.id ? TINT_A : TINT_N} size={30} fontSize={11} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              <Text style={styles.boardName}>{row.name}</Text>
              {row.isBot && <RobotIcon size={13} color="rgba(233,233,237,0.55)" />}
              {row.role && (
                <Tag label={row.role === 'hunter' ? 'Hunter' : 'Hunted'} variant={row.role === 'hunter' ? 'accent' : 'neutral'} />
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {scoredByDistance ? (
                <Text style={styles.boardSteps}>{row.totalDistanceMi.toFixed(1)} mi</Text>
              ) : (
                <>
                  <Text style={styles.boardSteps}>{row.totalSteps.toLocaleString()} steps</Text>
                  {row.totalDistanceMi > 0 && <Text style={styles.boardDistance}>{row.totalDistanceMi.toFixed(1)} mi</Text>}
                </>
              )}
            </View>
          </View>
        ))}
        {board.length === 0 && <Text style={styles.footNote}>No participants found.</Text>}
      </Card>

      {usesDeviceSteps(challenge) || usesWorkoutDistance(challenge) ? (
        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Your progress</Text>
          <Text style={styles.footNote}>{syncDescription}</Text>
          <View style={styles.syncRow}>
            <View style={[styles.dot, { backgroundColor: deviceSyncError ? color.amber : color.green }]} />
            <Text style={styles.footNote}>{syncStatusText}</Text>
            <Pressable style={styles.syncBtn} onPress={syncFromDevice} disabled={deviceSyncing}>
              <ArrowsClockwiseIcon size={13} color={color.accent} />
              <Text style={styles.syncLabel}>Sync now</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Card style={{ gap: 14 }} elevated={false}>
          <Text style={text.h4}>Log your progress</Text>
          <Text style={styles.footNote}>
            Manual entry for now — Hound doesn&rsquo;t automatically sync your HealthKit/Health Connect
            steps into this kind of challenge yet.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextField
              label="Steps today"
              value={stepsInput}
              onChangeText={setStepsInput}
              placeholder="8,432"
              keyboardType="number-pad"
              style={{ flex: 1 }}
            />
            <TextField
              label="Distance (mi)"
              value={distanceInput}
              onChangeText={setDistanceInput}
              placeholder="optional"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
          </View>
          {logError && <Text style={styles.loadError}>{logError}</Text>}
          {logSuccess && !logError && <Text style={styles.successNote}>Saved.</Text>}
          <Button
            label={logging ? 'Saving…' : 'Save'}
            variant="primary"
            block
            disabled={logging || !stepsInput.trim()}
            onPress={logProgress}
          />
        </Card>
      )}

      {challenge.createdBy === user?.id && (
        <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteRow}>
          <TrashIcon size={14} color={color.amber} />
          <Text style={styles.deleteLabel}>{deleting ? 'Deleting…' : 'Delete challenge'}</Text>
        </Pressable>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  headerIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  headerMeta: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  syncLabel: { fontSize: 12, color: color.accent, fontFamily: font.heading },
  leaderboardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233,233,237,0.07)',
  },
  boardRank: { width: 16, fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  boardName: { flex: 1, fontSize: 14, color: color.text, fontFamily: font.body },
  boardSteps: { fontSize: 14, color: color.text, fontFamily: font.heading },
  boardDistance: { fontSize: 11, color: 'rgba(233,233,237,0.55)' },
  footNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  loadError: { fontSize: 12.5, color: color.amber, textAlign: 'center' },
  successNote: { fontSize: 12.5, color: color.green, textAlign: 'center' },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  deleteLabel: { fontSize: 13, color: color.amber, fontFamily: font.heading },
});
