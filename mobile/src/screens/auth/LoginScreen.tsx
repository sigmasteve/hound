import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftIcon, EnvelopeSimpleIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme/ThemeContext';
import { withAlpha, type Palette } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';

export function LoginScreen({ onBack, onCreateAccount }: { onBack: () => void; onCreateAccount: () => void }) {
  const { signInWithEmail } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Button
          label="Back"
          variant="ghost"
          small
          icon={<ArrowLeftIcon size={15} color={colors.accent} />}
          onPress={onBack}
          style={styles.back}
        />

        <Text style={[text.h2, styles.title]}>Log in</Text>

        <View style={styles.fields}>
          <TextField
            label="Email"
            icon={<EnvelopeSimpleIcon size={17} color={withAlpha(colors.text, 0.55)} />}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <TextField
            label="Password"
            icon={<LockSimpleIcon size={17} color={withAlpha(colors.text, 0.55)} />}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureToggle
            textContentType="password"
            error={error ?? undefined}
          />
        </View>

        <Button
          label="Forgot password?"
          variant="ghost"
          small
          style={styles.forgot}
          onPress={() =>
            Alert.alert('Reset password', 'Password reset isn’t wired up yet — this is a UI placeholder.')
          }
        />

        <Button
          label={submitting ? 'Logging in…' : 'Log in'}
          variant="primary"
          block
          disabled={submitting}
          onPress={submit}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Hound? </Text>
          <Button label="Create account" variant="ghost" small onPress={onCreateAccount} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { flexGrow: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 20, gap: 18 },
    back: { alignSelf: 'flex-start' },
    title: { marginTop: 4 },
    fields: { gap: 14 },
    forgot: { alignSelf: 'flex-end', marginTop: -8 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 'auto', paddingTop: 20 },
    footerText: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
  });
}
