import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaretRightIcon, XIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { getMyEquippedCosmetics, type EquippedCosmetics } from '../cosmetics/cosmeticsApi';
import { getKennel, setHoundAvatar } from '../kennel/kennelApi';
import { useDogPhotos } from './DogPhotoContext';
import { DogPhotoSettings } from './DogPhotoSettings';
import { getMyDogPhoto, photoTokenFromIcon, stopDogPhoto } from './dogPhotos';

// Your avatar: one sheet for it, opened from the You tab (tap your
// avatar), the Kennel's top bar and Settings. My dog (a photo, 0191),
// My hound, or An icon from the Locker; your frame and level stay.

type Mode = 'dog' | 'hound' | 'icon';

export function AvatarSheet({
  visible,
  level,
  onClose,
  onChanged,
  onOpenLocker,
  onOpenKennel,
}: {
  visible: boolean;
  level?: number | null;
  onClose: () => void;
  // After the avatar changes, so the screen behind can reload it.
  onChanged?: () => void;
  onOpenLocker?: () => void;
  onOpenKennel?: () => void;
}) {
  const { user } = useAuth();
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refresh } = useDogPhotos();
  const [equipped, setEquipped] = useState<EquippedCosmetics | null>(null);
  const [houndName, setHoundName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user?.id) return;
    getMyEquippedCosmetics(user.id)
      .then(setEquipped)
      .catch(() => {});
    getKennel()
      .then((k) => setHoundName(k.name))
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const changed = useCallback(() => {
    load();
    refresh();
    onChanged?.();
  }, [load, refresh, onChanged]);

  const iconId = equipped?.iconId ?? null;
  const mode: Mode = photoTokenFromIcon(iconId) ? 'dog' : iconId?.startsWith('hound:') ? 'hound' : 'icon';
  const hound = houndName ?? 'your hound';

  const pick = async (next: Mode) => {
    if (next === mode && next !== 'icon') return;
    if (next === 'icon') {
      onClose();
      onOpenLocker?.();
      return;
    }
    setBusy(true);
    try {
      if (next === 'hound') {
        // Any photo comes down (one in use, or kept for later), so the
        // hound's code carries no photo; then the hound goes up.
        await stopDogPhoto();
        await setHoundAvatar(true);
      } else {
        // My dog: a photo you already have goes back up; otherwise the
        // panel below adds one.
        const mine = await getMyDogPhoto();
        if (mine.status === 'active') await setHoundAvatar(true);
        else if (mine.status === 'hidden') Alert.alert('Your dog’s photo', 'It was reported, so it’s hidden until Hound’s team has a look.');
        else Alert.alert('Your dog’s photo', 'Choose a photo below to use one.');
      }
      changed();
    } catch (e) {
      Alert.alert('Your avatar', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const choices: { id: Mode; label: string; note: string }[] = [
    { id: 'dog', label: 'My dog', note: mode === 'dog' ? 'In use' : 'A photo' },
    { id: 'hound', label: 'My hound', note: mode === 'hound' ? 'In use' : houndName ?? 'Your hound' },
    { id: 'icon', label: 'An icon', note: mode === 'icon' && iconId ? 'In use' : 'From the Locker' },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.top}>
          <View style={{ width: 28 }} />
          <Text style={styles.title}>Your avatar</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.preview}>
            {equipped ? (
              <Avatar
                initials={user?.initials ?? '?'}
                tint={colors.accent800}
                size={116}
                fontSize={36}
                frameId={equipped.frameId}
                backgroundId={equipped.backgroundId}
                iconId={equipped.iconId}
                level={level}
              />
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </View>
          <Text style={styles.lead}>
            {mode === 'dog'
              ? 'Friends see your dog. Everyone else sees your hound. Your frame and level stay.'
              : mode === 'hound'
                ? `${houndName ?? 'Your hound'} shows next to your name everywhere. Your frame and level stay.`
                : 'Your icon shows next to your name everywhere. Your frame and level stay.'}
          </Text>
          <View style={styles.choices}>
            {choices.map((c) => {
              const on = c.id === mode && (c.id !== 'icon' || !!iconId);
              return (
                <Pressable
                  key={c.id}
                  onPress={busy ? undefined : () => pick(c.id)}
                  style={[styles.choice, on && styles.choiceOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: busy }}
                >
                  <Text style={styles.choiceLabel}>{c.label}</Text>
                  <Text style={[styles.choiceNote, on && { color: colors.accentActive }]}>{c.note}</Text>
                </Pressable>
              );
            })}
          </View>
          <DogPhotoSettings embedded onChanged={changed} />
          {onOpenLocker && (
            <Pressable
              style={styles.linkRow}
              onPress={() => {
                onClose();
                onOpenLocker();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.linkLabel}>Frame and background</Text>
              <View style={styles.linkEnd}>
                <Text style={styles.link}>Locker</Text>
                <CaretRightIcon size={14} color={colors.accentActive} weight="bold" />
              </View>
            </Pressable>
          )}
          {onOpenKennel && (
            <Pressable
              style={styles.linkRow}
              onPress={() => {
                onClose();
                onOpenKennel();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.linkLabel}>Change {hound}’s look</Text>
              <View style={styles.linkEnd}>
                <Text style={styles.link}>Kennel</Text>
                <CaretRightIcon size={14} color={colors.accentActive} weight="bold" />
              </View>
            </Pressable>
          )}
          <Text style={styles.small}>Picking My hound takes your photo down; you can pick it again any time.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
    title: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text },
    body: { padding: 16, gap: 14, paddingBottom: 40 },
    preview: { alignItems: 'center', justifyContent: 'center', minHeight: 140 },
    lead: { fontSize: 13.5, lineHeight: 19, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    choices: { flexDirection: 'row', gap: 8 },
    choice: {
      flex: 1,
      minHeight: 76,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.12),
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      padding: 6,
    },
    choiceOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, 0.12) },
    choiceLabel: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    choiceNote: { fontSize: 12, color: withAlpha(colors.text, 0.6), textAlign: 'center' },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    linkLabel: { fontSize: 15, color: colors.text },
    linkEnd: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    link: { fontFamily: font.heading, fontSize: 15, color: colors.accentActive },
    small: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.5), textAlign: 'center' },
  });
}
