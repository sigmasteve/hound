import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  DevicesIcon,
  LinkIcon,
  RobotIcon,
  XIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { RadioPill } from '../components/Selectable';
import { SegmentedControl } from '../components/SegmentedControl';
import { text } from '../theme/text';
import { color, font, TINT_N } from '../theme/tokens';
import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import { isSupabaseConfigured } from '../lib/supabase';
import { supabaseChallengesProvider } from '../challenges/supabaseChallenges';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import type { Friend } from '../friends/types';
import { BOT_FITNESS_LEVELS, BOT_PRESETS, botInitials } from '../challenges/botSimulation';
import type { DistanceGoalUnit, HuntRole, ScoringMethod } from '../challenges/types';
import { useAuth } from '../auth/AuthContext';

const SCORING_METHODS: { id: ScoringMethod; label: string }[] = [
  { id: 'gps_distance', label: 'GPS distance from runs & walks' },
  { id: 'any_workout', label: 'Any logged workout' },
  { id: 'device_steps', label: 'Device step count' },
];

export function CreateScreen({ onCancel, onFinish }: { onCancel: () => void; onFinish: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draftType, setDraftType] = useState<ChallengeKind>('hunt');
  const [draftName, setDraftName] = useState('');
  const [headStart, setHeadStart] = useState(2);
  const [distanceGoalUnit, setDistanceGoalUnit] = useState<DistanceGoalUnit>('miles');
  const [distanceGoalMi, setDistanceGoalMi] = useState(100);
  const [distanceGoalSteps, setDistanceGoalSteps] = useState(500_000);
  const [length, setLength] = useState('21');
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>('device_steps');
  // Real friends' userIds picked to invite once the challenge exists —
  // see start()'s inviteFriendToChallenge calls below. Never populated
  // (and this screen just shows an empty state) while Supabase isn't
  // configured, same reasoning as every other real-data screen.
  const [invited, setInvited] = useState<string[]>([]);
  // null = the real fetch hasn't resolved yet, or never will (Supabase
  // unconfigured) — both render the same honest empty state below,
  // never fabricated friends (see ChallengesScreen's own fix for why).
  const [liveFriends, setLiveFriends] = useState<Friend[] | null>(null);
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  // 'me' or a BOT_PRESETS id — the one Hunter; every other selected bot
  // (and the creator, if they're not it) is Hunted. Only meaningful for
  // draftType === 'hunt'.
  const [hunterId, setHunterId] = useState<string>('me');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabaseFriendsProvider
      .listFriends()
      .then(setLiveFriends)
      .catch(() => {
        // Stay on the empty state on any failure — this screen never
        // shows an error for the friend list itself.
      });
  }, []);

  const toggleFriend = (userId: string) =>
    setInvited((cur) => (cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId]));
  const toggleBot = (id: string) => {
    setSelectedBots((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    // Deselecting the bot currently picked as Hunter would leave hunterId
    // pointing at someone no longer in the challenge — fall back to "You".
    setHunterId((cur) => (cur === id ? 'me' : cur));
  };

  const headStartLabel = headStart === 1 ? '1 day' : `${headStart} days`;
  const customLength = Number(length) || 1;
  const customLengthLabel = customLength === 1 ? '1 day' : `${customLength} days`;
  const friendsLoading = liveFriends === null && isSupabaseConfigured;
  const acceptedFriends = (liveFriends ?? []).filter((f) => f.status === 'accepted');

  const start = async () => {
    // The Hunt screen still reads static sample data unconditionally —
    // see mobile/README.md "What's not implemented" for why that's a
    // deliberate, separate follow-up. Everything else this saves is
    // read back for real: the Challenges list, Home's hero card, and
    // (for whoever gets invited below) their own invite card.
    if (!isSupabaseConfigured) {
      onFinish();
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      const isHunt = draftType === 'hunt';
      const chosenBots = BOT_PRESETS.filter((b) => selectedBots.includes(b.id));
      const roleFor = (id: string): HuntRole | undefined => (isHunt ? (id === hunterId ? 'hunter' : 'hunted') : undefined);
      const created = await supabaseChallengesProvider.createChallenge({
        name: draftName.trim() || 'Untitled challenge',
        kind: draftType,
        durationDays: Number(length),
        scoringMethod: isHunt ? scoringMethod : undefined,
        creatorRole: roleFor('me'),
        bots: chosenBots.map((b) => ({
          name: b.name,
          fitnessLevel: b.fitnessLevel,
          role: roleFor(b.id),
        })),
        headStartDays: isHunt ? headStart : undefined,
        distanceGoalUnit: draftType === 'distance' ? distanceGoalUnit : undefined,
        distanceGoalMi: draftType === 'distance' && distanceGoalUnit === 'miles' ? distanceGoalMi : undefined,
        distanceGoalSteps: draftType === 'distance' && distanceGoalUnit === 'steps' ? distanceGoalSteps : undefined,
      });
      // Best-effort, same reasoning as ChallengeDetailScreen's own
      // inviteFriend: the challenge itself already saved successfully by
      // this point, so one invite failing (a stale friendship row,
      // whatever) shouldn't read as "could not save that challenge" —
      // Promise.all would reject the whole thing on the first failure.
      await Promise.allSettled(
        invited.map((friendUserId) => supabaseChallengesProvider.inviteFriendToChallenge(created.id, friendUserId)),
      );
      onFinish();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save that challenge — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.container}>
      <Button label="Cancel" variant="ghost" small icon={<XIcon size={13} color={color.accent} />} onPress={onCancel} />

      <View style={styles.stepsBar}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.stepDot, n <= step && styles.stepDotOn]} />
        ))}
      </View>
      <Text style={text.eyebrow}>STEP {step} OF 3</Text>

      {step === 1 && (
        <View style={{ gap: 14 }}>
          <Text style={text.h2}>Pick the game</Text>
          {CHALLENGE_TYPES.map((t) => {
            const picked = draftType === t.id;
            const TypeIcon = CHALLENGE_KIND_ICON[t.id];
            return (
              <Pressable
                key={t.id}
                onPress={() => setDraftType(t.id)}
                style={[styles.typeRow, picked && styles.typeRowOn]}
              >
                <View style={[styles.typeIcon, { backgroundColor: t.tint }]}>
                  <TypeIcon size={19} color={t.iconColor} weight={t.id === 'hunt' ? 'fill' : 'regular'} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.typeName}>{t.name}</Text>
                  <Text style={styles.typeDesc}>{t.desc}</Text>
                </View>
                {picked ? (
                  <CheckCircleIcon size={18} color={color.accent} weight="fill" />
                ) : (
                  <CircleIcon size={18} color={color.neutral700} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {step === 2 && (
        <View style={{ gap: 16 }}>
          <Text style={text.h2}>Set the rules</Text>
          <View style={{ gap: 5 }}>
            <Text style={styles.fieldLabel}>Challenge name</Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Name your challenge"
              placeholderTextColor="rgba(233,233,237,0.4)"
              style={styles.input}
            />
          </View>
          <View style={{ gap: 5 }}>
            <Text style={styles.fieldLabel}>Runs for</Text>
            <SegmentedControl
              options={[
                { value: '7', label: '7 days' },
                { value: '21', label: '21 days' },
                { value: '30', label: '30 days' },
              ]}
              value={length}
              onChange={setLength}
            />
          </View>

          <View style={{ gap: 5 }}>
            <View style={styles.huntBlockHeader}>
              <Text style={styles.fieldLabel}>Or pick any length</Text>
              <Text style={styles.huntBlockValue}>{customLengthLabel}</Text>
            </View>
            <Slider
              minimumValue={1}
              maximumValue={45}
              step={1}
              value={customLength}
              onValueChange={(v) => setLength(String(Math.round(v)))}
              minimumTrackTintColor={color.accent}
              maximumTrackTintColor={color.neutral700}
              thumbTintColor={color.accent}
            />
          </View>

          {draftType === 'distance' && (
            <View style={styles.huntBlock}>
              <View style={styles.huntBlockHeader}>
                <Text style={styles.huntBlockLabel}>Group target</Text>
                <Text style={styles.huntBlockValue}>
                  {distanceGoalUnit === 'miles' ? `${distanceGoalMi} mi` : `${distanceGoalSteps.toLocaleString()} steps`}
                </Text>
              </View>
              <SegmentedControl
                options={[
                  { value: 'miles', label: 'Miles' },
                  { value: 'steps', label: 'Steps' },
                ]}
                value={distanceGoalUnit}
                onChange={setDistanceGoalUnit}
              />
              {distanceGoalUnit === 'miles' ? (
                <Slider
                  minimumValue={10}
                  maximumValue={1000}
                  step={10}
                  value={distanceGoalMi}
                  onValueChange={(v) => setDistanceGoalMi(Math.round(v))}
                  minimumTrackTintColor={color.accent}
                  maximumTrackTintColor={color.neutral700}
                  thumbTintColor={color.accent}
                />
              ) : (
                <Slider
                  minimumValue={50_000}
                  maximumValue={2_000_000}
                  step={50_000}
                  value={distanceGoalSteps}
                  onValueChange={(v) => setDistanceGoalSteps(Math.round(v))}
                  minimumTrackTintColor={color.accent}
                  maximumTrackTintColor={color.neutral700}
                  thumbTintColor={color.accent}
                />
              )}
              <Text style={styles.huntBlockNote}>
                Everyone&rsquo;s logged {distanceGoalUnit === 'miles' ? 'miles' : 'steps'} add up
                toward this one shared target — it&rsquo;s the whole group against the goal, not
                against each other.
              </Text>
            </View>
          )}

          {draftType === 'hunt' && (
            <View style={styles.huntBlock}>
              <View style={styles.huntBlockHeader}>
                <Text style={styles.huntBlockLabel}>Head start for the hunted</Text>
                <Text style={styles.huntBlockValue}>{headStartLabel}</Text>
              </View>
              <Slider
                minimumValue={1}
                maximumValue={3}
                step={1}
                value={headStart}
                onValueChange={setHeadStart}
                minimumTrackTintColor={color.accent}
                maximumTrackTintColor={color.neutral700}
                thumbTintColor={color.accent}
              />
              <Text style={styles.huntBlockNote}>
                The hunted logs alone for {headStartLabel}. Then the hunter starts tallying and has to
                close the gap before the clock runs out. Pick who&rsquo;s hunting whom on the next step
                — a hunt always has exactly one Hunter, but can have more than one Hunted.
              </Text>
            </View>
          )}

          {draftType === 'hunt' && (
            <View style={{ gap: 8 }}>
              <Text style={styles.fieldLabel}>What counts</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SCORING_METHODS.map((m) => (
                  <RadioPill
                    key={m.id}
                    label={m.label}
                    selected={scoringMethod === m.id}
                    onPress={() => setScoringMethod(m.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {draftType === 'hunt' && (
            <View style={styles.notice}>
              <DevicesIcon size={17} color={color.accent300} />
              <Text style={styles.noticeText}>
                {scoringMethod === 'device_steps'
                  ? 'Everyone in this hunt is scored on today’s device step count, synced automatically from their own phone.'
                  : scoringMethod === 'any_workout'
                    ? 'Everyone in this hunt is scored on total distance from every logged workout today, GPS or not.'
                    : 'Everyone in this hunt is scored on GPS distance from today’s runs and walks specifically — a treadmill session or a phone left on a desk won’t count.'}
              </Text>
            </View>
          )}
        </View>
      )}

      {step === 3 && (
        <View style={{ gap: 14 }}>
          <Text style={text.h2}>Bring friends</Text>
          {friendsLoading ? (
            <View style={styles.friendsLoadingRow}>
              <ActivityIndicator color={color.accent} />
            </View>
          ) : (
            <>
              {acceptedFriends.map((f) => {
                const picked = invited.includes(f.userId);
                return (
                  <Pressable
                    key={f.userId}
                    onPress={() => toggleFriend(f.userId)}
                    style={[styles.friendRow, picked && styles.friendRowOn]}
                  >
                    <Avatar initials={f.initials} tint={TINT_N} size={30} fontSize={11} />
                    <Text style={[styles.friendName, { flex: 1 }]}>{f.name}</Text>
                    {picked ? (
                      <CheckCircleIcon size={18} color={color.accent} weight="fill" />
                    ) : (
                      <CircleIcon size={18} color={color.neutral700} />
                    )}
                  </Pressable>
                );
              })}
              {acceptedFriends.length === 0 && (
                <Text style={styles.footNote}>Add friends from the Friends tab, then invite them here.</Text>
              )}
            </>
          )}
          <View style={styles.linkRow}>
            <LinkIcon size={16} color={color.accent} />
            <Text style={styles.linkText}>hound.app/j/hunt-4kq9</Text>
            <Button label="Copy invite link" small />
          </View>
          <Text style={styles.footNote}>
            Friends on iPhone connect Apple Health, friends on Android connect Health Connect. Same
            link either way.
          </Text>

          <Text style={[text.h4, { marginTop: 4 }]}>Bot opponents</Text>
          <Text style={styles.footNote}>
            Not enough friends free to race? Add a bot — it logs a plausible number of steps every
            day on its own, at whichever pace you pick.
          </Text>
          {BOT_PRESETS.map((b) => {
            const picked = selectedBots.includes(b.id);
            const level = BOT_FITNESS_LEVELS[b.fitnessLevel];
            return (
              <Pressable
                key={b.id}
                onPress={() => toggleBot(b.id)}
                style={[styles.friendRow, picked && styles.friendRowOn]}
              >
                <Avatar initials={botInitials(b.name)} tint={color.neutral800} size={30} fontSize={11} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.friendName}>{b.name}</Text>
                  <Text style={styles.botLevelDesc}>{level.desc}</Text>
                </View>
                <View style={styles.platformBadge}>
                  <RobotIcon size={11} color={color.neutral200} />
                  <Text style={styles.platformBadgeText}>{level.label}</Text>
                </View>
                {picked ? (
                  <CheckCircleIcon size={18} color={color.accent} weight="fill" />
                ) : (
                  <CircleIcon size={18} color={color.neutral700} />
                )}
              </Pressable>
            );
          })}

          {draftType === 'hunt' && (
            <View style={{ gap: 8, marginTop: 4 }}>
              <Text style={text.h4}>Who&rsquo;s the Hunter?</Text>
              <Text style={styles.footNote}>
                Exactly one Hunter chases everyone else — everyone else is Hunted, however many there
                are.
              </Text>
              <Pressable
                onPress={() => setHunterId('me')}
                style={[styles.friendRow, hunterId === 'me' && styles.friendRowOn]}
              >
                <Avatar initials={user?.initials ?? 'Y'} tint={color.accent800} size={30} fontSize={11} />
                <Text style={styles.friendName}>You</Text>
                {hunterId === 'me' ? (
                  <CheckCircleIcon size={18} color={color.accent} weight="fill" />
                ) : (
                  <CircleIcon size={18} color={color.neutral700} />
                )}
              </Pressable>
              {BOT_PRESETS.filter((b) => selectedBots.includes(b.id)).map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => setHunterId(b.id)}
                  style={[styles.friendRow, hunterId === b.id && styles.friendRowOn]}
                >
                  <Avatar initials={botInitials(b.name)} tint={color.neutral800} size={30} fontSize={11} />
                  <Text style={styles.friendName}>{b.name}</Text>
                  {hunterId === b.id ? (
                    <CheckCircleIcon size={18} color={color.accent} weight="fill" />
                  ) : (
                    <CircleIcon size={18} color={color.neutral700} />
                  )}
                </Pressable>
              ))}
              {selectedBots.length === 0 && (
                <Text style={styles.footNote}>
                  Add a bot above to give this hunt someone else to chase, or be chased by — real
                  friend invites above aren&rsquo;t wired to a role yet.
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {saveError && <Text style={styles.saveError}>{saveError}</Text>}

      <View style={styles.footer}>
        {step > 1 ? (
          <Button
            label="Back"
            icon={<ArrowLeftIcon size={13} color={color.text} />}
            onPress={() => setStep((s) => (s - 1) as 1 | 2)}
            disabled={saving}
          />
        ) : (
          <View />
        )}
        <Button
          label={step === 3 ? (saving ? 'Starting…' : 'Start the challenge') : 'Continue'}
          variant="primary"
          trailingIcon={<ArrowRightIcon size={13} color={color.accent} />}
          disabled={saving}
          onPress={() => (step === 3 ? start() : setStep((s) => (s + 1) as 2 | 3))}
        />
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  stepsBar: { flexDirection: 'row', gap: 6 },
  stepDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: color.neutral800 },
  stepDotOn: { backgroundColor: color.accent },
  typeRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    padding: 15,
    borderRadius: 8,
    backgroundColor: color.surface,
  },
  typeRowOn: { borderWidth: 1, borderColor: color.accent },
  typeIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  typeName: { fontFamily: font.heading, fontSize: 16, color: color.text },
  typeDesc: { fontSize: 13, color: 'rgba(233,233,237,0.7)' },
  fieldLabel: { fontSize: 12, color: 'rgba(233,233,237,0.7)' },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.divider,
    color: color.text,
    fontSize: 15,
  },
  huntBlock: { gap: 14, padding: 16, borderRadius: 8, backgroundColor: '#262a60' },
  huntBlockHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  huntBlockLabel: { fontFamily: font.heading, fontSize: 15, color: color.text },
  huntBlockValue: { fontFamily: font.heading, fontSize: 20, color: color.accent200 },
  huntBlockNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.7)' },
  notice: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(145,132,217,0.09)',
    alignItems: 'flex-start',
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: color.accent200 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: color.surface,
  },
  friendRowOn: { borderWidth: 1, borderColor: color.accent },
  friendName: { flex: 1, fontSize: 14, color: color.text },
  botLevelDesc: { fontSize: 11.5, color: 'rgba(233,233,237,0.55)' },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 5,
    backgroundColor: color.neutral800,
  },
  platformBadgeText: { fontSize: 10, color: color.neutral200 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 13,
    borderRadius: 8,
    backgroundColor: color.surface,
    flexWrap: 'wrap',
  },
  linkText: { flex: 1, fontFamily: font.body, fontSize: 12.5, color: 'rgba(233,233,237,0.75)' },
  footNote: { fontSize: 12.5, color: 'rgba(233,233,237,0.55)' },
  friendsLoadingRow: { paddingVertical: 20, alignItems: 'center' },
  saveError: { fontSize: 12.5, color: color.amber, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 },
});
