import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BoneIcon, GiftIcon, PlantIcon, PlusIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { PlantThumb } from './PlantArt';
import { plantProgress, plantStage, PLOTS, STAGE_NAMES, type Garden, type SeedKind } from './garden';
import type { GardenState } from './useGarden';

// Kennel → Yard → Garden (0162): the 3 plots, what's growing and how far
// along, the week's free seed, and the seed shop.

const SEASON_WORDS: Record<string, string> = { autumn: 'Autumn', winter: 'Winter', spring: 'Spring', summer: 'Summer' };

// "850", "6k", "18.2k"
function stepsText(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 || Number.isInteger(Math.round(k * 10) / 10) ? Math.round(k) : (Math.round(k * 10) / 10).toFixed(1)}k`;
}

export function GardenCard({
  state,
  currencyName,
  onShort,
}: {
  state: GardenState;
  currencyName: string;
  // Not enough Bones for a pack: the Kennel's "Get Bones" offer.
  onShort(cost: number): void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The seed sheet: for planting in a plot, or just the shop.
  const [sheet, setSheet] = useState<{ plot: number | null } | null>(null);
  const g = state.garden;
  if (!state.available || !g) return null;
  const kinds = new Map(g.kinds.map((k) => [k.id, k]));
  const seedCount = [...g.seeds.values()].reduce((n, c) => n + c, 0);

  const tapPlot = (i: number) => {
    const p = g.plots[i];
    if (!p) {
      setSheet({ plot: i });
      return;
    }
    const k = kinds.get(p.seedId);
    const name = k?.name ?? 'It';
    if (plantStage(p) === 3) {
      state.pick(i);
      return;
    }
    Alert.alert(
      name,
      `${p.steps.toLocaleString()} of ${p.need.toLocaleString()} steps. It grows with every step you take, and a day off just pauses it.`,
      [
        { text: 'Dig it up', style: 'destructive', onPress: () => confirmDig(i, name) },
        { text: 'OK', style: 'cancel' },
      ],
    );
  };
  const confirmDig = (i: number, name: string) =>
    Alert.alert(`Dig up the ${name.toLowerCase()}?`, 'The plot is free again, but the seed is used up.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Dig it up', style: 'destructive', onPress: () => state.digUp(i) },
    ]);

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <Text style={text.h4}>Garden</Text>
        <Pressable onPress={() => setSheet({ plot: null })} hitSlop={10} accessibilityRole="button" style={styles.headerBtn}>
          <PlantIcon size={15} color={colors.accent} />
          <Text style={styles.headerBtnText}>Seeds{seedCount > 0 ? ` · ${seedCount}` : ''}</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>Plant a seed and your steps water it. A day off pauses it; nothing wilts.</Text>

      {g.freeSeed && (
        <Pressable style={styles.freeBanner} onPress={() => setSheet({ plot: null })} accessibilityRole="button">
          <GiftIcon size={18} color={colors.accentActive} weight="fill" />
          <Text style={styles.freeText}>This week&rsquo;s free seed is ready. Pick one</Text>
        </Pressable>
      )}

      <View style={styles.plots}>
        {Array.from({ length: PLOTS }, (_, i) => {
          const p = g.plots[i];
          const k = p ? kinds.get(p.seedId) : undefined;
          const stage = p ? plantStage(p) : 0;
          return (
            <Pressable
              key={i}
              style={[styles.plot, p && stage === 3 && styles.plotBloom]}
              onPress={() => tapPlot(i)}
              disabled={state.busy}
              accessibilityRole="button"
              accessibilityLabel={p ? `${k?.name ?? 'Plant'}, ${STAGE_NAMES[stage]}` : 'Empty plot. Plant a seed'}
            >
              {p ? (
                <>
                  <PlantThumb id={p.seedId} stage={stage} size={56} />
                  <Text style={styles.plotName} numberOfLines={2}>
                    {k?.name ?? 'Plant'}
                  </Text>
                  {stage === 3 ? (
                    <Text style={styles.pickIt}>Tap to pick</Text>
                  ) : (
                    <>
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${Math.round(plantProgress(p) * 100)}%` }]} />
                      </View>
                      <Text style={styles.plotNote}>
                        {stepsText(p.steps)} of {stepsText(p.need)} steps
                      </Text>
                    </>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.emptyPlot}>
                    <PlusIcon size={20} color={withAlpha(colors.text, 0.45)} />
                  </View>
                  <Text style={styles.plotNote}>Plant a seed</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>

      {g.picked.size > 0 && (
        <Text style={styles.footNote}>
          Grown so far:{' '}
          {[...g.picked.entries()]
            .map(([id, n]) => `${kinds.get(id)?.name ?? id} ×${n}`)
            .join(' · ')}
        </Text>
      )}

      {sheet && (
        <SeedSheet
          garden={g}
          plot={sheet.plot}
          state={state}
          currencyName={currencyName}
          onClose={() => setSheet(null)}
          onShort={onShort}
          styles={styles}
        />
      )}
    </Card>
  );
}

function SeedSheet({
  garden,
  plot,
  state,
  currencyName,
  onClose,
  onShort,
  styles,
}: {
  garden: Garden;
  plot: number | null;
  state: GardenState;
  currencyName: string;
  onClose(): void;
  onShort(cost: number): void;
  styles: Styles;
}) {
  const { colors, text } = useTheme();
  const mine = garden.kinds.filter((k) => (garden.seeds.get(k.id) ?? 0) > 0);
  const free = garden.kinds.filter((k) => k.free);
  const emptyPlot = plot ?? garden.plots.findIndex((p) => p === null);

  const plant = async (k: SeedKind) => {
    if (emptyPlot < 0) {
      Alert.alert('Every plot is growing', 'Pick a plant that has bloomed, or dig one up, to free a plot.');
      return;
    }
    if (await state.plant(emptyPlot, k.id)) onClose();
  };

  // Short of Bones: the sheet closes and the Kennel offers a way to get
  // more, instead of an error.
  const buy = (k: SeedKind) => {
    if (garden.balance !== null && garden.balance < k.packBones) {
      onClose();
      // After the sheet has slid away: iOS drops an alert shown while a
      // modal is closing.
      setTimeout(() => onShort(k.packBones), 400);
      return;
    }
    state.buy(k.id);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <PlantIcon size={20} color={colors.accent} weight="fill" />
            <Text style={[text.h4, { flex: 1 }]}>{plot !== null ? 'Plant a seed' : 'Seeds'}</Text>
            {state.busy && <ActivityIndicator color={colors.accent} />}
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
            {garden.freeSeed && (
              <View style={{ gap: 8 }}>
                <Text style={styles.groupTitle}>THIS WEEK&rsquo;S FREE SEED</Text>
                <View style={styles.freeRow}>
                  {free.map((k) => (
                    <Pressable key={k.id} style={styles.freePick} onPress={() => state.claim(k.id)} disabled={state.busy} accessibilityRole="button">
                      <PlantThumb id={k.id} stage={3} size={40} />
                      <Text style={styles.plotName}>{k.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {mine.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={styles.groupTitle}>YOUR SEEDS{emptyPlot < 0 ? ' · EVERY PLOT IS GROWING' : ' · TAP ONE TO PLANT IT'}</Text>
                {mine.map((k) => (
                  <Pressable key={k.id} style={styles.seedRow} onPress={() => plant(k)} disabled={state.busy} accessibilityRole="button">
                    <PlantThumb id={k.id} stage={3} size={42} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.seedName}>
                        {k.name} <Text style={styles.seedCount}>×{garden.seeds.get(k.id)}</Text>
                      </Text>
                      <Text style={styles.plotNote}>{k.steps.toLocaleString()} steps to bloom</Text>
                    </View>
                    <Text style={styles.plantWord}>Plant</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={{ gap: 6 }}>
              <Text style={styles.groupTitle}>SEED SHOP</Text>
              {garden.kinds.map((k) => (
                <View key={k.id} style={styles.seedRow}>
                  <PlantThumb id={k.id} stage={3} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.seedName}>{k.name}</Text>
                    <Text style={styles.plotNote}>
                      {k.steps.toLocaleString()} steps to bloom{k.season ? ` · ${SEASON_WORDS[k.season]} only` : ''}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.buy, (!k.onSale || state.busy) && { opacity: 0.45 }]}
                    disabled={!k.onSale || state.busy}
                    onPress={() => buy(k)}
                    accessibilityRole="button"
                    accessibilityLabel={`${k.packSize} ${k.name} seeds for ${k.packBones} ${currencyName}`}
                  >
                    <Text style={styles.buyText}>{k.packSize} for</Text>
                    <BoneIcon size={12} color={colors.amber} weight="fill" />
                    <Text style={styles.buyText}>{k.packBones}</Text>
                  </Pressable>
                </View>
              ))}
              {garden.balance !== null && (
                <Text style={styles.footNote}>
                  You have {garden.balance.toLocaleString()} {currencyName}.
                </Text>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
    headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    headerBtnText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    note: { fontSize: 13.5, color: withAlpha(colors.text, 0.65), lineHeight: 19 },
    footNote: { fontSize: 12, color: withAlpha(colors.text, 0.5) },
    freeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.accent, 0.14),
    },
    freeText: { flex: 1, fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    plots: { flexDirection: 'row', gap: 8 },
    plot: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: withAlpha(colors.text, 0.05),
      minHeight: 124,
      justifyContent: 'center',
    },
    plotBloom: { backgroundColor: withAlpha('#5fb456', 0.16), borderWidth: 1.5, borderColor: withAlpha('#5fb456', 0.6) },
    plotName: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text, textAlign: 'center' },
    plotNote: { fontSize: 12, color: withAlpha(colors.text, 0.55), textAlign: 'left' },
    pickIt: { fontFamily: font.headingSemibold, fontSize: 12, color: '#5fb456' },
    bar: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.1), overflow: 'hidden', marginHorizontal: 4 },
    barFill: { height: 6, borderRadius: 3, backgroundColor: '#5fb456' },
    emptyPlot: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: withAlpha(colors.text, 0.3),
      alignItems: 'center',
      justifyContent: 'center',
    },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      paddingBottom: 30,
      gap: 12,
    },
    groupTitle: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.6, color: withAlpha(colors.text, 0.5) },
    freeRow: { flexDirection: 'row', gap: 8 },
    freePick: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.accent, 0.5),
      backgroundColor: withAlpha(colors.accent, 0.08),
    },
    seedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    seedName: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    seedCount: { fontFamily: font.body, fontSize: 13, color: withAlpha(colors.text, 0.55) },
    plantWord: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.accent },
    buy: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.amber, 0.14),
    },
    buyText: { fontFamily: font.headingSemibold, fontSize: 13, color: colors.text },
  });
}
