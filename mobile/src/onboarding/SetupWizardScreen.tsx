import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BarbellIcon,
  BellRingingIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  DotsThreeIcon,
  FootprintsIcon,
  HeartbeatIcon,
  PersonSimpleRunIcon,
  TrophyIcon,
  UsersThreeIcon,
} from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { SponsorLine } from '../components/SponsorLine';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, radius, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { useGoals } from '../goals/GoalsContext';
import { MAX_GOALS } from '../goals/goals';
import { canJoin, globalTimingLine, joinDeadlineLine, joinGlobalChallenge, listGlobalChallenges, type GlobalChallenge } from '../challenges/globalChallenges';
import { huntKindName } from '../challenges/present';
import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import { HoundArt } from '../kennel/HoundArt';
import { EAR_OPTIONS, KENNEL_ITEMS, TAN_SWATCH, type HoundEars } from '../kennel/kennelItems';
import { buyKennelItem, equipKennelItem, getKennel, setHoundAvatar, setKennel, setKennelLook, type Kennel } from '../kennel/kennelApi';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { Image } from 'react-native';
import { canAddPhoto, checkPhoto, chooseDogPhoto, pickPhoto, type DogLook } from '../dogPhotos/dogPhotos';
import type { HoundMarkings, HoundTail } from '../kennel/kennelItems';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { claimOnboardingReward, getOnboardingStatus } from './onboardingApi';
import { markAskedForUsername, useUsernameForm, UsernameFields } from '../profiles/UsernameForm';
import { setMyName } from '../profiles/supabaseProfile';
import { askForPush, dismissPushOffer, getPushPermission } from '../notifications/pushPermission';
import {
  CONNECT_PROMPT_SEEN_KEY,
  extraGoalsFor,
  finishWelcome,
  getWelcome,
  HOUND_USES,
  saveHoundUses,
  type HoundUse,
} from './welcomeApi';

// Five pages at most (November 2026: ten was too many). Daily goals and
// adding a friend moved to Today, which asks for each at a better moment
// (GoalSetupCard, Finish setting up). Notifications came back as a page
// (Steve: new people weren't turning them on from Today's PushAskCard
// alone): only while the phone hasn't been asked, after Jump in, so it
// follows joining something. Skipping it leaves Today's card to ask again
// in a few days.
type StepId = 'health' | 'about' | 'jump' | 'push' | 'hound';

const USE_ICONS: Record<HoundUse, typeof FootprintsIcon> = {
  steps: FootprintsIcon,
  workouts: CalendarCheckIcon,
  strength: BarbellIcon,
  cardio: PersonSimpleRunIcon,
  friends: UsersThreeIcon,
  habits: CheckCircleIcon,
  other: DotsThreeIcon,
};

// The welcome wizard (0109_welcome_wizard.sql): one thing at a time
// instead of a Today full of setup cards. Right after sign-up, and once
// for anyone who never finished "Get started". From Today's "Finish
// setting up" (resume) it only shows the steps still left.
export function SetupWizardScreen({
  resume = false,
  onFinish,
}: {
  resume?: boolean;
  // Unused since daily goals moved to Today; kept so callers needn't change.
  onOpenGoals?: () => void;
  // Unused since Jump in only offers challenges open to everyone.
  onCreateChallenge?: (kind: ChallengeKind) => void;
  onFinish: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { user } = useAuth();
  const [plan, setPlan] = useState<StepId[] | null>(null);
  const [index, setIndex] = useState(0);
  const [uses, setUses] = useState<HoundUse[]>([]);
  // Global challenges still open to join when the wizard opened.
  const [openGlobals, setOpenGlobals] = useState<GlobalChallenge[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [auth, status, welcome, globals, push] = await Promise.all([
        health.getAuthorizationStatus().catch(() => null),
        getOnboardingStatus().catch(() => null),
        getWelcome(),
        listGlobalChallenges().catch(() => [] as GlobalChallenge[]),
        getPushPermission().catch(() => null),
      ]);
      if (cancelled) return;
      const saved = welcome?.uses ?? [];
      setUses(saved);
      const joinable = globals.filter((c) => canJoin(c));
      setOpenGlobals(joinable);
      const steps: StepId[] = [];
      if (auth !== 'authorized') steps.push('health');
      // A name, a username, and what they're here for, on one page.
      // Finishing setup, only when something there is still missing.
      if (!resume || !user?.username || user?.needsName || saved.length === 0) steps.push('about');
      // Join a challenge open to everyone, when any are taking players.
      if (joinable.length > 0) steps.push('jump');
      // Notifications, while the phone hasn't been asked (not on web).
      if (push === 'undetermined') steps.push('push');
      if (!resume) steps.push('hound');
      setPlan(steps);
    })();
    return () => {
      cancelled = true;
    };
    // Planned once, when the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Done: the welcome's finished, the getting-started Bones paid if
  // they've earned them (Today's "Finish setting up" covers the rest), and
  // on to Today.
  const finish = useCallback(() => {
    finishWelcome().catch(() => {});
    getOnboardingStatus()
      .then(async (s) => {
        if (s && s.healthConnected && s.hasFriend && s.joinedChallenge && !s.rewardClaimed) {
          await claimOnboardingReward();
          notifyBonesChanged();
        }
      })
      .catch(() => {});
    onFinish();
  }, [onFinish]);

  // Nothing left to set up (finishing setup with everything done).
  useEffect(() => {
    if (plan && plan.length === 0) finish();
  }, [plan, finish]);

  if (!plan || plan.length === 0) {
    return (
      <SafeAreaView style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const step = plan[index];
  const last = index >= plan.length - 1;
  const next = () => (last ? finish() : setIndex((i) => i + 1));
  // Health can't be skipped from the top, only after trying it, and a
  // missing name can't be skipped at all.
  const canSkip = step !== 'health' && !(step === 'about' && user?.needsName);

  const skip = () => {
    if (step === 'about' && user?.id) markAskedForUsername(user.id);
    // Counts as one of Today's offers, which asks again in a few days.
    if (step === 'push') dismissPushOffer().catch(() => {});
    next();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.stepCount}>
            Step {index + 1} of {plan.length}
          </Text>
          <ProgressBar pct={((index + 1) / plan.length) * 100} height={4} />
        </View>
        {canSkip ? (
          <Pressable onPress={skip} hitSlop={10} accessibilityRole="button">
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      {step === 'health' && <HealthStep styles={styles} onNext={next} />}
      {step === 'about' && (
        <AboutStep
          styles={styles}
          initialUses={uses}
          onNext={(u) => {
            setUses(u);
            next();
          }}
        />
      )}
      {step === 'jump' && <JumpInStep styles={styles} initialGlobals={openGlobals} onNext={next} />}
      {step === 'push' && <PushStep styles={styles} onNext={next} />}
      {step === 'hound' && <HoundStep styles={styles} last={last} onNext={next} />}
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

// The shape every step shares: an icon, a title and a line, whatever the
// step needs, and its button(s) at the bottom.
function StepPage({
  styles,
  icon,
  eyebrow,
  title,
  body,
  children,
  footer,
}: {
  styles: Styles;
  icon?: React.ReactNode;
  // A small line over the title (the first step's welcome).
  eyebrow?: string;
  title: string;
  body?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {icon && <View style={styles.badge}>{icon}</View>}
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
        {body && <Text style={styles.body}>{body}</Text>}
        {children}
      </ScrollView>
      {footer && <View style={styles.footer}>{footer}</View>}
    </>
  );
}

function HealthStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const health = useHealthProvider();
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    const result = await health.requestAuthorization().catch(() => 'denied' as const);
    setConnecting(false);
    // Either way, the launch-time health prompt has been dealt with.
    AsyncStorage.setItem(CONNECT_PROMPT_SEEN_KEY, 'true').catch(() => {});
    if (result === 'authorized') onNext();
    else setProblem(`${health.platformLabel} didn’t allow it. You can turn it on later from You → Health data.`);
  };

  return (
    <StepPage
      styles={styles}
      icon={<HeartbeatIcon size={28} color={colors.accent} weight="fill" />}
      eyebrow="WELCOME TO HOUND · FITNESS WITH FRIENDS"
      title={`Connect ${health.platformLabel}`}
      body="Hound counts your steps, miles and workouts from your phone, so challenges and goals update on their own. It only reads, and you can turn it off anytime."
      footer={
        <>
          {problem && <Text style={styles.problem}>{problem}</Text>}
          {problem ? (
            <Button label="Continue without it" variant="primary" block onPress={onNext} />
          ) : (
            <Button label={connecting ? 'Connecting…' : 'Connect'} variant="primary" block disabled={connecting} onPress={connect} />
          )}
        </>
      }
    />
  );
}

// Notifications: what they're for, then the phone's own prompt (iOS
// shows it only once, so the reasons come first). Allowed or not, on to
// the next page.
function PushStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);

  const turnOn = async () => {
    if (!user?.id) {
      onNext();
      return;
    }
    setAsking(true);
    const result = await askForPush(user.id).catch(() => null);
    setAsking(false);
    if (result === 'granted' || result === null) onNext();
    else setRefused(true);
  };

  const reasons = [
    'A friend nudges you, cheers you on or sends you a challenge',
    'You’re tagged, caught or it’s your turn in a game',
    'A challenge you’re in starts, and how you placed',
    'Your club posts a challenge to join',
  ];

  return (
    <StepPage
      styles={styles}
      icon={<BellRingingIcon size={28} color={colors.accent} weight="fill" />}
      title="Turn on notifications"
      body="Hound’s games happen while you’re out walking. Notifications tell you when it’s your move, so nothing passes you by."
      footer={
        <>
          {refused && (
            <Text style={styles.problem}>No problem. You can turn them on any time in your phone&rsquo;s Settings → Hound → Notifications.</Text>
          )}
          {refused ? (
            <Button label="Continue" variant="primary" block onPress={onNext} />
          ) : (
            <Button label={asking ? 'Asking…' : 'Turn on notifications'} variant="primary" block disabled={asking} onPress={turnOn} />
          )}
        </>
      }
    >
      <Card style={{ gap: 10 }} elevated={false}>
        {reasons.map((r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <CheckIcon size={16} color={colors.green} weight="bold" style={{ marginTop: 2 }} />
            <Text style={[styles.body, { flex: 1, textAlign: 'left', marginTop: 0 }]}>{r}</Text>
          </View>
        ))}
        <Text style={[styles.body, { textAlign: 'left', marginTop: 0, fontSize: 13 }]}>
          No marketing. Change what you get any time in Settings.
        </Text>
      </Card>
    </StepPage>
  );
}

// Page 2: what to call you, and what you're into. A name when sign-up
// didn't bring one (Sign in with Apple only shares it the first time), an
// optional username for leaderboards (0030_username.sql; friends still see
// the name), and their interests (hound_uses, 0109; 'other' from 0175).
// The interests also add the daily goals that fit, which Today's goal
// setup card then asks them to set. (What they're working toward, K-08,
// is in Settings.)
function AboutStep({
  styles,
  initialUses,
  onNext,
}: {
  styles: Styles;
  initialUses: HoundUse[];
  onNext: (uses: HoundUse[]) => void;
}) {
  const { colors } = useTheme();
  const { user, updateUser } = useAuth();
  const { goals, addGoal } = useGoals();
  const askName = !!user?.needsName;
  const [name, setName] = useState('');
  const [uses, setUses] = useState<HoundUse[]>(initialUses);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const form = useUsernameForm(askName ? name : undefined);
  const hasUsername = !!user?.username;
  const toggleUse = (id: HoundUse) => setUses((cur) => (cur.includes(id) ? cur.filter((u) => u !== id) : [...cur, id]));
  const ready = (!askName || name.trim().length > 0) && uses.length > 0 && (!form.trimmed || form.valid);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      if (askName) {
        const saved = await setMyName(name);
        updateUser({ name: saved.name, initials: saved.initials, needsName: false });
      }
      // A username is optional: none typed keeps their name.
      if (!hasUsername) {
        if (form.trimmed) {
          if (!(await form.save())) return;
        } else {
          form.keepName();
        }
      }
      saveHoundUses(uses).catch(() => {});
      let room = MAX_GOALS - goals.length;
      for (const draft of extraGoalsFor(uses)) {
        const have = goals.some((g) => g.metric === draft.metric && g.period === draft.period && g.activity === draft.activity);
        if (have || room <= 0) continue;
        room -= 1;
        addGoal(draft).catch(() => {});
      }
      onNext(uses);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepPage
      styles={styles}
      title="About you"
      body="What to call you, and what you’re into. Hound suggests goals and challenges to match."
      footer={
        <>
          {(problem ?? form.problem) && <Text style={styles.problem}>{problem ?? form.problem}</Text>}
          <Button label={saving || form.saving ? 'Saving…' : 'Next'} variant="primary" block disabled={!ready || saving || form.saving} onPress={save} />
        </>
      }
    >
      <View style={styles.section}>
        {askName && (
          <TextField
            label="Your name"
            value={name}
            onChangeText={(v: string) => {
              setName(v);
              setProblem(null);
            }}
            placeholder="Jordan Lee"
            maxLength={40}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
          />
        )}
        {!hasUsername && (
          <>
            <Text style={styles.sectionLabel}>A USERNAME, IF YOU LIKE</Text>
            <Text style={styles.optionDetail}>Shown on leaderboards and in challenges instead of your name. Friends still see your name.</Text>
            <UsernameFields form={form} autoFocus={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>WHAT ARE YOUR INTERESTS?</Text>
        <View style={styles.chips}>
          {HOUND_USES.map((u) => {
            const on = uses.includes(u.id);
            const Icon = USE_ICONS[u.id];
            return (
              <Pressable
                key={u.id}
                onPress={() => toggleUse(u.id)}
                style={on ? [styles.chip, styles.chipOn] : styles.chip}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Icon size={16} color={on ? colors.accentActive : withAlpha(colors.text, 0.6)} weight={on ? 'fill' : 'regular'} />
                <Text style={on ? [styles.chipText, styles.chipTextOn] : styles.chipText}>{u.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

    </StepPage>
  );
}

// Page 3: the challenges open to everyone, each with its own Join, as many
// as they like. Or none: they're on Today too, and starting their own is
// one tap from there.
function JumpInStep({
  styles,
  initialGlobals,
  onNext,
}: {
  styles: Styles;
  initialGlobals: GlobalChallenge[];
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const currencyName = useCurrencyName();
  const [globals, setGlobals] = useState<GlobalChallenge[]>(initialGlobals);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  // Refresh once on open: the list was fetched when the wizard was
  // planned, and a window may have closed since.
  useEffect(() => {
    listGlobalChallenges()
      .then((all) => setGlobals(all.filter((c) => canJoin(c))))
      .catch(() => {});
  }, []);

  const join = async (c: GlobalChallenge) => {
    setJoiningId(c.id);
    try {
      await joinGlobalChallenge(c.id);
      setJoinedIds((cur) => new Set(cur).add(c.id));
    } catch (e) {
      Alert.alert("Couldn't join", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoiningId(null);
    }
  };

  const inOne = joinedIds.size > 0;

  return (
    <StepPage
      styles={styles}
      icon={<TrophyIcon size={28} color={colors.accent} weight="fill" />}
      title="Jump in"
      body="Challenges are where Hound gets fun. These are open to everyone: join as many as you like, and each one shows up on Today."
      footer={<Button label="Next" variant={inOne ? 'primary' : 'secondary'} block onPress={onNext} />}
    >
      {globals.length > 0 && (
        <View style={styles.section}>
          {globals.map((c) => {
            const typeName = c.kind === 'hunt' ? huntKindName() : (CHALLENGE_TYPES.find((t) => t.id === c.kind)?.name ?? 'Challenge');
            const isJoined = joinedIds.has(c.id) || c.joined;
            const deadline = joinDeadlineLine(c);
            return (
              <Card key={c.id} style={styles.panelRow} elevated={false}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.optionName}>{c.name}</Text>
                  <Text style={styles.optionDetail}>
                    {typeName} · {globalTimingLine(c)} · {c.participantCount} {c.participantCount === 1 ? 'player' : 'players'}
                    {c.prizes ? ` · 1st wins ${c.prizes[0]} ${currencyName}` : ''}
                  </Text>
                  {deadline && <Text style={styles.optionDetail}>{deadline}</Text>}
                  {c.sponsor && <SponsorLine challengeId={c.id} sponsor={c.sponsor} />}
                </View>
                <Button
                  label={isJoined ? 'Joined' : joiningId === c.id ? 'Joining…' : 'Join'}
                  variant={isJoined ? 'secondary' : 'primary'}
                  small
                  disabled={isJoined || joiningId !== null}
                  onPress={() => join(c)}
                />
              </Card>
            );
          })}
        </View>
      )}

      {inOne && <Text style={styles.success}>You’re in. {joinedIds.size === 1 ? 'It’s' : 'They’re'} on Today from now on.</Text>}
    </StepPage>
  );
}

const FREE_COATS = KENNEL_ITEMS.filter((i) => i.slot === 'coat' && i.costBones === 0);

function HoundStep({ styles, last, onNext }: { styles: Styles; last: boolean; onNext: () => void }) {
  const { colors } = useTheme();
  const [kennel, setKennelState] = useState<Kennel | null>(null);
  const [name, setName] = useState('');
  const [coatId, setCoatId] = useState<string | null>(null);
  const [ears, setEars] = useState<HoundEars>('floppy');
  const [asAvatar, setAsAvatar] = useState(true);
  const [saving, setSaving] = useState(false);
  // Or a photo of their dog as the avatar (0191, from 1.2.0): checked
  // here, used on Next. The photo's look can style the hound too.
  const photos = canAddPhoto();
  const [avatarChoice, setAvatarChoice] = useState<'hound' | 'dog'>('hound');
  const [dog, setDog] = useState<{ uri: string; photoId: string; look: DogLook } | null>(null);
  const [checking, setChecking] = useState(false);
  const [useLook, setUseLook] = useState(true);
  const [lookRest, setLookRest] = useState<{ tail: HoundTail; markings: HoundMarkings } | null>(null);

  const pickDog = async () => {
    try {
      const photo = await pickPhoto('library');
      if (!photo) return;
      setChecking(true);
      const result = await checkPhoto(photo.base64);
      if (!result.ok) {
        Alert.alert(result.limit ? 'That’s enough for today' : 'That doesn’t look like a dog', result.reason);
        return;
      }
      setDog({ uri: photo.uri, photoId: result.photoId, look: result.look });
      setAvatarChoice('dog');
      applyLook(result.look, true);
    } catch (e) {
      Alert.alert('Your dog’s photo', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setChecking(false);
    }
  };

  // The free parts of the dog's look go on the hound shown here (a coat
  // only if it's a free one); the rest is saved on Next.
  const applyLook = (look: DogLook, on: boolean) => {
    setUseLook(on);
    if (!on || !kennel) {
      setEars(kennel?.ears ?? 'floppy');
      setCoatId(kennel?.coatId ?? null);
      setLookRest(null);
      return;
    }
    setEars(look.ears);
    if (look.coat === null || FREE_COATS.some((c) => c.id === look.coat)) setCoatId(look.coat);
    setLookRest({ tail: look.tail, markings: look.markings });
  };

  useEffect(() => {
    getKennel()
      .then((k) => {
        setKennelState(k);
        setName(k.name);
        setCoatId(k.coatId);
        setEars(k.ears);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!kennel) return onNext();
    setSaving(true);
    try {
      const trimmed = name.trim();
      if (trimmed && trimmed !== kennel.name) await setKennel(trimmed, null);
      if (coatId !== kennel.coatId) {
        if (coatId && !kennel.owned.includes(coatId)) await buyKennelItem(coatId);
        await equipKennelItem('coat', coatId);
      }
      if (ears !== kennel.ears || lookRest) await setKennelLook({ ears, ...(lookRest ?? {}) });
      if (avatarChoice === 'dog' && dog) await chooseDogPhoto(dog.photoId);
      else if (asAvatar) await setHoundAvatar(true);
    } catch (e) {
      Alert.alert('Your hound', e instanceof Error ? e.message : 'Some of that didn’t save. You can change it in the Kennel.');
    }
    setSaving(false);
    onNext();
  };

  return (
    <StepPage
      styles={styles}
      title="Meet your hound"
      body="They’re happy when you hit your goals, and grow as you level up. Name them and pick a look."
      footer={<Button label={saving ? 'Saving…' : last ? 'Go to Today' : 'Next'} variant="primary" block disabled={saving || !kennel} onPress={save} />}
    >
      <View style={styles.houndArt}>
        <HoundArt rank="pup" mood="happy" coatId={coatId} ears={ears} tail={lookRest?.tail} markings={lookRest?.markings} size={130} />
      </View>
      {kennel ? (
        <View style={{ gap: 16, alignSelf: 'stretch' }}>
          <TextField label="Name" value={name} onChangeText={setName} maxLength={20} autoCorrect={false} />
          <View style={{ gap: 8 }}>
            <Text style={styles.panelLabel}>Coat</Text>
            <View style={styles.swatches}>
              {[{ id: null as string | null, color: TAN_SWATCH, name: 'Tan' }, ...FREE_COATS].map((c) => {
                const on = coatId === c.id;
                return (
                  <Pressable
                    key={c.id ?? 'tan'}
                    onPress={() => setCoatId(c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={c.name}
                    accessibilityState={{ selected: on }}
                    style={[styles.swatch, { backgroundColor: c.color }, on && styles.swatchOn]}
                  >
                    {on && <CheckIcon size={14} weight="bold" color="#fff" />}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={styles.panelLabel}>Ears</Text>
            <View style={styles.swatches}>
              {EAR_OPTIONS.map((o) => (
                <Pressable
                  key={o.id}
                  onPress={() => setEars(o.id)}
                  style={ears === o.id ? [styles.pill, styles.pillOn] : styles.pill}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ears === o.id }}
                >
                  <Text style={ears === o.id ? [styles.pillText, styles.pillTextOn] : styles.pillText}>{o.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {photos ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.panelLabel}>Your avatar</Text>
              <Pressable
                onPress={() => setAvatarChoice('hound')}
                style={avatarChoice === 'hound' ? [styles.option, styles.optionOn] : styles.option}
                accessibilityRole="radio"
                accessibilityState={{ checked: avatarChoice === 'hound' }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.optionName}>{name.trim() || 'Your hound'}</Text>
                  <Text style={styles.optionDetail}>Your hound next to your name on leaderboards and with friends.</Text>
                </View>
                {avatarChoice === 'hound' ? (
                  <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
                ) : (
                  <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
                )}
              </Pressable>
              <Pressable
                onPress={checking ? undefined : dog ? () => setAvatarChoice('dog') : pickDog}
                style={avatarChoice === 'dog' ? [styles.option, styles.optionOn] : styles.option}
                accessibilityRole="radio"
                accessibilityState={{ checked: avatarChoice === 'dog', busy: checking }}
              >
                {dog ? <Image source={{ uri: dog.uri }} style={{ width: 44, height: 44, borderRadius: 22 }} /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.optionName}>{checking ? 'Checking it’s a dog…' : dog ? 'A photo of my dog · checked' : 'A photo of my dog'}</Text>
                  <Text style={styles.optionDetail}>
                    {dog ? 'Friends see it; everyone else sees your hound. Tap to pick another.' : 'Friends see it, others see your hound. Hound can give your hound your dog’s look too.'}
                  </Text>
                </View>
                {checking ? (
                  <ActivityIndicator color={colors.accent} />
                ) : avatarChoice === 'dog' ? (
                  <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
                ) : (
                  <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
                )}
              </Pressable>
              {dog && avatarChoice === 'dog' && (
                <Pressable onPress={pickDog} accessibilityRole="button">
                  <Text style={[styles.optionDetail, { color: colors.accentActive, textAlign: 'center' }]}>Pick a different photo</Text>
                </Pressable>
              )}
              {dog && (
                <Pressable
                  onPress={() => applyLook(dog.look, !useLook)}
                  style={useLook ? [styles.option, styles.optionOn] : styles.option}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: useLook }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.optionName}>Give {name.trim() || 'your hound'} your dog’s look</Text>
                    <Text style={styles.optionDetail}>Ears, tail, markings and a free coat now. Other coats and breeds are in the Kennel.</Text>
                  </View>
                  {useLook ? (
                    <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
                  ) : (
                    <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
                  )}
                </Pressable>
              )}
            </View>
          ) : (
          <Pressable
              onPress={() => setAsAvatar((v) => !v)}
              style={asAvatar ? [styles.option, styles.optionOn] : styles.option}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: asAvatar }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.optionName}>Use as my avatar</Text>
                <Text style={styles.optionDetail}>Your hound shows next to your name on leaderboards and with friends.</Text>
              </View>
              {asAvatar ? (
                <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
              ) : (
                <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
              )}
            </Pressable>
          )}
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
    </StepPage>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
    stepCount: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    skip: { fontFamily: font.heading, fontSize: 15, color: colors.accentActive },
    page: { padding: 20, paddingTop: 28, gap: 16, alignItems: 'center' },
    badge: {
      width: 56,
      height: 56,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    eyebrow: { fontFamily: font.headingSemibold, fontSize: 11, letterSpacing: 1.5, color: colors.accentActive, textAlign: 'center' },
    title: { fontFamily: font.headingSemibold, fontSize: 26, letterSpacing: -0.4, color: colors.text, textAlign: 'center' },
    body: { fontSize: 15, lineHeight: 21, color: withAlpha(colors.text, 0.7), textAlign: 'center', maxWidth: 420 },
    footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 10 },
    problem: { fontSize: 13, color: colors.amber, textAlign: 'center' },
    success: { fontSize: 13.5, color: colors.accentActive, textAlign: 'center' },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.surface,
    },
    optionOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.1) },
    optionName: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    optionDetail: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    panel: { gap: 10, alignSelf: 'stretch' },
    panelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
    section: { gap: 10, alignSelf: 'stretch', marginTop: 4 },
    sectionLabel: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
      backgroundColor: colors.surface,
    },
    chipOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.12) },
    chipText: { fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    chipTextOn: { fontFamily: font.heading, color: colors.accentActive },
    panelLabel: { fontSize: 12, letterSpacing: 0.4, color: withAlpha(colors.text, 0.55) },
    code: { fontFamily: font.headingSemibold, fontSize: 28, letterSpacing: 2, color: colors.text },
    codeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    houndArt: {
      width: 160,
      height: 160,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.amber, 0.08),
      overflow: 'hidden',
    },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    swatch: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    swatchOn: { borderColor: colors.accent },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    pillOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.12) },
    pillText: { fontSize: 14, color: withAlpha(colors.text, 0.7) },
    pillTextOn: { fontFamily: font.heading, color: colors.accentActive },
  });
}
