import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowSquareOutIcon, HandshakeIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { ChallengeSponsor } from '../challenges/globalChallenges';

// "Sponsored by …" on a global challenge (0111_sponsored_challenges.sql),
// with the sponsor's message under it. With a link, tapping opens their
// site in the browser; nothing else about the member goes to them.
export function SponsorLine({ sponsor }: { sponsor: ChallengeSponsor }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const url = sponsor.url;

  const body = (
    <View style={styles.row}>
      <HandshakeIcon size={13} color={colors.accentActive} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>
          Sponsored by {sponsor.name}
        </Text>
        {sponsor.message && (
          <Text style={styles.message} numberOfLines={2}>
            {sponsor.message}
          </Text>
        )}
      </View>
      {url && <ArrowSquareOutIcon size={13} color={withAlpha(colors.text, 0.5)} />}
    </View>
  );

  if (!url) return body;
  return (
    <Pressable
      onPress={() => Linking.openURL(url).catch(() => {})}
      hitSlop={6}
      accessibilityRole="link"
      accessibilityLabel={`Sponsored by ${sponsor.name}. Opens their site.`}
    >
      {body}
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    name: { fontFamily: font.heading, fontSize: 12.5, color: colors.accentActive },
    message: { fontSize: 12, color: withAlpha(colors.text, 0.65) },
  });
}
