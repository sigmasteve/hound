import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { ToggleRow } from '../components/Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { missedMessage } from './messages';
import { setCelebratePrefs, useCelebratePrefs, type CelebrateTone } from './prefs';

// Settings → Celebrations: sounds on or off, and how Hound talks to you
// after a missed day, with an example of each.
export function CelebrationSettings() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const prefs = useCelebratePrefs();
  if (!prefs) return null;
  const example = missedMessage(prefs.tone, 'Your hound', 6, false);

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <Text style={text.h4}>Celebrations</Text>
      <Text style={styles.note}>Confetti when you hit your goals, and a nudge the day after you miss.</Text>
      <ToggleRow
        label="Sounds"
        note={prefs.sounds ? 'Not when your phone is on silent' : 'Off'}
        value={prefs.sounds}
        onChange={(sounds) => setCelebratePrefs({ sounds })}
      />
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>After a missed day</Text>
        <SegmentedControl<CelebrateTone>
          options={[
            { value: 'playful', label: 'Playful' },
            { value: 'roast', label: 'Roast me' },
          ]}
          value={prefs.tone}
          onChange={(tone) => setCelebratePrefs({ tone })}
        />
        <View style={styles.example}>
          <Text style={styles.exampleTitle}>{example.title}</Text>
          <Text style={styles.note}>{example.body}</Text>
        </View>
      </View>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    label: { fontSize: 14, color: colors.text },
    example: { gap: 2, padding: 12, borderRadius: 10, backgroundColor: withAlpha(colors.amber, 0.1) },
    exampleTitle: { fontFamily: font.headingSemibold, fontSize: 14, color: colors.text },
  });
}
