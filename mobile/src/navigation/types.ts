export type MainTab = 'home' | 'challenges' | 'metrics' | 'friends' | 'settings' | 'connect';

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  Main: { tab?: MainTab } | undefined;
  Hunt: undefined;
  Create: undefined;
  ChallengeDetail: { challengeId: string };
  FriendDetail: { friendshipId: string; friendUserId: string; friendName: string; friendInitials: string };
  Admin: undefined;
};
