import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { codeFrom } from './communityApi';

// A community challenge link (K-04) opens Hound on that challenge's Join
// card: hound://c/<code> from the website's "Open in Hound" button now,
// and houndchallenge.net/c/<code> itself once the app claims those links
// (iPhone universal links, Android app links) in a native build. Waits
// for the signed-in navigator, like a notification tap, and handles each
// link once.
export function useChallengeCodeLinks(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  signedIn: boolean,
  navReady: boolean,
) {
  const [url, setUrl] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    Linking.getInitialURL()
      .then((u) => u && setUrl(u))
      .catch(() => {});
    const sub = Linking.addEventListener('url', (e) => setUrl(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!url || !signedIn || !navReady || !navigationRef.isReady()) return;
    if (handled.current === url) return;
    handled.current = url;
    if (!/(^hound(-staging)?:\/\/c\/|houndchallenge\.net\/c\/)/i.test(url)) return;
    const code = codeFrom(url);
    if (code) navigationRef.navigate('JoinCode', { code });
  }, [url, signedIn, navReady, navigationRef]);
}
