import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { TopNav } from '../components/TopNav';
import { color } from '../theme/tokens';
import type { MainTab, RootStackParamList } from '../navigation/types';
import { HomeScreen } from './HomeScreen';
import { ChallengesScreen } from './ChallengesScreen';
import { MetricsScreen } from './MetricsScreen';
import { FriendsScreen } from './FriendsScreen';
import { SettingsScreen } from './SettingsScreen';
import { ConnectScreen } from './ConnectScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function MainScreen({ route, navigation }: Props) {
  const [tab, setTab] = useState<MainTab>(route.params?.tab ?? 'home');

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

  return (
    <View style={styles.root}>
      <TopNav active={tab} onSelect={setTab} onProfile={() => setTab('settings')} />
      <View style={styles.content}>
        {tab === 'home' && (
          <HomeScreen
            onOpenHunt={() => navigation.navigate('Hunt')}
            onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
            onGoTab={setTab}
          />
        )}
        {tab === 'challenges' && (
          <ChallengesScreen
            onOpenHunt={() => navigation.navigate('Hunt')}
            onOpenChallenge={(challengeId) => navigation.navigate('ChallengeDetail', { challengeId })}
            onCreate={() => navigation.navigate('Create')}
          />
        )}
        {tab === 'metrics' && <MetricsScreen />}
        {tab === 'friends' && <FriendsScreen />}
        {tab === 'settings' && <SettingsScreen />}
        {tab === 'connect' && <ConnectScreen onDone={() => setTab('home')} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flex: 1 },
});
