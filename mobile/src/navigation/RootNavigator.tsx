import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingView } from '../components/LoadingView';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from './types';
import { MainScreen } from '../screens/MainScreen';
import { CreateScreen } from '../screens/CreateScreen';
import { ChallengeDetailScreen } from '../screens/ChallengeDetailScreen';
import { FriendDetailScreen } from '../screens/FriendDetailScreen';
import { LockerScreen } from '../screens/LockerScreen';
import { KennelScreen } from '../screens/KennelScreen';
import { JourneyScreen } from '../screens/JourneyScreen';
import { JourneyPickerScreen } from '../screens/JourneyPickerScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { AdminUserDetailScreen } from '../screens/AdminUserDetailScreen';
import { OrgManagementScreen } from '../screens/OrgManagementScreen';
import { OrgDetailScreen } from '../screens/OrgDetailScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { AchievementsScreen } from '../screens/AchievementsScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { JoinCodeScreen } from '../screens/JoinCodeScreen';
import { ClubScreen } from '../screens/ClubScreen';
import { StartClubScreen } from '../screens/StartClubScreen';
import { PackFunHubScreen } from '../packFun/PackFunHubScreen';
import { PackFunStartScreen } from '../packFun/PackFunStartScreen';
import { PackFunScreen } from '../packFun/PackFunScreen';
import { FastingScreen } from '../fasting/FastingScreen';
import { FastingGameScreen } from '../fasting/FastingGameScreen';
import { FastingBoardScreen } from '../fasting/FastingBoardScreen';
import { FastingPackScreen } from '../fasting/FastingPackScreen';
import { GolfPlayScreen } from '../screens/GolfPlayScreen';
import { HoopsShootScreen } from '../screens/HoopsShootScreen';
import { BaseballBatScreen } from '../screens/BaseballBatScreen';
import { CricketPlayScreen } from '../screens/CricketPlayScreen';
import { RouletteScreen } from '../screens/RouletteScreen';
import { SlotsScreen } from '../screens/SlotsScreen';
import { LongShotScreen } from '../screens/LongShotScreen';
import { BullseyeScreen } from '../screens/BullseyeScreen';
import { ChessScreen } from '../screens/ChessScreen';
import { HorseShootScreen } from '../screens/HorseShootScreen';
import { DerbyBatScreen } from '../screens/DerbyBatScreen';
import { ShootoutKickScreen } from '../screens/ShootoutKickScreen';
import { BoutRingScreen } from '../screens/BoutRingScreen';
import { GlobalInviteScreen } from '../screens/GlobalInviteScreen';
import { useChallengeCodeLinks } from '../challenges/codeLinks';
import { ConnectScreen } from '../screens/ConnectScreen';
import { MetricsScreen } from '../screens/MetricsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { GoalsScreen } from '../screens/GoalsScreen';
import { StackPage } from '../components/StackPage';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';
import { useNotificationTaps } from '../notifications/notificationTaps';
import { SetupWizardScreen } from '../onboarding/SetupWizardScreen';
import { CONNECT_PROMPT_SEEN_KEY, getWelcome } from '../onboarding/welcomeApi';

const Stack = createNativeStackNavigator<RootStackParamList>();
// A separate, untyped single-screen navigator just for the connect-gate
// branch below — ConnectScreen uses useFocusEffect (see its own comment:
// it re-checks health auth status every time it's focused, not just on
// mount), which throws "Couldn't find a navigation object" without a
// real NavigationContainer/navigator ancestor. That branch renders
// ConnectScreen directly, deliberately outside the main Stack.Navigator
// below (see its own comment), so it needs its own minimal one instead
// of borrowing that one — this was a real, always-reproducing crash the
// moment connectGate ever actually reached 'show', just never hit
// before now: this was the previously-fixed connectGate hang keeping it
// permanently stuck on 'checking', so this branch never mounted at all.
const ConnectGateStack = createNativeStackNavigator();

// Once someone's dealt with this (connected, or tapped "Skip for now"),
// it never interrupts a launch again — from then on it's You → Health
// data, there to revisit whenever. Device-scoped rather than
// per-account on purpose: whether this phone's HealthKit/Health Connect
// access is granted is an OS-level fact, not something a second Hound
// account signing in on the same device needs asked again. The key
// (CONNECT_PROMPT_SEEN_KEY) lives in welcomeApi.ts, since the setup
// wizard's health step sets it too.
//
// The setup wizard (0109_welcome_wizard.sql) comes first when the
// server says this account should see it; it has its own health step,
// so the prompt above doesn't show then. Once an account is past it,
// that's remembered on the phone so later launches don't ask again.
const welcomeDoneKey = (userId: string) => `hound:welcome-done:${userId}`;

// 'checking': the AsyncStorage read + health.getAuthorizationStatus() call
// below haven't resolved yet — rendered the same as `initializing`, so a
// fresh sign-in never flashes Main before this decides. 'show': neither
// seen before nor already authorized — this is what makes ConnectScreen
// appear right after a first login instead of relying on someone finding
// it in the nav. 'hide': already seen, or health access already granted
// (e.g. restored from a previous session) — go straight to Main.
type ConnectGate = 'checking' | 'show' | 'hide';

export function RootNavigator() {
  const { status, initializing, user } = useAuth();
  const health = useHealthProvider();
  const { colors } = useTheme();
  const [connectGate, setConnectGate] = useState<ConnectGate>('checking');
  const [showSetup, setShowSetup] = useState(false);
  // Lets a tapped push open a screen (src/notifications/notificationTaps.ts).
  // Only the main, signed-in container below carries the ref.
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [navReady, setNavReady] = useState(false);
  useNotificationTaps(navigationRef, status === 'signedIn' && connectGate === 'hide', navReady);
  useChallengeCodeLinks(navigationRef, status === 'signedIn' && connectGate === 'hide', navReady);

  useEffect(() => {
    if (status !== 'signedIn') {
      // Reset so a sign-out followed by a different sign-in re-checks
      // fresh, rather than reusing whichever gate the previous session
      // last landed on.
      setConnectGate('checking');
      setShowSetup(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const userId = user?.id ?? null;
      const [seen, authStatus, welcomeDone] = await Promise.all([
        AsyncStorage.getItem(CONNECT_PROMPT_SEEN_KEY),
        health.getAuthorizationStatus(),
        userId ? AsyncStorage.getItem(welcomeDoneKey(userId)).catch(() => null) : 'true',
      ]);
      const welcome = welcomeDone === 'true' ? null : await getWelcome();
      if (cancelled) return;
      if (userId && welcome && !welcome.show) AsyncStorage.setItem(welcomeDoneKey(userId), 'true').catch(() => {});
      if (welcome?.show) {
        setShowSetup(true);
        setConnectGate('hide');
        return;
      }
      setConnectGate(seen !== 'true' && authStatus !== 'authorized' ? 'show' : 'hide');
    })().catch(() => {
      // health.getAuthorizationStatus() is now guarded not to throw on
      // both platforms (see iosProvider.ts/androidProvider.ts), but this
      // stays as a second line of defense: an unhandled rejection here
      // used to leave connectGate stuck on 'checking' forever — a
      // permanent spinner that looked like a blank screen and
      // reproduced on every relaunch. Falling back to 'hide' means the
      // worst case is skipping the connect prompt once, not being
      // locked out of the app.
      if (!cancelled) setConnectGate('hide');
    });
    return () => {
      cancelled = true;
    };
  }, [status, health, user?.id]);

  const dismissConnectPrompt = useCallback(() => {
    setConnectGate('hide');
    AsyncStorage.setItem(CONNECT_PROMPT_SEEN_KEY, 'true').catch(() => {
      // Best-effort — this session still moves on to Main either way,
      // it just might ask again next launch if this write never lands.
    });
  }, []);

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.divider,
        primary: colors.accent,
      },
    }),
    [colors],
  );

  // Only non-instant when Supabase is configured (mock auth never
  // persists a session, so there's nothing to wait on) — restoring a
  // session from AsyncStorage is fast but still async, and briefly
  // showing Welcome before swapping to Main would be worse than a beat of
  // blank screen.
  if (initializing || (status === 'signedIn' && connectGate === 'checking')) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <LoadingView />
      </View>
    );
  }

  // Deliberately outside the Stack.Navigator below — a plain full-screen
  // gate, the same way the spinner above is, rather than a Stack.Screen
  // this would have to navigate to (and briefly show Main's own first
  // screen behind before redirecting). onDone is the one thing that
  // marks CONNECT_PROMPT_SEEN_KEY, so tapping "Skip for now" counts as
  // "dealt with" exactly the same as actually connecting — either way
  // this never interrupts a launch again.
  if (status === 'signedIn' && connectGate === 'show') {
    return (
      <NavigationContainer theme={navTheme}>
        <ConnectGateStack.Navigator screenOptions={{ headerShown: false }}>
          <ConnectGateStack.Screen name="ConnectGate">
            {() => (
              <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
                <ConnectScreen onDone={dismissConnectPrompt} />
              </SafeAreaView>
            )}
          </ConnectGateStack.Screen>
        </ConnectGateStack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={() => setNavReady(true)}>
      <Stack.Navigator
        screenOptions={{ headerShown: false }}
        initialRouteName={status === 'signedOut' ? 'Welcome' : showSetup ? 'Setup' : 'Main'}
      >
        {status === 'signedOut' ? (
          // Rendering a completely different set of Stack.Screen children
          // swaps the navigator's whole state — the standard React
          // Navigation auth-flow pattern. Signing in immediately replaces
          // this group with the Main one below; there's no back button
          // into Welcome/Login/SignUp afterwards.
          <Stack.Group>
            <Stack.Screen name="Welcome">
              {({ navigation }) => (
                <WelcomeScreen
                  onContinueWithEmail={() => navigation.navigate('Login')}
                  onCreateAccount={() => navigation.navigate('SignUp')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Login" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <LoginScreen onBack={() => navigation.goBack()} onCreateAccount={() => navigation.navigate('SignUp')} />
              )}
            </Stack.Screen>
            <Stack.Screen name="SignUp" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <SignUpScreen onBack={() => navigation.goBack()} onLogIn={() => navigation.navigate('Login')} />
              )}
            </Stack.Screen>
          </Stack.Group>
        ) : (
          <Stack.Group>
            <Stack.Screen name="Main" component={MainScreen} />
            <Stack.Screen name="Create" options={{ animation: 'slide_from_bottom' }}>
              {({ navigation, route }) => (
                <CreateScreen
                  rematch={route.params?.rematch}
                  global={route.params?.global}
                  inviteUserIds={route.params?.inviteUserIds}
                  clubId={route.params?.clubId}
                  // Always lands on the Challenges tab, regardless of
                  // whether Create was opened from Home or Challenges —
                  // same "land somewhere fixed and meaningful" reasoning
                  // as Hunt's and ChallengeDetail's onBack below, rather
                  // than goBack() popping to wherever the wizard happened
                  // to be opened from. Matches onFinish below, so
                  // cancelling and finishing the wizard land in the same
                  // place.
                  // A global challenge is published from Admin, so it
                  // returns there instead.
                  kind={route.params?.kind}
                  onOpenChallenge={(challengeId) => navigation.replace('ChallengeDetail', { challengeId })}
                  onCancel={() =>
                    route.params?.global || route.params?.fromSetup
                      ? navigation.goBack()
                      : navigation.navigate('Main', { tab: 'challenges' })
                  }
                  // Used to always go to the static Hunt screen, regardless
                  // of what kind of challenge (or name) was actually
                  // created — every real challenge landed on the same
                  // hardcoded "Marcus is chasing you" content with no
                  // connection to what the user just made. Back to the
                  // Challenges tab instead, where ChallengesScreen's real
                  // read (src/challenges/present.ts) shows the actual new
                  // challenge.
                  onFinish={() =>
                    route.params?.global || route.params?.fromSetup
                      ? navigation.goBack()
                      : navigation.navigate('Main', { tab: 'challenges' })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="ChallengeDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <ChallengeDetailScreen
                  challengeId={route.params.challengeId}
                  initialTab={route.params.tab}
                  onRematch={(rematch) => navigation.navigate('Create', { rematch })}
                  onBack={() => navigation.navigate('Main', { tab: 'challenges' })}
                  onGoHome={() => navigation.navigate('Main', { tab: 'home' })}
                  onPlayGolf={() => navigation.navigate('GolfPlay', { challengeId: route.params.challengeId })}
                  onShootHoops={() => navigation.navigate('HoopsShoot', { challengeId: route.params.challengeId })}
                  onBatBaseball={() => navigation.navigate('BaseballBat', { challengeId: route.params.challengeId })}
                  onPlayCricket={() => navigation.navigate('CricketPlay', { challengeId: route.params.challengeId })}
                  onSpinRoulette={() => navigation.navigate('Roulette', { challengeId: route.params.challengeId })}
                  onPlaySlots={() => navigation.navigate('Slots', { challengeId: route.params.challengeId })}
                  onPlayLongShot={() => navigation.navigate('LongShot', { challengeId: route.params.challengeId })}
                  onPlayBullseye={() => navigation.navigate('Bullseye', { challengeId: route.params.challengeId })}
                  onOpenPrizes={() => navigation.navigate('Kennel', { tab: 'prizes' })}
                  onPlayChess={(mode) => navigation.navigate('Chess', { challengeId: route.params.challengeId, mode })}
                  onShootHorse={() => navigation.navigate('HorseShoot', { challengeId: route.params.challengeId })}
                  onBatDerby={() => navigation.navigate('DerbyBat', { challengeId: route.params.challengeId })}
                  onKickShootout={() => navigation.navigate('ShootoutKick', { challengeId: route.params.challengeId })}
                  onBoutRing={(mode, kind) => navigation.navigate('BoutRing', { challengeId: route.params.challengeId, mode, kind })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="FriendDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <FriendDetailScreen
                  friendshipId={route.params.friendshipId}
                  friendUserId={route.params.friendUserId}
                  friendName={route.params.friendName}
                  friendInitials={route.params.friendInitials}
                  friendFrameId={route.params.friendFrameId}
                  friendBackgroundId={route.params.friendBackgroundId}
                  friendIconId={route.params.friendIconId}
                  // Back to wherever it was opened from (Friends, or the dog
                  // park in the Kennel); Friends when there's nothing behind.
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { tab: 'friends' }))}
                  onChallenge={() => navigation.navigate('Create', { inviteUserIds: [route.params.friendUserId] })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Locker" options={{ animation: 'slide_from_right' }}>
              {/* Opened from the You tab — goBack() returns there. */}
              {({ navigation }) => (
                <LockerScreen onBack={() => navigation.goBack()} onOpenGames={() => navigation.navigate('Create', {})} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Kennel" options={{ animation: 'slide_from_right' }}>
              {/* Opened from Today or the You tab — goBack() returns there. */}
              {({ navigation, route }) => (
                <KennelScreen
                  initialTab={route.params?.tab}
                  onBack={() => navigation.goBack()}
                  onOpenLocker={() => navigation.navigate('Locker')}
                  onOpenFriend={(h) =>
                    navigation.navigate('FriendDetail', {
                      friendshipId: h.friendshipId,
                      friendUserId: h.userId,
                      friendName: h.owner,
                      friendInitials: h.owner
                        .split(/\s+/)
                        .map((w) => w[0] ?? '')
                        .join('')
                        .slice(0, 2)
                        .toUpperCase(),
                      friendFrameId: h.frameId,
                      friendBackgroundId: h.backgroundId,
                      friendIconId: h.iconId,
                    })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Journey" options={{ animation: 'slide_from_right' }}>
              {/* Opened from the You tab — goBack() returns there. */}
              {({ navigation }) => (
                <JourneyScreen onBack={() => navigation.goBack()} onPick={() => navigation.navigate('JourneyPicker')} />
              )}
            </Stack.Screen>
            <Stack.Screen name="JourneyPicker" options={{ animation: 'slide_from_right' }}>
              {/* From the You tab or a Journey; once started, the new
                  Journey takes the picker's place. */}
              {({ navigation }) => (
                <JourneyPickerScreen onBack={() => navigation.goBack()} onStarted={() => navigation.replace('Journey')} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Admin" options={{ animation: 'slide_from_right' }}>
              {/* Reached from TopNav's own admin icon, visible on every
                  tab — goBack() naturally returns to whichever tab that
                  was, unlike Hunt/Create above, which deliberately land
                  on one fixed tab since they can be opened from several
                  different starting points. */}
              {({ navigation }) => (
                <AdminScreen
                  onBack={() => navigation.goBack()}
                  onNewGlobalChallenge={() => navigation.navigate('Create', { global: true })}
                  onOpenOrgs={() => navigation.navigate('OrgManagement')}
                  onOpenUser={(u) =>
                    navigation.navigate('AdminUserDetail', {
                      userId: u.id,
                      name: u.name,
                      initials: u.initials,
                      frameId: u.frameId,
                      backgroundId: u.backgroundId,
                      iconId: u.iconId,
                      email: u.email,
                      lastActiveAt: u.lastActiveAt,
                      createdAt: u.createdAt,
                    })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="AdminUserDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <AdminUserDetailScreen
                  userId={route.params.userId}
                  name={route.params.name}
                  initials={route.params.initials}
                  frameId={route.params.frameId}
                  backgroundId={route.params.backgroundId}
                  iconId={route.params.iconId}
                  email={route.params.email}
                  lastActiveAt={route.params.lastActiveAt}
                  createdAt={route.params.createdAt}
                  onBack={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="OrgManagement" options={{ animation: 'slide_from_right' }}>
              {/* Reached from TopNav's own org icon — only for a platform
                  admin, who picks which org to manage from here. An
                  org's own (non-platform-admin) admin skips this screen
                  entirely: TopNav sends them straight to OrgDetail below
                  for their one org instead. */}
              {({ navigation }) => (
                <OrgManagementScreen
                  onBack={() => navigation.goBack()}
                  onOpenOrg={(organizationId) => navigation.navigate('OrgDetail', { organizationId })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="OrgDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <OrgDetailScreen organizationId={route.params.organizationId} onBack={() => navigation.goBack()} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Help" options={{ animation: 'slide_from_right' }}>
              {/* Opened from the You tab — goBack() returns there. */}
              {({ navigation }) => <HelpScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
            {/* Stats & records, Settings and Health data used to be tabs (or
                behind your name in the top bar); now they open from You,
                and goBack() returns there. */}
            <Stack.Screen name="Stats" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <MetricsScreen />
                </StackPage>
              )}
            </Stack.Screen>
            {/* Opened from the You tab and from Today's goals card, so the
                back button just says Back. */}
            <Stack.Screen name="Goals" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage backLabel="Back" onBack={() => navigation.goBack()}>
                  <GoalsScreen />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="Settings" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <SettingsScreen onOpenLocker={() => navigation.navigate('Locker')} />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="HealthData" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <StackPage onBack={() => navigation.goBack()}>
                  <ConnectScreen onDone={() => navigation.goBack()} title="Health data" doneLabel="Done" />
                </StackPage>
              )}
            </Stack.Screen>
            <Stack.Screen name="Setup" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {({ navigation, route }) => (
                <SetupWizardScreen
                  resume={route.params?.resume}
                  onOpenGoals={() => navigation.navigate('Goals')}
                  onCreateChallenge={(kind) => navigation.navigate('Create', { kind, fromSetup: true })}
                  onFinish={() => {
                    if (user?.id) AsyncStorage.setItem(welcomeDoneKey(user.id), 'true').catch(() => {});
                    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
                  }}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="JoinCode" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <JoinCodeScreen
                  code={route.params.code}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { tab: 'challenges' }))}
                  onJoined={(challengeId) => navigation.replace('ChallengeDetail', { challengeId })}
                  onJoinedClub={(clubId) => navigation.replace('Club', { clubId })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Club" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <ClubScreen
                  clubId={route.params.clubId}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { tab: 'clubs' }))}
                  onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
                  onPostChallenge={() => navigation.navigate('Create', { clubId: route.params.clubId })}
                  onEdit={() => navigation.navigate('StartClub', { clubId: route.params.clubId })}
                  onStartPackFun={() => navigation.navigate('PackFunStart', { clubId: route.params.clubId })}
                  onOpenPackFun={(packId) => navigation.navigate('PackFun', { packId })}
                  onOpenFasting={() => navigation.navigate('Fasting')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="PackFunHub" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <PackFunHubScreen
                  onBack={() => navigation.goBack()}
                  onOpen={(packId) => navigation.navigate('PackFun', { packId })}
                  onStart={() => navigation.navigate('PackFunStart')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="PackFunStart" options={{ animation: 'slide_from_bottom' }}>
              {({ navigation, route }) => (
                <PackFunStartScreen
                  clubId={route.params?.clubId}
                  onBack={() => navigation.goBack()}
                  onStarted={(packId) => navigation.replace('PackFun', { packId })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="PackFun" options={{ animation: 'slide_from_right' }}>
              {/* From the list, a push, or right after starting one. */}
              {({ navigation, route }) => (
                <PackFunScreen
                  key={route.params.packId}
                  packId={route.params.packId}
                  myId={user?.id ?? ''}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('PackFunHub'))}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Fasting" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <FastingScreen
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { tab: 'home' }))}
                  onOpenPack={(packId) => navigation.navigate('FastingPack', { packId })}
                  onOpenClub={(clubId) => navigation.navigate('Club', { clubId })}
                  onPlayGame={(fastId, slot) => navigation.navigate('FastingGame', { fastId, slot })}
                  onOpenGamesBoard={() => navigation.navigate('FastingBoard')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="FastingGame" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* A phase game (0269), from the strip under the dial. */}
              {({ navigation, route }) => (
                <FastingGameScreen
                  key={`${route.params.fastId}-${route.params.slot}`}
                  fastId={route.params.fastId}
                  slot={route.params.slot}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Fasting'))}
                  onOpenBoard={() => navigation.replace('FastingBoard')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="FastingBoard" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <FastingBoardScreen onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Fasting'))} />
              )}
            </Stack.Screen>
            <Stack.Screen name="FastingPack" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <FastingPackScreen
                  key={route.params.packId}
                  packId={route.params.packId}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Fasting'))}
                  onOpenFasting={() => navigation.navigate('Fasting')}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="GolfPlay" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Golf: your ball on the course, from the challenge's card. */}
              {({ navigation, route }) => (
                <GolfPlayScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="HoopsShoot" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Hoops: take your own shots, from the challenge's card. */}
              {({ navigation, route }) => (
                <HoopsShootScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="BaseballBat" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Baseball: take your own at-bats, from the challenge's card. */}
              {({ navigation, route }) => (
                <BaseballBatScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="CricketPlay" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Cricket: bat and bowl yourself (0234), from the challenge's card. */}
              {({ navigation, route }) => (
                <CricketPlayScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Chess" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Hound Chess (0238): the board, or the puzzle of the day. */}
              {({ navigation, route }) => (
                <ChessScreen
                  key={`${route.params.challengeId ?? 'puzzle'}:${route.params.mode ?? 'game'}`}
                  challengeId={route.params.challengeId}
                  mode={route.params.mode ?? 'game'}
                  onBack={() =>
                    navigation.canGoBack()
                      ? navigation.goBack()
                      : route.params.challengeId
                        ? navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                        : navigation.navigate('Main', { tab: 'home' })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Roulette" options={{ animation: 'slide_from_right' }}>
              {/* Hound Roulette's wheel (0236), from the challenge's card. */}
              {({ navigation, route }) => (
                <RouletteScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Slots" options={{ animation: 'slide_from_right' }}>
              {/* Paw Slots' machine (0242), from the challenge's card. */}
              {({ navigation, route }) => (
                <SlotsScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Bullseye" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Bullseye's field (0249), from the challenge's card. */}
              {({ navigation, route }) => (
                <BullseyeScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="LongShot" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Long Shot's range (0247), from the challenge's card. */}
              {({ navigation, route }) => (
                <LongShotScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="HorseShoot" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* H-O-R-S-E: call your shot and take it, from the challenge's card. */}
              {({ navigation, route }) => (
                <HorseShootScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="DerbyBat" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* The Home Run Derby: step up to the plate, from the Derby's board. */}
              {({ navigation, route }) => (
                <DerbyBatScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="ShootoutKick" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* The Hound Shootout: step up to the spot, from the Shootout's board. */}
              {({ navigation, route }) => (
                <ShootoutKickScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="BoutRing" options={{ animation: 'slide_from_right', gestureEnabled: false }}>
              {/* Hound Bout: in the ring, from the fight's card. */}
              {({ navigation, route }) => (
                <BoutRingScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  initialMode={route.params.mode}
                  kind={route.params.kind}
                  onBack={() =>
                    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ChallengeDetail', { challengeId: route.params.challengeId })
                  }
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="StartClub" options={{ animation: 'slide_from_bottom' }}>
              {({ navigation, route }) => (
                <StartClubScreen
                  clubId={route.params?.clubId}
                  onBack={() => navigation.goBack()}
                  onDone={(clubId) => (route.params?.clubId ? navigation.goBack() : navigation.replace('Club', { clubId }))}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="GlobalInvite" options={{ animation: 'slide_from_right' }}>
              {/* A push from Hound inviting you to a Global challenge (0228). */}
              {({ navigation, route }) => (
                <GlobalInviteScreen
                  key={route.params.challengeId}
                  challengeId={route.params.challengeId}
                  onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main', { tab: 'home' }))}
                  onOpen={(challengeId) => navigation.replace('ChallengeDetail', { challengeId })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Discover" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                <DiscoverScreen
                  onBack={() => navigation.goBack()}
                  onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
                  onStart={(kind) => navigation.navigate('Create', { kind })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="Achievements" options={{ animation: 'slide_from_right' }}>
              {/* Opened from Home's unlock popup or Settings — goBack()
                  returns to whichever it was. */}
              {({ navigation }) => <AchievementsScreen onBack={() => navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
