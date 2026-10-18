import type { RematchDraft } from '../challenges/rematch';
import type { ChallengeKind } from '../data/sampleData';

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
  // kind: picks that kind to start with; fromSetup: opened from the
  // setup wizard, so it returns there.
  Create: { rematch?: RematchDraft; global?: boolean; kind?: ChallengeKind; fromSetup?: boolean } | undefined;
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
  Kennel: undefined;
  Help: undefined;
  Achievements: undefined;
  // Opened from the You tab (they used to be tabs or the top bar).
  Stats: undefined;
  Settings: undefined;
  Goals: undefined;
  HealthData: undefined;
  // The setup wizard (src/onboarding/SetupWizardScreen.tsx). resume: from
  // Today's "Finish setting up", only the steps still left.
  Setup: { resume?: boolean } | undefined;
};
