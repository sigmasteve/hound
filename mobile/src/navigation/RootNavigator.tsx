import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { color } from '../theme/tokens';
import type { RootStackParamList } from './types';
import { MainScreen } from '../screens/MainScreen';
import { HuntScreen } from '../screens/HuntScreen';
import { CreateScreen } from '../screens/CreateScreen';
import { ChallengeDetailScreen } from '../screens/ChallengeDetailScreen';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignUpScreen } from '../screens/auth/SignUpScreen';
import { useAuth } from '../auth/AuthContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: color.bg,
    card: color.bg,
    text: color.text,
    border: color.divider,
    primary: color.accent,
  },
};

export function RootNavigator() {
  const { status, initializing } = useAuth();

  // Only non-instant when Supabase is configured (mock auth never
  // persists a session, so there's nothing to wait on) — restoring a
  // session from AsyncStorage is fast but still async, and briefly
  // showing Welcome before swapping to Main would be worse than a beat of
  // blank screen.
  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={color.accent} />
      </View>
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
                  // hardcoded "Marcus is hunting you" content with no
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
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
