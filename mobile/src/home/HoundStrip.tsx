import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CaretRightIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { HoundArt } from '../kennel/HoundArt';
import { useMyMoonLook } from '../kennel/moonApi';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { moodReason, type Kennel } from '../kennel/kennelApi';
import type { HoundProfile } from '../growth/growth';

// Your hound on Today (the streamlining's third part, 0281): a strip at
// the bottom, about the hound and not the shop: drawn large, its mood and
// what would cheer it up (your goals). For the first three days it says
// "Meet <name>", so new people aren't asked to shop first. On its birthday
// it moves up to the top of the tiles for the day, as it does every day
// with Customize Today's "Your hound at the top". Tapping opens the Kennel.

const MOOD: Record<Kennel['mood'], string> = {
  happy: 'is happy',
  okay: 'is doing okay',
  hungry: 'is hungry',
  sleepy: 'is sleepy',
};

export function daysOld(bornOn: string | null, now = new Date()): number | null {
  if (!bornOn) return null;
  const [y, m, d] = bornOn.split('-').map(Number);
  const born = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - born) / 86400000);
}

export function houndStripOnTop(onPref: boolean, profile: HoundProfile | null): boolean {
  return onPref || !!profile?.isBirthday;
}

export function HoundStrip({ kennel, profile, onPress }: { kennel: Kennel; profile: HoundProfile | null; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level);
  const moon = useMyMoonLook();
  const age = daysOld(profile?.bornOn ?? null);
  const isNew = age !== null && age < 3;
  const birthday = !!profile?.isBirthday;

  const title = birthday ? `🎂 It’s ${kennel.name}’s birthday!` : isNew ? `Meet ${kennel.name}` : `${kennel.name} ${MOOD[kennel.mood]}`;
  const line = birthday
    ? 'Come to the party in the Kennel.'
    : isNew
      ? 'Your hound grows with your steps and cheers when you hit your goals.'
      : moodReason(kennel);
  const sub = birthday || isNew ? 'Say hello' : kennel.treatedToday ? 'Had a treat today' : 'The Kennel';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.strip, birthday && styles.party, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${line} Open the Kennel`}
    >
      <View style={styles.art} pointerEvents="none">
        <HoundArt
          rank={rank.id}
          mood={kennel.mood}
          neckId={kennel.neckId}
          headId={kennel.headId}
          faceId={kennel.faceId}
          coatId={kennel.coatId}
          ears={kennel.ears}
          tail={kennel.tail}
          markings={kennel.markings}
          breedId={kennel.breedId}
          bodyId={kennel.bodyId}
          feetId={kennel.feetId}
          moon={moon}
          size={96}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.line} numberOfLines={2}>
          {line}
        </Text>
        <View style={styles.subRow}>
          <Text style={styles.sub}>{sub}</Text>
          <CaretRightIcon size={13} color={colors.accentActive} />
        </View>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 20,
      backgroundColor: colors.surface,
      paddingVertical: 8,
      paddingLeft: 6,
      paddingRight: 14,
      minHeight: 104,
    },
    party: { borderWidth: 1.5, borderColor: withAlpha('#f0c24a', 0.6) },
    art: { width: 100, height: 96, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 16.5, fontFamily: font.headingSemibold, color: colors.text },
    line: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.7) },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
    sub: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.accentActive },
  });
}
