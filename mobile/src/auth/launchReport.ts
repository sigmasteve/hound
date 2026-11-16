import { supabase } from '../lib/supabase';
import { appVersionFields, installSourceFields } from '../admin/appVersions';
import { getPushPermission } from '../notifications/pushPermission';
import { registerForPushNotifications, touchLastActive } from '../notifications/supabaseNotifications';

// Everything an app open tells the server about this person, in one
// profile update. It used to be five separate writes to the same row
// (Roshan's database report, Nov 2026):
//   last_active_at          send-login-reminders: who used the app today
//   app_* / os_version      Admin → App versions (0076)
//   app_install_*           Android: Play or the website APK (0163)
//   push_permission         Admin, and who gets the push ask (0081)
//   time_zone               reminders in their own evening (0088)
// Then it registers the phone for push once notifications are allowed.
// Never throws: a failed report just leaves the last one in place.
export async function reportLaunch(userId: string): Promise<void> {
  if (!supabase) return;
  const fields: Record<string, unknown> = { last_active_at: new Date().toISOString() };
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) fields.time_zone = timeZone;
  } catch {
    // The last saved zone (or US Eastern) is used.
  }
  const [permission, install] = await Promise.all([getPushPermission(), installSourceFields()]);
  if (permission) fields.push_permission = permission;
  Object.assign(fields, appVersionFields(), install);

  try {
    const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
    // One update is all or nothing. If it's refused, still record the
    // open, so today's login reminder doesn't go to someone who's here.
    if (error) await touchLastActive(userId);
  } catch {
    // Offline.
  }
  if (permission === 'granted') await registerForPushNotifications(userId).catch(() => {});
}
