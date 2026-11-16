import AsyncStorage from '@react-native-async-storage/async-storage';

// What each challenge's device sync last sent for past days, so a sync
// sends only the days whose numbers changed (Roshan's database report,
// Nov 2026: every sync re-sent every day since the challenge started,
// up to 30 rows a time, from every phone, every open and every
// background run).
//
//   * Today is always sent: it's the day that moves, and the server
//     reads it straight after (a Rally's return, a TAG round's first
//     sync).
//   * The memory resets each day, so the first sync of a day sends
//     every day again. That heals anything a past day missed (a second
//     phone that wrote different numbers, a row the server refused).
//   * Only days the server accepted are remembered.

const KEY = 'hound:sent-snapshot-days';

type Memory = {
  // The local day this memory was started on.
  stamp: string;
  // "userId:challengeId" → day → "steps|distance".
  sent: Record<string, Record<string, string>>;
};

let memory: Memory | null = null;
let loading: Promise<Memory> | null = null;

function fingerprint(steps: number, distanceMi: number): string {
  return `${steps}|${Math.round(distanceMi * 1000) / 1000}`;
}

async function load(today: string): Promise<Memory> {
  if (!memory) {
    loading ??= (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const parsed = raw ? (JSON.parse(raw) as Memory) : null;
        if (parsed && typeof parsed.stamp === 'string' && parsed.sent) return parsed;
      } catch {
        // Start fresh below.
      }
      return { stamp: today, sent: {} };
    })();
    memory = await loading;
    loading = null;
  }
  if (memory.stamp !== today) memory = { stamp: today, sent: {} };
  return memory;
}

type Day = { day: string; steps: number; distanceMi: number };

// The days to send: today, and any past day not already sent with these
// numbers today.
export async function daysToSend(userId: string, challengeId: string, days: Day[], today: string): Promise<Day[]> {
  const m = await load(today);
  const sent = m.sent[`${userId}:${challengeId}`];
  if (!sent) return days;
  return days.filter((d) => d.day >= today || sent[d.day] !== fingerprint(d.steps, d.distanceMi));
}

// After the server accepted these days.
export async function rememberSent(userId: string, challengeId: string, days: Day[], today: string): Promise<void> {
  if (days.length === 0) return;
  const m = await load(today);
  const id = `${userId}:${challengeId}`;
  const sent = (m.sent[id] ??= {});
  for (const d of days) sent[d.day] = fingerprint(d.steps, d.distanceMi);
  AsyncStorage.setItem(KEY, JSON.stringify(m)).catch(() => {});
}
