import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeftIcon, EnvelopeSimpleIcon, LockSimpleIcon, UserIcon } from 'phosphor-react-native';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { useTheme } from '../../theme/ThemeContext';
import { withAlpha, type Palette } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';

export function SignUpScreen({ onBack, onLogIn }: { onBack: () => void; onLogIn: () => void }) {
  const { signUpWithEmail } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError('Fill in every field to continue.');
      return;
    }
    if (password.length < 6) {
      setError('Password needs to be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUpWithEmail({ name: name.trim(), email: email.trim(), password });
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

        <Text style={[text.h2, styles.title]}>Create your account</Text>

        <View style={styles.fields}>
          <TextField
            label="Name"
            icon={<UserIcon size={17} color={withAlpha(colors.text, 0.55)} />}
            value={name}
            onChangeText={setName}
            placeholder="Jordan Lee"
            textContentType="name"
          />
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
            placeholder="At least 6 characters"
            secureToggle
            textContentType="newPassword"
          />
          <TextField
            label="Confirm password"
            icon={<LockSimpleIcon size={17} color={withAlpha(colors.text, 0.55)} />}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="••••••••"
            secureToggle
            textContentType="newPassword"
            error={error ?? undefined}
          />
        </View>

        <Button
          label={submitting ? 'Creating account…' : 'Create account'}
          variant="primary"
          block
          disabled={submitting}
          onPress={submit}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Button label="Log in" variant="ghost" small onPress={onLogIn} />
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
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 'auto', paddingTop: 20 },
    footerText: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
  });
}
