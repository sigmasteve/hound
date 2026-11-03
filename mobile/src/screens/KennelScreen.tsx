import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Text } from '../components/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { ArrowLeftIcon, BoneIcon, CheckCircleIcon, GhostIcon,
  LeafIcon, SnowflakeIcon, HeartIcon, PawPrintIcon, PencilSimpleIcon, PlusIcon, CheckIcon, XIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SegmentedControl } from '../components/SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { HOUND_AVATAR_PREFIX } from '../kennel/houndAvatar';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import { HoundArt } from '../kennel/HoundArt';
import { HoundLadderSheet } from '../kennel/HoundLadderSheet';
import { stepLabel, stepsAfter } from '../challenges/ladder';
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
  type KennelSlot,
} from '../kennel/kennelItems';
import { localDayKey } from '../goals/goals';
import { YardScene, YardThumb, yardFocusPoint } from '../kennel/YardArt';
import { PorchScene, porchFocusPoint } from '../kennel/PorchArt';
import { TRICKS, isTrick, type TrickId } from '../kennel/tricks';
import { useWater } from '../water/WaterContext';
import { getYard, placeYardItem, setYardTrophies, type Yard } from '../kennel/yardApi';
import {
  PORCH_ITEMS,
  PORCH_UNLOCK,
  TROPHIES,
  YARD_ITEMS,
  YARD_SIZES,
  YARD_SPOTS,
  nextSizeLine,
  spotSlot,
  yardItemOnSale,
  yardSaleEnds,
  trophyRoom,
  type TrophyKind,
  type YardItem,
  type YardSpot,
} from '../kennel/yardItems';
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
type KennelTab = 'wardrobe' | 'look' | 'yard' | 'more';
const KENNEL_TABS: { id: KennelTab; label: string }[] = [
  { id: 'wardrobe', label: 'Wardrobe' },
  { id: 'look', label: 'Look' },
  { id: 'yard', label: 'Yard' },
  { id: 'more', label: 'More' },
];
type WardrobeChip = 'holiday' | 'head' | 'neck' | 'face' | 'body' | 'feet';
const WARDROBE_CHIPS: { id: WardrobeChip; label: string }[] = [
  { id: 'holiday', label: 'Holiday' },
  { id: 'head', label: 'Hats' },
  { id: 'neck', label: 'Neck' },
  { id: 'face', label: 'Glasses' },
  { id: 'body', label: 'Outfits' },
  { id: 'feet', label: 'Shoes' },
];
// Something being tried on: an item to wear (or null, for the plain
// hound or tan coat), a yard item in a spot, or a porch item.
interface Trying {
  kind: 'wear' | 'yard' | 'porch' | 'trick';
  item: any | null;
  slot?: KennelSlot;
  spot?: YardSpot;
}

export function KennelScreen({ onBack, onOpenLocker }: { onBack: () => void; onOpenLocker: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const water = useWater();
  const [kennel, setKennelState] = useState<Kennel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [ladderOpen, setLadderOpen] = useState(false);
  // The Yard (0148_yard.sql). Null until it loads, and if it can't (before
  // 0148 has run) the hound stands on its own as before.
  const [yard, setYard] = useState<Yard | null>(null);
  const [yardSpot, setYardSpot] = useState<YardSpot>('house');
  // The fitting room: which tab, which wardrobe chip, and what's being
  // tried on (shown on the hound or in the yard before it's bought).
  const [tab, setTab] = useState<KennelTab>('wardrobe');
  const [wardrobe, setWardrobe] = useState<WardrobeChip>('holiday');
  const [trying, setTrying] = useState<Trying | null>(null);
  const pagerRef = useRef<ScrollView>(null);
  const pickRowRef = useRef<ScrollView>(null);
  // The last zoom, kept so ✗ and ✓ ease back out from where it was.
  const lastZoom = useRef({ by: 1.6, x: 0, y: 0 });
  // A trick being shown in the yard (0158); n replays it.
  const [trickShow, setTrickShow] = useState<{ id: TrickId; n: number } | null>(null);
  // Picking in place: the scene zooms in on what's being changed.
  const zoom = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(zoom, { toValue: trying ? 1 : 0, duration: 320, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  }, [trying, zoom]);
  const [sceneWidth, setSceneWidth] = useState(0);
  // While a finger is throwing the toy, the page holds still.
  const [throwing, setThrowing] = useState(false);
  // The Yard (0) or the Porch (1), swiped between (0157).
  const [zone, setZone] = useState(0);
  const focused = useIsFocused();

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
    getYard()
      .then(setYard)
      .catch(() => setYard(null));
    if (user?.id) {
      getMyEquippedCosmetics(user.id)
        .then((c) => setHoundIsAvatar(!!c.iconId?.startsWith(HOUND_AVATAR_PREFIX)))
        .catch(() => {});
    }
  }, [user?.id]);

  useFocusEffect(reload);

  // Getting more Bones: the Locker's shop has the ad and the packs.
  // "Get more", and anything you can't afford yet, go there; the Kennel
  // used to carry a second copy of both cards.

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
  // Just the one step ahead; the ladder sheet has the rest.
  const nextStep = stepsAfter(level, 1)[0] ?? null;
  const classic = kennel.careMode === 'classic';
  const equippedIn = (item: KennelItem) =>
    item.slot === 'neck'
      ? kennel.neckId
      : item.slot === 'head'
        ? kennel.headId
        : item.slot === 'face'
          ? kennel.faceId
          : item.slot === 'coat'
            ? kennel.coatId
            : item.slot === 'body'
              ? kennel.bodyId
              : item.slot === 'feet'
                ? kennel.feetId
                : kennel.breedId;

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
        { text: `Get ${currencyName}`, onPress: onOpenLocker },
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
  const seasons = [
    ...new Set([
      ...seasonItems.map((i) => i.season!),
      ...YARD_ITEMS.filter((i) => i.season && yardItemOnSale(i, today)).map((i) => i.season!),
    ]),
  ];
  const inShop = (i: KennelItem) => !i.season || (!onSale(i, today) && kennel.owned.includes(i.id));

  // The Yard (0148): what the hound says when you tap it.
  const yardLines =
    kennel.mood === 'happy'
      ? [
          ...(kennel.goalDayToday ? ['Goal day! Again, again!'] : []),
          `${kennel.goalDays7} goal day${kennel.goalDays7 === 1 ? '' : 's'} this week!`,
          'Throw the ball?',
        ]
      : kennel.mood === 'okay'
        ? ['Walk with me?', 'Finish your goals and I’ll do zoomies.']
        : kennel.mood === 'hungry'
          ? [classic ? 'Is it dinner time?' : 'A treat? Please?']
          : ['Zzz… a walk would wake me up.', '*yawn*'];

  // Yours or free: straight in. Otherwise bought first, like the gear.
  const pressYardItem = (spot: YardSpot, item: YardItem) => {
    const owned = item.costBones === 0 || kennel.owned.includes(item.id);
    if (owned) {
      run(`yard-${item.id}`, () => placeYardItem(spot, item.id), "Couldn't change the yard");
    } else if (shortOf(item.costBones)) {
      offerMore(item.costBones);
    } else {
      Alert.alert(`Get the ${item.name}?`, `${item.costBones} ${currencyName} from your balance.`, [
        { text: 'Not now', style: 'cancel' },
        {
          text: `Spend ${item.costBones}`,
          onPress: () =>
            run(
              `yard-${item.id}`,
              async () => {
                await buyKennelItem(item.id);
                await placeYardItem(spot, item.id);
              },
              "Couldn't get that",
            ),
        },
      ]);
    }
  };

  // The Porch (0157): unlocked once, then each item goes in its place.
  const unlockPorch = () => {
    if (shortOf(PORCH_UNLOCK.costBones)) {
      offerMore(PORCH_UNLOCK.costBones);
      return;
    }
    Alert.alert('Unlock the Porch?', `${PORCH_UNLOCK.costBones.toLocaleString()} ${currencyName} from your balance. It's yours for good.`, [
      { text: 'Not now', style: 'cancel' },
      { text: `Spend ${PORCH_UNLOCK.costBones.toLocaleString()}`, onPress: () => run(PORCH_UNLOCK.id, () => buyKennelItem(PORCH_UNLOCK.id).then(() => {}), "Couldn't unlock it") },
    ]);
  };
  const pressPorchItem = (item: (typeof PORCH_ITEMS)[number]) => {
    if (kennel.owned.includes(item.id)) return;
    if (shortOf(item.costBones)) {
      offerMore(item.costBones);
      return;
    }
    Alert.alert(`Get the ${item.name}?`, `${item.costBones.toLocaleString()} ${currencyName} from your balance.`, [
      { text: 'Not now', style: 'cancel' },
      { text: `Spend ${item.costBones.toLocaleString()}`, onPress: () => run(`porch-${item.id}`, () => buyKennelItem(item.id).then(() => {}), "Couldn't get that") },
    ]);
  };

  // Up or down; the row holds as many as the yard has room for.
  const toggleTrophy = (kind: TrophyKind) => {
    if (!yard) return;
    const room = trophyRoom(yard.size);
    if (yard.shown.includes(kind)) {
      run(`trophy-${kind}`, () => setYardTrophies(yard.shown.filter((k) => k !== kind)), "Couldn't change the trophies");
    } else if (yard.shown.length >= room) {
      Alert.alert(
        'The trophy row is full',
        `Your yard has room for ${room}. Take one down first${yard.size < YARD_SIZES.length - 1 ? ', or rank up for a bigger yard' : ''}.`,
      );
    } else {
      run(`trophy-${kind}`, () => setYardTrophies([...yard.shown, kind]), "Couldn't change the trophies");
    }
  };

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
            breedId={item.slot === 'breed' ? item.id : kennel.breedId}
            bodyId={item.slot === 'body' ? item.id : kennel.bodyId}
            feetId={item.slot === 'feet' ? item.id : kennel.feetId}
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

  // ── The fitting room ──────────────────────────────────────────────
  const showZone = (z: number) => {
    setZone(z);
    pagerRef.current?.scrollTo({ x: z * sceneWidth, animated: true });
  };
  const tryOn = (t: Trying) => {
    setTrying(t);
    if (t.kind === 'yard') showZone(0);
    if (t.kind === 'porch') showZone(1);
    if (t.kind === 'trick') {
      showZone(0);
      setTrickShow((cur) => ({ id: t.item.id, n: (cur?.n ?? 0) + 1 }));
    }
  };
  const wearSlot = trying?.kind === 'wear' ? (trying.slot ?? trying.item?.slot ?? null) : null;
  const over = (slot: KennelSlot, current: string | null) => (wearSlot === slot ? (trying?.item?.id ?? null) : current);
  const shownHound = {
    name: kennel.name,
    rank: rank.id,
    mood: kennel.mood,
    neckId: over('neck', kennel.neckId),
    headId: over('head', kennel.headId),
    faceId: over('face', kennel.faceId),
    coatId: over('coat', kennel.coatId),
    breedId: over('breed', kennel.breedId),
    bodyId: over('body', kennel.bodyId),
    feetId: over('feet', kennel.feetId),
    ears: kennel.ears,
    tail: kennel.tail,
    markings: kennel.markings,
  };
  const shownYard =
    yard && trying?.kind === 'yard' && trying.spot ? { ...yard, spots: { ...yard.spots, [trying.spot]: trying.item.id } } : yard;
  const shownPorch = [...(yard?.porch ?? []), ...(trying?.kind === 'porch' && trying.item ? [trying.item.id as string] : [])];

  // Done: back to what's on, and the kennel reloaded.
  const act = (id: string, fn: () => Promise<unknown>, fail: string) =>
    run(
      id,
      async () => {
        await fn();
        setTrying(null);
      },
      fail,
    );
  const currentIn = (slot: KennelSlot): string | null =>
    slot === 'neck'
      ? kennel.neckId
      : slot === 'head'
        ? kennel.headId
        : slot === 'face'
          ? kennel.faceId
          : slot === 'coat'
            ? kennel.coatId
            : slot === 'body'
              ? kennel.bodyId
              : slot === 'feet'
                ? kennel.feetId
                : slot === 'breed'
                  ? kennel.breedId
                  : null;
  let tryName = '';
  let tryNote = '';
  let tryAction: { label: string; run: () => void } | null = null;
  if (trying?.kind === 'wear') {
    const item: KennelItem | null = trying.item;
    const slot = (trying.slot ?? item?.slot) as KennelSlot;
    if (!item) {
      tryName = slot === 'breed' ? 'The hound' : slot === 'coat' ? 'Tan coat' : 'Nothing';
      const wearingNow = !currentIn(slot);
      tryNote = wearingNow ? 'On now' : slot === 'breed' || slot === 'coat' ? 'Free' : 'Take it off';
      if (!wearingNow) tryAction = { label: 'Wear it', run: () => act('wear', () => equipKennelItem(slot, null), "Couldn't change that") };
    } else {
      const owned = kennel.owned.includes(item.id);
      const wearingNow = equippedIn(item) === item.id;
      const ends = saleEndsLabel(item);
      tryName = item.name;
      tryNote = wearingNow ? 'Wearing it now' : owned ? 'Yours' : item.costBones === 0 ? 'Free' : `${item.costBones} ${currencyName}${ends ? ` · ${ends}` : ''}`;
      tryAction = wearingNow
        ? slot === 'coat' || slot === 'breed'
          ? null
          : { label: 'Take it off', run: () => act(item.id, () => equipKennelItem(slot, null), "Couldn't change that") }
        : owned
          ? { label: 'Wear it', run: () => act(item.id, () => equipKennelItem(slot, item.id), "Couldn't change that") }
          : item.costBones === 0
            ? { label: 'Wear it', run: () => act(item.id, async () => { await buyKennelItem(item.id); await equipKennelItem(slot, item.id); }, "Couldn't change that") }
            : {
                label: `Get it · ${item.costBones}`,
                run: () =>
                  shortOf(item.costBones)
                    ? offerMore(item.costBones)
                    : act(item.id, async () => { await buyKennelItem(item.id); await equipKennelItem(slot, item.id); }, "Couldn't get that"),
              };
    }
  } else if (trying?.kind === 'yard' && trying.spot && yard) {
    const item: YardItem = trying.item;
    const spot = trying.spot;
    const placed = yard.spots[spot] === item.id;
    const owned = item.costBones === 0 || kennel.owned.includes(item.id);
    tryName = item.name;
    tryNote = placed ? 'In the yard' : owned ? (item.costBones === 0 ? 'Free' : 'Yours') : `${item.costBones} ${currencyName}`;
    tryAction = placed
      ? null
      : owned
        ? { label: 'Put it out', run: () => act(`yard-${item.id}`, () => placeYardItem(spot, item.id), "Couldn't change the yard") }
        : {
            label: `Get it · ${item.costBones}`,
            run: () =>
              shortOf(item.costBones)
                ? offerMore(item.costBones)
                : act(`yard-${item.id}`, async () => { await buyKennelItem(item.id); await placeYardItem(spot, item.id); }, "Couldn't get that"),
          };
  } else if (trying?.kind === 'trick') {
    const item = trying.item as (typeof TRICKS)[number];
    const owned = kennel.owned.includes(item.id);
    tryName = item.name;
    tryNote = owned ? `Yours · double-tap ${kennel.name} for it` : `${item.costBones} ${currencyName}`;
    tryAction = owned
      ? { label: 'Again', run: () => setTrickShow((cur) => ({ id: item.id, n: (cur?.n ?? 0) + 1 })) }
      : {
          label: `Get it · ${item.costBones}`,
          run: () => (shortOf(item.costBones) ? offerMore(item.costBones) : act(item.id, () => buyKennelItem(item.id), "Couldn't get that")),
        };
  } else if (trying?.kind === 'porch') {
    const item = trying.item as (typeof PORCH_ITEMS)[number];
    const owned = kennel.owned.includes(item.id);
    tryName = item.name;
    tryNote = owned ? 'On your porch' : `${item.costBones.toLocaleString()} ${currencyName} · ${item.note}`;
    tryAction = owned
      ? null
      : {
          label: `Get it · ${item.costBones.toLocaleString()}`,
          run: () => (shortOf(item.costBones) ? offerMore(item.costBones) : act(`porch-${item.id}`, () => buyKennelItem(item.id), "Couldn't get that")),
        };
  }

  // What the ✓ costs: a price when it buys, otherwise nothing to show.
  const tryCost: number | null =
    trying && tryAction?.label.startsWith('Get it') && trying.item && typeof trying.item.costBones === 'number' ? trying.item.costBones : null;
  const tryShort = tryCost !== null && shortOf(tryCost);
  // The other choices for the same spot, along the bottom of the scene.
  const today0 = localDayKey(new Date());
  const pickOptions: { key: string; item: any | null; label: string }[] = (() => {
    if (!trying) return [];
    if (trying.kind === 'wear') {
      const slot = (trying.slot ?? trying.item?.slot) as KennelSlot;
      const items = KENNEL_ITEMS.filter((i) => i.slot === slot && (inShop(i) || (!!i.season && onSale(i, today0))));
      const none = slot === 'breed' ? 'Hound' : slot === 'coat' ? 'Tan' : 'None';
      return [{ key: `none-${slot}`, item: null, label: none }, ...items.map((i) => ({ key: i.id, item: i, label: i.name }))];
    }
    if (trying.kind === 'yard' && trying.spot) {
      const slot = spotSlot(trying.spot);
      return YARD_ITEMS.filter((i) => i.slot === slot && (!i.season || yardItemOnSale(i, today0) || kennel.owned.includes(i.id))).map((i) => ({
        key: i.id,
        item: i,
        label: i.name,
      }));
    }
    if (trying.kind === 'porch') return PORCH_ITEMS.map((i) => ({ key: i.id, item: i, label: i.name }));
    return TRICKS.map((i) => ({ key: i.id, item: i, label: i.name }));
  })();
  const pick = (item: any | null) => {
    if (!trying) return;
    if (trying.kind === 'trick') tryOn({ kind: 'trick', item });
    else tryOn({ ...trying, item });
  };
  // Where to zoom: the spot being changed, or the hound. The tile row
  // covers the bottom of the scene, so the point is centred in what's left
  // above it; something low (the bowl, the ground) zooms in further, up to
  // 2.4x, so it still clears the row.
  const PICK_BAR = 64;
  const focus =
    !trying || !yard || sceneWidth === 0
      ? null
      : trying.kind === 'porch'
        ? porchFocusPoint(trying.item?.id ?? '', sceneWidth)
        : yardFocusPoint(yard, sceneWidth, trying.kind === 'yard' && trying.spot ? trying.spot : 'hound', kennel.mood);
  const clampShift = (v: number, by: number, half: number) => Math.max(-(by - 1) * half, Math.min((by - 1) * half, v));
  if (focus) {
    const by = Math.min(2.4, Math.max(1.6, (PICK_BAR + 26) / Math.max(1, focus.height - focus.y)));
    // The point moves toward the middle, but never past an edge.
    lastZoom.current = {
      by,
      x: clampShift(-by * (focus.x - sceneWidth / 2), by, sceneWidth / 2),
      y: clampShift(-by * (focus.y - focus.height / 2) - PICK_BAR / 2, by, focus.height / 2),
    };
  }
  const { by: zoomBy, x: shiftX, y: shiftY } = lastZoom.current;

  // The wardrobe: a chip per slot (Holiday first while a drop is on), and
  // the items as tiles with the hound wearing each.
  const wardrobeChips = WARDROBE_CHIPS.filter((c) => c.id !== 'holiday' || seasonItems.length > 0);
  const chip: WardrobeChip = wardrobe === 'holiday' && seasonItems.length === 0 ? 'head' : wardrobe;
  const wardrobeItems =
    chip === 'holiday'
      ? seasonItems.filter((i) => i.slot !== 'coat' && i.slot !== 'breed')
      : KENNEL_ITEMS.filter((i) => i.slot === chip && inShop(i));
  const itemTile = (item: KennelItem) => {
    const owned = kennel.owned.includes(item.id);
    const wearingNow = equippedIn(item) === item.id;
    const tryingThis = trying?.kind === 'wear' && trying.item?.id === item.id;
    const look = { ...shownHound, [`${item.slot}Id`]: item.id };
    return (
      <Pressable
        key={item.id}
        style={[styles.tile, wearingNow && styles.tileWearing, tryingThis && styles.tileOn]}
        onPress={() => tryOn({ kind: 'wear', item, slot: item.slot })}
        accessibilityRole="button"
        accessibilityState={{ selected: tryingThis }}
        accessibilityLabel={`${item.name}${wearingNow ? ', wearing' : owned ? ', yours' : `, ${item.costBones} ${currencyName}`}. Try it on`}
      >
        <View style={styles.tileArt}>
          <HoundArt
            rank={rank.id}
            mood="okay"
            neckId={look.neckId}
            headId={look.headId}
            faceId={look.faceId}
            coatId={look.coatId}
            breedId={look.breedId}
            bodyId={look.bodyId}
            feetId={look.feetId}
            ears={kennel.ears}
            tail={kennel.tail}
            markings={kennel.markings}
            size={66}
            animate={false}
          />
        </View>
        <Text style={styles.tileName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.tileNote, wearingNow && { color: colors.accentActive }]} numberOfLines={1}>
          {wearingNow ? 'Wearing' : owned ? 'Yours' : `${item.costBones} ${currencyName}`}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      {/* The fitting room: the hound and its yard stay at the top while
          everything to change sits in tabs below. Tap an item to try it
          on (or put it in the yard) here first; the bar under the scene
          buys it, puts it on, or puts it back. */}
      <View style={styles.top}>
        <View style={styles.topRow}>
          <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeftIcon size={20} color={colors.accentActive} />
          </Pressable>
          {editingName !== null ? (
            <TextInput
              maxFontSizeMultiplier={1.3}
              value={editingName}
              onChangeText={setEditingName}
              onBlur={saveName}
              autoFocus
              maxLength={20}
              returnKeyType="done"
              style={styles.nameInput}
            />
          ) : (
            <Pressable style={styles.nameRowSmall} onPress={() => setEditingName(kennel.name)} hitSlop={8}>
              <Text style={styles.nameSmall}>{kennel.name}</Text>
              <PencilSimpleIcon size={15} color={withAlpha(colors.text, 0.5)} />
            </Pressable>
          )}

          <View style={[styles.rankChip, { backgroundColor: withAlpha(rank.color, 0.18) }]}>
            <Text style={[styles.rankText, { color: rank.color }]}>{rank.name}</Text>
          </View>
          <Pressable onPress={onOpenLocker} style={styles.bonesPill} accessibilityRole="button" accessibilityLabel={`${kennel.bonesBalance} ${currencyName}. Get more`}>
            <BoneIcon size={13} color={colors.amber} weight="fill" />
            <Text style={styles.bonesText}>{kennel.bonesBalance.toLocaleString()}</Text>
            <PlusIcon size={11} color={colors.accentActive} weight="bold" />
          </Pressable>
        </View>
          {yard ? (
            <View style={styles.yardFloor} onLayout={(e) => setSceneWidth(Math.floor(e.nativeEvent.layout.width))}>
              {sceneWidth > 0 && (
                <View style={{ width: sceneWidth, height: sceneWidth * 0.75, overflow: 'hidden', borderRadius: 14 }}>
                <Animated.View
                  style={{
                    transform: [
                      { translateX: zoom.interpolate({ inputRange: [0, 1], outputRange: [0, shiftX] }) },
                      { translateY: zoom.interpolate({ inputRange: [0, 1], outputRange: [0, shiftY] }) },
                      { scale: zoom.interpolate({ inputRange: [0, 1], outputRange: [1, zoomBy] }) },
                    ],
                  }}
                >
                <ScrollView
                  ref={pagerRef}
                  horizontal
                  pagingEnabled
                  scrollEnabled={!throwing}
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => setZone(Math.round(e.nativeEvent.contentOffset.x / sceneWidth))}
                  style={{ width: sceneWidth }}
                >
                  <View style={{ width: sceneWidth }}>
                    <YardScene
                      water={water.goal ? water.todayMl / water.goal.targetMl : null}
                      onGesture={setThrowing}
                      yard={shownYard ?? yard}
                      tricks={kennel.owned.filter(isTrick)}
                      trick={trickShow}
                      width={sceneWidth}
                      animate={focused}
                      lines={yardLines}
                      guest={
                        yard.guest
                          ? {
                              hound: {
                                name: yard.guest.name,
                                rank: rankForLevel(levelProgressForXp(yard.guest.xpTotal).level).id,
                                mood: 'happy',
                                neckId: yard.guest.neckId,
                                headId: yard.guest.headId,
                                faceId: yard.guest.faceId,
                                coatId: yard.guest.coatId,
                                breedId: yard.guest.breedId,
                                bodyId: yard.guest.bodyId,
                                feetId: yard.guest.feetId,
                                ears: yard.guest.ears,
                                tail: yard.guest.tail,
                                markings: yard.guest.markings,
                              },
                              label: `${yard.guest.name} · ${yard.guest.owner}'s`,
                              line: `${yard.guest.owner} finished their goals too!`,
                            }
                          : null
                      }
                      hound={shownHound}
                    />

                  </View>
                  <View style={{ width: sceneWidth }}>
                    <PorchScene
                      items={shownPorch}
                      locked={!yard.porch}
                      width={sceneWidth}
                      animate={focused && zone === 1}
                      hound={shownHound}
                    />
                    {!yard.porch && (
                      <View style={styles.porchLock} pointerEvents="box-none">
                        <View style={styles.porchLockCard}>
                          <Text style={text.h4}>The Porch</Text>
                          <Text style={styles.itemNote}>A hot tub, a swing, a fire pit and more, round the back of the house.</Text>
                          {level >= PORCH_UNLOCK.minLevel ? (
                            <Button
                              label={busyId === PORCH_UNLOCK.id ? 'Unlocking…' : `Unlock · ${PORCH_UNLOCK.costBones.toLocaleString()} ${currencyName}`}
                              variant="primary"
                              small
                              disabled={busyId !== null}
                              onPress={unlockPorch}
                            />
                          ) : (
                            <Text style={styles.itemNote}>Opens at Hunter (level {PORCH_UNLOCK.minLevel}).</Text>
                          )}
                        </View>
                      </View>
                    )}
                  </View>
                </ScrollView>
                </Animated.View>

                {/* Picking in place: the choices along the bottom, ✗ to put
                    it back, ✓ to keep it (with the price when it buys). */}
                {trying && (
                  <View style={styles.pickBar} pointerEvents="box-none">
                    <Pressable
                      onPress={() => setTrying(null)}
                      style={[styles.pickRound, styles.pickCancel]}
                      accessibilityRole="button"
                      accessibilityLabel="Put it back"
                      hitSlop={6}
                    >
                      <XIcon size={24} color="#ffffff" weight="bold" />
                    </Pressable>
                    <ScrollView ref={pickRowRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickRow} style={{ flex: 1 }}>
                      {pickOptions.map((o) => {
                        const on = (trying.item?.id ?? null) === (o.item?.id ?? null);
                        return (
                          <Pressable
                            key={o.key}
                            onPress={() => pick(o.item)}
                            // The row opens scrolled to what's being tried.
                            onLayout={on ? (e) => pickRowRef.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 62), animated: false }) : undefined}
                            style={[styles.pickTile, on && styles.pickTileOn]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={o.label}
                          >
                            {trying.kind === 'wear' ? (
                              o.item || trying.slot === 'breed' || trying.slot === 'coat' ? (
                                <HoundArt
                                  {...{ ...shownHound, [`${trying.slot}Id`]: o.item?.id ?? null }}
                                  rank={rank.id}
                                  mood="okay"
                                  size={42}
                                  animate={false}
                                  variant={trying.slot === 'feet' || trying.slot === 'body' ? 'full' : 'avatar'}
                                />
                              ) : (
                                <Text style={styles.pickNone}>None</Text>
                              )
                            ) : trying.kind === 'yard' ? (
                              <YardThumb id={o.item.id} size={42} />
                            ) : (
                              <Text style={styles.pickWord} numberOfLines={2}>
                                {o.label}
                              </Text>
                            )}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Pressable
                      onPress={() => (tryAction ? tryAction.run() : setTrying(null))}
                      disabled={busyId !== null}
                      style={[styles.pickRound, styles.pickOk, tryShort && { opacity: 0.55 }]}
                      accessibilityRole="button"
                      accessibilityLabel={tryCost !== null ? `Get the ${tryName} for ${tryCost} ${currencyName}` : `Keep ${tryName}`}
                      hitSlop={6}
                    >
                      {busyId ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : tryShort ? (
                        <LockSimpleIcon size={22} color="#ffffff" weight="bold" />
                      ) : (
                        <CheckIcon size={26} color="#ffffff" weight="bold" />
                      )}
                      {tryCost !== null && (
                        <View style={styles.pickPrice}>
                          <BoneIcon size={10} color={colors.amber} weight="fill" />
                          <Text style={styles.pickPriceText}>{tryCost.toLocaleString()}</Text>
                        </View>
                      )}
                    </Pressable>
                  </View>
                )}
                </View>
              )}
              <View style={styles.zoneDots}>
                {[0, 1].map((i) => (
                  <View key={i} style={[styles.zoneDot, zone === i && styles.zoneDotOn]} />
                ))}
              </View>
            </View>
          ) : (
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
                breedId={kennel.breedId}
                bodyId={kennel.bodyId}
                feetId={kennel.feetId}
                size={190}
              />
            </View>
          )}


        {trying ? (
          <View style={styles.statusRow}>
            <Text style={styles.itemName} numberOfLines={1}>
              {tryName}
            </Text>
            <Text style={[styles.itemNote, { flex: 1 }]} numberOfLines={1}>
              {tryShort ? `${tryNote} · you have ${kennel.bonesBalance}` : tryNote}
            </Text>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Text style={[styles.note, { flex: 1 }]} numberOfLines={2}>
              {moodLine(kennel)}
            </Text>
          {classic && kennel.hearts !== null && (
            <View style={styles.hearts}>
              {[0, 1, 2].map((i) => (
                <HeartIcon key={i} size={16} color="#e04f6a" weight={i < (kennel.hearts ?? 0) ? 'fill' : 'regular'} />
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
                small
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
          </View>
        )}

        <View style={styles.tabs} accessibilityRole="tablist">
          {KENNEL_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
                {t.id === 'wardrobe' && seasonItems.length > 0 && <View style={styles.tabDot} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView scrollEnabled={!throwing} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {tab === 'wardrobe' && (
          <>
            <View style={styles.chips}>
              {wardrobeChips.map((c) => (
                <Pressable
                  key={c.id}
                  style={[styles.chip, wardrobe === c.id && styles.chipOn]}
                  onPress={() => setWardrobe(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: wardrobe === c.id }}
                >
                  <Text style={[styles.chipText, wardrobe === c.id && styles.chipTextOn]}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            {wardrobe === 'holiday' && seasons.length > 0 && (
              <Text style={styles.itemNote}>
                {seasons.join(' and ')}: only around for a little while. Anything you get, you keep.
              </Text>
            )}
            <View style={styles.tileGrid}>{wardrobeItems.map(itemTile)}</View>
          </>
        )}

        {tab === 'look' && (
          <>
          <Card style={{ gap: 10 }} elevated={false}>
            <Text style={text.h4}>Look</Text>
            {/* Breeds (0132): the hound, or a different dog for Bones. Coats
                below still apply; ears, tail and markings come with it. */}
            <Text style={styles.label}>Breed</Text>
            <View style={styles.swatches}>
              {[null, ...KENNEL_ITEMS.filter((i) => i.slot === 'breed')].map((item) => {
                const on = kennel.breedId === (item?.id ?? null);
                const tryingThis = trying?.slot === 'breed' && (trying.item?.id ?? null) === (item?.id ?? null);
                const owned = !item || kennel.owned.includes(item.id);
                return (
                  <Pressable
                    key={item?.id ?? 'hound'}
                    style={styles.swatchCell}
                    disabled={on || busyId !== null}
                    onPress={() => tryOn({ kind: 'wear', item, slot: 'breed' })}
                    accessibilityRole="button"
                    accessibilityLabel={`${item?.name ?? 'Hound'}${owned ? '' : `, ${item!.costBones} ${currencyName}`}`}
                  >
                    <View style={[styles.breedSwatch, (on || tryingThis) && styles.swatchOn]}>
                      <HoundArt
                        rank={rank.id}
                        mood="okay"
                        coatId={kennel.coatId}
                        breedId={item?.id ?? null}
                        ears={kennel.ears}
                        tail={kennel.tail}
                        markings={kennel.markings}
                        size={34}
                        animate={false}
                        variant="avatar"
                      />
                    </View>
                    <Text style={styles.swatchName} numberOfLines={2}>
                      {item?.name ?? 'Hound'}
                    </Text>
                    {!owned && <Text style={styles.swatchPrice}>{item!.costBones}</Text>}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>Coat</Text>
            <View style={styles.swatches}>
              {[null, ...KENNEL_ITEMS.filter((i) => i.slot === 'coat' && inShop(i))].map((item) => {
                const on = kennel.coatId === (item?.id ?? null);
                const tryingThis = trying?.slot === 'coat' && (trying.item?.id ?? null) === (item?.id ?? null);
                const owned = !item || item.costBones === 0 || kennel.owned.includes(item.id);
                return (
                  <Pressable
                    key={item?.id ?? 'tan'}
                    style={styles.swatchCell}
                    disabled={on || busyId !== null}
                    onPress={() => tryOn({ kind: 'wear', item, slot: 'coat' })}
                    accessibilityRole="button"
                    accessibilityLabel={`${item?.name ?? 'Tan'} coat${owned ? '' : `, ${item!.costBones} ${currencyName}`}`}
                  >
                    <View style={[styles.swatch, { backgroundColor: item?.color ?? TAN_SWATCH }, (on || tryingThis) && styles.swatchOn]} />
                    <Text style={styles.swatchName} numberOfLines={2}>
                      {item?.name ?? 'Tan'}
                    </Text>
                    {!owned && <Text style={styles.swatchPrice}>{item!.costBones}</Text>}
                  </Pressable>
                );
              })}
            </View>
            {kennel.breedId ? (
              <Text style={styles.itemNote}>Ears, tail and markings come with the breed.</Text>
            ) : (
              (
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
            ))
            )}
          </Card>

          </>
        )}

        {tab === 'yard' && (
          <>
            <SegmentedControl
              options={[
                { value: 'yard', label: 'Yard' },
                { value: 'porch', label: 'Porch' },
              ]}
              value={zone === 1 ? 'porch' : 'yard'}
              onChange={(v) => showZone(v === 'porch' ? 1 : 0)}
            />
            {zone === 0 ? (
              <>
            {/* The Yard (0148): a fixed spot for everything, more spots as the
                hound ranks up, and trophies that can only be won. */}
            {yard && (
              <Card style={{ gap: 10 }} elevated={false}>
                <View style={styles.seasonHeader}>
                  <Text style={text.h4}>Your yard</Text>
                  <Text style={styles.yardSize}>{YARD_SIZES[yard.size]?.name}</Text>
                </View>
                {nextSizeLine(yard.size) && <Text style={styles.itemNote}>{nextSizeLine(yard.size)}</Text>}
                <View style={styles.chips}>
                  {YARD_SPOTS.map(({ spot, label, opensAt }) => {
                    const open = opensAt <= yard.size;
                    const on = yardSpot === spot;
                    return (
                      <Pressable
                        key={spot}
                        style={[styles.chip, on && styles.chipOn, !open && styles.chipLocked]}
                        disabled={!open || on}
                        onPress={() => setYardSpot(spot)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: !open }}
                        accessibilityLabel={open ? label : `${label}, opens at ${YARD_SIZES[opensAt].rank}`}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {open ? label : `${label} · ${YARD_SIZES[opensAt].rank}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.yardItems}>
                  {YARD_ITEMS.filter(
                    (i) =>
                      i.slot === spotSlot(yardSpot) &&
                      // Limited-time ones while they're on sale, then only if yours.
                      (!i.season || yardItemOnSale(i, today) || kennel.owned.includes(i.id)),
                  ).map((item) => {
                    const placed = yard.spots[yardSpot] === item.id;
                    const owned = item.costBones === 0 || kennel.owned.includes(item.id);
                    const ends = item.season && !owned ? yardSaleEnds(item) : null;
                    return (
                      <Pressable
                        key={item.id}
                        style={[styles.yardItem, (placed || trying?.item?.id === item.id) && styles.yardItemOn]}
                        disabled={placed || busyId !== null}
                        onPress={() => tryOn({ kind: 'yard', item, spot: yardSpot })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: placed }}
                        accessibilityLabel={`${item.name}${placed ? ', in the yard' : owned ? '' : `, ${item.costBones} ${currencyName}`}`}
                      >
                        <View style={styles.yardThumb}>
                          <YardThumb id={item.id} size={52} />
                        </View>
                        <Text style={styles.swatchName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {busyId === `yard-${item.id}` ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <Text style={[styles.yardItemNote, placed && { color: colors.accent }]}>
                            {placed ? 'In the yard' : owned ? (item.costBones === 0 ? 'Free' : 'Yours') : `${item.costBones} ${currencyName}`}
                          </Text>
                        )}
                        {ends && <Text style={styles.yardSeason}>{`${item.season} · ${ends}`}</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            )}

              </>
            ) : yard?.porch ? (
              <>
            {/* The Porch's shop (0157), once it's unlocked. */}
            {yard?.porch && (
              <Card style={{ gap: 10 }} elevated={false}>
                <View style={styles.seasonHeader}>
                  <Text style={text.h4}>Your porch</Text>
                </View>
                <View style={styles.yardItems}>
                  {PORCH_ITEMS.map((item) => {
                    const owned = kennel.owned.includes(item.id);
                    return (
                      <Pressable
                        key={item.id}
                        style={[styles.yardItem, (owned || trying?.item?.id === item.id) && styles.yardItemOn]}
                        disabled={owned || busyId !== null}
                        onPress={() => tryOn({ kind: 'porch', item })}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.name}${owned ? ', on your porch' : `, ${item.costBones} ${currencyName}`}`}
                      >
                        <Text style={styles.swatchName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.itemNote} numberOfLines={2}>
                          {item.note}
                        </Text>
                        {busyId === `porch-${item.id}` ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <Text style={[styles.yardItemNote, owned && { color: colors.accent }]}>
                            {owned ? 'On your porch' : `${item.costBones.toLocaleString()} ${currencyName}`}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            )}

              </>
            ) : (
              <Card style={{ gap: 8 }} elevated={false}>
                <Text style={text.h4}>The Porch</Text>
                <Text style={styles.itemNote}>A hot tub, a swing, a fire pit and more, round the back of the house. Unlock it on the Porch above.</Text>
              </Card>
            )}
          </>
        )}

        {tab === 'more' && (
          <>
            {/* Tricks (0158): tap one to see it; double-tap the hound in the
                yard for the ones you have. */}
            <Card style={{ gap: 10 }} elevated={false}>
              <View style={styles.seasonHeader}>
                <Text style={text.h4}>Tricks</Text>
                <Text style={styles.yardSize}>Double-tap {kennel.name}</Text>
              </View>
              <View style={styles.tileGrid}>
                {TRICKS.map((t) => {
                  const owned = kennel.owned.includes(t.id);
                  const on = trying?.kind === 'trick' && trying.item?.id === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      style={[styles.trickTile, owned && styles.tileWearing, on && styles.tileOn]}
                      onPress={() => tryOn({ kind: 'trick', item: t })}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.name}${owned ? ', yours' : `, ${t.costBones} ${currencyName}`}. Watch it`}
                    >
                      <Text style={styles.tileName}>{t.name}</Text>
                      <Text style={[styles.tileNote, owned && { color: colors.accentActive }]}>
                        {owned ? 'Yours' : `${t.costBones} ${currencyName}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
            {nextStep && (
              <Card style={{ gap: 6, alignItems: 'center' }} elevated={false}>
              {nextStep && (
                <View style={styles.whatsNext}>
                  <Text style={styles.note}>
                    Next: level {nextStep.level}, {stepLabel(nextStep)} · {(nextStep.xp - kennel.xpTotal).toLocaleString('en-US')} XP to go
                  </Text>
                  <Button label="See the whole ladder" variant="ghost" small onPress={() => setLadderOpen(true)} />
                </View>
              )}

              </Card>
            )}
        {/* Visits (0150): who stopped by in the last day, and a friend's
            hound over to play. */}
        {yard && (yard.visitors.length > 0 || yard.guest) && (
          <Card style={{ gap: 8 }} elevated={false}>
            <View style={styles.seasonHeader}>
              <Text style={text.h4}>Visitors</Text>
              <Text style={styles.yardSize}>Last 24 hours</Text>
            </View>
            {yard.guest && (
              <Text style={styles.itemNote}>
                {yard.guest.name}, {yard.guest.owner}'s hound, came over to play: you both finished your goals today, and you're in{' '}
                {yard.guest.challenge} together.
              </Text>
            )}
            {yard.visitors.map((v) => (
              <View key={v.userId} style={styles.visitorRow}>
                <PawPrintIcon size={16} color={colors.accent} weight="fill" />
                <Text style={styles.itemName}>
                  {v.name}{' '}
                  <Text style={styles.itemNote}>
                    {v.pawprint && v.treat
                      ? `left a pawprint and tossed ${kennel.name} a treat`
                      : v.treat
                        ? `tossed ${kennel.name} a treat`
                        : 'left a pawprint'}
                  </Text>
                </Text>
              </View>
            ))}
          </Card>
        )}

        {yard && (
          <Card style={{ gap: 8 }} elevated={false}>
            <View style={styles.seasonHeader}>
              <Text style={text.h4}>Trophies</Text>
              <Text style={styles.yardSize}>
                {yard.shown.length} of {trophyRoom(yard.size)} up
              </Text>
            </View>
            {yard.trophies.filter((t) => TROPHIES[t.kind]).length === 0 ? (
              <Text style={styles.itemNote}>
                Trophies can’t be bought. Win a challenge (a Step Race, a Soccer match, a Journey to the finish) and its trophy goes up in
                your yard.
              </Text>
            ) : (
              <>
                <Text style={styles.itemNote}>Won, never bought. Tap one to put it up or take it down.</Text>
                <View style={styles.yardItems}>
                  {yard.trophies
                    .filter((t) => TROPHIES[t.kind])
                    .map((t) => {
                      const up = yard.shown.includes(t.kind);
                      return (
                        <Pressable
                          key={t.kind}
                          style={[styles.yardItem, up && styles.yardItemOn]}
                          disabled={busyId !== null}
                          onPress={() => toggleTrophy(t.kind)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: up }}
                        >
                          <View style={styles.yardThumb}>
                            <YardThumb trophy={t.kind} size={44} />
                          </View>
                          <Text style={styles.swatchName} numberOfLines={2}>
                            {TROPHIES[t.kind].name}
                          </Text>
                          <Text style={[styles.yardItemNote, up && { color: colors.accent }]}>
                            {t.wins === 1 ? 'Won once' : `Won ${t.wins} times`}
                            {up ? ' · up' : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              </>
            )}
          </Card>
        )}

        {/* Your hound in your avatar's place on leaderboards, friends,
            chats and Today. Your frame and background stay. */}
        <Card style={styles.avatarCard} elevated={false}>
          <Avatar
            initials={user?.initials ?? '?'}
            tint={colors.accent800}
            size={44}
            fontSize={15}
            iconId={`${HOUND_AVATAR_PREFIX}${kennel.coatId ?? ''}.${kennel.ears}.${kennel.tail}.${kennel.markings}.${kennel.neckId ?? ''}.${kennel.headId ?? ''}.${kennel.faceId ?? ''}${kennel.breedId ? `.${kennel.breedId}` : ''}`}
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

          </>
        )}
      </ScrollView>
      {ladderOpen && <HoundLadderSheet kennel={kennel} onClose={() => setLadderOpen(false)} />}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    top: { paddingHorizontal: 16, paddingTop: 6, gap: 8 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nameRowSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    nameSmall: { fontFamily: font.headingSemibold, fontSize: 22, color: colors.text },
    bonesPill: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.amber, 0.14),
    },
    bonesText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
    pickBar: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    pickRow: { gap: 8, paddingHorizontal: 2, alignItems: 'center' },
    pickRound: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: '#ffffff',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    pickCancel: { backgroundColor: '#e0545a' },
    pickOk: { backgroundColor: '#3fae5f' },
    pickPrice: {
      position: 'absolute',
      bottom: -10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.6),
    },
    pickPriceText: { fontFamily: font.headingSemibold, fontSize: 11, color: colors.text },
    pickTile: {
      width: 54,
      height: 54,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.88)',
      borderWidth: 2.5,
      borderColor: 'rgba(255,255,255,0.95)',
    },
    pickTileOn: { borderColor: colors.amber, transform: [{ scale: 1.08 }] },
    pickNone: { fontFamily: font.headingSemibold, fontSize: 12, color: '#5d5294' },
    pickWord: { fontFamily: font.headingSemibold, fontSize: 10.5, color: '#2b2741', textAlign: 'center', paddingHorizontal: 3 },
    tryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 36,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.accent, 0.12),
    },
    tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 9,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      marginBottom: -StyleSheet.hairlineWidth,
    },
    tabOn: { borderBottomColor: colors.accent },
    tabLabel: { fontFamily: font.heading, fontSize: 14.5, color: withAlpha(colors.text, 0.6) },
    tabLabelOn: { fontFamily: font.headingSemibold, color: colors.text },
    tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.amber },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    trickTile: {
      width: '48.5%',
      gap: 2,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: withAlpha(colors.text, 0.08),
      backgroundColor: colors.surface,
    },
    tile: {
      width: '31.5%',
      alignItems: 'center',
      gap: 2,
      paddingTop: 6,
      paddingBottom: 8,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    tileWearing: { borderColor: withAlpha(colors.accent, 0.35) },
    tileOn: { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.1) },
    tileArt: { height: 80, alignItems: 'center', justifyContent: 'center' },
    tileName: { fontFamily: font.heading, fontSize: 12.5, color: colors.text, paddingHorizontal: 4 },
    tileNote: { fontSize: 11.5, color: withAlpha(colors.text, 0.6) },
    hero: { alignItems: 'center', gap: 8 },
    kennelFloor: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingTop: 8,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.amber, 0.08),
    },
    yardFloor: { alignSelf: 'stretch', gap: 6 },
    zoneDots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
    zoneDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: withAlpha(colors.text, 0.2) },
    zoneDotOn: { backgroundColor: colors.accent },
    porchLock: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 },
    porchLockCard: { gap: 8, alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: colors.surface, maxWidth: 280 },
    visitorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    yardHint: { fontSize: 11.5, color: withAlpha(colors.text, 0.5), textAlign: 'center' },
    yardSize: { marginLeft: 'auto', fontSize: 12.5, fontFamily: font.heading, color: colors.accent },
    yardItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    yardItem: {
      width: '31%',
      alignItems: 'center',
      gap: 4,
      padding: 8,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: withAlpha(colors.text, 0.05),
    },
    yardItemOn: { borderColor: colors.amber },
    yardThumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: '#6dbb73', alignItems: 'center', justifyContent: 'center' },
    yardItemNote: { fontSize: 11, color: withAlpha(colors.text, 0.6) },
    yardSeason: { fontSize: 10.5, color: colors.amber, fontFamily: font.heading, textAlign: 'center' },
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
    whatsNext: { alignItems: 'center', gap: 2, marginTop: 4 },
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
    breedSwatch: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 2,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: withAlpha(colors.text, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
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
    chipLocked: { opacity: 0.45, borderStyle: 'dashed' },
    chipText: { fontFamily: font.heading, fontSize: 13.5, color: colors.text },
    chipTextOn: { color: '#ffffff' },
  });
}
