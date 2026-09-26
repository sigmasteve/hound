import React, { useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider } from './src/auth/AuthContext';
import { HealthDataProvider } from './src/health/HealthContext';
import { LabelsProvider } from './src/labels/LabelsContext';
import { GoalsProvider } from './src/goals/GoalsContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Without this, expo-notifications' own documented default is to NOT
// show a push at all while the app is in the foreground — every "Test:
// ..." button in Settings' Developer tools card is tapped from inside
// the app, so without this handler a real, successfully-delivered push
// would silently disappear with no banner, looking exactly like a
// delivery failure. Registered once at module load, before anything
// could arrive — see src/notifications/supabaseNotifications.ts for
// where the token itself gets registered.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Split out from App so it can call useTheme() — the provider it depends
// on has to be above it, and App itself still needs to gate everything on
// fonts loading before any of this mounts at all.
function AppContent() {
  const { colors, mode } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <HealthDataProvider>
            <LabelsProvider>
              <GoalsProvider>
                {/* Light mode's page is bright enough that light (white)
                    status bar icons would disappear into it — dark icons only
                    make sense against Dark's own near-black bg. */}
                <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
                <RootNavigator />
              </GoalsProvider>
            </LabelsProvider>
          </HealthDataProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const onReady = useCallback(async () => {
    if (fontsLoaded || fontError) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
