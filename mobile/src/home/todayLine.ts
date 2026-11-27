import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

// Today's one line (Steve, Nov 2026; mock-up
// claude.ai/artifact/GJqj1VqeT3YxacL57rznFR, version A): the whole day in
// one sentence at the top of Today, each fact a link to where it's done.
// At most three facts, in this order: your step goal, your fast, the games
// waiting (or your first week's steps); with none of those, your streak or
// your hound. Never guilt: nothing pushes steps after 10 PM. No filler
// (Steve, Nov 2026: "nothing's waiting" took space from Your day).
//
// Once a day, at a random moment, your hound says it instead ("Biscuit's
// ready: 1,200 steps to go, ..."): the first open after a time picked at
// random for the day, between 7 AM and 9 PM, so when it happens depends on
// when you open Hound.

export type LineLink = 'steps' | 'fast' | 'games' | 'starter' | 'streak' | 'hound';
export interface LinePart {
  text: string;
  link?: LineLink;
}

export interface LineInput {
  now: Date;
  stepGoal: number | null;
  steps: number | null;
  fastOn: boolean;
  fastOpen: { startedAt: string; goalHours: number } | null;
  fastDoneToday: boolean;
  games: number;
  topGame: string | null;
  starterLeft: number;
  streak: number;
  houndName: string | null;
  houndMood: string | null;
}

const fmt = (n: number) => n.toLocaleString();

function endsText(startedAt: string, goalHours: number, now: Date): string {
  const end = new Date(new Date(startedAt).getTime() + goalHours * 3600000);
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: end.getMinutes() ? '2-digit' : undefined });
  const sameDay = end.toDateString() === now.toDateString();
  return sameDay ? time : `${time} tomorrow`;
}

// The facts, each a list of parts (plain text and links).
export function lineFacts(i: LineInput): LinePart[][] {
  const facts: LinePart[][] = [];
  const late = i.now.getHours() >= 22;

  if (i.stepGoal && i.steps !== null) {
    if (i.steps >= i.stepGoal) facts.push([{ text: 'goal done ✓', link: 'steps' }, { text: ` (${fmt(i.steps)} steps)` }]);
    else if (!late) facts.push([{ text: `${fmt(i.stepGoal - i.steps)} steps`, link: 'steps' }, { text: ' to go' }]);
  }

  if (i.fastOn) {
    if (i.fastOpen) {
      const end = new Date(i.fastOpen.startedAt).getTime() + i.fastOpen.goalHours * 3600000;
      if (end <= i.now.getTime()) facts.push([{ text: 'your fast hit its goal ✓', link: 'fast' }]);
      else facts.push([{ text: 'your fast ends at ' }, { text: endsText(i.fastOpen.startedAt, i.fastOpen.goalHours, i.now), link: 'fast' }]);
    } else if (i.fastDoneToday) {
      facts.push([{ text: 'your fast’s done ✓', link: 'fast' }]);
    }
  }

  if (i.games > 1) facts.push([{ text: `${i.games} games`, link: 'games' }, { text: ' are waiting' }]);
  else if (i.games === 1 && i.topGame) facts.push([{ text: 'it’s ' }, { text: i.topGame, link: 'games' }]);

  if (i.starterLeft > 0 && facts.length < 3) {
    facts.push(
      i.starterLeft === 1
        ? [{ text: '1 step', link: 'starter' }, { text: ' is left in your first week' }]
        : [{ text: 'your first week has ' }, { text: `${i.starterLeft} easy steps`, link: 'starter' }],
    );
  }

  if (facts.length === 0) {
    if (i.streak > 1) facts.push([{ text: `a ${i.streak}-day streak`, link: 'streak' }, { text: ' going' }]);
    else if (i.houndName) facts.push([{ text: `${i.houndName} is ${i.houndMood ?? 'here'}`, link: 'hound' }]);
  }
  return facts.slice(0, 3);
}

// "A, B, and C." with the first letter capitalised.
export function joinFacts(facts: LinePart[][], lead: string | null): LinePart[] {
  const out: LinePart[] = [];
  if (lead) out.push({ text: `${lead} ` });
  facts.forEach((f, idx) => {
    if (idx > 0) out.push({ text: idx === facts.length - 1 ? (facts.length > 2 ? ', and ' : ' and ') : ', ' });
    out.push(...f);
  });
  if (out.length > 0) out.push({ text: '.' });
  const first = out.find((p) => p.text.trim().length > 0);
  if (first && !lead) first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return out;
}

// How the hound says it.
const LEADS = ['{n}’s ready:', '{n} says:', '{n} checked:', '{n}’s keeping count:', '{n} wags:'];

const KEY = 'today:hound-line';
interface Saved {
  day: string;
  at: number;
  spoken: boolean;
  lead: string;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The hound's lead-in for this visit to Today, or null. Once a day: the
// first time Today comes into view after the day's random moment.
export function useHoundSaysIt(houndName: string | null): string | null {
  const [lead, setLead] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setLead(null);
      if (!houndName) return;
      let cancelled = false;
      (async () => {
        const now = new Date();
        const today = dayKey(now);
        let s: Saved | null = null;
        try {
          const raw = await AsyncStorage.getItem(KEY);
          s = raw ? (JSON.parse(raw) as Saved) : null;
        } catch {
          s = null;
        }
        if (!s || s.day !== today) {
          const start = new Date(now);
          start.setHours(7, 0, 0, 0);
          s = {
            day: today,
            at: start.getTime() + Math.floor(Math.random() * 14 * 60) * 60000,
            spoken: false,
            lead: LEADS[Math.floor(Math.random() * LEADS.length)],
          };
        }
        if (!s.spoken && now.getTime() >= s.at) {
          s.spoken = true;
          if (!cancelled) setLead(s.lead.replace('{n}', houndName));
        }
        AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
      })();
      return () => {
        cancelled = true;
      };
    }, [houndName]),
  );
  return lead;
}
