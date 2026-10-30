import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import { HoundArt } from '../kennel/HoundArt';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';
import type { Kennel } from '../kennel/kennelApi';
import { saveHoundImage } from './houndImage';
import { updateWidgets } from './widgetData';

// The whole hound, hat and all: HoundArt draws it 1.2 times as tall as wide.
const SIZE = 110;
const HEIGHT = SIZE * 1.2;
const SAVED_KEY = 'widgetHoundKey';

// Your hound for the home screen widget. A widget can't draw the hound
// itself, so Today draws it out of sight and saves a picture, only when its
// look or mood has changed since the last one.
export function WidgetHound({ kennel }: { kennel: Kennel }) {
  const ref = useRef<View>(null);
  const rank = rankForLevel(levelProgressForXp(kennel.xpTotal).level).id;
  const key = [rank, kennel.neckId, kennel.headId, kennel.faceId, kennel.coatId, kennel.ears, kennel.tail, kennel.markings, kennel.mood]
    .map((part) => part ?? 'none')
    .join('-');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    // After the hound has drawn.
    const timer = setTimeout(async () => {
      try {
        if ((await AsyncStorage.getItem(SAVED_KEY)) === key || cancelled || !ref.current) return;
        const base64 = await captureRef(ref, { format: 'png', result: 'base64', width: SIZE * 2, height: HEIGHT * 2 });
        const houndImage = await saveHoundImage(base64, key);
        if (cancelled || !houndImage) return;
        // Remembered as saved only once the widget has it: a push that
        // failed left the key written and the widget on the old picture.
        if (await updateWidgets({ houndImage })) await AsyncStorage.setItem(SAVED_KEY, key);
      } catch {
        // The widget shows the paw instead.
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  if (Platform.OS === 'web') return null;
  return (
    <View ref={ref} collapsable={false} style={styles.offscreen} pointerEvents="none">
      <HoundArt
        rank={rank}
        mood={kennel.mood}
        neckId={kennel.neckId}
        headId={kennel.headId}
        faceId={kennel.faceId}
        coatId={kennel.coatId}
        ears={kennel.ears}
        tail={kennel.tail}
        markings={kennel.markings}
        breedId={kennel.breedId}
        size={SIZE}
        animate={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out (so it can be captured) but off the left of the screen.
  offscreen: { position: 'absolute', left: -SIZE * 3, top: 0, width: SIZE, height: HEIGHT },
});
