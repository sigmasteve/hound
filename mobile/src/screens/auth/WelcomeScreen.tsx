import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { EnvelopeSimpleIcon, FacebookLogoIcon, GoogleLogoIcon, PawPrintIcon } from 'phosphor-react-native';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../../theme/tokens';
import { useAuth } from '../../auth/AuthContext';
import type { AuthProviderId } from '../../auth/types';

type Busy = Exclude<AuthProviderId, 'email'> | null;

export function WelcomeScreen({
  onContinueWithEmail,
  onCreateAccount,
}: {
  onContinueWithEmail: () => void;
  onCreateAccount: () => void;
}) {
  const { signInWithGoogle, signInWithFacebook } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const runProvider = async (provider: Busy, action: () => Promise<void>) => {
    setError(null);
    setBusy(provider);
    try {
      await action();
      // On success the app swaps navigators (see RootNavigator) — nothing
      // else to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <PawPrintIcon size={30} color={colors.accent} weight="fill" />
        </View>
        <Text style={[text.h2, styles.title]}>Hound</Text>
        <Text style={styles.tagline}>Turn your step count into a friendly chase.</Text>
      </View>

      <View style={styles.providers}>
        <ProviderButton
          label="Continue with Google"
          icon={<GoogleLogoIcon size={18} color={colors.text} weight="bold" />}
          busy={busy === 'google'}
          disabled={busy !== null}
          onPress={() => runProvider('google', signInWithGoogle)}
          textColor={colors.text}
        />
        <ProviderButton
          label="Continue with Facebook"
          icon={<FacebookLogoIcon size={18} color={colors.text} weight="fill" />}
          busy={busy === 'facebook'}
          disabled={busy !== null}
          onPress={() => runProvider('facebook', signInWithFacebook)}
          textColor={colors.text}
        />
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerLabel}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <Button
        label="Continue with email"
        variant="secondary"
        block
        icon={<EnvelopeSimpleIcon size={17} color={colors.text} />}
        disabled={busy !== null}
        onPress={onContinueWithEmail}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.footer}>
        <Text style={styles.footerText}>New to Hound? </Text>
        <Button label="Create account" variant="ghost" small onPress={onCreateAccount} disabled={busy !== null} />
      </View>
    </View>
  );
}

function ProviderButton({
  label,
  icon,
  busy,
  disabled,
  onPress,
  textColor,
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  textColor: string;
}) {
  return (
    <Button
      label={busy ? 'Connecting…' : label}
      variant="secondary"
      block
      icon={busy ? <ActivityIndicator size="small" color={textColor} /> : icon}
      disabled={disabled}
      onPress={onPress}
    />
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 24, paddingTop: 72, gap: 20 },
    hero: { alignItems: 'center', gap: 10, marginBottom: 8 },
    badge: {
      width: 56,
      height: 56,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    title: { fontSize: 30 },
    tagline: { fontSize: 14.5, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    providers: { gap: 10 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    dividerLabel: { fontSize: 12, color: withAlpha(colors.text, 0.5) },
    error: { fontSize: 12.5, color: colors.amber, textAlign: 'center' },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 'auto', paddingTop: 12 },
    footerText: { fontSize: 13, color: withAlpha(colors.text, 0.6), fontFamily: font.body },
  });
}
