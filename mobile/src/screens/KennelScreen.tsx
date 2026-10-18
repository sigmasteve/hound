import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, HeartIcon, PencilSimpleIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { levelProgressForXp } from '../challenges/leveling';
import { RANKS, rankForLevel } from '../challenges/ranks';
import { HoundArt } from '../kennel/HoundArt';
import {
  EAR_OPTIONS,
  KENNEL_ITEMS,
  KENNEL_SLOTS,
  MARKING_OPTIONS,
  TAIL_OPTIONS,
  TAN_SWATCH,
  TREAT_BONES,
  type KennelItem,
} from '../kennel/kennelItems';
import {
  buyKennelItem,
  equipKennelItem,
  getKennel,
  giveTreat,
  moodLine,
  setKennel,
  setKennelLook,
  type CareMode,
  type Kennel,
} from '../kennel/kennelApi';

const CARE_MODES: { id: CareMode; name: string; detail: string }[] = [
  {
    id: 'gentle',
    name: 'Gentle',
    detail: 'Their mood follows your goal days. A daily treat cheers them up. Nothing to keep up.',
  },
  {
    id: 'classic',
    name: 'Classic pet',
    detail: 'Adds 3 meal hearts. One empties each day they aren’t fed; with none left they’re hungry.',
  },
];

// Your hound (0104_kennel.sql): how they're doing, a treat or meal, their
// accessories and how you look after them. Grows with your rank.
export function KennelScreen({ onBack }: { onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const [kennel, setKennelState] = useState<Kennel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);

  const reload = useCallback(() => {
    getKennel()
      .then((k) => {
        setKennelState(k);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load the Kennel.'));
  }, []);

  useFocusEffect(reload);

  const run = async (id: string, action: () => Promise<void>, failTitle: string) => {
    setBusyId(id);
    try {
      await action();
      reload();
    } catch (e) {
      Alert.alert(failTitle, e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (!kennel) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
          {loadError ? <Text style={styles.note}>{loadError}</Text> : <ActivityIndicator color={colors.accent} />}
        </View>
      </SafeAreaView>
    );
  }

  const level = levelProgressForXp(kennel.xpTotal).level;
  const rank = rankForLevel(level);
  const nextRank = RANKS.find((r) => r.minLevel > level) ?? null;
  const classic = kennel.careMode === 'classic';
  const equippedIn = (item: KennelItem) => (item.slot === 'neck' ? kennel.neckId : item.slot === 'head' ? kennel.headId : kennel.faceId);

  const saveName = () => {
    const name = editingName?.trim() ?? '';
    setEditingName(null);
    if (name && name !== kennel.name) run('name', () => setKennel(name, null), "Couldn't rename");
  };

  // Free coats are picked straight away; the rest are bought first.
  const pressCoat = (item: KennelItem) => {
    const wear = () => equipKennelItem('coat', item.id);
    if (kennel.owned.includes(item.id)) {
      run('coat', wear, "Couldn't change the coat");
    } else if (item.costBones === 0) {
      run(
        'coat',
        async () => {
          await buyKennelItem(item.id);
          await wear();
        },
        "Couldn't change the coat",
      );
    } else {
      pressItem(item);
    }
  };

  const pressItem = (item: KennelItem) => {
    const owned = kennel.owned.includes(item.id);
    if (owned) {
      const wearing = equippedIn(item) === item.id;
      run(item.id, () => equipKennelItem(item.slot, wearing ? null : item.id), "Couldn't change that");
    } else {
      Alert.alert(`Get the ${item.name}?`, `${item.costBones} ${currencyName} from your balance.`, [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Spend ${item.costBones}`,
          onPress: () =>
            run(
              item.id,
              async () => {
                await buyKennelItem(item.id);
                await equipKennelItem(item.slot, item.id);
              },
              "Couldn't get that",
            ),
        },
      ]);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <Card style={styles.hero} elevated={false}>
          <View style={styles.kennelFloor}>
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
              size={190}
            />
          </View>

          {editingName !== null ? (
            <TextInput
              value={editingName}
              onChangeText={setEditingName}
              onBlur={saveName}
              onSubmitEditing={saveName}
              autoFocus
              maxLength={20}
              returnKeyType="done"
              style={styles.nameInput}
            />
          ) : (
            <Pressable style={styles.nameRow} onPress={() => setEditingName(kennel.name)} hitSlop={8}>
              <Text style={styles.name}>{kennel.name}</Text>
              <PencilSimpleIcon size={15} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          )}

          <View style={[styles.rankChip, { backgroundColor: withAlpha(rank.color, 0.18) }]}>
            <Text style={[styles.rankText, { color: rank.color }]}>{rank.name}</Text>
          </View>
          <Text style={styles.mood}>{moodLine(kennel)}</Text>
          {nextRank && (
            <Text style={styles.note}>
              Grows into a {nextRank.name} at level {nextRank.minLevel}. You’re level {level}.
            </Text>
          )}

          {classic && kennel.hearts !== null && (
            <View style={styles.hearts}>
              {[0, 1, 2].map((i) => (
                <HeartIcon key={i} size={22} color="#e04f6a" weight={i < (kennel.hearts ?? 0) ? 'fill' : 'regular'} />
              ))}
            </View>
          )}

          <View style={styles.treatRow}>
            {kennel.treatedToday ? (
              <Text style={styles.note}>{classic ? 'Fed today. Back tomorrow.' : 'Had a treat today. Back tomorrow.'}</Text>
            ) : (
              <Button
                label={busyId === 'treat' ? '…' : `${classic ? 'Feed a meal' : 'Give a treat'} · ${TREAT_BONES} ${currencyName}`}
                variant="primary"
                icon={<BoneIcon size={14} color={colors.accent} weight="fill" />}
                disabled={busyId !== null}
                onPress={() => run('treat', giveTreat, classic ? "Couldn't feed them" : "Couldn't give a treat")}
              />
            )}
          </View>
          <Text style={styles.note}>
            {kennel.bonesBalance.toLocaleString()} {currencyName} to spend
          </Text>
        </Card>

        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Look</Text>
          <Text style={styles.label}>Coat</Text>
          <View style={styles.swatches}>
            {[null, ...KENNEL_ITEMS.filter((i) => i.slot === 'coat')].map((item) => {
              const on = kennel.coatId === (item?.id ?? null);
              const owned = !item || item.costBones === 0 || kennel.owned.includes(item.id);
              return (
                <Pressable
                  key={item?.id ?? 'tan'}
                  style={styles.swatchCell}
                  disabled={on || busyId !== null}
                  onPress={() => (item ? pressCoat(item) : run('coat', () => equipKennelItem('coat', null), "Couldn't change the coat"))}
                  accessibilityRole="button"
                  accessibilityLabel={`${item?.name ?? 'Tan'} coat${owned ? '' : `, ${item!.costBones} ${currencyName}`}`}
                >
                  <View style={[styles.swatch, { backgroundColor: item?.color ?? TAN_SWATCH }, on && styles.swatchOn]} />
                  <Text style={styles.swatchName} numberOfLines={2}>
                    {item?.name ?? 'Tan'}
                  </Text>
                  {!owned && <Text style={styles.swatchPrice}>{item!.costBones}</Text>}
                </Pressable>
              );
            })}
          </View>
          {(
            [
              ['Ears', EAR_OPTIONS, kennel.ears, (v: string) => ({ ears: v as Kennel['ears'] })],
              ['Tail', TAIL_OPTIONS, kennel.tail, (v: string) => ({ tail: v as Kennel['tail'] })],
              ['Markings', MARKING_OPTIONS, kennel.markings, (v: string) => ({ markings: v as Kennel['markings'] })],
            ] as const
          ).map(([label, options, current, toLook]) => (
            <View key={label} style={{ gap: 6 }}>
              <Text style={styles.label}>{label}</Text>
              <View style={styles.chips}>
                {options.map((o) => (
                  <Pressable
                    key={o.id}
                    style={[styles.chip, current === o.id && styles.chipOn]}
                    disabled={current === o.id || busyId !== null}
                    onPress={() => run(`look-${o.id}`, () => setKennelLook(toLook(o.id)), "Couldn't change the look")}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current === o.id }}
                  >
                    <Text style={[styles.chipText, current === o.id && styles.chipTextOn]}>{o.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Card>

        {KENNEL_SLOTS.map(({ slot, label }) => (
          <Card key={slot} style={{ gap: 4 }} elevated={false}>
            <Text style={text.h4}>{label}</Text>
            {KENNEL_ITEMS.filter((i) => i.slot === slot).map((item) => {
              const owned = kennel.owned.includes(item.id);
              const wearing = equippedIn(item) === item.id;
              return (
                <Pressable key={item.id} style={styles.itemRow} disabled={busyId !== null} onPress={() => pressItem(item)}>
                  <View style={styles.itemPreview}>
                    <HoundArt
                      rank={rank.id}
                      mood="okay"
                      neckId={slot === 'neck' ? item.id : null}
                      headId={slot === 'head' ? item.id : null}
                      faceId={slot === 'face' ? item.id : null}
                      coatId={kennel.coatId}
                      ears={kennel.ears}
                      tail={kennel.tail}
                      markings={kennel.markings}
                      size={44}
                      animate={false}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemNote}>
                      {wearing ? 'Wearing · tap to take off' : owned ? 'Tap to put on' : `${item.costBones} ${currencyName}`}
                    </Text>
                  </View>
                  {busyId === item.id ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : wearing ? (
                    <CheckCircleIcon size={18} color={colors.accent} weight="fill" />
                  ) : null}
                </Pressable>
              );
            })}
          </Card>
        ))}

        <Card style={{ gap: 8 }} elevated={false}>
          <Text style={text.h4}>Care style</Text>
          {CARE_MODES.map((m) => {
            const on = kennel.careMode === m.id;
            return (
              <Pressable
                key={m.id}
                style={[styles.mode, on && styles.modeOn]}
                disabled={on || busyId !== null}
                onPress={() => run(`mode-${m.id}`, () => setKennel(null, m.id), "Couldn't change the care style")}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.itemName}>{m.name}</Text>
                  <Text style={styles.itemNote}>{m.detail}</Text>
                </View>
                {on && <CheckCircleIcon size={18} color={colors.accent} weight="fill" />}
              </Pressable>
            );
          })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    hero: { alignItems: 'center', gap: 8 },
    kennelFloor: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingTop: 8,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.08),
    },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    name: { fontFamily: font.headingSemibold, fontSize: 24, color: colors.text },
    nameInput: {
      fontFamily: font.headingSemibold,
      fontSize: 22,
      color: colors.text,
      minWidth: 160,
      textAlign: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.accent,
      paddingVertical: 2,
    },
    rankChip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
    rankText: { fontFamily: font.headingSemibold, fontSize: 13.5 },
    mood: { fontSize: 14.5, color: colors.text, textAlign: 'center' },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    hearts: { flexDirection: 'row', gap: 6 },
    treatRow: { marginTop: 4 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    itemPreview: {
      width: 52,
      height: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      backgroundColor: withAlpha(colors.amber, 0.08),
      overflow: 'hidden',
    },
    itemName: { fontSize: 14.5, color: colors.text, fontFamily: font.body },
    itemNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    mode: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
    },
    modeOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.08) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    swatchCell: { width: 74, alignItems: 'center', gap: 4 },
    swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: withAlpha(colors.text, 0.12) },
    swatchOn: { borderColor: colors.accent, borderWidth: 3 },
    swatchName: { fontSize: 11.5, color: colors.text, textAlign: 'center' },
    swatchPrice: { fontSize: 11, color: withAlpha(colors.text, 0.55), marginTop: -3 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.2),
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    chipTextOn: { color: '#ffffff' },
  });
}
