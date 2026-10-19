import type { RefObject } from 'react';
import { Platform, Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

// A share card is laid out at 360×640 (9:16, an Instagram Story) and
// saved at three times that, 1080×1920.
export const CARD_WIDTH = 360;
export const CARD_HEIGHT = 640;

// Takes a picture of the card and opens the phone's share sheet with it:
// Instagram, Messages, WhatsApp, Save Image and so on. Both pieces are
// native (from 0.11.0); on web, or if the phone can't share a file, the
// text version goes out instead.
export async function shareCardImage(card: RefObject<View | null>, fallbackMessage: string): Promise<void> {
  if (Platform.OS !== 'web' && card.current && (await Sharing.isAvailableAsync())) {
    const uri = await captureRef(card, {
      format: 'png',
      result: 'tmpfile',
      width: CARD_WIDTH * 3,
      height: CARD_HEIGHT * 3,
    });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share' });
    return;
  }
  await Share.share({ message: fallbackMessage });
}
