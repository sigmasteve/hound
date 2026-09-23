import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { color, font, withAlpha } from '../theme/tokens';

// The single biggest gap a real support report ("blank screen after
// login, closed and reopened, still blank") exposed: there was nothing
// catching a render-time exception anywhere in the tree, so React
// Native just stopped rendering with zero visible feedback and nothing
// in any log a tester could hand back. This can't fix whatever actually
// crashed, but it turns "blank screen, no idea why" into "an error
// message on screen with enough detail to actually debug" — and the
// console.error in componentDidCatch means it'll show up in `expo
// logs`/logcat even without a crash-reporting service wired up (a real
// follow-up, not something this component substitutes for).
//
// Deliberately styled off the fixed `color`/`font` exports and a plain
// Pressable, not the shared Button component (which calls useTheme()
// internally) — this wraps the entire app in App.tsx, outside
// ThemeProvider, so its fallback has to render without depending on any
// provider that might be exactly what crashed.
interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled error in app tree:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            Hound hit an error it couldn't recover from. Try again below — if it keeps happening, screenshot
            this message and pass it along.
          </Text>
          <Text style={styles.error} selectable>
            {this.state.error.message}
          </Text>
          <Pressable style={styles.retryButton} onPress={this.reset}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 14 },
  title: { fontFamily: font.heading, fontSize: 20, color: color.text },
  body: { fontSize: 13.5, color: color.text, opacity: 0.7, lineHeight: 19 },
  error: {
    fontSize: 12,
    color: color.amber,
    backgroundColor: color.surface,
    padding: 12,
    borderRadius: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: withAlpha(color.accent, 0.12),
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 22,
  },
  retryLabel: { fontFamily: font.heading, fontSize: 14, color: color.accent },
});
