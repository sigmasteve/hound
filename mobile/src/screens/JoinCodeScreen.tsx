import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { CodeJoinCard } from '../components/CodeJoinCard';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';

// Where a community challenge's link lands (K-04): its Join card, looked
// up from the link's code.
export function JoinCodeScreen({
  code,
  onBack,
  onJoined,
  onPickUsername,
}: {
  code: string;
  onBack: () => void;
  onJoined: (challengeId: string) => void;
  onPickUsername: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <Text style={text.h2}>Join a challenge</Text>
        <Text style={styles.note}>Someone shared this community challenge with you.</Text>
        <CodeJoinCard initialCode={code} onJoined={onJoined} onPickUsername={onPickUsername} onCancel={onBack} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    note: { fontSize: 14, color: withAlpha(colors.text, 0.65) },
  });
}
