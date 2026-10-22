import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TopNav } from '../components/TopNav';
import { TabBar } from '../components/TabBar';
import { useTheme } from '../theme/ThemeContext';
import type { MainTab, RootStackParamList } from '../navigation/types';
import { HomeScreen, type HomeDestination } from './HomeScreen';
import { ChallengesScreen } from './ChallengesScreen';
import { FriendsScreen } from './FriendsScreen';
import { YouScreen } from './YouScreen';
import { startBackgroundSync } from '../background';

type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function MainScreen({ route, navigation }: Props) {
  const [tab, setTab] = useState<MainTab>(route.params?.tab ?? 'home');
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Main stays mounted for the app's lifetime, so a second `navigate('Main',
  // { tab })` while it's already on the stack (e.g. Hunt's "All challenges"
  // button) only updates route.params — it doesn't remount the screen, so
  // the initial useState value above won't see it. Sync explicitly instead.
  useEffect(() => {
    if (route.params?.tab && route.params.tab !== tab) {
      setTab(route.params.tab);
      navigation.setParams({ tab: undefined });
    }
  }, [route.params?.tab]);

  // Main only shows once someone is signed in: from here on the phone may
  // sync in the background.
  useEffect(() => {
    startBackgroundSync();
  }, []);

  // Today links to a tab, or to a screen that used to be one.
  const goFromHome = (dest: HomeDestination) => {
    if (dest === 'stats') navigation.navigate('Stats');
    else if (dest === 'healthData') navigation.navigate('HealthData');
    else if (dest === 'goals') navigation.navigate('Goals');
    else if (dest === 'kennel') navigation.navigate('Kennel');
    else if (dest === 'setup') navigation.navigate('Setup', { resume: true });
    else if (dest === 'journey') navigation.navigate('Journey');
    else setTab(dest);
  };

  return (
    <View style={styles.root}>
      <TopNav
        tab={tab}
        onHome={() => setTab('home')}
        onOpenLevel={() => navigation.navigate('Kennel')}
        onOpenBones={() => navigation.navigate('Locker')}
        onAdmin={() => navigation.navigate('Admin')}
        onOrgManagement={(organizationId) =>
          organizationId
            ? navigation.navigate('OrgDetail', { organizationId })
            : navigation.navigate('OrgManagement')
        }
      />
      <View style={styles.content}>
        {tab === 'home' && (
          <HomeScreen
            onOpenHunt={() => navigation.navigate('Hunt')}
            onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
            onGoTab={goFromHome}
            onOpenAchievements={() => navigation.navigate('Achievements')}
          />
        )}
        {tab === 'challenges' && (
          <ChallengesScreen
            onOpenHunt={() => navigation.navigate('Hunt')}
            onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
            onCreate={() => navigation.navigate('Create')}
          />
        )}
        {tab === 'friends' && (
          <FriendsScreen
            onOpenFriend={(friend) =>
              navigation.navigate('FriendDetail', {
                friendshipId: friend.friendshipId,
                friendUserId: friend.userId,
                friendName: friend.name,
                friendInitials: friend.initials,
                friendFrameId: friend.frameId,
                friendBackgroundId: friend.backgroundId,
                friendIconId: friend.iconId,
              })
            }
          />
        )}
        {tab === 'you' && (
          <YouScreen
            onOpenGoals={() => navigation.navigate('Goals')}
            onOpenStats={() => navigation.navigate('Stats')}
            onOpenAchievements={() => navigation.navigate('Achievements')}
            onOpenLocker={() => navigation.navigate('Locker')}
            onOpenKennel={() => navigation.navigate('Kennel')}
            onOpenJourney={() => navigation.navigate('Journey')}
            onPickJourney={() => navigation.navigate('JourneyPicker')}
            onOpenHealthData={() => navigation.navigate('HealthData')}
            onOpenSettings={() => navigation.navigate('Settings')}
            onOpenHelp={() => navigation.navigate('Help')}
          />
        )}
      </View>
      <TabBar
        active={tab}
        onSelect={(next) => {
          // A field on the old tab is about to go; take its keyboard with it.
          Keyboard.dismiss();
          setTab(next);
        }}
      />
    </View>
  );
}

function makeStyles(colors: { bg: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { flex: 1 },
  });
}
