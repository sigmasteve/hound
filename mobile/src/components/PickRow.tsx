import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { XIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Today's pick in a game, as one row: what you've picked (or that you
// haven't) and your side's picks in small text, with a button that opens
// the choices in a sheet. Shared by the sports and board games so the
// choices only take room while you're choosing.
export function PickRow({
  title = 'Today’s play',
  value,
  note,
  picked,
  busy,
  sheetTitle,
  sheetNote,
  children,
}: {
  title?: string;
  // "Marking MamaBear2", "No pick yet".
  value: string;
  // Your side's picks, or anything else worth a line.
  note?: string | null;
  // Whether there's a pick yet: the button says Change rather than Pick.
  picked: boolean;
  busy?: boolean;
  sheetTitle: string;
  sheetNote?: string;
  // The choices; call close() once one's been made.
  children: (close: () => void) => React.ReactNode;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.value, !picked && styles.valueNone]}>{value}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Pressable onPress={() => setOpen(true)} style={[styles.button, !picked && styles.buttonPrimary]} accessibilityRole="button">
          <Text style={[styles.buttonText, !picked && styles.buttonTextPrimary]}>{picked ? 'Change' : 'Pick'}</Text>
        </Pressable>
      )}
      {open && (
        <Modal transparent animationType="slide" visible onRequestClose={close}>
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={[text.h4, { flex: 1 }]}>{sheetTitle}</Text>
                <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <XIcon size={18} color={withAlpha(colors.text, 0.55)} />
                </Pressable>
              </View>
              {sheetNote ? <Text style={styles.sheetNote}>{sheetNote}</Text> : null}
              <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>{children(close)}</ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    title: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    value: { fontFamily: font.heading, fontSize: 14.5, color: colors.text },
    valueNone: { color: withAlpha(colors.text, 0.7) },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.6), lineHeight: 16 },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.text, 0.15),
      minHeight: 36,
      justifyContent: 'center',
    },
    buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    buttonText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    buttonTextPrimary: { color: '#ffffff' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 10 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sheetNote: { fontSize: 13, color: withAlpha(colors.text, 0.65), lineHeight: 18 },
  });
}
