import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { BarbellIcon, CheckCircleIcon, CircleIcon, HeartbeatIcon, PersonSimpleRunIcon, ScalesIcon, SoccerBallIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, radius, withAlpha, type Palette } from '../theme/tokens';
import { INTERESTS, type Interest } from './interests';

const ICONS: Record<Interest, React.ComponentType<any>> = {
  athlete: PersonSimpleRunIcon,
  sports: SoccerBallIcon,
  gym: BarbellIcon,
  weight_loss: ScalesIcon,
  general: HeartbeatIcon,
};

// Pick any of the interests (K-08): onboarding's step and Settings.
export function InterestsPicker({ picked, onToggle, disabled }: { picked: Interest[]; onToggle: (id: Interest) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ gap: 10, alignSelf: 'stretch' }}>
      {INTERESTS.map((it) => {
        const on = picked.includes(it.id);
        const Icon = ICONS[it.id];
        return (
          <Pressable
            key={it.id}
            onPress={() => onToggle(it.id)}
            disabled={disabled}
            style={on ? [styles.option, styles.optionOn] : styles.option}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled }}
          >
            <Icon size={22} color={on ? colors.accent : withAlpha(colors.text, 0.6)} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{it.name}</Text>
              <Text style={styles.detail}>{it.detail}</Text>
            </View>
            {on ? (
              <CheckCircleIcon size={22} color={colors.accent} weight="fill" />
            ) : (
              <CircleIcon size={22} color={withAlpha(colors.text, 0.3)} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    // The same look as the wizard's other choices.
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.surface,
    },
    optionOn: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: withAlpha(colors.accent, 0.1) },
    name: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    detail: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
  });
}
