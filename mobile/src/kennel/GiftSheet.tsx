import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { GiftIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { localDayKey } from '../goals/goals';
import { HoundArt } from './HoundArt';
import { YardThumb } from './YardArt';
import { KENNEL_ITEMS, onSale } from './kennelItems';
import { PORCH_ITEMS, YARD_ITEMS, yardItemOnSale } from './yardItems';
import { giftKennelItem } from './kennelApi';
import { TRICKS } from './tricks';
import { ROOM_ITEMS } from './roomItems';
import { RoomThumb } from './RoomArt';
import { TreatArt } from '../care/TreatArt';
import { getCare, giftTreat, type Care } from '../care/care';

interface GiftOption {
  id: string;
  name: string;
  costBones: number;
  kind: 'wear' | 'yard' | 'porch' | 'room' | 'treat';
  slot: string;
  season?: string;
  // A homemade treat (0169): the one in your pantry to send, and how many
  // of that kind you have.
  treatId?: string;
  count?: number;
}

// Send a friend something for their hound (0157): pick an item, add a
// short note, and it's theirs straight away. Paid from your Bones.
export function GiftSheet({
  friendUserId,
  friendName,
  houndName,
  hasPorch,
  balance,
  onClose,
  onSent,
}: {
  friendUserId: string;
  friendName: string;
  houndName: string;
  // Porch items only go to someone with a Porch.
  hasPorch: boolean;
  balance: number | null;
  onClose: () => void;
  // Your balance after (unchanged, null, for a treat from your pantry).
  onSent: (newBalance: number | null) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const [picked, setPicked] = useState<GiftOption | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  // Treats you baked (0169), to send from your pantry. Empty before 0169.
  const [care, setCare] = useState<Care | null>(null);
  useEffect(() => {
    getCare(localDayKey(new Date()))
      .then(setCare)
      .catch(() => {});
  }, []);

  const today = localDayKey(new Date());
  const groups = useMemo(() => {
    const wear: GiftOption[] = KENNEL_ITEMS.filter((i) => i.costBones > 0 && onSale(i, today) && i.slot !== 'coat').map((i) => ({
      id: i.id,
      name: i.name,
      costBones: i.costBones,
      kind: 'wear',
      slot: i.slot,
      season: i.season,
    }));
    const yard: GiftOption[] = YARD_ITEMS.filter((i) => i.costBones > 0 && yardItemOnSale(i, today)).map((i) => ({
      id: i.id,
      name: i.name,
      costBones: i.costBones,
      kind: 'yard',
      slot: i.slot,
      season: i.season,
    }));
    const porch: GiftOption[] = hasPorch
      ? PORCH_ITEMS.map((i) => ({ id: i.id, name: i.name, costBones: i.costBones, kind: 'porch', slot: 'porch' }))
      : [];
    const room: GiftOption[] = ROOM_ITEMS.map((i) => ({ id: i.id, name: i.name, costBones: i.costBones, kind: 'room', slot: 'room' }));
    const baked = new Map<string, GiftOption>();
    for (const t of care?.pantry ?? []) {
      if (t.from) continue;
      const have = baked.get(t.recipeId);
      if (have) have.count = (have.count ?? 1) + 1;
      else {
        const name = care?.recipes.find((r) => r.id === t.recipeId)?.name ?? 'A treat';
        baked.set(t.recipeId, { id: `treat-${t.recipeId}`, name, costBones: 0, kind: 'treat', slot: 'treat', treatId: t.id, count: 1 });
      }
    }
    return [
      { title: 'From your kitchen', items: [...baked.values()] },
      { title: 'Holiday', items: [...wear, ...yard].filter((i) => i.season) },
      { title: `For ${houndName} to wear`, items: wear.filter((i) => !i.season) },
      { title: 'For the yard', items: yard.filter((i) => !i.season) },
      { title: 'For the porch', items: porch },
      { title: 'For the room', items: room },
      { title: 'Tricks', items: TRICKS.map((t) => ({ id: t.id, name: t.name, costBones: t.costBones, kind: 'porch' as const, slot: 'trick' })) },
    ].filter((g) => g.items.length > 0);
  }, [today, hasPorch, houndName, care]);

  const send = async () => {
    if (!picked) return;
    if (balance !== null && picked.costBones > balance) {
      Alert.alert(`Not enough ${currencyName}`, `That's ${picked.costBones}, and you have ${balance}.`);
      return;
    }
    setSending(true);
    try {
      if (picked.kind === 'treat' && picked.treatId) {
        await giftTreat(localDayKey(new Date()), friendUserId, picked.treatId, note.trim() || null);
        Alert.alert('Sent!', `${picked.name} for ${houndName}, from your kitchen. ${friendName} will see your note next time they open Hound.`);
        onSent(null);
        return;
      }
      const left = await giftKennelItem(friendUserId, picked.id, note.trim() || null);
      Alert.alert('Sent!', `${friendName} has the ${picked.name}. They'll see your note next time they open Hound.`);
      onSent(left);
    } catch (e) {
      Alert.alert('Couldn’t send it', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Behind the sheet, so a tap outside closes it without stealing the sheet's scrolling. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <GiftIcon size={20} color={colors.accent} weight="fill" />
              <Text style={[text.h4, { flex: 1 }]}>A gift for {houndName}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <XIcon size={18} color={withAlpha(colors.text, 0.5)} />
              </Pressable>
            </View>
            <Text style={styles.note}>
              From your {currencyName}{balance !== null ? ` (you have ${balance.toLocaleString()})` : ''}. If {friendName} already has it, you
              won’t be charged.
            </Text>

            <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              {groups.map((g) => (
                <View key={g.title} style={{ gap: 6 }}>
                  <Text style={styles.heading}>{g.title.toUpperCase()}</Text>
                  <View style={styles.grid}>
                    {g.items.map((i) => {
                      const on = picked?.id === i.id;
                      return (
                        <Pressable
                          key={i.id}
                          onPress={() => setPicked(i)}
                          style={[styles.option, on && styles.optionOn]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={i.kind === 'treat' ? `${i.name}, homemade` : `${i.name}, ${i.costBones} ${currencyName}`}
                        >
                          <View style={styles.thumb}>
                            {i.kind === 'wear' ? (
                              <HoundArt
                                rank="alpha"
                                mood="happy"
                                size={46}
                                animate={false}
                                neckId={i.slot === 'neck' ? i.id : null}
                                headId={i.slot === 'head' ? i.id : null}
                                faceId={i.slot === 'face' ? i.id : null}
                                bodyId={i.slot === 'body' ? i.id : null}
                                feetId={i.slot === 'feet' ? i.id : null}
                                breedId={i.slot === 'breed' ? i.id : null}
                              />
                            ) : i.kind === 'yard' ? (
                              <YardThumb id={i.id} size={46} />
                            ) : i.kind === 'room' ? (
                              <RoomThumb id={i.id} size={46} />
                            ) : i.kind === 'treat' ? (
                              <TreatArt id={i.id.replace('treat-', '')} size={42} />
                            ) : (
                              <GiftIcon size={24} color={colors.accent} />
                            )}
                          </View>
                          <Text style={styles.optionName} numberOfLines={1}>
                            {i.name}
                          </Text>
                          <Text style={styles.optionCost}>
                            {i.kind === 'treat' ? `Homemade${(i.count ?? 1) > 1 ? ` · ${i.count}` : ''}` : i.costBones.toLocaleString()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>

            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={80}
              placeholder="Add a note (optional)"
              placeholderTextColor={withAlpha(colors.text, 0.45)}
              style={styles.input}
              accessibilityLabel="A note with the gift"
            />
            <Button
              label={
                sending
                  ? 'Sending…'
                  : picked
                    ? picked.kind === 'treat'
                      ? `Send the ${picked.name}`
                      : `Send the ${picked.name} · ${picked.costBones.toLocaleString()}`
                    : 'Pick a gift'
              }
              variant="primary"
              disabled={!picked || sending}
              onPress={send}
              icon={sending ? <ActivityIndicator size="small" color="#161826" /> : undefined}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 18,
      paddingBottom: 30,
      gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    heading: { fontFamily: font.headingSemibold, fontSize: 11.5, letterSpacing: 0.8, color: withAlpha(colors.text, 0.55) },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: {
      width: 92,
      alignItems: 'center',
      gap: 2,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    optionOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.12) },
    thumb: { height: 50, alignItems: 'center', justifyContent: 'center' },
    optionName: { fontFamily: font.heading, fontSize: 12, color: colors.text, paddingHorizontal: 4 },
    optionCost: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    input: {
      fontSize: 15,
      color: colors.text,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
    },
  });
}
