import React, { useMemo } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ArrowSquareOutIcon, HandshakeIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { recordSponsorClick, sponsorColor, type ChallengeSponsor, type SponsorPlacement } from '../challenges/globalChallenges';

// Counts the tap (0111; where it was, 0203), then opens the sponsor's site.
export function openSponsor(challengeId: string, url: string, placement?: SponsorPlacement) {
  recordSponsorClick(challengeId, placement);
  Linking.openURL(url).catch(() => {});
}

// The sponsor's logo (0203), or a rounded square in their colour with
// their first letter when there's no logo.
export function SponsorLogo({ sponsor, size = 22 }: { sponsor: ChallengeSponsor; size?: number }) {
  const radius = Math.round(size * 0.27);
  if (sponsor.logoUrl) {
    return (
      <Image
        source={{ uri: sponsor.logoUrl }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#ffffff' }}
        accessibilityLabel={`${sponsor.name} logo`}
      />
    );
  }
  return (
    <View
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: sponsorColor(sponsor), alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={{ fontFamily: font.headingSemibold, fontSize: Math.round(size * 0.52), color: '#161826' }} maxFontSizeMultiplier={1}>
        {sponsor.name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

// "presented by [logo] NAME": an Open's title line (0203).
export function PresentedBy({ challengeId, sponsor, placement = 'presented' }: { challengeId: string; sponsor: ChallengeSponsor; placement?: SponsorPlacement }) {
  const { colors } = useTheme();
  const url = sponsor.url;
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
      <Text style={{ fontSize: 12.5, color: withAlpha(colors.text, 0.7) }}>presented by</Text>
      <SponsorLogo sponsor={sponsor} size={24} />
      <Text style={{ fontFamily: font.headingSemibold, fontSize: 14, letterSpacing: 0.3, color: colors.text, flexShrink: 1 }} numberOfLines={1}>
        {sponsor.name.toUpperCase()}
      </Text>
      {url && <ArrowSquareOutIcon size={13} color={withAlpha(colors.text, 0.5)} />}
    </View>
  );
  if (!url) return body;
  return (
    <Pressable onPress={() => openSponsor(challengeId, url, placement)} hitSlop={6} accessibilityRole="link" accessibilityLabel={`Presented by ${sponsor.name}. Opens their site.`}>
      {body}
    </Pressable>
  );
}

// "Sponsored by …" on a global challenge (0111_sponsored_challenges.sql),
// with the sponsor's message under it. With a link, tapping opens their
// site in the browser and counts the tap for Admin; nothing about the
// member goes to the sponsor.
// compact: the name and message run together, for Today's card.
export function SponsorLine({
  challengeId,
  sponsor,
  compact = false,
  placement,
}: {
  challengeId: string;
  sponsor: ChallengeSponsor;
  compact?: boolean;
  // Where this line is, for the sponsor's report (0203).
  placement?: SponsorPlacement;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const url = sponsor.url;

  const body = (
    <View style={styles.row}>
      {sponsor.logoUrl || sponsor.presented ? <SponsorLogo sponsor={sponsor} size={16} /> : <HandshakeIcon size={13} color={colors.accentActive} />}
      {compact ? (
        <Text style={[styles.message, { flex: 1 }]} numberOfLines={2}>
          <Text style={styles.name}>{sponsor.presented ? 'presented by' : 'Sponsored by'} {sponsor.name}</Text>
          {sponsor.message ? ` · ${sponsor.message}` : ''}
        </Text>
      ) : (
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>
            {sponsor.presented ? 'presented by' : 'Sponsored by'} {sponsor.name}
          </Text>
          {sponsor.message && (
            <Text style={styles.message} numberOfLines={2}>
              {sponsor.message}
            </Text>
          )}
        </View>
      )}
      {url && <ArrowSquareOutIcon size={13} color={withAlpha(colors.text, 0.5)} />}
    </View>
  );

  if (!url) return body;
  return (
    <Pressable
      onPress={() => openSponsor(challengeId, url, placement)}
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
export function SponsorBanner({ challengeId, sponsor }: { challengeId: string; sponsor: ChallengeSponsor }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeBannerStyles(colors), [colors]);
  const url = sponsor.url;
  return (
    <View style={styles.banner}>
      <View style={styles.badge}>
        {sponsor.logoUrl || sponsor.presented ? <SponsorLogo sponsor={sponsor} size={32} /> : <HandshakeIcon size={20} color={colors.accentActive} weight="fill" />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{sponsor.presented ? 'PRESENTED BY' : 'SPONSORED BY'}</Text>
        <Text style={styles.name}>{sponsor.name}</Text>
        {sponsor.message && <Text style={styles.message}>{sponsor.message}</Text>}
      </View>
      {url && (
        <Pressable
          onPress={() => openSponsor(challengeId, url, 'presented')}
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
