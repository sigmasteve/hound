import { supabase } from '../lib/supabase';

// The phone's time zone (an IANA name like 'America/Chicago'), saved on
// every app open so reminders and alerts arrive in this person's own
// evening (0088_local_time_alerts.sql). Never throws — before 0088 has
// run, or offline, the last saved zone (or US Eastern) is used.
export async function reportTimeZone(userId: string): Promise<void> {
  if (!supabase) return;
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  if (!timeZone) return;
  try {
    await supabase.from('profiles').update({ time_zone: timeZone }).eq('id', userId);
  } catch {
    // See above.
  }
}
