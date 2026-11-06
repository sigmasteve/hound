import React, { useMemo, useRef } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Scan a QR code with the camera: a friend's (Friends → Add friends → My
// code) or a challenge's. Hands back whatever the code says, once; the
// caller makes sense of it (extractFriendCode accepts the link).
export function ScanCodeModal({
  visible,
  onScanned,
  onClose,
  title = 'Scan a friend’s code',
  hint = 'Ask your friend to open Friends → Add friends → My code.',
  askText = 'Hound needs the camera to scan your friend’s QR code. It’s only used while this screen is open.',
}: {
  visible: boolean;
  onScanned: (data: string) => void;
  onClose: () => void;
  title?: string;
  hint?: string;
  askText?: string;
}) {
  const { colors } = useTheme();
  // Read here, outside the Modal: a full-screen Modal is its own native
  // window, so a SafeAreaView inside it sees no status bar and the header
  // (and its Close) ended up under the clock, out of reach.
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  // The camera reports the same code many times a second; take the first.
  const handled = useRef(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onShow={() => {
        handled.current = false;
      }}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Button label="Close" variant="ghost" small icon={<XIcon size={13} color={colors.accent} />} onPress={onClose} />
        </View>

        {!permission ? null : permission.granted ? (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (handled.current) return;
                handled.current = true;
                onScanned(data);
              }}
            />
            <View style={styles.frame} pointerEvents="none" />
          </View>
        ) : (
          <View style={styles.ask}>
            <Text style={styles.askText}>{askText}</Text>
            {permission.canAskAgain ? (
              <Button label="Allow camera" variant="primary" onPress={requestPermission} />
            ) : (
              <Button label="Open Settings" variant="primary" onPress={() => Linking.openSettings()} />
            )}
          </View>
        )}

        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, gap: 16 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    frame: { width: 220, height: 220, borderRadius: 18, borderWidth: 3, borderColor: withAlpha('#ffffff', 0.85) },
    ask: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 12 },
    askText: { fontSize: 15, textAlign: 'center', color: colors.text },
    hint: { fontSize: 13, textAlign: 'center', color: withAlpha(colors.text, 0.6) },
  });
}
