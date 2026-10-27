import React, { useMemo, useRef } from 'react';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { XIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';

// Scan a friend's QR code (the one under Friends → Add friends → My
// code) with the camera. Hands back whatever the code says, once; the
// caller turns it into a friend code (extractFriendCode accepts the link).
export function ScanCodeModal({
  visible,
  onScanned,
  onClose,
}: {
  visible: boolean;
  onScanned: (data: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
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
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan a friend&rsquo;s code</Text>
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
            <Text style={styles.askText}>
              Hound needs the camera to scan your friend&rsquo;s QR code. It&rsquo;s only used while this screen is open.
            </Text>
            {permission.canAskAgain ? (
              <Button label="Allow camera" variant="primary" onPress={requestPermission} />
            ) : (
              <Button label="Open Settings" variant="primary" onPress={() => Linking.openSettings()} />
            )}
          </View>
        )}

        <Text style={styles.hint}>Ask your friend to open Friends → Add friends → My code.</Text>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 16 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    frame: { width: 220, height: 220, borderRadius: 18, borderWidth: 3, borderColor: withAlpha('#ffffff', 0.85) },
    ask: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 12 },
    askText: { fontSize: 15, textAlign: 'center', color: colors.text },
    hint: { fontSize: 13, textAlign: 'center', color: withAlpha(colors.text, 0.6) },
  });
}
