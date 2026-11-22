import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../components/Text';
import { SegmentedControl } from '../components/SegmentedControl';
import { ShareNetworkIcon } from 'phosphor-react-native';
import { Button } from '../components/Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getKennel, type Kennel } from '../kennel/kennelApi';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';
import { friendCodeUrl } from '../friends/types';
import { ShareCard, shareText, type ShareContent, type ShareFooter } from './ShareCard';
import { CARD_HEIGHT, CARD_WIDTH, shareCardImage } from './shareImage';

// The card you're about to share, shown first so you know what goes out,
// with Share to open the phone's share sheet. Your hound and your friend
// code (the "challenge me" link) are read when it opens; without them the
// card still works, with the Hound logo and the website instead.
const FOOTER_KEY = 'hound:share-footer';

export function ShareSheet({ content, onClose }: { content: ShareContent; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [kennel, setKennel] = useState<Kennel | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // Two cards: the QR code and link, or the app stores. The pick is kept
  // for next time on this phone.
  const [footer, setFooter] = useState<ShareFooter>('qr');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FOOTER_KEY)
      .then((v) => !cancelled && (v === 'stores' || v === 'qr') && setFooter(v))
      .catch(() => {});
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
  const scale = Math.min(1, (height * 0.56) / CARD_HEIGHT, 300 / CARD_WIDTH);
  const pick = (v: string) => {
    const f = v === 'stores' ? 'stores' : 'qr';
    setFooter(f);
    AsyncStorage.setItem(FOOTER_KEY, f).catch(() => {});
  };

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
      <View style={styles.backdrop}>
        {/* Behind the sheet, so a tap outside closes it without stealing the sheet's scrolling. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={{ alignSelf: 'stretch' }}>
            <SegmentedControl
              options={[
                { value: 'qr', label: 'QR code' },
                { value: 'stores', label: 'App stores' },
              ]}
              value={footer}
              onChange={pick}
            />
          </View>
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
              <ShareCard content={content} kennel={kennel} inviteUrl={inviteUrl} cardRef={cardRef} footer={footer} />
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
        </View>
      </View>
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
