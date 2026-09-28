import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, font } from '../theme/tokens';

// Guards the one failure mode mockAuth.ts's own fallback doesn't cover:
// isSupabaseConfigured being false is a legitimate, intended path in
// local dev or the web preview (no .env at all) — but in any real
// distributed build (TestFlight, the App Store, an EAS internal-
// distribution link) it means that build's own env vars were never set,
// and the fallback it silently triggers, mockAuth's hardcoded Google
// profile, happens to be the developer's own real name and email. A
// tester who hits that sees what looks exactly like an already-signed-in
// account, with sample data standing in for real challenges, and nothing
// telling them anything is wrong. AuthContext.tsx renders this screen
// instead of the app itself whenever that combination is true, turning a
// silently wrong identity into a loud, unmissable failure instead.
//
// Styled off the fixed color/font tokens directly, not useTheme() —
// same "don't depend on a provider that might be exactly what's broken"
// reasoning ErrorBoundary.tsx already uses for its own fallback.
export function MisconfiguredScreen() {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Hound isn't configured</Text>
        <Text style={styles.body}>
          This build is missing its Supabase configuration
          (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY). Without it, the app would otherwise show
          sample data as if you were already signed in — so it's stopped here instead.
        </Text>
        <Text style={styles.body}>
          This should never happen in a real build. Screenshot this message and pass it to the developer.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title: { fontFamily: font.heading, fontSize: 20, color: color.text },
  body: { fontSize: 13.5, color: color.text, opacity: 0.7, lineHeight: 19 },
});
