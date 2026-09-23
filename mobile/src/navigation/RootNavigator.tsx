import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import type { RootStackParamList } from './types';
import { MainScreen } from '../screens/MainScreen';
import { HuntScreen } from '../screens/HuntScreen';
import { CreateScreen } from '../screens/CreateScreen';
import { ChallengeDetailScreen } from '../screens/ChallengeDetailScreen';
import { FriendDetailScreen } from '../screens/FriendDetailScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { AdminUserDetailScreen } from '../screens/AdminUserDetailScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';
import { useAuth } from '../auth/AuthContext';
import { useHealthProvider } from '../health/HealthContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Once someone's dealt with this (connected, or tapped "Skip for now"),
// it never interrupts a launch again — from then on Connect is just the
// normal tab, there to revisit whenever. Device-scoped rather than
// per-account on purpose: whether this phone's HealthKit/Health Connect
// access is granted is an OS-level fact, not something a second Hound
// account signing in on the same device needs asked again.
const CONNECT_PROMPT_SEEN_KEY = 'hound:connect-prompt-seen';

// 'checking': the AsyncStorage read + health.getAuthorizationStatus() call
// below haven't resolved yet — rendered the same as `initializing`, so a
// fresh sign-in never flashes Main before this decides. 'show': neither
// seen before nor already authorized — this is what makes ConnectScreen
// appear right after a first login instead of relying on someone finding
// it in the nav. 'hide': already seen, or health access already granted
// (e.g. restored from a previous session) — go straight to Main.
type ConnectGate = 'checking' | 'show' | 'hide';

export function RootNavigator() {
  const { status, initializing } = useAuth();
  const health = useHealthProvider();
  const { colors } = useTheme();
  const [connectGate, setConnectGate] = useState<ConnectGate>('checking');

  useEffect(() => {
    if (status !== 'signedIn') {
      // Reset so a sign-out followed by a different sign-in re-checks
      // fresh, rather than reusing whichever gate the previous session
      // last landed on.
      setConnectGate('checking');
      return;
    }
    let cancelled = false;
    (async () => {
      const [seen, authStatus] = await Promise.all([
        AsyncStorage.getItem(CONNECT_PROMPT_SEEN_KEY),
        health.getAuthorizationStatus(),
      ]);
      if (cancelled) return;
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
  }, [status, health]);

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
        <ActivityIndicator color={colors.accent} />
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
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
        <ConnectScreen onDone={dismissConnectPrompt} />
      </SafeAreaView>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
            <Stack.Screen name="Hunt" options={{ animation: 'slide_from_right' }}>
              {({ navigation }) => (
                // "All challenges" always lands on the Challenges tab, regardless
                // of whether Hunt was opened from Home, Challenges, or just-created
                // via the wizard — matching the label, not just popping the stack.
                <HuntScreen onBack={() => navigation.navigate('Main', { tab: 'challenges' })} />
              )}
            </Stack.Screen>
            <Stack.Screen name="Create" options={{ animation: 'slide_from_bottom' }}>
              {({ navigation }) => (
                <CreateScreen
                  // Always lands on the Challenges tab, regardless of
                  // whether Create was opened from Home or Challenges —
                  // same "land somewhere fixed and meaningful" reasoning
                  // as Hunt's and ChallengeDetail's onBack below, rather
                  // than goBack() popping to wherever the wizard happened
                  // to be opened from. Matches onFinish below, so
                  // cancelling and finishing the wizard land in the same
                  // place.
                  onCancel={() => navigation.navigate('Main', { tab: 'challenges' })}
                  // Used to always go to the static Hunt screen, regardless
                  // of what kind of challenge (or name) was actually
                  // created — every real challenge landed on the same
                  // hardcoded "Marcus is chasing you" content with no
                  // connection to what the user just made. Back to the
                  // Challenges tab instead, where ChallengesScreen's real
                  // read (src/challenges/present.ts) shows the actual new
                  // challenge.
                  onFinish={() => navigation.navigate('Main', { tab: 'challenges' })}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="ChallengeDetail" options={{ animation: 'slide_from_right' }}>
              {({ navigation, route }) => (
                <ChallengeDetailScreen
                  challengeId={route.params.challengeId}
                  onBack={() => navigation.navigate('Main', { tab: 'challenges' })}
                  onGoHome={() => navigation.navigate('Main', { tab: 'home' })}
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
                  onBack={() => navigation.navigate('Main', { tab: 'friends' })}
                />
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
                  onOpenUser={(u) =>
                    navigation.navigate('AdminUserDetail', {
                      userId: u.id,
                      name: u.name,
                      initials: u.initials,
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
                  email={route.params.email}
                  lastActiveAt={route.params.lastActiveAt}
                  createdAt={route.params.createdAt}
                  onBack={() => navigation.goBack()}
                />
              )}
            </Stack.Screen>
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
