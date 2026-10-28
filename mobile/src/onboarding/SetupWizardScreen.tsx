import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import {
  AtIcon,
  BarbellIcon,
  BellRingingIcon,
  CalendarCheckIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  FootprintsIcon,
  GlobeIcon,
  HeartbeatIcon,
  PersonSimpleRunIcon,
  ShareNetworkIcon,
  TrophyIcon,
  UserIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { GoalSetupCard } from '../components/GoalSetupCard';
import { ProgressBar } from '../components/ProgressBar';
import { SponsorLine } from '../components/SponsorLine';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, radius, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { useGoals } from '../goals/GoalsContext';
import { MAX_GOALS } from '../goals/goals';
import { askForPush, dismissPushOffer, getPushPermission } from '../notifications/pushPermission';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import { inviteMessage } from '../friends/discovery';
import { canJoin, globalTimingLine, joinGlobalChallenge, listGlobalChallenges, type GlobalChallenge } from '../challenges/globalChallenges';
import { huntKindName } from '../challenges/present';
import { CHALLENGE_TYPES, type ChallengeKind } from '../data/sampleData';
import { HoundArt } from '../kennel/HoundArt';
import { EAR_OPTIONS, KENNEL_ITEMS, TAN_SWATCH, type HoundEars } from '../kennel/kennelItems';
import { buyKennelItem, equipKennelItem, getKennel, setHoundAvatar, setKennel, setKennelLook, type Kennel } from '../kennel/kennelApi';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { claimOnboardingReward, getOnboardingStatus, type OnboardingStatus } from './onboardingApi';
import { markAskedForUsername, useUsernameForm, usernameBody, UsernameFields } from '../profiles/UsernameForm';
import { setMyName } from '../profiles/supabaseProfile';
import {
  CONNECT_PROMPT_SEEN_KEY,
  extraGoalsFor,
  finishWelcome,
  getWelcome,
  HOUND_USES,
  saveHoundUses,
  suggestedKind,
  type HoundUse,
} from './welcomeApi';

type StepId = 'health' | 'name' | 'uses' | 'goals' | 'push' | 'friend' | 'challenge' | 'hound' | 'done';

const USE_ICONS: Record<HoundUse, typeof FootprintsIcon> = {
  steps: FootprintsIcon,
  workouts: CalendarCheckIcon,
  strength: BarbellIcon,
  cardio: PersonSimpleRunIcon,
  friends: UsersThreeIcon,
  habits: CheckCircleIcon,
};

// The welcome wizard (0109_welcome_wizard.sql): one thing at a time
// instead of a Today full of setup cards. Right after sign-up, and once
// for anyone who never finished "Get started". From Today's "Finish
// setting up" (resume) it only shows the steps still left.
export function SetupWizardScreen({
  resume = false,
  onOpenGoals,
  onCreateChallenge,
  onFinish,
}: {
  resume?: boolean;
  onOpenGoals: () => void;
  onCreateChallenge: (kind: ChallengeKind) => void;
  onFinish: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const health = useHealthProvider();
  const { user } = useAuth();
  const { goalsSet } = useGoals();
  const [plan, setPlan] = useState<StepId[] | null>(null);
  const [index, setIndex] = useState(0);
  const [uses, setUses] = useState<HoundUse[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [auth, push, status, welcome] = await Promise.all([
        health.getAuthorizationStatus().catch(() => null),
        getPushPermission(),
        getOnboardingStatus().catch(() => null),
        getWelcome(),
      ]);
      if (cancelled) return;
      const saved = welcome?.uses ?? [];
      setUses(saved);
      const steps: StepId[] = [];
      if (auth !== 'authorized') steps.push('health');
      // Anyone without a username yet, new or finishing setup, and anyone
      // sign-up didn't give a name (NameStep asks for one first).
      if (!user?.username || user?.needsName) steps.push('name');
      if (!resume || saved.length === 0) steps.push('uses');
      if (!resume || !goalsSet) steps.push('goals');
      if (push === 'undetermined') steps.push('push');
      if (!status?.hasFriend) steps.push('friend');
      if (!status?.joinedChallenge) steps.push('challenge');
      if (!resume) steps.push('hound');
      steps.push('done');
      setPlan(steps);
    })();
    return () => {
      cancelled = true;
    };
    // Planned once, when the wizard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!plan) {
    return (
      <SafeAreaView style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const step = plan[index];
  const next = () => setIndex((i) => Math.min(i + 1, plan.length - 1));
  // Health can't be skipped from the top, only after trying it, and a
  // missing name can't be skipped at all.
  const canSkip = step !== 'health' && step !== 'done' && !(step === 'name' && user?.needsName);
  const counted = plan.length - 1;

  const skip = () => {
    if (step === 'push') dismissPushOffer();
    if (step === 'name' && user?.id) markAskedForUsername(user.id);
    next();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      {step !== 'done' && (
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.stepCount}>
              Step {index + 1} of {counted}
            </Text>
            <ProgressBar pct={((index + 1) / counted) * 100} height={4} />
          </View>
          {canSkip ? (
            <Pressable onPress={skip} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          ) : (
            <View style={{ width: 32 }} />
          )}
        </View>
      )}
      {step === 'health' && <HealthStep styles={styles} onNext={next} />}
      {step === 'name' && <NameStep styles={styles} onNext={next} />}
      {step === 'uses' && <UsesStep styles={styles} initial={uses} onNext={(u) => (setUses(u), next())} />}
      {step === 'goals' && <GoalsStep styles={styles} uses={uses} onOpenGoals={onOpenGoals} onNext={next} />}
      {step === 'push' && <PushStep styles={styles} onNext={next} />}
      {step === 'friend' && <FriendStep styles={styles} onNext={next} />}
      {step === 'challenge' && <ChallengeStep styles={styles} uses={uses} onCreate={onCreateChallenge} onNext={next} />}
      {step === 'hound' && <HoundStep styles={styles} onNext={next} />}
      {step === 'done' && <DoneStep styles={styles} onFinish={onFinish} />}
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

// A username for leaderboards and challenges instead of the name from
// sign-up (0030_username.sql). Choosing one turns it on there right away;
// friends still see the real name. "Keep my name" moves on without one.
// The form is shared with Today's ask (profiles/UsernameForm.tsx).
//
// When sign-up didn't bring a name (user.needsName: Sign in with Apple
// only shares one the first time), this asks "What should we call you?"
// above the username, and either button saves the name first.
function NameStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const { user, updateUser } = useAuth();
  const askName = !!user?.needsName;
  const [name, setName] = useState('');
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const form = useUsernameForm(askName ? name : undefined);
  const nameOk = !askName || name.trim().length > 0;
  const busy = form.saving || savingName;

  // True once there's a name to go on with (or none was needed).
  const saveName = async (): Promise<boolean> => {
    if (!askName) return true;
    setSavingName(true);
    setNameProblem(null);
    try {
      const saved = await setMyName(name);
      updateUser({ name: saved.name, initials: saved.initials, needsName: false });
      return true;
    } catch (e) {
      setNameProblem(e instanceof Error ? e.message : 'Could not save your name. Try again.');
      return false;
    } finally {
      setSavingName(false);
    }
  };

  return (
    <StepPage
      styles={styles}
      icon={
        askName ? (
          <UserIcon size={28} color={colors.accent} weight="bold" />
        ) : (
          <AtIcon size={28} color={colors.accent} weight="bold" />
        )
      }
      title={askName ? 'What should we call you?' : 'Pick a username'}
      body={
        askName
          ? 'Your name is what friends see. Then pick a username for leaderboards and challenges, if you like.'
          : usernameBody(form.name)
      }
      footer={
        <>
          {(nameProblem ?? form.problem) && <Text style={styles.problem}>{nameProblem ?? form.problem}</Text>}
          <Button
            label={busy ? 'Saving…' : 'Use this username'}
            variant="primary"
            block
            disabled={!nameOk || !form.valid || busy}
            onPress={async () => {
              if ((await saveName()) && (await form.save())) onNext();
            }}
          />
          <Button
            label={askName ? 'Just my name' : 'Keep my name'}
            variant="ghost"
            block
            disabled={!nameOk || busy}
            onPress={async () => {
              if (!(await saveName())) return;
              form.keepName();
              onNext();
            }}
          />
        </>
      }
    >
      <View style={{ gap: 18, alignSelf: 'stretch' }}>
        {askName && (
          <TextField
            label="Your name"
            value={name}
            onChangeText={(v: string) => {
              setName(v);
              setNameProblem(null);
            }}
            placeholder="Jordan Lee"
            maxLength={40}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            autoFocus
          />
        )}
        <UsernameFields form={form} autoFocus={!askName} />
      </View>
    </StepPage>
  );
}

function UsesStep({ styles, initial, onNext }: { styles: Styles; initial: HoundUse[]; onNext: (uses: HoundUse[]) => void }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<HoundUse[]>(initial);
  const toggle = (id: HoundUse) => setPicked((cur) => (cur.includes(id) ? cur.filter((u) => u !== id) : [...cur, id]));

  const save = () => {
    saveHoundUses(picked).catch(() => {});
    onNext(picked);
  };

  return (
    <StepPage
      styles={styles}
      title="How will you use Hound?"
      body="Pick any. Hound suggests goals and challenges to match."
      footer={<Button label="Next" variant="primary" block disabled={picked.length === 0} onPress={save} />}
    >
      <View style={{ gap: 10, alignSelf: 'stretch' }}>
        {HOUND_USES.map((u) => {
          const on = picked.includes(u.id);
          const Icon = USE_ICONS[u.id];
          return (
            <Pressable
              key={u.id}
              onPress={() => toggle(u.id)}
              style={on ? [styles.option, styles.optionOn] : styles.option}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Icon size={22} color={on ? colors.accent : withAlpha(colors.text, 0.6)} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.optionName}>{u.name}</Text>
                <Text style={styles.optionDetail}>{u.detail}</Text>
              </View>
              {on ? (
                <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
              ) : (
                <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
              )}
            </Pressable>
          );
        })}
      </View>
    </StepPage>
  );
}

function GoalsStep({
  styles,
  uses,
  onOpenGoals,
  onNext,
}: {
  styles: Styles;
  uses: HoundUse[];
  onOpenGoals: () => void;
  onNext: () => void;
}) {
  const { goals, loaded, addGoal } = useGoals();
  // Adds the goals that fit what they picked, once, before they set targets.
  const added = useRef(false);
  useEffect(() => {
    if (!loaded || added.current) return;
    added.current = true;
    let room = MAX_GOALS - goals.length;
    for (const draft of extraGoalsFor(uses)) {
      const have = goals.some((g) => g.metric === draft.metric && g.period === draft.period && g.activity === draft.activity);
      if (have || room <= 0) continue;
      room -= 1;
      addGoal(draft).catch(() => {});
    }
  }, [loaded, goals, uses, addGoal]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <GoalSetupCard canDismiss={false} onDone={onNext} onMoreOptions={onOpenGoals} />
    </ScrollView>
  );
}

function PushStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [asking, setAsking] = useState(false);

  const turnOn = async () => {
    if (!user?.id) return onNext();
    setAsking(true);
    await askForPush(user.id);
    setAsking(false);
    onNext();
  };

  return (
    <StepPage
      styles={styles}
      icon={<BellRingingIcon size={28} color={colors.accent} weight="fill" />}
      title="Turn on notifications"
      body="Hound nudges you when a goal’s still open, a friend adds you, or it’s your move in a challenge. You choose what you get in Settings."
      footer={<Button label={asking ? 'Turning on…' : 'Turn on'} variant="primary" block disabled={asking} onPress={turnOn} />}
    />
  );
}

function FriendStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const [myCode, setMyCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabaseFriendsProvider
      .getMyFriendCode()
      .then(setMyCode)
      .catch(() => {});
  }, []);

  const invite = () => {
    if (!myCode) return;
    Share.share({ message: inviteMessage(myCode) })
      .then(() => setDone(true))
      .catch(() => {});
  };

  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      // A bare code or a whole houndchallenge.net/f/… link.
      await supabaseFriendsProvider.addFriendByCode(code);
      setDone(true);
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that. Try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <StepPage
      styles={styles}
      icon={<UserPlusIcon size={28} color={colors.accent} weight="fill" />}
      title="Add a friend"
      body="Hound is better with someone to chase. Send them your code, or enter theirs."
      footer={done ? <Button label="Next" variant="primary" block onPress={onNext} /> : undefined}
    >
      <Card style={styles.panel} elevated={false}>
        <Text style={styles.panelLabel}>Your code</Text>
        <Text style={styles.code} selectable>
          {myCode ?? '…'}
        </Text>
        <Button
          label="Send an invite"
          variant="primary"
          small
          icon={<ShareNetworkIcon size={14} color={colors.accent} />}
          disabled={!myCode}
          onPress={invite}
        />
      </Card>
      <Card style={styles.panel} elevated={false}>
        <View style={styles.codeRow}>
          <TextField
            label="Got their code or link?"
            value={code}
            onChangeText={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            placeholder="e.g. Ab3xK9pQ"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1 }}
          />
          <View style={{ paddingBottom: 2 }}>
            <Button label={adding ? 'Adding…' : 'Add'} variant="primary" small disabled={adding || !code.trim()} onPress={add} />
          </View>
        </View>
        {error && <Text style={styles.problem}>{error}</Text>}
      </Card>
      {done && <Text style={styles.success}>Nice. Your friends show up under Friends.</Text>}
    </StepPage>
  );
}

function ChallengeStep({
  styles,
  uses,
  onCreate,
  onNext,
}: {
  styles: Styles;
  uses: HoundUse[];
  onCreate: (kind: ChallengeKind) => void;
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const currencyName = useCurrencyName();
  const [globals, setGlobals] = useState<GlobalChallenge[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    listGlobalChallenges()
      .then((all) => setGlobals(all.filter((c) => canJoin(c)).slice(0, 2)))
      .catch(() => setGlobals([]));
  }, []);

  // Back from Create: did they start one?
  useFocusEffect(
    useCallback(() => {
      getOnboardingStatus()
        .then((s) => s?.joinedChallenge && setJoined(true))
        .catch(() => {});
    }, []),
  );

  const join = async (c: GlobalChallenge) => {
    setJoiningId(c.id);
    try {
      await joinGlobalChallenge(c.id);
      setJoined(true);
    } catch (e) {
      Alert.alert("Couldn't join", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoiningId(null);
    }
  };

  const kind = suggestedKind(uses);
  const type = CHALLENGE_TYPES.find((t) => t.id === kind)!;
  const kindName = kind === 'hunt' ? huntKindName() : type.name;

  return (
    <StepPage
      styles={styles}
      icon={<TrophyIcon size={28} color={colors.accent} weight="fill" />}
      title={globals && globals.length > 0 ? 'Join a challenge' : 'Start a challenge'}
      body={
        globals && globals.length > 0
          ? 'Everyone on Hound can join these. Or start your own with friends.'
          : 'Challenges are where Hound gets fun. Here’s one that fits what you picked.'
      }
      footer={joined ? <Button label="Next" variant="primary" block onPress={onNext} /> : undefined}
    >
      {globals === null && <ActivityIndicator color={colors.accent} />}
      {(globals ?? []).map((c) => (
        <Card key={c.id} style={styles.panel} elevated={false}>
          <View style={styles.rowCenter}>
            <GlobeIcon size={18} color={colors.accent} />
            <Text style={styles.optionName}>{c.name}</Text>
          </View>
          <Text style={styles.optionDetail}>
            {globalTimingLine(c)} · {c.participantCount} {c.participantCount === 1 ? 'player' : 'players'}
            {c.prizes ? ` · 1st wins ${c.prizes[0]} ${currencyName}` : ''}
          </Text>
          {c.sponsor && <SponsorLine challengeId={c.id} sponsor={c.sponsor} />}
          <Button
            label={joined ? 'Joined' : joiningId === c.id ? 'Joining…' : 'Join'}
            variant="primary"
            small
            disabled={joined || joiningId !== null}
            onPress={() => join(c)}
          />
        </Card>
      ))}
      <Card style={styles.panel} elevated={false}>
        {globals && globals.length > 0 && <Text style={styles.panelLabel}>Or start your own</Text>}
        <Text style={styles.optionName}>{kindName}</Text>
        <Text style={styles.optionDetail}>{type.desc}</Text>
        <Button
          label={`Start a ${kindName}`}
          variant={globals && globals.length > 0 ? 'secondary' : 'primary'}
          small
          onPress={() => onCreate(kind)}
        />
      </Card>
      {joined && <Text style={styles.success}>You’re in. It’s on Today from now on.</Text>}
    </StepPage>
  );
}

const FREE_COATS = KENNEL_ITEMS.filter((i) => i.slot === 'coat' && i.costBones === 0);

function HoundStep({ styles, onNext }: { styles: Styles; onNext: () => void }) {
  const { colors } = useTheme();
  const [kennel, setKennelState] = useState<Kennel | null>(null);
  const [name, setName] = useState('');
  const [coatId, setCoatId] = useState<string | null>(null);
  const [ears, setEars] = useState<HoundEars>('floppy');
  const [asAvatar, setAsAvatar] = useState(true);
  const [saving, setSaving] = useState(false);

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
      if (ears !== kennel.ears) await setKennelLook({ ears });
      if (asAvatar) await setHoundAvatar(true);
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
      footer={<Button label={saving ? 'Saving…' : 'Done'} variant="primary" block disabled={saving || !kennel} onPress={save} />}
    >
      <View style={styles.houndArt}>
        <HoundArt rank="pup" mood="happy" coatId={coatId} ears={ears} size={130} />
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
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} />
      )}
    </StepPage>
  );
}

function DoneStep({ styles, onFinish }: { styles: Styles; onFinish: () => void }) {
  const { colors } = useTheme();
  const currencyName = useCurrencyName();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [rewarded, setRewarded] = useState<number | null>(null);

  useEffect(() => {
    finishWelcome().catch(() => {});
    getOnboardingStatus()
      .then(async (s) => {
        setStatus(s);
        if (s && s.healthConnected && s.hasFriend && s.joinedChallenge && !s.rewardClaimed) {
          const bones = await claimOnboardingReward();
          setRewarded(bones);
          notifyBonesChanged();
        }
      })
      .catch(() => {});
  }, []);

  const rows: { label: string; done: boolean }[] = status
    ? [
        { label: 'Health connected', done: status.healthConnected },
        { label: 'A friend added', done: status.hasFriend },
        { label: 'In a challenge', done: status.joinedChallenge },
      ]
    : [];

  return (
    <StepPage
      styles={styles}
      icon={<CheckCircleIcon size={28} color={colors.accent} weight="fill" />}
      title={!status || (status.healthConnected && status.hasFriend && status.joinedChallenge) ? 'You’re all set' : 'Nice start'}
      body={
        rewarded !== null
          ? `+${rewarded} ${currencyName} for getting started.`
          : status && !status.rewardClaimed
            ? `Finish the rest from Today to earn ${status.rewardBones} ${currencyName}.`
            : 'Today shows your goals and challenges from here on.'
      }
      footer={<Button label="Go to Today" variant="primary" block onPress={onFinish} />}
    >
      {rows.length > 0 && (
        <Card style={styles.panel} elevated={false}>
          {rows.map((r) => (
            <View key={r.label} style={styles.rowCenter}>
              {r.done ? (
                <CheckCircleIcon size={20} color={colors.accent} weight="fill" />
              ) : (
                <CircleIcon size={20} color={withAlpha(colors.text, 0.3)} />
              )}
              <Text style={r.done ? styles.optionName : styles.optionDetail}>{r.label}</Text>
            </View>
          ))}
        </Card>
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
