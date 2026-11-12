import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraIcon, CheckCircleIcon, ImageIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { HoundArt } from '../kennel/HoundArt';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { buyKennelItem, equipKennelItem, getKennel, setKennelLook, type Kennel } from '../kennel/kennelApi';
import { KENNEL_ITEMS } from '../kennel/kennelItems';
import { useDogPhotos } from './DogPhotoContext';
import {
  canAddPhoto,
  checkPhoto,
  chooseDogPhoto,
  getMyDogPhoto,
  lookWasApplied,
  pickPhoto,
  signedPhotoUrls,
  stopDogPhoto,
  type CheckResult,
  type DogLook,
  type MyDogPhoto,
} from './dogPhotos';

// Settings → Your dog as your avatar (0191). Pick or take a photo; Hound
// checks it's a dog; friends see it, everyone else sees your hound. The
// same photo can give your hound its look.

export function DogPhotoSettings() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refresh } = useDogPhotos();
  const [mine, setMine] = useState<MyDogPhoto | null>(null);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ uri: string; result: CheckResult | null } | null>(null);
  const [look, setLook] = useState<{ look: DogLook; uri: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getMyDogPhoto()
      .then(async (m) => {
        setMine(m);
        setMineUrl(m.path && m.status !== 'pending' ? ((await signedPhotoUrls([m.path])).get(m.path) ?? null) : null);
      })
      .catch(() => setMine(null));
  }, []);
  useEffect(() => load(), [load]);

  const canAdd = canAddPhoto();
  const active = mine?.status === 'active' || mine?.status === 'hidden';
  // Older builds can't add a photo; they only see this if one's in use.
  if (!mine || (!canAdd && !active)) return null;

  const start = async (from: 'library' | 'camera') => {
    try {
      const photo = await pickPhoto(from);
      if (!photo) return;
      setFlow({ uri: photo.uri, result: null });
      const result = await checkPhoto(photo.base64);
      setFlow({ uri: photo.uri, result });
      load();
    } catch (e) {
      setFlow(null);
      Alert.alert('Your dog’s photo', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };

  const stop = () =>
    Alert.alert('Back to your hound?', 'Your photo comes down, and friends see your hound again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Back to my hound',
        onPress: async () => {
          setBusy(true);
          try {
            await stopDogPhoto();
            refresh();
            load();
          } catch (e) {
            Alert.alert('Your dog’s photo', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const blocked = !!mine.blockedUntil;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Your dog as your avatar</Text>
      {active ? (
        <View style={styles.row}>
          {mineUrl ? <Image source={{ uri: mineUrl }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]} />}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.strong}>{mine.status === 'hidden' ? 'Being looked at' : 'Your friends see this photo'}</Text>
            <Text style={styles.note}>
              {mine.status === 'hidden'
                ? 'It was reported, so it’s hidden until Hound’s team has a look. Your hound shows meanwhile.'
                : 'Everyone else sees your hound.'}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.note}>A photo of your dog or puppy, in a circle. Your friends see it; everyone else sees your hound.</Text>
      )}
      {blocked ? (
        <Text style={styles.warn}>Photo uploads are off for your account.</Text>
      ) : canAdd ? (
        <>
          <Button
            label={active ? 'Change photo' : 'Choose a photo'}
            variant="primary"
            block
            icon={<ImageIcon size={18} color="#fff" />}
            onPress={busy ? undefined : () => start('library')}
          />
          <Button label="Take one" variant="secondary" block icon={<CameraIcon size={18} color={colors.text} />} onPress={busy ? undefined : () => start('camera')} />
        </>
      ) : null}
      {active && mine.look && (
        <Button label="Make my hound look like my dog" variant="ghost" block onPress={() => setLook({ look: mine.look!, uri: mineUrl })} />
      )}
      {active && <Button label="Back to my hound" variant="ghost" block onPress={busy ? undefined : stop} />}
      {!active && !blocked && (
        <Text style={styles.small}>Hound checks it’s a dog before anyone sees it. Photos of people, or anything rude, aren’t allowed and can be reported.</Text>
      )}

      {flow && (
        <CheckFlow
          uri={flow.uri}
          result={flow.result}
          onClose={() => setFlow(null)}
          onRetry={() => {
            setFlow(null);
            start('library');
          }}
          onUsed={() => {
            refresh();
            load();
          }}
          onLook={(l) => {
            setFlow(null);
            setLook({ look: l, uri: flow.uri });
          }}
        />
      )}
      {look && <LookSheet look={look.look} uri={look.uri} onClose={() => setLook(null)} />}
    </Card>
  );
}

export function CheckFlow({
  uri,
  result,
  onClose,
  onRetry,
  onUsed,
  onLook,
}: {
  uri: string;
  result: CheckResult | null;
  onClose: () => void;
  onRetry: () => void;
  onUsed: () => void;
  onLook: (look: DogLook) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [using, setUsing] = useState(false);
  const [used, setUsed] = useState(false);

  const use = async () => {
    if (!result?.ok) return;
    setUsing(true);
    try {
      await chooseDogPhoto(result.photoId);
      setUsed(true);
      onUsed();
    } catch (e) {
      Alert.alert('Your dog’s photo', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setUsing(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetTop}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          {result && !result.ok ? (
            <View style={[styles.bigPhoto, styles.photoEmpty, { borderStyle: 'dashed' }]} />
          ) : (
            <Image source={{ uri }} style={[styles.bigPhoto, result?.ok ? styles.bigPhotoOk : null]} />
          )}
          {!result ? (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={[text.h4, styles.center]}>Checking it’s a dog…</Text>
              <Text style={[styles.note, styles.center]}>Takes a few seconds.</Text>
            </>
          ) : result.ok ? (
            <>
              <View style={styles.okRow}>
                <CheckCircleIcon size={18} color={colors.green} weight="fill" />
                <Text style={[styles.strong, { color: colors.green }]}>Checked: it’s a dog</Text>
              </View>
              <Text style={[text.h2, styles.center]}>{used ? 'It’s your avatar now' : 'What a good dog!'}</Text>
              <Text style={[styles.note, styles.center]}>
                {result.breed && !/^mixed/i.test(result.breed) ? `Looks like a ${result.breed.toLowerCase()}. ` : ''}
                Your friends will see this photo; everyone else sees your hound.
              </Text>
              {!used && <Button label={using ? 'Saving…' : 'Use as my avatar'} variant="primary" block onPress={using ? undefined : use} />}
              <Pressable onPress={() => onLook(result.look)} style={styles.lookCard} accessibilityRole="button">
                <HoundArt rank="hunter" mood="happy" size={56} animate={false} coatId={result.look.coat} ears={result.look.ears} tail={result.look.tail} markings={result.look.markings} breedId={result.look.breed} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.strong}>Make your hound look like your dog?</Text>
                  <Text style={styles.note}>The coat, ears, tail and markings Hound picked</Text>
                </View>
                <Text style={styles.link}>See it</Text>
              </Pressable>
              {used && <Button label="Done" variant="ghost" block onPress={onClose} />}
            </>
          ) : (
            <>
              <Text style={[text.h2, styles.center]}>{result.limit ? 'That’s enough for today' : 'That doesn’t look like a dog'}</Text>
              <Text style={[styles.note, styles.center]}>{result.reason}</Text>
              {!result.limit && (
                <Text style={[styles.small, styles.center]}>
                  Avatars are for dogs and puppies. A photo of you with your dog is fine, as long as the dog’s in it. Nothing was saved.
                </Text>
              )}
              {!result.limit && <Button label="Try another photo" variant="primary" block onPress={onRetry} />}
              <Button label="Keep my hound" variant="ghost" block onPress={onClose} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function LookSheet({ look, uri, onClose }: { look: DogLook; uri: string | null; onClose: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const [kennel, setKennel] = useState<Kennel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadKennel = useCallback(() => {
    getKennel()
      .then(setKennel)
      .catch(() => {});
  }, []);
  useEffect(() => loadKennel(), [loadKennel]);

  const item = (id: string | null) => (id ? KENNEL_ITEMS.find((i) => i.id === id) ?? null : null);
  const coat = item(look.coat);
  const breed = item(look.breed);
  const has = (id: string) => !!kennel && (kennel.owned.includes(id) || item(id)?.costBones === 0);
  const priceNote = (it: ReturnType<typeof item>, none: string) =>
    !it ? none : has(it.id) ? (kennel?.owned.includes(it.id) ? `${it.name} · yours` : `${it.name} · free`) : `${it.name} · ${it.costBones} ${currencyName}`;

  const equipOwned = async (slot: 'coat' | 'breed', it: ReturnType<typeof item>) => {
    if (!it) {
      await equipKennelItem(slot, null);
      return;
    }
    if (!kennel?.owned.includes(it.id)) {
      if (it.costBones > 0) return;
      await buyKennelItem(it.id);
    }
    await equipKennelItem(slot, it.id);
  };

  const apply = async () => {
    setBusy('apply');
    try {
      await setKennelLook({ ears: look.ears, tail: look.tail, markings: look.markings });
      await equipOwned('coat', coat);
      await equipOwned('breed', breed);
      await lookWasApplied();
      const left = [coat, breed].filter((it) => it && !has(it.id)).map((it) => it!.name);
      Alert.alert(
        'Your hound has the look',
        left.length ? `Get the ${left.join(' and ')} in the Kennel to finish it.` : 'Have a look in the Kennel.',
      );
      onClose();
    } catch (e) {
      Alert.alert('Your hound’s look', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(null);
    }
  };

  const buy = (slot: 'coat' | 'breed', it: NonNullable<ReturnType<typeof item>>) =>
    Alert.alert(`Get the ${it.name}?`, `${it.costBones} ${currencyName} from your balance.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: `Spend ${it.costBones}`,
        onPress: async () => {
          setBusy(it.id);
          try {
            await buyKennelItem(it.id);
            await equipKennelItem(slot, it.id);
            loadKennel();
          } catch (e) {
            Alert.alert('Couldn’t get that', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const rows: { label: string; value: string; buyFor?: { slot: 'coat' | 'breed'; it: NonNullable<ReturnType<typeof item>> } }[] = [
    { label: 'Coat', value: priceNote(coat, 'Classic tan · free'), buyFor: coat && kennel && !has(coat.id) ? { slot: 'coat', it: coat } : undefined },
    { label: 'Ears', value: `${cap(look.ears)} · free` },
    { label: 'Tail', value: `${cap(look.tail)} · free` },
    { label: 'Markings', value: `${look.markings === 'eye_patch' ? 'Eye patch' : cap(look.markings)} · free` },
    { label: 'Closest breed', value: priceNote(breed, 'Classic hound · free'), buyFor: breed && kennel && !has(breed.id) ? { slot: 'breed', it: breed } : undefined },
  ];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetTop}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={[text.h2, styles.center]}>Your hound, like your dog</Text>
          <View style={styles.compare}>
            {uri ? <Image source={{ uri }} style={styles.photo} /> : null}
            <HoundArt rank="hunter" mood="happy" size={130} coatId={look.coat} ears={look.ears} tail={look.tail} markings={look.markings} breedId={look.breed} />
          </View>
          <View style={styles.table}>
            {rows.map((r) => (
              <View key={r.label} style={styles.tableRow}>
                <Text style={styles.cell}>{r.label}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.cell, styles.strong]}>{r.value}</Text>
                  {r.buyFor && (
                    <Pressable onPress={() => buy(r.buyFor!.slot, r.buyFor!.it)} disabled={busy !== null} accessibilityRole="button">
                      <Text style={styles.link}>{busy === r.buyFor.it.id ? '…' : 'Get'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.small}>Ears, tail and markings change for free. A coat or breed you don’t have yet shows its Kennel price: get it here, or keep yours.</Text>
          <Button label={busy === 'apply' ? 'Saving…' : 'Use this look'} variant="primary" block onPress={busy ? undefined : apply} />
          <Text style={[styles.small, styles.center]}>Nobody else sees your photo here. Change anything later in the Kennel.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    photo: { width: 72, height: 72, borderRadius: 36 },
    photoEmpty: { backgroundColor: withAlpha(colors.text, 0.08), borderWidth: 1, borderColor: withAlpha(colors.text, 0.2) },
    strong: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    note: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.7) },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.55) },
    warn: { fontSize: 14, color: colors.amber },
    link: { fontFamily: font.heading, fontSize: 14.5, color: colors.accentActive },
    center: { textAlign: 'center' },
    sheet: { flex: 1, backgroundColor: colors.bg },
    sheetTop: { flexDirection: 'row', justifyContent: 'flex-end', padding: 16 },
    sheetBody: { padding: 20, gap: 14, alignItems: 'stretch' },
    bigPhoto: { width: 180, height: 180, borderRadius: 90, alignSelf: 'center' },
    bigPhotoOk: { borderWidth: 4, borderColor: colors.amber },
    okRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' },
    lookCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.text, 0.06),
    },
    compare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
    table: { borderRadius: 16, backgroundColor: withAlpha(colors.text, 0.06), paddingHorizontal: 16 },
    tableRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.1),
    },
    cell: { fontSize: 14.5, color: colors.text },
  });
}
