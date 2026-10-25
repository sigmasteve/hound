import { supabase, signedInUserId } from '../lib/supabase';
import {
  DEFAULT_MAX_CHECKLIST_ITEMS,
  isChecklistDayComplete,
  type ChecklistCheckin,
  type ChecklistItem,
  type ChecklistItemKind,
} from './checklist';

// Reads and writes for an Accountability challenge's list and ticks
// (checklist_items, checklist_checkins, checklist_settings —
// 0126_checklist.sql). Same self-contained shape as seventyFiveApi.ts.

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ITEM_COLUMNS = 'id, challenge_id, owner_id, position, label, kind, steps_target, from_day';

interface ItemRow {
  id: string;
  challenge_id: string;
  owner_id: string | null;
  position: number;
  label: string;
  kind: string;
  steps_target: number | null;
  from_day: string | null;
}

function rowToItem(row: ItemRow): ChecklistItem {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    ownerId: row.owner_id,
    position: row.position,
    label: row.label,
    kind: row.kind as ChecklistItemKind,
    stepsTarget: row.steps_target,
    fromDay: row.from_day,
  };
}

// The shared list plus every personal line the caller may see (RLS:
// participants see the whole challenge's items; a global one is open to
// anyone signed in, so the list can be read before joining).
export async function listChecklistItems(challengeId: string): Promise<ChecklistItem[]> {
  const { data, error } = await requireClient()
    .from('checklist_items')
    .select(ITEM_COLUMNS)
    .eq('challenge_id', challengeId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ItemRow[]).map(rowToItem);
}

export interface NewChecklistItem {
  label: string;
  kind: ChecklistItemKind;
  stepsTarget?: number;
}

// The creator's shared list, in order. Only possible until anyone has
// ticked anything (the server locks the list then), and up to the admin
// cap — both raised as plain errors.
export async function addChecklistItems(challengeId: string, items: NewChecklistItem[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await requireClient().from('checklist_items').insert(
    items.map((it, i) => ({
      challenge_id: challengeId,
      position: i + 1,
      label: it.label.trim(),
      kind: it.kind,
      steps_target: it.kind === 'steps' ? (it.stepsTarget ?? null) : null,
    })),
  );
  if (error) throw new Error(error.message);
}

// Your own one line: written, changed, or (null) removed. A new line
// counts from today on this phone.
export async function setPersonalLine(challengeId: string, label: string | null): Promise<void> {
  const client = requireClient();
  const userId = await signedInUserId();
  if (label === null || label.trim() === '') {
    const { error } = await client.from('checklist_items').delete().eq('challenge_id', challengeId).eq('owner_id', userId);
    if (error) throw new Error(error.message);
    return;
  }
  const { data, error: readError } = await client
    .from('checklist_items')
    .select('id')
    .eq('challenge_id', challengeId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (data) {
    const { error } = await client.from('checklist_items').update({ label: label.trim() }).eq('id', data.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client.from('checklist_items').insert({
      challenge_id: challengeId,
      owner_id: userId,
      position: 99,
      label: label.trim(),
      kind: 'manual',
      from_day: localDateKey(new Date()),
    });
    if (error) throw new Error(error.message);
  }
}

export async function listChecklistCheckins(challengeId: string): Promise<ChecklistCheckin[]> {
  const { data, error } = await requireClient()
    .from('checklist_checkins')
    .select('user_id, day, item_id, done, source')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    day: row.day as string,
    itemId: row.item_id as string,
    done: row.done as boolean,
    source: row.source as 'tap' | 'device',
  }));
}

// Same as seventyFiveApi's listSeventyFiveJoinDates: when each person
// joined is where their own streak clock starts.
export async function listChecklistJoinDates(challengeId: string): Promise<Map<string, Date>> {
  const { data, error } = await requireClient()
    .from('challenge_participants')
    .select('user_id, joined_at')
    .eq('challenge_id', challengeId);
  if (error) throw new Error(error.message);
  const map = new Map<string, Date>();
  for (const row of data ?? []) map.set(row.user_id, new Date(row.joined_at as string));
  return map;
}

// A tap on any item, today's by default. Written as 'tap' so the
// phone's sync (recordDeviceTicks) leaves it alone afterwards.
export async function setChecklistTick(challengeId: string, itemId: string, done: boolean, day?: string): Promise<void> {
  const client = requireClient();
  const userId = await signedInUserId();
  const { error } = await client.from('checklist_checkins').upsert(
    { challenge_id: challengeId, user_id: userId, day: day ?? localDateKey(new Date()), item_id: itemId, done, source: 'tap' },
    { onConflict: 'challenge_id,user_id,day,item_id' },
  );
  if (error) throw new Error(error.message);
}

// What the phone found for one day: items it has earned. Insert-only
// (on conflict do nothing), so it never re-ticks something a person
// unticked by hand, and never unticks anything.
export async function recordDeviceTicks(challengeId: string, day: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const client = requireClient();
  const userId = await signedInUserId();
  const { error } = await client.from('checklist_checkins').upsert(
    itemIds.map((itemId) => ({ challenge_id: challengeId, user_id: userId, day, item_id: itemId, done: true, source: 'device' })),
    { onConflict: 'challenge_id,user_id,day,item_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

// "Have I finished today's list" for the Home screen's Needs you, one
// challenge at a time: the list and today's own ticks, nothing else.
export async function isMyChecklistTodayComplete(challengeId: string, userId: string): Promise<boolean> {
  const client = requireClient();
  const today = localDateKey(new Date());
  const [items, ticks] = await Promise.all([
    listChecklistItems(challengeId),
    client
      .from('checklist_checkins')
      .select('user_id, day, item_id, done, source')
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .eq('day', today),
  ]);
  if (ticks.error) throw new Error(ticks.error.message);
  const checkins: ChecklistCheckin[] = (ticks.data ?? []).map((row) => ({
    userId: row.user_id as string,
    day: row.day as string,
    itemId: row.item_id as string,
    done: row.done as boolean,
    source: row.source as 'tap' | 'device',
  }));
  return isChecklistDayComplete(items, checkins, userId, today);
}

// Admin → how many shared items a list can hold (checklist_settings).
export async function getChecklistMaxItems(): Promise<number> {
  const { data, error } = await requireClient().from('checklist_settings').select('max_items').maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.max_items as number | undefined) ?? DEFAULT_MAX_CHECKLIST_ITEMS;
}

export async function setChecklistMaxItems(maxItems: number): Promise<void> {
  const { error } = await requireClient()
    .from('checklist_settings')
    .update({ max_items: maxItems, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw new Error(error.message);
}
