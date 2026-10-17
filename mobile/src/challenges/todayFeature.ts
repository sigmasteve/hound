import AsyncStorage from '@react-native-async-storage/async-storage';

// Whether Today features your newest challenge when you haven't pinned
// one (Pin to Today on the challenge). On by default; turned off in
// Settings, Today only shows a challenge you've pinned. Kept on this
// phone.
const KEY = 'hound:feature-newest-challenge';

export async function getFeatureNewest(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setFeatureNewest(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, on ? 'on' : 'off');
}
