import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AtIcon } from 'phosphor-react-native';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { chooseUsername, USERNAME_FORMAT } from './supabaseProfile';

// Picking a username, in the setup wizard's step and in Today's one-time
// ask for members who set up before it existed (UsernamePrompt). Both use
// this form: a field, a few ideas from the sign-up name, and the rule.

// Asked once: choosing one, "Keep my name" or skipping the wizard's step
// all count, so Today never asks again after the wizard did.
const seenKey = (userId: string) => `hound:username-asked:${userId}`;

export async function wasAskedForUsername(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(seenKey(userId)).catch(() => null)) === 'true';
}

export function markAskedForUsername(userId: string): void {
  AsyncStorage.setItem(seenKey(userId), 'true').catch(() => {});
}

// Usernames to suggest from the name someone signed up with: "Stephen
// Washington" gives StephenW, Stephen_Washington and Stephen23. Only
// letters, numbers and underscores, 3 to 20 long (USERNAME_FORMAT).
function usernameIdeas(name: string): string[] {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const [first, ...rest] = words;
  const last = rest.find((w) => !/^(jr|sr|ii|iii|iv)$/i.test(w));
  const ideas = [
    last ? `${first}${last[0].toUpperCase()}` : null,
    last ? `${first}_${last}` : null,
    `${first}${10 + Math.floor(Math.random() * 90)}`,
  ];
  return [...new Set(ideas.filter((i): i is string => !!i).map((i) => i.slice(0, 20)))].filter((i) =>
    USERNAME_FORMAT.test(i),
  );
}

// The form's state. save() resolves true once the username is saved and
// turned on for leaderboards and challenges (chooseUsername). `ideasFrom`
// suggests from a name typed on the same screen instead of the profile's.
export function useUsernameForm(ideasFrom?: string) {
  const { user, updateUser } = useAuth();
  const ideaName = ideasFrom ?? user?.name ?? '';
  const ideas = useMemo(() => usernameIdeas(ideaName), [ideaName]);
  const [value, setValueState] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmed = value.trim();
  const valid = USERNAME_FORMAT.test(trimmed);

  const setValue = (v: string) => {
    setValueState(v.replace(/\s/g, ''));
    setProblem(null);
  };

  const save = async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (!valid) {
      setProblem('3–20 letters, numbers or underscores.');
      return false;
    }
    setSaving(true);
    setProblem(null);
    try {
      await chooseUsername(user.id, trimmed);
      updateUser({ username: trimmed, useUsername: true });
      markAskedForUsername(user.id);
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not save that. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // "Keep my name": nothing saved, and not asked again.
  const keepName = () => {
    if (user?.id) markAskedForUsername(user.id);
  };

  return { name: user?.name ?? '', ideas, value, trimmed, setValue, problem, saving, valid, save, keepName };
}

export type UsernameFormState = ReturnType<typeof useUsernameForm>;

export function usernameBody(name: string): string {
  return `It's what others see on leaderboards and in challenges, instead of ${name ? `"${name}"` : 'your name'}. Friends still see your name.`;
}

export function UsernameFields({ form, autoFocus = true }: { form: UsernameFormState; autoFocus?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ gap: 12, alignSelf: 'stretch' }}>
      <TextField
        label="Username"
        value={form.value}
        onChangeText={form.setValue}
        placeholder="NightRunner99"
        maxLength={20}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        icon={<AtIcon size={16} color={withAlpha(colors.text, 0.5)} />}
      />
      {form.ideas.length > 0 && (
        <View style={styles.ideas}>
          {form.ideas.map((idea) => (
            <Pressable
              key={idea}
              onPress={() => form.setValue(idea)}
              style={form.trimmed === idea ? [styles.idea, styles.ideaOn] : styles.idea}
              accessibilityRole="button"
              accessibilityLabel={`Use ${idea}`}
            >
              <Text style={styles.ideaText}>{idea}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.hint}>3–20 letters, numbers or underscores. You can change it in Settings.</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    idea: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
    ideaOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.1) },
    ideaText: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    hint: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
  });
}
