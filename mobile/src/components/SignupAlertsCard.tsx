import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BellRingingIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { Button } from './Button';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import {
  getSignupAlertPrefs,
  sendTestSignupAlert,
  setSignupAlertPrefs,
  type SignupAlertPrefs,
} from '../admin/signupAlerts';

// Admin → Signup alerts: whether this admin gets a push for each new
// user, a daily summary, or both (0077_admin_signup_alerts.sql). Saves
// on each tap.
export function SignupAlertsCard() {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [prefs, setPrefs] = useState<SignupAlertPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      getSignupAlertPrefs(user.id)
        .then((p) => {
          setPrefs(p);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your alert settings.'));
    }, [user?.id]),
  );

  const update = (next: SignupAlertPrefs) => {
    if (!user?.id || !prefs) return;
    const before = prefs;
    setPrefs(next);
    setError(null);
    setSignupAlertPrefs(user.id, next).catch((e) => {
      setPrefs(before);
      setError(e instanceof Error ? e.message : 'Could not save that — try again.');
    });
  };

  const test = () => {
    setTesting(true);
    setTestNote(null);
    sendTestSignupAlert()
      .then((r) =>
        setTestNote(
          r.sent
            ? 'Sent — it should arrive on this phone in a few seconds.'
            : r.reason ?? 'Nothing was sent. Check that notifications are on for Hound.',
        ),
      )
      .catch((e) => setTestNote(e instanceof Error ? e.message : 'Could not send a test.'))
      .finally(() => setTesting(false));
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>Signup alerts</Text>
        <BellRingingIcon size={18} color={colors.accent} />
      </View>
      <Text style={styles.footNote}>
        Get a push when someone new joins Hound. Tapping one opens that person&rsquo;s page here.
      </Text>
      {prefs && (
        <View style={{ gap: 12 }}>
          <ToggleRow
            label="Each new signup"
            note={prefs.instant ? 'On' : 'Off'}
            value={prefs.instant}
            onChange={(v) => update({ ...prefs, instant: v })}
          />
          <ToggleRow
            label="Daily summary"
            note={prefs.digest ? 'Around 9am PT' : 'Off'}
            value={prefs.digest}
            onChange={(v) => update({ ...prefs, digest: v })}
          />
        </View>
      )}
      {error && <Text style={styles.loadError}>{error}</Text>}
      {testNote && <Text style={styles.footNote}>{testNote}</Text>}
      <Button label={testing ? 'Sending…' : 'Send me a test'} disabled={testing} onPress={test} />
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
  });
}
