import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { BACKGROUNDS, FRAMES, type BackgroundStyle, type CosmeticSlot, type FrameStyle } from '../cosmetics/catalog';
import {
  equipCosmetic,
  getMyEquippedCosmetics,
  getMyPurchasedItemIds,
  purchaseCosmetic,
  type EquippedCosmetics,
} from '../cosmetics/cosmeticsApi';
import { getMyHoundScore, type HoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';

type LockerTab = 'locker' | 'shop';

export function LockerScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tab, setTab] = useState<LockerTab>('locker');

  // null covers both "hasn't loaded yet" and "failed to load" — same
  // never-show-a-guessed-number reasoning as SettingsScreen's own
  // houndScore fetch. Everything below (unlock/afford checks, the
  // header) just waits rather than assuming 0 XP/Bones, which would
  // flash every item as freshly locked/unaffordable for a real player.
  const [houndScore, setHoundScore] = useState<HoundScore | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [purchasedIds, setPurchasedIds] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!user?.id) return;
    Promise.all([getMyHoundScore(user.id), getMyEquippedCosmetics(user.id), getMyPurchasedItemIds(user.id)])
      .then(([score, cosmetics, purchased]) => {
        setHoundScore(score);
        setEquipped(cosmetics);
        setPurchasedIds(new Set(purchased));
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load your locker.'));
  }, [user?.id]);

  useFocusEffect(reload);

  // Tapping an already-equipped item un-equips it (p_item_id: null,
  // always allowed); tapping any other owned item equips it.
  // equip_cosmetic re-checks ownership itself server-side, so a stale
  // local read can't let someone equip something they don't actually
  // have — this can only fail safe, never succeed wrongly.
  const toggleEquip = async (slot: CosmeticSlot, itemId: string, alreadyEquipped: boolean) => {
    setEquippingId(itemId);
    try {
      await equipCosmetic(slot, alreadyEquipped ? null : itemId);
      setEquipped((prev) => ({
        frameId: slot === 'frame' ? (alreadyEquipped ? null : itemId) : (prev?.frameId ?? null),
        backgroundId: slot === 'background' ? (alreadyEquipped ? null : itemId) : (prev?.backgroundId ?? null),
      }));
    } catch (e) {
      Alert.alert('Could not equip that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setEquippingId(null);
    }
  };

  // purchase_cosmetic re-derives the price and the caller's own real
  // Bones balance server-side — a stale local balance can't let someone
  // buy something they can't actually afford. The local balance/ownership
  // patch below just reflects what the RPC already did, same "the write
  // already succeeded, no round-trip would tell us more" shape
  // FriendDetailScreen's own kudos count uses.
  const buyItem = async (item: FrameStyle | BackgroundStyle) => {
    setBuyingId(item.id);
    try {
      await purchaseCosmetic(item.id);
      setPurchasedIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
      setHoundScore((prev) => (prev ? { ...prev, bonesBalance: prev.bonesBalance - (item.costBones ?? 0) } : prev));
    } catch (e) {
      Alert.alert('Could not buy that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBuyingId(null);
    }
  };

  const xpTotal = houndScore?.xpTotal ?? null;
  const bonesBalance = houndScore?.bonesBalance ?? null;

  const renderItem = (item: FrameStyle | BackgroundStyle, slot: CosmeticSlot) => {
    const isShopItem = item.costBones !== null;
    const owned = isShopItem
      ? !!purchasedIds?.has(item.id)
      : xpTotal !== null && item.unlockXp !== null && xpTotal >= item.unlockXp;
    const isEquipped = slot === 'frame' ? equipped?.frameId === item.id : equipped?.backgroundId === item.id;
    const affordable = isShopItem && bonesBalance !== null && item.costBones !== null && bonesBalance >= item.costBones;
    const busy = equippingId === item.id || buyingId === item.id;

    const handlePress = () => {
      if (busy) return;
      if (owned) {
        toggleEquip(slot, item.id, !!isEquipped);
      } else if (isShopItem && affordable) {
        buyItem(item);
      }
    };

    let noteText: string;
    if (owned) {
      noteText = isEquipped ? 'Equipped — tap to remove' : 'Tap to equip';
    } else if (isShopItem) {
      noteText = affordable ? `Buy for ${item.costBones} Bones` : `Need ${item.costBones} Bones`;
    } else {
      // XOR invariant (catalog.ts) guarantees unlockXp is set here — the
      // ?? 0 is just to satisfy the nullable type, not a real fallback.
      noteText = `Unlocks at level ${levelProgressForXp(item.unlockXp ?? 0).level}`;
    }

    return (
      <Pressable
        key={item.id}
        style={styles.itemRow}
        disabled={busy || (!owned && !(isShopItem && affordable))}
        onPress={handlePress}
      >
        {/* Previews this item combined with whatever's equipped in the
            other slot, not in isolation — so picking a frame shows it
            against your actual current background, and vice versa. */}
        <Avatar
          initials={user?.initials ?? '?'}
          tint={colors.accent800}
          size={36}
          fontSize={12}
          frameId={slot === 'frame' ? item.id : equipped?.frameId}
          backgroundId={slot === 'background' ? item.id : equipped?.backgroundId}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemNote}>{noteText}</Text>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : owned ? (
          isEquipped && <CheckCircleIcon size={18} color={color.accent} weight="fill" />
        ) : !isShopItem ? (
          <LockSimpleIcon size={16} color={withAlpha(colors.text, 0.4)} />
        ) : null}
      </Pressable>
    );
  };

  const leveledFrames = FRAMES.filter((f) => f.unlockXp !== null);
  const leveledBackgrounds = BACKGROUNDS.filter((b) => b.unlockXp !== null);
  const shopFrames = FRAMES.filter((f) => f.costBones !== null);
  const shopBackgrounds = BACKGROUNDS.filter((b) => b.costBones !== null);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Button label="Settings" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={styles.headerRow}>
          <Avatar
            initials={user?.initials ?? '?'}
            tint={colors.accent800}
            size={56}
            fontSize={18}
            frameId={equipped?.frameId}
            backgroundId={equipped?.backgroundId}
          />
          <View style={{ gap: 2 }}>
            <Text style={text.h2}>Locker</Text>
            <Text style={styles.footNote}>
              {xpTotal !== null ? `Level ${levelProgressForXp(xpTotal).level} · ${xpTotal.toLocaleString()} XP` : 'Loading…'}
            </Text>
          </View>
        </View>

        {loadError && <Text style={styles.errorNote}>{loadError}</Text>}

        <View style={styles.tabRow}>
          <Pressable style={[styles.tabButton, tab === 'locker' && styles.tabButtonActive]} onPress={() => setTab('locker')}>
            <Text style={[styles.tabLabel, tab === 'locker' && styles.tabLabelActive]}>Locker</Text>
          </Pressable>
          <Pressable style={[styles.tabButton, tab === 'shop' && styles.tabButtonActive]} onPress={() => setTab('shop')}>
            <Text style={[styles.tabLabel, tab === 'shop' && styles.tabLabelActive]}>Shop</Text>
          </Pressable>
        </View>

        {tab === 'locker' ? (
          <>
            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Frames</Text>
              {leveledFrames.map((f) => renderItem(f, 'frame'))}
            </Card>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Backgrounds</Text>
              {leveledBackgrounds.map((b) => renderItem(b, 'background'))}
            </Card>
          </>
        ) : (
          <>
            <Card style={{ gap: 8 }} elevated={false}>
              <View style={styles.balanceRow}>
                <BoneIcon size={22} color={color.accent} weight="fill" />
                <View>
                  <Text style={styles.balanceLabel}>Bones</Text>
                  <Text style={styles.balanceValue}>{bonesBalance !== null ? bonesBalance.toLocaleString() : '—'}</Text>
                </View>
              </View>
              <Text style={styles.footNote}>Earned from finishing challenges and leveling up.</Text>
            </Card>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Frames</Text>
              {shopFrames.map((f) => renderItem(f, 'frame'))}
            </Card>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Backgrounds</Text>
              {shopBackgrounds.map((b) => renderItem(b, 'background'))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 16, paddingBottom: 48 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    errorNote: { fontSize: 12.5, color: colors.amber },
    tabRow: {
      flexDirection: 'row',
      gap: 6,
      backgroundColor: withAlpha(colors.text, 0.06),
      borderRadius: 10,
      padding: 4,
    },
    tabButton: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
    tabButtonActive: { backgroundColor: colors.surface },
    tabLabel: { fontSize: 13.5, fontFamily: font.heading, color: withAlpha(colors.text, 0.55) },
    tabLabelActive: { color: colors.text },
    balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    balanceLabel: { fontSize: 12, letterSpacing: 0.5, color: withAlpha(colors.text, 0.55) },
    balanceValue: { fontFamily: font.headingSemibold, fontSize: 20, color: colors.text },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.07),
    },
    itemName: { fontSize: 14.5, color: colors.text, fontFamily: font.body },
    itemNote: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
  });
}
