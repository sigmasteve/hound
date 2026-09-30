import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

// Where tapping a push takes you. Pushes without one of these types just
// open the app, as before.
//   admin_signup         → that new person's Admin page
//   admin_signup_digest  → the Admin screen
//   friend_request       → the Friends tab (Accept/Decline is at the top)
//   friend_accepted      → the new friend's profile
function routeFor(data: Record<string, unknown> | undefined): (() => [keyof RootStackParamList, any]) | null {
  if (!data) return null;
  if (data.type === 'admin_signup' && typeof data.userId === 'string') {
    return () => [
      'AdminUserDetail',
      {
        userId: data.userId,
        name: String(data.name ?? 'New user'),
        initials: String(data.initials ?? '?'),
        frameId: null,
        backgroundId: null,
        iconId: null,
        email: String(data.email ?? ''),
        lastActiveAt: null,
        createdAt: String(data.createdAt ?? new Date().toISOString()),
      },
    ];
  }
  if (data.type === 'admin_signup_digest') return () => ['Admin', undefined];
  if (data.type === 'friend_request') return () => ['Main', { tab: 'friends' }];
  if (data.type === 'friend_accepted' && typeof data.friendshipId === 'string' && typeof data.friendUserId === 'string') {
    return () => [
      'FriendDetail',
      {
        friendshipId: data.friendshipId,
        friendUserId: data.friendUserId,
        friendName: String(data.friendName ?? 'Your friend'),
        friendInitials: String(data.friendInitials ?? '?'),
        friendFrameId: (data.friendFrameId as string | null) ?? null,
        friendBackgroundId: (data.friendBackgroundId as string | null) ?? null,
        friendIconId: (data.friendIconId as string | null) ?? null,
      },
    ];
  }
  return null;
}

// Covers both a tap while the app is running and the tap that launched
// it. Waits for the signed-in navigator to be ready before navigating,
// and handles each tap once. Web has no notifications (reading the last
// response throws there), so this does nothing on web.
export function useNotificationTaps(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  signedIn: boolean,
  navReady: boolean,
) {
  const [response, setResponse] = useState<Notifications.NotificationResponse | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let subscription: { remove: () => void } | null = null;
    try {
      const launched = Notifications.getLastNotificationResponse();
      if (launched) setResponse(launched);
      subscription = Notifications.addNotificationResponseReceivedListener(setResponse);
    } catch {
      // A tap just opens the app, as it always has.
    }
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    if (!response || !signedIn || !navReady || !navigationRef.isReady()) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const route = routeFor(response.notification.request.content.data as Record<string, unknown> | undefined);
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Not critical — `handled` already stops a repeat this session.
    }
    if (!route) return;
    const [name, params] = route();
    (navigationRef.navigate as (n: string, p?: unknown) => void)(name, params);
  }, [response, signedIn, navReady, navigationRef]);
}
