import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha } from '../theme/tokens';
import * as notifications from '../notifications/supabaseNotifications';

type Job = 'login' | 'staleData' | 'dailyStandings';

// Admin: fire a notification job right now instead of waiting for its
// daily schedule. Lived on Settings until the launch review moved it
// here, with the rest of what only an admin sees.
export function DeveloperToolsCard() {
  const { colors, text } = useTheme();
  const [triggering, setTriggering] = useState<Job | null>(null);

  const run = async (which: Job, fn: () => Promise<Record<string, unknown>>) => {
    setTriggering(which);
    try {
      const result = await fn();
      Alert.alert('Sent', JSON.stringify(result));
    } catch (err) {
      Alert.alert('Could not trigger', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setTriggering(null);
    }
  };

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={text.h4}>Developer tools</Text>
      <Text style={{ fontSize: 12.5, color: withAlpha(colors.text, 0.6) }}>
        Fire a notification job right now instead of waiting for its daily schedule.
      </Text>
      <Button
        label={triggering === 'login' ? 'Sending…' : 'Test: Login reminders'}
        small
        disabled={triggering !== null}
        onPress={() => run('login', notifications.triggerLoginReminders)}
      />
      <Button
        label={triggering === 'staleData' ? 'Sending…' : 'Test: Stale data alert'}
        small
        disabled={triggering !== null}
        onPress={() => run('staleData', notifications.triggerStaleDataAlerts)}
      />
      <Button
        label={triggering === 'dailyStandings' ? 'Sending…' : 'Test: Daily standings'}
        small
        disabled={triggering !== null}
        onPress={() => run('dailyStandings', notifications.triggerDailyStandings)}
      />
    </Card>
  );
}
