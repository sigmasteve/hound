import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BellRingingIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { askForPush, dismissPushOffer } from '../notifications/pushPermission';

// Today, for someone whose phone has never been asked about
// notifications (src/notifications/pushPermission.ts). Says what they're
// for before "Turn on" shows the phone's own prompt, which iOS only ever
// shows once.
export function PushAskCard({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [asking, setAsking] = useState(false);

  const turnOn = async () => {
    setAsking(true);
    // Whatever they pick, the phone won't offer its prompt again, so the
    // card's job is done.
    await askForPush(userId);
    setAsking(false);
    onDone();
  };

  const notNow = () => {
    dismissPushOffer();
    onDone();
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <BellRingingIcon size={17} color={colors.accentActive} />
        <Text style={styles.title}>Turn on notifications</Text>
      </View>
      <Text style={styles.body}>
        Know when a friend adds you, when it&rsquo;s your turn in Tic-Tac-Go, and how you stand in your
        challenges. You can change what you get anytime in Settings.
      </Text>
      <View style={styles.buttons}>
        <Button label="Not now" variant="ghost" small disabled={asking} onPress={notNow} />
        <Button label={asking ? 'Turning on…' : 'Turn on'} variant="primary" small disabled={asking} onPress={turnOn} />
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 10,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 16, fontFamily: font.heading, color: colors.text },
    body: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  });
}
