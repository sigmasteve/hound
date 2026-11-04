import { supabase } from '../lib/supabase';
import type { YardHound } from '../kennel/YardArt';
import { levelProgressForXp } from '../challenges/leveling';
import { rankForLevel } from '../challenges/ranks';

// Together (0170, lifestyle phase 5): playdates, walks together and the
// dog park.

export interface Playdate {
  userId: string;
  owner: string;
  houndName: string;
  // A challenge you're in together, when there is one.
  challenge: string | null;
}

// A walk of yours that overlapped a friend's by 10 minutes or more.
export interface WalkTogether {
  walkId: string;
  userId: string;
  owner: string;
  houndName: string;
  minutes: number;
}

// A friend's hound at the dog park: out walking in the last day.
export interface ParkHound {
  userId: string;
  friendshipId: string;
  owner: string;
  frameId: string | null;
  backgroundId: string | null;
  iconId: string | null;
  walks: number;
  minutes: number;
  steps: number;
  lastAt: string;
  withMe: boolean;
  hound: YardHound;
}

export interface Together {
  playdate: Playdate | null;
  together: WalkTogether[];
  park: ParkHound[];
  meWalked: boolean;
}

function parse(data: unknown): Together {
  const d = (data ?? {}) as any;
  const p = d.playdate;
  return {
    playdate: p ? { userId: p.user_id, owner: p.owner ?? 'A friend', houndName: p.hound_name ?? 'Scout', challenge: p.challenge ?? null } : null,
    together: ((d.together ?? []) as any[]).map((t) => ({
      walkId: t.walk_id,
      userId: t.user_id,
      owner: t.owner ?? 'A friend',
      houndName: t.hound_name ?? 'Scout',
      minutes: Number(t.minutes ?? 0),
    })),
    park: ((d.park ?? []) as any[]).map((h) => ({
      userId: h.user_id,
      friendshipId: h.friendship_id,
      owner: h.owner ?? 'A friend',
      frameId: h.frame_id ?? null,
      backgroundId: h.background_id ?? null,
      iconId: h.icon_id ?? null,
      walks: Number(h.walks ?? 0),
      minutes: Number(h.minutes ?? 0),
      steps: Number(h.steps ?? 0),
      lastAt: h.last_at,
      withMe: !!h.with_me,
      hound: {
        name: h.name ?? 'Scout',
        rank: rankForLevel(levelProgressForXp(Number(h.xp_total ?? 0)).level).id,
        mood: 'happy',
        neckId: h.neck_id ?? null,
        headId: h.head_id ?? null,
        faceId: h.face_id ?? null,
        coatId: h.coat_id ?? null,
        breedId: h.breed_id ?? null,
        bodyId: h.body_id ?? null,
        feetId: h.feet_id ?? null,
        ears: h.ears ?? 'floppy',
        tail: h.tail ?? 'wavy',
        markings: h.markings ?? 'none',
      },
    })),
    meWalked: !!d.me_walked,
  };
}

export async function getTogether(day: string): Promise<Together> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('my_together', { p_day: day });
  if (error) throw new Error(error.message);
  return parse(data);
}

// "Jordan's Scout"; "Jordan's Scout and Sam's Biscuit"
export function togetherNames(list: Pick<WalkTogether, 'owner' | 'houndName'>[]): string {
  const names = list.map((t) => `${t.owner}’s ${t.houndName}`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Admin → Together (0170).
export interface TogetherOverview {
  playdates7d: number;
  playdatePeople7d: number;
  playdatesAll: number;
  walksTogether7d: number;
  walkersTogether7d: number;
  parkOpens7d: number;
  parkVisitors7d: number;
  parkVisitorsAll: number;
}

export async function getTogetherOverview(): Promise<TogetherOverview> {
  if (!supabase) throw new Error('Not connected to Hound.');
  const { data, error } = await supabase.rpc('admin_together_overview');
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as any;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    playdates7d: n(d.playdates_7d),
    playdatePeople7d: n(d.playdate_people_7d),
    playdatesAll: n(d.playdates_all),
    walksTogether7d: n(d.walks_together_7d),
    walkersTogether7d: n(d.walkers_together_7d),
    parkOpens7d: n(d.park_opens_7d),
    parkVisitors7d: n(d.park_visitors_7d),
    parkVisitorsAll: n(d.park_visitors_all),
  };
}
