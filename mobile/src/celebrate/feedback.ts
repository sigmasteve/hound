import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { getCelebratePrefs } from './prefs';

// The sound and the buzz that go with a celebration (from 0.11.0; both are
// native). The sounds are made for Hound (assets/sounds): a party horn when
// every goal is done, a pop for one goal, a sad trombone for a missed day.
export type CelebrateSound = 'party' | 'pop' | 'womp';

const SOURCES: Record<CelebrateSound, number> = {
  party: require('../../assets/sounds/party.m4a'),
  pop: require('../../assets/sounds/pop.m4a'),
  womp: require('../../assets/sounds/womp.m4a'),
};

let audioModeSet = false;

export async function playSound(sound: CelebrateSound): Promise<void> {
  try {
    if (!(await getCelebratePrefs()).sounds) return;
    if (!audioModeSet) {
      // A phone on silent stays silent, and music or a podcast keeps
      // playing underneath.
      await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
      audioModeSet = true;
    }
    const player = createAudioPlayer(SOURCES[sound]);
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        sub.remove();
        player.remove();
      }
    });
    player.play();
  } catch {
    // A celebration without sound is still a celebration.
  }
}

// Success for every goal, a light tap for one, a warning for a missed day.
export function buzz(kind: 'success' | 'light' | 'warning'): void {
  if (Platform.OS === 'web') return;
  const done =
    kind === 'light'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.notificationAsync(
          kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
        );
  done.catch(() => {});
}
