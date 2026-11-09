import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { codeFrom } from './communityApi';
import { clubCodeFrom } from '../clubs/ClubJoinCard';
import { supabase } from '../lib/supabase';
import { supabaseFriendsProvider } from '../friends/supabaseFriends';

// A community challenge link (K-04) opens Hound on that challenge's Join
// card: hound://c/<code> from the website's "Open in Hound" button, and
// houndchallenge.net/c/<code> itself where the app claims those links
// (iPhone universal links, from the build with associatedDomains). A
// friend's link (hound://f/<code>, houndchallenge.net/f/<code>: the QR on
// a share card or the Friends tab) asks to add them. Waits for the
// signed-in navigator, like a notification tap, and handles each link
// once.
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
    if (/(^hound(-staging)?:\/\/f\/|houndchallenge\.net\/f\/)/i.test(url)) {
      const code = friendCodeFrom(url);
      if (code) void askToAddFriend(code);
      return;
    }
    if (!/(^hound(-staging)?:\/\/c\/|houndchallenge\.net\/c\/)/i.test(url)) return;
    // A club's code is 6 characters (0185), a challenge's 7.
    const code = codeFrom(url) ?? clubCodeFrom(url);
    if (code) navigationRef.navigate('JoinCode', { code });
  }, [url, signedIn, navReady, navigationRef]);
}

// The code in a friend link: the last part of the path, without any
// query or fragment a messaging app tacks on.
export function friendCodeFrom(url: string): string | null {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  const code = path.slice(path.lastIndexOf('/') + 1);
  return /^[A-Za-z0-9_-]{4,32}$/.test(code) ? code : null;
}

// "Add Sam as a friend?", then add them, the same as entering their code
// on the Friends tab.
async function askToAddFriend(code: string) {
  let name = 'this person';
  try {
    const { data } = (await supabase?.rpc('friend_code_owner_name', { code })) ?? {};
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.name) name = row.name;
  } catch {
    // The name is only for the question; the add still works without it.
  }
  Alert.alert(`Add ${name} as a friend?`, 'From their Hound invite link.', [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Add friend',
      onPress: () => {
        supabaseFriendsProvider
          .addFriendByCode(code)
          .then(() => Alert.alert("You're now friends!", `${name === 'this person' ? 'They' : name} will show on your Friends tab.`))
          .catch((e) => Alert.alert("Couldn't add them", e instanceof Error ? e.message : 'Try again.'));
      },
    },
  ]);
}
