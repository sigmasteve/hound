import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon, RobotIcon, TrophyIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tag } from '../components/Tag';
import { TextField } from '../components/TextField';
import { text } from '../theme/text';
import { color, font, TINT_A, TINT_N } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { buildBoard } from '../challenges/board';
import type { Challenge, ChallengeBot, Participant, LeaderboardEntry } from '../challenges/types';
import { useAuth } from '../auth/AuthContext';

// The generic detail view for a real, Supabase-backed challenge of any
// kind — there's no per-kind template yet (HuntScreen is one specific
// hardcoded storyline, not reusable), so this renders the same for
// 'hunt'/'steps'/'streak'/'distance' alike: who's in it, who's logged
// what, and a way to log your own progress. Fetches by id itself rather
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

  const board = buildBoard(participants, leaderboard, bots, daysElapsed).map((row) => ({
    ...row,
    name: row.userId === user?.id ? 'You' : row.name,
  }));

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

      <Card style={{ gap: 12 }} elevated={false}>
        <View style={styles.leaderboardHeader}>
          <TrophyIcon size={16} color={color.accent} />
          <Text style={text.h4}>Leaderboard</Text>
        </View>
        {board.map((row, i) => (
          <View key={row.userId} style={styles.boardRow}>
            <Text style={styles.boardRank}>{i + 1}</Text>
            <Avatar initials={row.initials} tint={row.userId === user?.id ? TINT_A : TINT_N} size={30} fontSize={11} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.boardName}>{row.name}</Text>
              {row.isBot && <RobotIcon size={13} color="rgba(233,233,237,0.55)" />}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.boardSteps}>{row.totalSteps.toLocaleString()} steps</Text>
              {row.totalDistanceMi > 0 && <Text style={styles.boardDistance}>{row.totalDistanceMi.toFixed(1)} mi</Text>}
            </View>
          </View>
        ))}
        {board.length === 0 && <Text style={styles.footNote}>No participants found.</Text>}
      </Card>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Log your progress</Text>
        <Text style={styles.footNote}>
          Manual entry for now — Hound doesn&rsquo;t automatically sync your HealthKit/Health Connect
          steps into a challenge yet.
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
});
