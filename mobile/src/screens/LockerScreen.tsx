import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, GhostIcon, LockSimpleIcon, PlusIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import {
  BACKGROUNDS,
  FRAMES,
  ICONS,
  isCollectionOnSale,
  SEASONAL_COLLECTIONS,
  type BackgroundStyle,
  type CosmeticSlot,
  type FrameStyle,
  type IconStyle,
} from '../cosmetics/catalog';
import {
  equipCosmetic,
  getMyEquippedCosmetics,
  getMyPurchasedItemIds,
  purchaseCosmetic,
  type EquippedCosmetics,
} from '../cosmetics/cosmeticsApi';
import { getMyHoundScore, type HoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';
import { listBonesPackOffers, purchaseBonesPack, type BonesPackOffer } from '../bones/purchasesApi';
import { useCurrencyName } from '../organizations/useCurrencyName';

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

  // Real-money packs — separate from the cosmetics catalog above, and
  // loaded lazily (only once the Shop tab is actually open) since
  // fetching it touches the RevenueCat SDK, not just Supabase. null
  // means "hasn't loaded yet"; a load failure sets bonesOffersError
  // instead of leaving this stuck on null forever.
  const [bonesOffers, setBonesOffers] = useState<BonesPackOffer[] | null>(null);
  const [bonesOffersError, setBonesOffersError] = useState<string | null>(null);
  const [buyingProductId, setBuyingProductId] = useState<string | null>(null);

  const currencyName = useCurrencyName();

  // "Add Bones" shortcuts (next to the balance, and on items you can't
  // afford yet) just scroll down to the packs card rather than opening
  // anything new — the store's own purchase sheet stays the one place a
  // real-money buy happens. Only offered once there are packs to show:
  // while they're loading, or if the store can't provide any, there's
  // nothing worth scrolling to.
  const scrollRef = useRef<ScrollView>(null);
  const [packsY, setPacksY] = useState<number | null>(null);
  const canAddBones = !bonesOffersError && !!bonesOffers && bonesOffers.length > 0;
  const scrollToPacks = () => {
    if (packsY !== null) scrollRef.current?.scrollTo({ y: Math.max(0, packsY - 12), animated: true });
  };

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
        iconId: slot === 'icon' ? (alreadyEquipped ? null : itemId) : (prev?.iconId ?? null),
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
  const buyItem = async (item: FrameStyle | BackgroundStyle | IconStyle) => {
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

  // Loads once per time the Shop tab is opened, not on every focus like
  // reload() above — this hits the RevenueCat SDK (a native/network call
  // beyond Supabase), so it shouldn't re-run just because the user
  // switched tabs and back.
  useEffect(() => {
    if (tab !== 'shop' || !user?.id || bonesOffers !== null || bonesOffersError) return;
    listBonesPackOffers(user.id)
      .then(setBonesOffers)
      .catch((e) => setBonesOffersError(e instanceof Error ? e.message : 'Could not load Bones packs.'));
  }, [tab, user?.id, bonesOffers, bonesOffersError]);

  const buyBonesPack = async (offer: BonesPackOffer) => {
    if (!user?.id) return;
    setBuyingProductId(offer.productId);
    try {
      const { credited } = await purchaseBonesPack(user.id, offer);
      if (credited) {
        setHoundScore((prev) => (prev ? { ...prev, bonesBalance: prev.bonesBalance + offer.bonesAmount } : prev));
      } else {
        // The purchase went through — only the immediate balance update
        // failed, so this isn't the "could not buy that" error path
        // below. revenuecat-webhook (0064_bones_purchases.sql) still
        // credits it shortly; reopening the Shop tab will show the
        // correct balance either way.
        Alert.alert('Purchase complete', `Your ${currencyName} may take a minute to show up.`);
      }
    } catch (e) {
      Alert.alert('Could not buy that', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBuyingProductId(null);
    }
  };

  const xpTotal = houndScore?.xpTotal ?? null;
  const bonesBalance = houndScore?.bonesBalance ?? null;

  const renderItem = (item: FrameStyle | BackgroundStyle | IconStyle, slot: CosmeticSlot) => {
    const isShopItem = item.costBones !== null;
    const owned = isShopItem
      ? !!purchasedIds?.has(item.id)
      : xpTotal !== null && item.unlockXp !== null && xpTotal >= item.unlockXp;
    const isEquipped =
      slot === 'frame' ? equipped?.frameId === item.id : slot === 'background' ? equipped?.backgroundId === item.id : equipped?.iconId === item.id;
    const affordable = isShopItem && bonesBalance !== null && item.costBones !== null && bonesBalance >= item.costBones;
    const busy = equippingId === item.id || buyingId === item.id;

    const needsMoreBones = isShopItem && !owned && !affordable && bonesBalance !== null;

    const handlePress = () => {
      if (busy) return;
      if (owned) {
        toggleEquip(slot, item.id, !!isEquipped);
      } else if (isShopItem && affordable) {
        buyItem(item);
      } else if (needsMoreBones && canAddBones) {
        scrollToPacks();
      }
    };

    let noteText: string;
    if (owned) {
      noteText = isEquipped ? 'Equipped — tap to remove' : 'Tap to equip';
    } else if (isShopItem) {
      noteText = affordable ? `Buy for ${item.costBones} ${currencyName}` : `Need ${item.costBones} ${currencyName}`;
    } else {
      // XOR invariant (catalog.ts) guarantees unlockXp is set here — the
      // ?? 0 is just to satisfy the nullable type, not a real fallback.
      noteText = `Unlocks at level ${levelProgressForXp(item.unlockXp ?? 0).level}`;
    }

    return (
      <Pressable
        key={item.id}
        style={styles.itemRow}
        disabled={busy || (!owned && !(isShopItem && affordable) && !(needsMoreBones && canAddBones))}
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
          iconId={slot === 'icon' ? item.id : equipped?.iconId}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemNote}>
            {noteText}
            {needsMoreBones && canAddBones && <Text style={styles.itemNoteAction}>{` · Add ${currencyName}`}</Text>}
          </Text>
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
  const leveledIcons = ICONS.filter((i) => i.unlockXp !== null);
  // Seasonal items get their own card below, not the evergreen lists.
  const shopFrames = FRAMES.filter((f) => f.costBones !== null && !f.collection);
  const shopBackgrounds = BACKGROUNDS.filter((b) => b.costBones !== null && !b.collection);
  const shopIcons = ICONS.filter((i) => i.costBones !== null && !i.collection);

  // The Halloween drop: everything while it's on sale; afterwards only
  // what this viewer already owns (still equippable forever), and the
  // card disappears entirely for anyone who didn't buy anything.
  const halloween = SEASONAL_COLLECTIONS.halloween_2026;
  const halloweenOnSale = isCollectionOnSale(halloween.id);
  const halloweenItems: { item: FrameStyle | BackgroundStyle | IconStyle; slot: CosmeticSlot }[] = [
    ...FRAMES.filter((f) => f.collection === halloween.id).map((item) => ({ item, slot: 'frame' as const })),
    ...BACKGROUNDS.filter((b) => b.collection === halloween.id).map((item) => ({ item, slot: 'background' as const })),
    ...ICONS.filter((i) => i.collection === halloween.id).map((item) => ({ item, slot: 'icon' as const })),
  ].filter(({ item }) => halloweenOnSale || !!purchasedIds?.has(item.id));
  // Calendar days left in the viewer's own time zone, counting today —
  // so the sale's final day reads "last day", not "1 day left".
  const saleLastDay = new Date(new Date(halloween.availableUntil).getTime() - 1);
  saleLastDay.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const halloweenDaysLeft = Math.max(1, Math.round((saleLastDay.getTime() - today.getTime()) / 86_400_000) + 1);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />

        <View style={styles.headerRow}>
          <Avatar
            initials={user?.initials ?? '?'}
            tint={colors.accent800}
            size={56}
            fontSize={18}
            frameId={equipped?.frameId}
            backgroundId={equipped?.backgroundId}
            iconId={equipped?.iconId}
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

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Icons</Text>
              {leveledIcons.map((i) => renderItem(i, 'icon'))}
            </Card>
          </>
        ) : (
          <>
            <Card style={{ gap: 8 }} elevated={false}>
              <View style={styles.balanceRow}>
                <BoneIcon size={22} color={color.accent} weight="fill" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.balanceLabel}>{currencyName}</Text>
                  <Text style={styles.balanceValue}>{bonesBalance !== null ? bonesBalance.toLocaleString() : '—'}</Text>
                </View>
                {canAddBones && (
                  <Button
                    label={`Add ${currencyName}`}
                    variant="primary"
                    small
                    icon={<PlusIcon size={13} color={colors.accent} weight="bold" />}
                    onPress={scrollToPacks}
                  />
                )}
              </View>
              <Text style={styles.footNote}>Earned from finishing challenges and leveling up.</Text>
            </Card>

            {halloweenItems.length > 0 && (
              <Card style={styles.seasonCard} elevated={false}>
                <View style={styles.seasonHeader}>
                  <GhostIcon size={20} color={SEASON_ORANGE} weight="fill" />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={text.h4}>{halloween.name}</Text>
                    <Text style={styles.seasonNote}>
                      {halloweenOnSale
                        ? `Limited time · ${halloweenDaysLeft === 1 ? 'last day' : `${halloweenDaysLeft} days left`} · yours to keep`
                        : 'No longer sold — these are yours to keep.'}
                    </Text>
                  </View>
                </View>
                {/* Same Frames / Backgrounds / Icons grouping as the
                    evergreen shop below — only groups with something to
                    show (after the sale, just what the viewer owns). */}
                {HALLOWEEN_GROUPS.map(({ slot, label }) => {
                  const group = halloweenItems.filter((h) => h.slot === slot);
                  if (group.length === 0) return null;
                  return (
                    <View key={slot} style={styles.seasonGroup}>
                      <Text style={text.h4}>{label}</Text>
                      {group.map(({ item }) => renderItem(item, slot))}
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Measured so the "Add" shortcuts know where to scroll. */}
            <View onLayout={(e) => setPacksY(e.nativeEvent.layout.y)}>
              <Card style={{ gap: 4 }} elevated={false}>
                <Text style={text.h4}>Buy {currencyName}</Text>
                {bonesOffersError ? (
                  <Text style={styles.errorNote}>{bonesOffersError}</Text>
                ) : bonesOffers === null ? (
                  <ActivityIndicator color={colors.accent} />
                ) : bonesOffers.length === 0 ? (
                  <Text style={styles.footNote}>No {currencyName} packs available right now.</Text>
                ) : (
                  bonesOffers.map((offer) => {
                    const busy = buyingProductId === offer.productId;
                    return (
                      <Pressable
                        key={offer.productId}
                        style={styles.itemRow}
                        disabled={buyingProductId !== null}
                        onPress={() => buyBonesPack(offer)}
                      >
                        <BoneIcon size={22} color={color.accent} weight="fill" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{offer.bonesAmount.toLocaleString()} {currencyName}</Text>
                        </View>
                        {busy ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.itemNote}>{offer.priceString}</Text>}
                      </Pressable>
                    );
                  })
                )}
              </Card>
            </View>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Frames</Text>
              {shopFrames.map((f) => renderItem(f, 'frame'))}
            </Card>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Backgrounds</Text>
              {shopBackgrounds.map((b) => renderItem(b, 'background'))}
            </Card>

            <Card style={{ gap: 4 }} elevated={false}>
              <Text style={text.h4}>Icons</Text>
              {shopIcons.map((i) => renderItem(i, 'icon'))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const HALLOWEEN_GROUPS: { slot: CosmeticSlot; label: string }[] = [
  { slot: 'frame', label: 'Frames' },
  { slot: 'background', label: 'Backgrounds' },
  { slot: 'icon', label: 'Icons' },
];

// Pumpkin orange — the one accent this card uses instead of the app's
// own purple, so the drop reads as seasonal at a glance.
const SEASON_ORANGE = '#ff7a1a';

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    seasonCard: {
      gap: 4,
      borderWidth: 1,
      borderColor: withAlpha(SEASON_ORANGE, 0.55),
      backgroundColor: withAlpha(SEASON_ORANGE, 0.08),
    },
    seasonHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 },
    seasonNote: { fontSize: 12, color: SEASON_ORANGE, fontFamily: font.heading },
    seasonGroup: { gap: 4, paddingTop: 10 },
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
    itemNoteAction: { color: colors.accent },
  });
}
