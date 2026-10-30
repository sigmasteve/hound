import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { CaretRightIcon, CheckIcon, HeartIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { HoundArt } from '../kennel/HoundArt';
import { KENNEL_ITEMS, TREAT_BONES, onSale } from '../kennel/kennelItems';
import { localDayKey } from '../goals/goals';
import { giveTreat, moodReason, type Kennel } from '../kennel/kennelApi';

const MOOD_WORD: Record<Kennel['mood'], string> = {
  happy: 'happy',
  okay: 'doing okay',
  hungry: 'hungry',
  sleepy: 'sleepy',
};

// Today, in three lines: your hound and how they're doing, why, and the
// Kennel's to-dos as chips. The treat (or meal) chip gives it right here;
// the rest of the card opens the Kennel.
export function KennelCard({
  kennel,
  currencyName,
  onOpen,
  onChanged,
}: {
  kennel: Kennel;
  currencyName: string;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [treating, setTreating] = useState(false);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level);
  const classic = kennel.careMode === 'classic';
  // The cheapest gear you don't have yet, can pay for and can still buy;
  // a limited-time one (0112) first while it's around.
  const today = localDayKey(new Date());
  const shopItem =
    KENNEL_ITEMS.filter(
      (i) => i.costBones > 0 && i.costBones <= kennel.bonesBalance && !kennel.owned.includes(i.id) && onSale(i, today),
    ).sort((a, b) => Number(!a.season) - Number(!b.season) || a.costBones - b.costBones)[0] ?? null;

  const treat = async () => {
    setTreating(true);
    try {
      await giveTreat();
      notifyBonesChanged();
      onChanged();
    } catch (e) {
      Alert.alert(classic ? "Couldn't feed them" : "Couldn't give a treat", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setTreating(false);
    }
  };

  // Still to do first, done last.
  const meal = classic ? 'Feed' : 'Treat';
  const chips: ChipProps[] = [
    kennel.treatedToday
      ? { id: 'treat', label: classic ? 'Fed' : 'Treat', done: true }
      : {
          id: 'treat',
          label: treating ? '…' : `${meal} · ${TREAT_BONES}`,
          a11yLabel: `${meal} for ${TREAT_BONES} ${currencyName}`,
          onPress: treating ? undefined : treat,
        },
    { id: 'goals', label: 'Goals', done: kennel.goalDayToday },
    ...(shopItem ? [{ id: 'shop', label: `New: ${shopItem.name}`, onPress: onOpen }] : []),
  ].sort((a, b) => Number(!!a.done) - Number(!!b.done));

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open the Kennel: ${kennel.name} is ${MOOD_WORD[kennel.mood]}`}
    >
      <Card style={styles.card} elevated={false}>
        <View style={styles.art}>
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
            size={46}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {kennel.name} is {MOOD_WORD[kennel.mood]}
            </Text>
            {kennel.hearts !== null && (
              <View style={styles.hearts}>
                {[0, 1, 2].map((i) => (
                  <HeartIcon key={i} size={12} color="#e04f6a" weight={i < (kennel.hearts ?? 0) ? 'fill' : 'regular'} />
                ))}
              </View>
            )}
            <CaretRightIcon size={14} color={withAlpha(colors.text, 0.45)} />
          </View>
          <Text style={styles.line} numberOfLines={1}>
            {moodReason(kennel)}
          </Text>
          <View style={styles.chips}>
            {chips.map((c) => (
              <Chip key={c.id} styles={styles} colors={colors} {...c} />
            ))}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

interface ChipProps {
  id: string;
  label: string;
  a11yLabel?: string;
  done?: boolean;
  onPress?: () => void;
}

// A to-do: highlighted while it's waiting, a quiet check once done.
function Chip({
  styles,
  colors,
  label,
  a11yLabel,
  done = false,
  onPress,
}: Omit<ChipProps, 'id'> & { styles: ReturnType<typeof makeStyles>; colors: Palette }) {
  const body = (
    <View style={done ? [styles.chip, styles.chipDone] : styles.chip}>
      {done && <CheckIcon size={11} weight="bold" color={withAlpha(colors.text, 0.55)} />}
      <Text style={done ? [styles.chipText, styles.chipTextDone] : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable style={{ flexShrink: 1 }} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={a11yLabel ?? label}>
      {body}
    </Pressable>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    art: {
      width: 52,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: withAlpha(colors.amber, 0.08),
      overflow: 'hidden',
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { flex: 1, fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    line: { fontSize: 12.5, color: withAlpha(colors.text, 0.65) },
    hearts: { flexDirection: 'row', gap: 2 },
    chips: { flexDirection: 'row', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.6),
      backgroundColor: withAlpha(colors.amber, 0.12),
    },
    chipDone: { flexShrink: 0, borderColor: withAlpha(colors.text, 0.12), backgroundColor: 'transparent' },
    chipText: { flexShrink: 1, fontFamily: font.heading, fontSize: 12, color: colors.text },
    chipTextDone: { color: withAlpha(colors.text, 0.55) },
  });
}
