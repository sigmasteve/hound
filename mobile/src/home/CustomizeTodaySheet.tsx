import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { SheetLink } from './TodayTiles';
import { TODAY_EXTRAS, setTodayExtra, useTodayExtras, type TodayExtra } from './todayExtras';

// Customize Today (0278): the extras Today can show, each off until it's
// turned on, saved for the account. The three parts of Your day follow
// what you use Hound for (Settings, the welcome wizard's checkboxes).
export function CustomizeTodaySheet({ onOpenUses }: { onOpenUses: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const extras = useTodayExtras();
  const [saving, setSaving] = useState<TodayExtra | null>(null);

  const flip = (id: TodayExtra, on: boolean) => {
    setSaving(id);
    setTodayExtra(id, on)
      .catch((e) => Alert.alert('Customize Today', e instanceof Error ? e.message : 'Couldn’t save that.'))
      .finally(() => setSaving(null));
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.lead}>Today shows the basics. Turn on any extras you’d like to see too.</Text>
      <View style={styles.card}>
        {TODAY_EXTRAS.map((x, i) => (
          <Pressable
            key={x.id}
            onPress={() => flip(x.id, !extras[x.id])}
            disabled={saving === x.id}
            style={[styles.row, i > 0 && styles.rowLine]}
            accessibilityRole="switch"
            accessibilityState={{ checked: extras[x.id] }}
            accessibilityLabel={`${x.label}. ${x.detail}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.label}>{x.label}</Text>
              <Text style={styles.detail}>{x.detail}</Text>
            </View>
            <Switch
              value={extras[x.id]}
              onValueChange={(v) => flip(x.id, v)}
              disabled={saving === x.id}
              trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.15) }}
            />
          </Pressable>
        ))}
      </View>
      <Text style={styles.detail}>Fasting and Move show in Your day when you use them.</Text>
      <SheetLink label="What you use Hound for" onPress={onOpenUses} />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    lead: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.75) },
    card: { borderRadius: 16, backgroundColor: colors.surface, paddingHorizontal: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    label: { fontSize: 15, fontFamily: font.headingSemibold, color: colors.text },
    detail: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
  });
}
