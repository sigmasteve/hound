import type { RematchDraft } from '../challenges/rematch';

export type MainTab = 'home' | 'challenges' | 'metrics' | 'friends' | 'settings' | 'connect';

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  Main: { tab?: MainTab } | undefined;
  Hunt: undefined;
  // rematch: set by a finished challenge's Rematch button (see
  // src/challenges/rematch.ts) to prefill the wizard.
  Create: { rematch?: RematchDraft } | undefined;
  ChallengeDetail: { challengeId: string };
  FriendDetail: {
    friendshipId: string;
    friendUserId: string;
    friendName: string;
    friendInitials: string;
    friendFrameId: string | null;
    friendBackgroundId: string | null;
    friendIconId: string | null;
  };
  Admin: undefined;
  AdminUserDetail: {
    userId: string;
    name: string;
    initials: string;
    frameId: string | null;
    backgroundId: string | null;
    iconId: string | null;
    email: string;
    lastActiveAt: string | null;
    createdAt: string;
  };
  OrgManagement: undefined;
  OrgDetail: { organizationId: string };
  Locker: undefined;
  Help: undefined;
};
