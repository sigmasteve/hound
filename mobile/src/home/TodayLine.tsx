import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, type Palette } from '../theme/tokens';
import { joinFacts, lineFacts, type LineInput, type LineLink } from './todayLine';

// Today's one line (version A): plain facts, each a link to where it's
// done; once a day the hound says it ("Biscuit's ready: ...").
export function TodayLine({ input, lead, onLink }: { input: LineInput; lead: string | null; onLink: (l: LineLink) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const parts = joinFacts(lineFacts(input), lead);
  if (parts.length === 0) return null;
  return (
    <Text style={styles.line} accessibilityRole="header">
      {parts.map((p, i) =>
        p.link ? (
          <Text key={i} style={styles.link} onPress={() => onLink(p.link!)} accessibilityRole="link">
            {p.text}
          </Text>
        ) : (
          <Text key={i} style={i === 0 && lead ? styles.lead : undefined}>
            {p.text}
          </Text>
        ),
      )}
    </Text>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    line: { fontSize: 17, lineHeight: 23, fontFamily: font.headingSemibold, color: colors.text, paddingHorizontal: 2 },
    link: { color: colors.accentActive, fontFamily: font.headingSemibold, textDecorationLine: 'underline' },
    lead: { color: colors.amber },
  });
}
