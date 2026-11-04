import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BathtubIcon, BoneIcon, CookingPotIcon, GiftIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { FindArt } from '../walks/FindArt';
import { TreatArt } from './TreatArt';
import { bathLine, missingFinds, RECIPE_NOTES, recipeNeeds, spareOf, type Care } from './care';
import type { CareState } from './useCare';

// Kennel → Care (0169): bath day, the kitchen, and the pantry.

export function CareTab({
  state,
  houndName,
  balance,
  currencyName,
  onShort,
}: {
  state: CareState;
  houndName: string;
  balance: number;
  currencyName: string;
  // Not enough Bones for a recipe: the Kennel's "Get Bones" offer.
  onShort(cost: number): void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const care = state.care;
  if (!state.available) return null;
  if (!care) return <ActivityIndicator color={colors.accent} />;
  const b = care.bath;
  const names = new Map(care.recipes.map((r) => [r.id, r.name]));

  return (
    <>
      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.header}>
          <BathtubIcon size={18} color={colors.accent} weight="fill" />
          <Text style={[text.h4, { flex: 1 }]}>Bath day</Text>
          {b.bathed && !b.muddy && <Text style={styles.tag}>Fresh</Text>}
          {b.muddy && <Text style={[styles.tag, { color: '#b07a45' }]}>Muddy</Text>}
        </View>
        <Text style={styles.note}>{bathLine(b, houndName)}</Text>
        {b.canBath && (
          <Button
            label={state.busy ? '…' : 'Give a bath'}
            variant="primary"
            small
            disabled={state.busy}
            icon={<BathtubIcon size={14} color="#161826" weight="fill" />}
            onPress={() => state.bath()}
          />
        )}
      </Card>

      <Card style={{ gap: 12 }} elevated={false}>
        <View style={styles.header}>
          <CookingPotIcon size={18} color={colors.accent} weight="fill" />
          <Text style={[text.h4, { flex: 1 }]}>Kitchen</Text>
        </View>
        <Text style={styles.note}>
          Bake treats from the things {houndName} finds on walks, plus a few {currencyName}.
        </Text>
        <SpareFinds care={care} />
        {care.recipes.map((r) => {
          const missing = missingFinds(care, r);
          const short = r.bones > balance;
          return (
            <View key={r.id} style={styles.row}>
              <TreatArt id={r.id} size={44} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.name}>{r.name}</Text>
                <Text style={styles.small}>{RECIPE_NOTES[r.id] ?? ''}</Text>
                <View style={styles.cost}>
                  <Text style={styles.small}>{recipeNeeds(r)} finds +</Text>
                  <BoneIcon size={11} color={colors.amber} weight="fill" />
                  <Text style={styles.small}>{r.bones}</Text>
                </View>
              </View>
              {missing ? (
                <Text style={[styles.small, styles.missing]} numberOfLines={2}>
                  Needs {missing}
                </Text>
              ) : (
                <Button
                  label="Make"
                  small
                  disabled={state.busy}
                  onPress={() => (short ? onShort(r.bones) : state.make(r.id))}
                />
              )}
            </View>
          );
        })}
      </Card>

      <Card style={{ gap: 10 }} elevated={false}>
        <View style={styles.header}>
          <GiftIcon size={18} color={colors.accent} weight="fill" />
          <Text style={[text.h4, { flex: 1 }]}>Pantry</Text>
          {care.pantry.length > 0 && <Text style={styles.small}>{care.pantry.length}</Text>}
        </View>
        {care.pantry.length === 0 ? (
          <Text style={styles.note}>Nothing in the pantry yet. Treats you bake, and treats friends send, wait here.</Text>
        ) : (
          care.pantry.map((t) => (
            <View key={t.id} style={styles.row}>
              <TreatArt id={t.recipeId} size={38} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.name}>{names.get(t.recipeId) ?? 'A treat'}</Text>
                {t.from ? (
                  <Text style={styles.small} numberOfLines={2}>
                    From {t.from}
                    {t.note ? `: “${t.note}”` : ''}
                  </Text>
                ) : (
                  <Text style={styles.small}>Homemade</Text>
                )}
              </View>
              <Button
                label={care.treatedToday ? 'Tomorrow' : 'Feed'}
                small
                variant={care.treatedToday ? 'ghost' : 'primary'}
                disabled={state.busy || care.treatedToday}
                onPress={() => state.feed(t.id)}
              />
            </View>
          ))
        )}
        {care.pantry.length > 0 && (
          <Text style={styles.small}>
            {care.treatedToday ? `${houndName} had a treat today. ` : 'A homemade treat is today’s treat, with nothing to pay. '}
            To send one to a friend’s hound, open them in Friends and tap Send a gift.
          </Text>
        )}
      </Card>
    </>
  );
}

// The finds you can bake with, by kind.
function SpareFinds({ care }: { care: Care }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (care.spare.length === 0) {
    return <Text style={styles.small}>No spare finds yet. Every walk of 10 minutes or more brings something home.</Text>;
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.small}>
        Spare finds: {spareOf(care, 'common')} common · {spareOf(care, 'uncommon')} uncommon · {spareOf(care, 'rare')} rare
      </Text>
      <View style={styles.finds}>
        {care.spare.map((s) => (
          <View key={s.id} style={styles.find}>
            <FindArt id={s.id} size={26} />
            {s.n > 1 && <Text style={styles.findN}>{s.n}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tag: { fontFamily: font.heading, fontSize: 12.5, color: colors.accent },
    note: { fontSize: 13.5, color: withAlpha(colors.text, 0.75), lineHeight: 19 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontFamily: font.heading, fontSize: 14, color: colors.text },
    small: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    cost: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    missing: { width: 92, textAlign: 'right' },
    finds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    find: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.text, 0.06),
    },
    findN: {
      position: 'absolute',
      right: 2,
      bottom: 0,
      fontFamily: font.heading,
      fontSize: 10.5,
      color: colors.text,
    },
  });
}
