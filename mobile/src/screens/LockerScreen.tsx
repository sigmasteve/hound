import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeftIcon, CheckCircleIcon, LockSimpleIcon } from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { BACKGROUNDS, FRAMES, type BackgroundStyle, type CosmeticSlot, type FrameStyle } from '../cosmetics/catalog';
import { equipCosmetic, getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { getMyHoundScore } from '../challenges/scoreApi';
import { levelProgressForXp } from '../challenges/leveling';

export function LockerScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // null covers both "hasn't loaded yet" and "failed to load" — same
  // never-show-a-guessed-number reasoning as SettingsScreen's own
  // houndScore fetch. Everything below (unlock checks, the header) just
  // waits rather than assuming 0 XP, which would flash every item as
  // freshly locked for a real player.
  const [xpTotal, setXpTotal] = useState<number | null>(null);
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!user?.id) return;
    Promise.all([getMyHoundScore(user.id), getMyEquippedCosmetics(user.id)])
      .then(([score, cosmetics]) => {
        setXpTotal(score.xpTotal);
        setEquipped(cosmetics);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load your locker.'));
  }, [user?.id]);

  useFocusEffect(reload);

  // Tapping an already-equipped item un-equips it (p_item_id: null,
  // always allowed); tapping any other unlocked item equips it.
  // equip_cosmetic re-checks the unlock itself server-side, so a stale
  // local xpTotal can't let someone equip something they don't actually
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

  const renderItem = (item: FrameStyle | BackgroundStyle, slot: CosmeticSlot) => {
    const unlocked = xpTotal !== null && xpTotal >= item.unlockXp;
    const isEquipped = slot === 'frame' ? equipped?.frameId === item.id : equipped?.backgroundId === item.id;
    const requiredLevel = levelProgressForXp(item.unlockXp).level;
    return (
      <Pressable
        key={item.id}
        style={styles.itemRow}
        disabled={!unlocked || equippingId !== null}
        onPress={() => toggleEquip(slot, item.id, !!isEquipped)}
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
          <Text style={styles.itemNote}>
            {unlocked ? (isEquipped ? 'Equipped — tap to remove' : 'Tap to equip') : `Unlocks at level ${requiredLevel}`}
          </Text>
        </View>
        {equippingId === item.id ? (
          <ActivityIndicator color={colors.accent} />
        ) : unlocked ? (
          isEquipped && <CheckCircleIcon size={18} color={color.accent} weight="fill" />
        ) : (
          <LockSimpleIcon size={16} color={withAlpha(colors.text, 0.4)} />
        )}
      </Pressable>
    );
  };

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

        <Card style={{ gap: 4 }} elevated={false}>
          <Text style={text.h4}>Frames</Text>
          {FRAMES.map((f) => renderItem(f, 'frame'))}
        </Card>

        <Card style={{ gap: 4 }} elevated={false}>
          <Text style={text.h4}>Backgrounds</Text>
          {BACKGROUNDS.map((b) => renderItem(b, 'background'))}
        </Card>
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
