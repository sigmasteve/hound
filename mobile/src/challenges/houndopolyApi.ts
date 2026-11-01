import { supabase } from '../lib/supabase';
import {
  DEFAULT_HOUNDOPOLY_SETTINGS,
  type HoundopolyDeed,
  type HoundopolyEvent,
  type HoundopolyGame,
  type HoundopolyPlayer,
  type HoundopolySettings,
  type HoundopolySlot,
  type HoundopolyTurn,
} from './houndopoly';
import { localDayKey } from '../goals/goals';

// Hound'opoly's reads and its two calls (0136_houndopoly.sql). Every
// call throws its message on failure.

function client() {
  if (!supabase) throw new Error('This game needs a connection to Hound.');
  return supabase;
}

function settingsFromRow(r: any): HoundopolySettings {
  return {
    startCash: r?.start_cash ?? DEFAULT_HOUNDOPOLY_SETTINGS.startCash,
    passStartCash: r?.pass_start_cash ?? DEFAULT_HOUNDOPOLY_SETTINGS.passStartCash,
    vetCost: r?.vet_cost ?? DEFAULT_HOUNDOPOLY_SETTINGS.vetCost,
    dogHouseSteps: r?.dog_house_steps ?? DEFAULT_HOUNDOPOLY_SETTINGS.dogHouseSteps,
    twoDiceSteps: r?.two_dice_steps ?? DEFAULT_HOUNDOPOLY_SETTINGS.twoDiceSteps,
    threeDiceSteps: r?.three_dice_steps ?? DEFAULT_HOUNDOPOLY_SETTINGS.threeDiceSteps,
    rollHourUtc: r?.roll_hour_utc ?? DEFAULT_HOUNDOPOLY_SETTINGS.rollHourUtc,
    middayHourUtc: r?.midday_hour_utc ?? DEFAULT_HOUNDOPOLY_SETTINGS.middayHourUtc,
  };
}

export async function getHoundopolySettings(): Promise<HoundopolySettings> {
  const { data, error } = await client().from('houndopoly_settings').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return settingsFromRow(data);
}

// Admin only (the table's own RLS).
export async function setHoundopolySettings(s: HoundopolySettings): Promise<void> {
  const { error } = await client()
    .from('houndopoly_settings')
    .update({
      start_cash: s.startCash,
      pass_start_cash: s.passStartCash,
      vet_cost: s.vetCost,
      dog_house_steps: s.dogHouseSteps,
      two_dice_steps: s.twoDiceSteps,
      three_dice_steps: s.threeDiceSteps,
      roll_hour_utc: s.rollHourUtc,
      midday_hour_utc: s.middayHourUtc,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true);
  if (error) throw new Error(error.message);
}

// Rolls any day that's over and not yet rolled. Returns how many.
export async function advanceHoundopoly(challengeId: string): Promise<number> {
  const { data, error } = await client().rpc('houndopoly_advance', { p_challenge_id: challengeId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// Buy the square held for you, or let it go.
export async function decideHoundopoly(challengeId: string, buy: boolean): Promise<void> {
  const { error } = await client().rpc('houndopoly_decide', { p_challenge_id: challengeId, p_buy: buy });
  if (error) throw new Error(error.message);
}

const FEED_TURNS = 4;

export async function getHoundopolyGame(challengeId: string, myUserId: string | null): Promise<HoundopolyGame> {
  const c = client();
  const todayKey = localDayKey(new Date());
  const [players, deeds, days, settings, turns] = await Promise.all([
    c.from('houndopoly_players').select('user_id, position, cash, pending_idx, bankrupt, joined_day').eq('challenge_id', challengeId),
    c.from('houndopoly_deeds').select('idx, owner_id, bought_on').eq('challenge_id', challengeId),
    c
      .from('houndopoly_days')
      .select('day, slot')
      .eq('challenge_id', challengeId)
      .order('day', { ascending: false })
      .order('slot', { ascending: true })
      .limit(FEED_TURNS),
    c.from('houndopoly_settings').select('*').maybeSingle(),
    myUserId
      ? c.from('houndopoly_turns').select('user_id, day, slot, steps, dice, roll').eq('challenge_id', challengeId).eq('user_id', myUserId).eq('day', todayKey)
      : Promise.resolve({ data: [], error: null } as { data: any[]; error: null }),
  ]);
  for (const r of [players, deeds, days, settings, turns]) if (r.error) throw new Error(r.error.message);
  // 'night' sorts after 'noon' alphabetically, so within a day the
  // overnight turn comes first here; newest first overall.
  const rolledTurns = (days.data ?? [])
    .map((r: any) => ({ day: String(r.day), slot: r.slot as HoundopolySlot }))
    .sort((a, b) => (a.day === b.day ? (a.slot === 'night' ? -1 : 1) : a.day < b.day ? 1 : -1));
  // The feed: everything from the last few rolled turns, plus today's own
  // buys and passes (which carry today's date).
  const since = rolledTurns.length > 0 ? rolledTurns[rolledTurns.length - 1].day : '1970-01-01';
  const events = await c
    .from('houndopoly_events')
    .select('id, day, slot, seq, user_id, kind, idx, amount, other_user_id, detail')
    .eq('challenge_id', challengeId)
    .gte('day', since)
    .order('day', { ascending: false })
    .order('seq', { ascending: false })
    .limit(200);
  if (events.error) throw new Error(events.error.message);
  return {
    players: (players.data ?? []).map(
      (r: any): HoundopolyPlayer => ({
        userId: r.user_id,
        position: r.position,
        cash: r.cash,
        pendingIdx: r.pending_idx,
        bankrupt: r.bankrupt,
        joinedDay: String(r.joined_day),
      }),
    ),
    deeds: (deeds.data ?? []).map((r: any): HoundopolyDeed => ({ idx: r.idx, ownerId: r.owner_id, boughtOn: String(r.bought_on) })),
    events: (events.data ?? []).map(
      (r: any): HoundopolyEvent => ({
        id: Number(r.id),
        day: String(r.day),
        slot: (r.slot ?? 'night') as HoundopolySlot,
        seq: r.seq,
        userId: r.user_id,
        kind: r.kind,
        idx: r.idx,
        amount: r.amount,
        otherUserId: r.other_user_id,
        detail: r.detail ?? {},
      }),
    ),
    rolledTurns,
    myTurnsToday: ((turns.data ?? []) as any[]).map(
      (r): HoundopolyTurn => ({ userId: r.user_id, day: String(r.day), slot: r.slot, steps: r.steps, dice: r.dice, roll: r.roll }),
    ),
    settings: settingsFromRow(settings.data),
  };
}

// The games where a square is waiting on the viewer's decision, for
// Today's "Needs you".
export async function listMyHoundopolyPending(userId: string): Promise<Set<string>> {
  const { data, error } = await client()
    .from('houndopoly_players')
    .select('challenge_id')
    .eq('user_id', userId)
    .not('pending_idx', 'is', null);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: any) => String(r.challenge_id)));
}
