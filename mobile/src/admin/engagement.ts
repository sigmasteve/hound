import { supabase } from '../lib/supabase';

// Admin → Engagement (0113_admin_engagement.sql): who's opening Hound,
// how new members get set up, who comes back, and what got used this
// week. "Opened the app" means the daily bonus was claimed that day.
export interface Engagement {
  members: number;
  active: { day: number; week: number; month: number };
  // The last 14 days, oldest first.
  daily: { day: string; people: number }[];
  newMembers: {
    joined: number;
    health: number;
    uses: number;
    goals: number;
    notifications: number;
    friend: number;
    challenge: number;
    finishedSetup: number;
    houndAvatar: number;
  };
  cameBack: { nextDay: number; nextDayOf: number; secondWeek: number; secondWeekOf: number };
  week: {
    goalDays: number;
    treats: number;
    kennelItems: number;
    boneDigs: number;
    bounties: number;
    challenges: number;
    globalJoins: number;
    sponsorTaps: number;
  };
}

export async function getEngagement(): Promise<Engagement> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_engagement');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  const nm = d.new_members ?? {};
  const cb = d.came_back ?? {};
  const w = d.week ?? {};
  return {
    members: n(d.members),
    active: { day: n(d.active?.day), week: n(d.active?.week), month: n(d.active?.month) },
    daily: ((d.daily ?? []) as { day: string; people: number }[]).map((r) => ({ day: r.day, people: n(r.people) })),
    newMembers: {
      joined: n(nm.joined),
      health: n(nm.health),
      uses: n(nm.uses),
      goals: n(nm.goals),
      notifications: n(nm.notifications),
      friend: n(nm.friend),
      challenge: n(nm.challenge),
      finishedSetup: n(nm.finished_setup),
      houndAvatar: n(nm.hound_avatar),
    },
    cameBack: {
      nextDay: n(cb.next_day),
      nextDayOf: n(cb.next_day_of),
      secondWeek: n(cb.second_week),
      secondWeekOf: n(cb.second_week_of),
    },
    week: {
      goalDays: n(w.goal_days),
      treats: n(w.treats),
      kennelItems: n(w.kennel_items),
      boneDigs: n(w.bone_digs),
      bounties: n(w.bounties),
      challenges: n(w.challenges),
      globalJoins: n(w.global_joins),
      sponsorTaps: n(w.sponsor_taps),
    },
  };
}
