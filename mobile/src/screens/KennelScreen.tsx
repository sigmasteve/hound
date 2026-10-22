import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, GhostIcon, HeartIcon, PencilSimpleIcon, PlusIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { BonesPacksCard } from '../bones/BonesPacksCard';
import { notifyBonesChanged } from '../bones/bonesChanged';
import { WatchAdCard } from '../ads/WatchAdCard';
import { useRewardedBones } from '../ads/rewardedBones';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { HOUND_AVATAR_PREFIX } from '../kennel/houndAvatar';
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
  onSale,
  saleEndsLabel,
  type KennelItem,
} from '../kennel/kennelItems';
import { localDayKey } from '../goals/goals';
import {
  buyKennelItem,
  equipKennelItem,
  getKennel,
  giveTreat,
  moodLine,
  setKennel,
  setHoundAvatar,
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

  // Whether your avatar is this hound (0106_hound_avatar.sql).
  const { user } = useAuth();
  const [houndIsAvatar, setHoundIsAvatar] = useState(false);

  const reload = useCallback(() => {
    getKennel()
      .then((k) => {
        setKennelState(k);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load the Kennel.'));
    if (user?.id) {
      getMyEquippedCosmetics(user.id)
        .then((c) => setHoundIsAvatar(!!c.iconId?.startsWith(HOUND_AVATAR_PREFIX)))
        .catch(() => {});
    }
  }, [user?.id]);

  useFocusEffect(reload);

  // Getting more Bones without leaving the Kennel: an ad, or a pack
  // (BonesPacksCard), at the bottom. "Get more", and anything you can't
  // afford yet, scroll down to them.
  const scrollRef = useRef<ScrollView>(null);
  const [packsY, setPacksY] = useState<number | null>(null);
  const scrollToPacks = () => {
    if (packsY !== null) scrollRef.current?.scrollTo({ y: Math.max(0, packsY - 12), animated: true });
  };
  const rewardedBones = useRewardedBones(isSupabaseConfigured ? user?.id : null, () => {
    reload();
    notifyBonesChanged();
  });

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

  // On blur only: Done blurs the field too, so a second handler on submit
  // saved the name twice.
  const saveName = () => {
    Keyboard.dismiss();
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

  // Short of Bones: say how short, and offer the way to get more,
  // instead of a confirm that can only fail.
  const shortOf = (cost: number) => cost > kennel.bonesBalance;
  const offerMore = (cost: number) =>
    Alert.alert(
      `Not enough ${currencyName}`,
      `That's ${cost}, and you have ${kennel.bonesBalance}. Watch an ad or get a pack to top up.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: `Get ${currencyName}`, onPress: scrollToPacks },
      ],
    );

  const pressItem = (item: KennelItem) => {
    const owned = kennel.owned.includes(item.id);
    if (!owned && shortOf(item.costBones)) {
      offerMore(item.costBones);
    } else if (owned) {
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

  // Limited-time items (0112_halloween_kennel.sql): their own section
  // while on sale; afterwards, only the ones you bought, in their usual
  // place.
  const today = localDayKey(new Date());
  const seasonItems = KENNEL_ITEMS.filter((i) => i.season && onSale(i, today));
  const season = seasonItems[0]?.season ?? null;
  const inShop = (i: KennelItem) => !i.season || (!onSale(i, today) && kennel.owned.includes(i.id));

  const itemRow = (item: KennelItem) => {
    const isCoat = item.slot === 'coat';
    const owned = kennel.owned.includes(item.id);
    const wearing = isCoat ? kennel.coatId === item.id : equippedIn(item) === item.id;
    const ends = saleEndsLabel(item);
    return (
      <Pressable
        key={item.id}
        style={styles.itemRow}
        disabled={busyId !== null || (isCoat && wearing)}
        onPress={() => (isCoat ? pressCoat(item) : pressItem(item))}
      >
        <View style={styles.itemPreview}>
          <HoundArt
            rank={rank.id}
            mood="okay"
            neckId={item.slot === 'neck' ? item.id : null}
            headId={item.slot === 'head' ? item.id : null}
            faceId={item.slot === 'face' ? item.id : null}
            coatId={isCoat ? item.id : kennel.coatId}
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
            {wearing
              ? isCoat
                ? 'Wearing'
                : 'Wearing · tap to take off'
              : owned
                ? 'Tap to put on'
                : `${item.costBones} ${currencyName}${item.season && ends ? ` · ${ends}` : ''}`}
          </Text>
        </View>
        {busyId === item.id ? (
          <ActivityIndicator color={colors.accent} />
        ) : wearing ? (
          <CheckCircleIcon size={18} color={colors.accent} weight="fill" />
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
                onPress={() =>
                  shortOf(TREAT_BONES)
                    ? offerMore(TREAT_BONES)
                    : run('treat', giveTreat, classic ? "Couldn't feed them" : "Couldn't give a treat")
                }
              />
            )}
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.note}>
              {kennel.bonesBalance.toLocaleString()} {currencyName} to spend
            </Text>
            <Button
              label="Get more"
              variant="ghost"
              small
              icon={<PlusIcon size={12} color={colors.accent} weight="bold" />}
              onPress={scrollToPacks}
            />
          </View>
        </Card>

        {/* Your hound in your avatar's place on leaderboards, friends,
            chats and Today. Your frame and background stay. */}
        <Card style={styles.avatarCard} elevated={false}>
          <Avatar
            initials={user?.initials ?? '?'}
            tint={colors.accent800}
            size={44}
            fontSize={15}
            iconId={`${HOUND_AVATAR_PREFIX}${kennel.coatId ?? ''}.${kennel.ears}.${kennel.tail}.${kennel.markings}.${kennel.neckId ?? ''}.${kennel.headId ?? ''}.${kennel.faceId ?? ''}`}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.itemName}>Use {kennel.name} as my avatar</Text>
            <Text style={styles.itemNote}>On leaderboards, friends and everywhere else your avatar shows.</Text>
          </View>
          <Switch
            value={houndIsAvatar}
            disabled={busyId !== null}
            onValueChange={(on) => {
              setHoundIsAvatar(on);
              run(
                'avatar',
                async () => {
                  try {
                    await setHoundAvatar(on);
                  } catch (e) {
                    setHoundIsAvatar(!on);
                    throw e;
                  }
                },
                "Couldn't change your avatar",
              );
            }}
            trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.2) }}
            accessibilityLabel={`Use ${kennel.name} as my avatar`}
          />
        </Card>

        <Card style={{ gap: 10 }} elevated={false}>
          <Text style={text.h4}>Look</Text>
          <Text style={styles.label}>Coat</Text>
          <View style={styles.swatches}>
            {[null, ...KENNEL_ITEMS.filter((i) => i.slot === 'coat' && inShop(i))].map((item) => {
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

        {season && seasonItems.length > 0 && (
          <Card style={[{ gap: 4 }, styles.seasonCard]} elevated={false}>
            <View style={styles.seasonHeader}>
              <GhostIcon size={18} color={colors.amber} weight="fill" />
              <Text style={text.h4}>{season}</Text>
              <Text style={styles.seasonEnds}>{saleEndsLabel(seasonItems[0])}</Text>
            </View>
            <Text style={styles.itemNote}>Only around for a little while. Anything you get, you keep.</Text>
            {seasonItems.map(itemRow)}
          </Card>
        )}

        {KENNEL_SLOTS.map(({ slot, label }) => (
          <Card key={slot} style={{ gap: 4 }} elevated={false}>
            <Text style={text.h4}>{label}</Text>
            {KENNEL_ITEMS.filter((i) => i.slot === slot && inShop(i)).map(itemRow)}
          </Card>
        ))}

        {/* Measured so "Get more" knows where to scroll. */}
        <View style={{ gap: 16 }} onLayout={(e) => setPacksY(e.nativeEvent.layout.y)}>
          <WatchAdCard ads={rewardedBones} currencyName={currencyName} />
          {user?.id && isSupabaseConfigured && (
            <BonesPacksCard userId={user.id} currencyName={currencyName} onCredited={() => reload()} />
          )}
        </View>

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
    balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    hearts: { flexDirection: 'row', gap: 6 },
    seasonCard: { borderWidth: 1.5, borderColor: withAlpha(colors.amber, 0.6), backgroundColor: withAlpha(colors.amber, 0.08) },
    seasonHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    seasonEnds: { marginLeft: 'auto', fontSize: 12.5, fontFamily: font.heading, color: colors.amber },
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
    avatarCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
