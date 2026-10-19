import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ShareNetworkIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getKennel, type Kennel } from '../kennel/kennelApi';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import { friendCodeUrl } from '../friends/types';
import { ShareCard, shareText, type ShareContent } from './ShareCard';
import { CARD_HEIGHT, CARD_WIDTH, shareCardImage } from './shareImage';

// The card you're about to share, shown first so you know what goes out,
// with Share to open the phone's share sheet. Your hound and your friend
// code (the "challenge me" link) are read when it opens; without them the
// card still works, with the Hound logo and the website instead.
export function ShareSheet({ content, onClose }: { content: ShareContent; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [kennel, setKennel] = useState<Kennel | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getKennel()
      .then((k) => !cancelled && setKennel(k))
      .catch(() => {});
    supabaseFriendsProvider
      .getMyFriendCode()
      .then((code) => !cancelled && setInviteUrl(friendCodeUrl(code)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The card is always laid out full size (that's what gets saved) and
  // shrunk to fit here.
  const scale = Math.min(1, (height * 0.62) / CARD_HEIGHT, 300 / CARD_WIDTH);

  const share = async () => {
    setSharing(true);
    try {
      await shareCardImage(cardRef, shareText(content, inviteUrl));
    } catch (e) {
      Alert.alert("Couldn't share", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View
            style={[styles.preview, { width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }]}
            accessible
            accessibilityLabel="Preview of the picture you'll share"
          >
            <View
              style={{
                position: 'absolute',
                left: (CARD_WIDTH * scale - CARD_WIDTH) / 2,
                top: (CARD_HEIGHT * scale - CARD_HEIGHT) / 2,
                transform: [{ scale }],
              }}
            >
              <ShareCard content={content} kennel={kennel} inviteUrl={inviteUrl} cardRef={cardRef} />
            </View>
          </View>
          <Text style={styles.note}>Only your own numbers are on it.</Text>
          <View style={styles.buttons}>
            <Button label="Cancel" variant="ghost" onPress={onClose} />
            <Button
              label={sharing ? 'Sharing…' : 'Share'}
              variant="primary"
              disabled={sharing}
              icon={<ShareNetworkIcon size={16} color={colors.accent} />}
              onPress={share}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      alignItems: 'center',
      gap: 12,
      padding: 18,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    preview: { borderRadius: 18, overflow: 'hidden' },
    note: { fontFamily: font.body, fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    buttons: { flexDirection: 'row', gap: 10 },
  });
}
