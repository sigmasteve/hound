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

// The challenge page's version, at the top under its name: the sponsor
// stands out, with a button to their site.
export function SponsorBanner({ sponsor }: { sponsor: ChallengeSponsor }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeBannerStyles(colors), [colors]);
  const url = sponsor.url;
  return (
    <View style={styles.banner}>
      <View style={styles.badge}>
        <HandshakeIcon size={20} color={colors.accentActive} weight="fill" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>SPONSORED BY</Text>
        <Text style={styles.name}>{sponsor.name}</Text>
        {sponsor.message && <Text style={styles.message}>{sponsor.message}</Text>}
      </View>
      {url && (
        <Pressable
          onPress={() => Linking.openURL(url).catch(() => {})}
          style={styles.visit}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel={`Visit ${sponsor.name}'s site`}
        >
          <Text style={styles.visitText}>Visit</Text>
          <ArrowSquareOutIcon size={13} color={colors.accentActive} />
        </Pressable>
      )}
    </View>
  );
}

function makeBannerStyles(colors: Palette) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.accent, 0.55),
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    badge: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accent, 0.18),
    },
    label: { fontSize: 10.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    name: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    message: { fontSize: 13, color: withAlpha(colors.text, 0.75) },
    visit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    visitText: { fontFamily: font.heading, fontSize: 13, color: colors.accentActive },
  });
}
