import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { STAGES, planLabel, timeOfDay, usualStartMinutes } from './fasting';
import type { MyFasting } from './fastingApi';

// Fasting's own local notifications (the phone's, not pushes):
//   fasting-goal   when your fast reaches its goal
//   fasting-36     a check-in at 36 hours, if you're still going
//   fasting-usual  "Start your fast?" at your usual start time, when you
//                  aren't fasting (needs 3 starts to know your usual)
//   fasting-stage-*  as each stage begins up to your goal (settling, fat
//                  burning, ketosis), with what's happening and what's next
// Rescheduled from whatever the Fasting screen or Today last loaded.

const STAGE_NOTES: Record<string, { title: string; body: string }> = {
  settling: { title: '💧 Settling in', body: '4 hours in. Your body is switching to its stored energy. Water or plain tea helps. Your phase game is open.' },
  fatburn: { title: '🔥 Fat burning', body: '12 hours in. More of your energy is coming from fat now. Ketosis is next. Burn Zone is open.' },
  ketosis: { title: '⚡ Into ketosis', body: '16 hours in. Your liver’s stored sugar is running low and ketones are rising. Clarity is open.' },
};
const IDS = ['fasting-goal', 'fasting-36', 'fasting-usual', ...Object.keys(STAGE_NOTES).map((k) => `fasting-stage-${k}`)];
const CHANNEL = 'reminders';

async function cancelAll(): Promise<void> {
  await Promise.all(IDS.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

async function at(id: string, date: Date, title: string, body: string): Promise<void> {
  if (date.getTime() <= Date.now() + 30000) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title, body, sound: 'default', data: { type: 'fasting' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL },
  });
}

export async function scheduleFastingReminders(f: MyFasting | null): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await cancelAll();
    if (!f || f.age !== 'ok') return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    if (f.open) {
      const start = new Date(f.open.startedAt).getTime();
      // Each stage on the way, up to the goal (the goal has its own).
      for (const st of STAGES) {
        const note = STAGE_NOTES[st.key];
        if (!note || st.from >= f.open.goalHours) continue;
        await at(`fasting-stage-${st.key}`, new Date(start + st.from * 3600000), note.title, note.body);
      }
      await at(
        'fasting-goal',
        new Date(start + f.open.goalHours * 3600000),
        `${planLabel(f.open.goalHours)} done 🎉`,
        `${f.open.goalHours} hours! End your fast in Hound whenever you eat, and play Refeed.`,
      );
      await at(
        'fasting-36',
        new Date(start + 36 * 3600000),
        'Still fasting?',
        'You’re 36 hours in. How do you feel? If you’ve eaten, end your fast. If you feel unwell, eat.',
      );
      return;
    }
    const usual = usualStartMinutes(f.recentStarts);
    if (usual === null) return;
    const next = new Date();
    next.setHours(Math.floor(usual / 60), usual % 60, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    await at('fasting-usual', next, 'Start your fast?', `It’s about your usual time (${timeOfDay(usual)}). One tap and you’re going.`);
  } catch {
    // Reminders are a nicety; never let them break the screen.
  }
}
