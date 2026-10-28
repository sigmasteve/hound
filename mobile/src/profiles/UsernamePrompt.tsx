import React, { useMemo } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { AtIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useUsernameForm, usernameBody, UsernameFields } from './UsernameForm';

// Today's one-time ask for members who set up before the wizard had a
// username step: the same form, as a card. Either button closes it for
// good (UsernameForm's markAskedForUsername).
export function UsernamePrompt({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const form = useUsernameForm();

  const keepName = () => {
    form.keepName();
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={keepName}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <AtIcon size={26} color={colors.accent} weight="bold" />
          </View>
          <Text style={styles.title}>Pick a username</Text>
          <Text style={styles.body}>{usernameBody(form.name)}</Text>
          <UsernameFields form={form} autoFocus={false} />
          {form.problem && <Text style={styles.problem}>{form.problem}</Text>}
          <View style={styles.buttons}>
            <Button
              label={form.saving ? 'Saving…' : 'Use this username'}
              variant="primary"
              block
              disabled={!form.valid || form.saving}
              onPress={async () => {
                if (await form.save()) onClose();
              }}
            />
            <Button label="Keep my name" variant="ghost" block disabled={form.saving} onPress={keepName} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      alignItems: 'center',
      gap: 12,
      padding: 22,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    badge: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    title: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text, textAlign: 'center' },
    body: { fontSize: 14.5, lineHeight: 20, color: withAlpha(colors.text, 0.7), textAlign: 'center' },
    problem: { fontSize: 13, color: colors.amber, textAlign: 'center' },
    buttons: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  });
}
