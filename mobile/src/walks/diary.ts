import { findWithArticle, walkMiles, walkMinutes, walkName, type FindKind, type HoundWalk } from './walks';

// Fluffy's diary (lifestyle phase 1): a line a day in the Hound's voice,
// written from your real day: the walks, what they found, steps, water,
// and (today) the treat and the goals. Templates, picked by the day so a
// line doesn't change each time it's read.

export interface DiaryDay {
  // Local day, 'YYYY-MM-DD'.
  day: string;
  walks: HoundWalk[];
  steps: number | null;
  // Null when there's no water goal.
  waterMet: boolean | null;
  // Today only.
  treated?: boolean;
  goalHit?: boolean;
}

// The same day always picks the same line.
function pick<T>(day: string, salt: string, options: T[]): T {
  let h = 0;
  for (const c of day + salt) h = (h * 31 + c.charCodeAt(0)) | 0;
  return options[Math.abs(h) % options.length];
}

function miles(n: number): string {
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

function walksSentence(d: DiaryDay): string {
  // Oldest first.
  const out = d.walks.filter((w) => !w.walking).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const going = d.walks.some((w) => w.walking);
  if (out.length === 0) {
    if (going) return 'Out on a walk with you right now.';
    const steps = d.steps ?? 0;
    if (steps >= 8000) return pick(d.day, 'busy', ['No proper walk, but you kept me busy all day.', "We didn't go far, but we never sat still."]);
    if (steps >= 2000) return pick(d.day, 'quiet', ['A quiet day. A few trips round the block.', 'We took it easy.']);
    return pick(d.day, 'lazy', ['A lazy day at home. I napped a lot.', 'Stayed in and kept the sofa warm.']);
  }
  if (out.length === 1) {
    const w = out[0];
    const name = walkName(w).toLowerCase();
    const mi = miles(walkMiles(w));
    const long = walkMiles(w) >= 3 || walkMinutes(w) >= 60;
    const line = long
      ? pick(d.day, 'long', [`A long ${name}: ${mi} mi. My paws are tired.`, `A big ${name}, ${mi} mi. Worth every step.`])
      : pick(d.day, 'one', [`Went on a ${name}, ${mi} mi.`, `A ${mi}-mile ${name} with you.`]);
    return going ? `${line} Out again now.` : line;
  }
  const times = [...new Set(out.map((w) => walkName(w).replace(' walk', '').toLowerCase()))];
  const total = miles(out.reduce((n, w) => n + walkMiles(w), 0));
  const count = COUNT_WORDS[out.length] ?? String(out.length);
  const line =
    times.length > 1 ? `${count} walks, ${listOf(times)}: ${total} mi in all.` : `${count} ${times[0]} walks, ${total} mi in all.`;
  return going ? `${line} Out again now.` : line;
}

function findsSentence(d: DiaryDay, kinds: Map<string, FindKind>): string | null {
  const found = d.walks.map((w) => (w.findId ? kinds.get(w.findId) : undefined)).filter((k): k is FindKind => !!k);
  if (found.length === 0) return null;
  const names = found.map((k) => findWithArticle(k.name));
  const rare = found.find((k) => k.rarity === 'rare');
  if (rare) {
    return found.length === 1
      ? `Found ${names[0]}! That's a rare one.`
      : `Found ${listOf(names)}. The ${rare.name.toLowerCase()} is a rare one!`;
  }
  return `Found ${listOf(names)}.`;
}

// Extras from 0165: the birthday, and traits earned that day.
export interface DiaryExtras {
  birthday?: boolean;
  newTraits?: string[];
  // Friends' hounds who walked with us that day (0170).
  walkedWith?: string[];
}

export function diaryLine(d: DiaryDay, kinds: Map<string, FindKind>, extras: DiaryExtras = {}): string {
  const parts = [walksSentence(d)];
  if (extras.walkedWith?.length) parts.push(`${listOf(extras.walkedWith)} came along.`);
  if (extras.birthday) parts.unshift(pick(d.day, 'bday', ['It’s my birthday! There was cake.', 'My birthday today! Party hat on.']));
  const finds = findsSentence(d, kinds);
  if (finds) parts.push(finds);
  if (d.goalHit) parts.push('We hit our goals.');
  else if (d.waterMet) parts.push('You drank all your water, so I had a big drink too.');
  else if (d.treated) parts.push('Got a treat.');
  if (extras.newTraits?.length) parts.push(`New ${extras.newTraits.length === 1 ? 'trait' : 'traits'}: ${listOf(extras.newTraits)}.`);
  return parts.join(' ');
}

// "Today", "Yesterday", "Monday"
export function diaryDayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const d = new Date(`${day}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

// The week's page, as text to share.
export function diaryShareText(houndName: string, lines: { label: string; line: string }[]): string {
  return [`${houndName}'s diary`, '', ...[...lines].reverse().map((l) => `${l.label}: ${l.line}`), '', 'From Hound'].join('\n');
}
