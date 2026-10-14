import type { RematchDraft } from '../challenges/rematch';

export type MainTab = 'home' | 'challenges' | 'friends' | 'you';

// The challenge screen's three tabs.
export type ChallengeTab = 'board' | 'talk' | 'details';

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  Main: { tab?: MainTab } | undefined;
  Hunt: undefined;
  // rematch: set by a finished challenge's Rematch button (see
  // src/challenges/rematch.ts) to prefill the wizard.
  // global: an admin publishing a Global Hound Challenge from Admin.
  Create: { rematch?: RematchDraft; global?: boolean } | undefined;
  // tab: which part of the challenge to open on (Board by default).
  ChallengeDetail: { challengeId: string; tab?: ChallengeTab };
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
  Achievements: undefined;
  // Opened from the You tab (they used to be tabs or the top bar).
  Stats: undefined;
  Settings: undefined;
  HealthData: undefined;
};
