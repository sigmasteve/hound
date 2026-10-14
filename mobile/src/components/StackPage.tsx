import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';

// A screen opened from the You tab (Stats & records, Settings, Health
// data): the screen itself plus a back button above it. Those screens
// used to be tabs, which got their top inset and header from TopNav.
export function StackPage({ backLabel = 'You', onBack, children }: { backLabel?: string; onBack: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, alignItems: 'flex-start' }}>
        <Button
          label={backLabel}
          variant="ghost"
          small
          icon={<ArrowLeftIcon size={13} color={colors.accent} />}
          onPress={onBack}
        />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}
