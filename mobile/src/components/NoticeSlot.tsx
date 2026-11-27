import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// One notice at a time above Today (the streamlining, Steve Nov 2026):
// the offline strip, the maintenance heads-up, "A new version is ready",
// "Hound can't see your steps" and the announcement banner used to stack
// up. Inside a NoticeSlot only the most important one that wants to show
// does; when it goes, the next one takes its place. Outside a NoticeSlot
// (the offline strip on other screens) each shows as before.
export type NoticeId = 'offline' | 'maintenance' | 'update' | 'health' | 'announcement';

const ORDER: NoticeId[] = ['offline', 'maintenance', 'update', 'health', 'announcement'];

interface Slot {
  wanting: Set<NoticeId>;
  set: (id: NoticeId, on: boolean) => void;
}

const SlotCtx = createContext<Slot | null>(null);

export function NoticeSlot({ children }: { children: React.ReactNode }) {
  const [wanting, setWanting] = useState<Set<NoticeId>>(new Set());
  const set = useCallback((id: NoticeId, on: boolean) => {
    setWanting((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ wanting, set }), [wanting, set]);
  return <SlotCtx.Provider value={value}>{children}</SlotCtx.Provider>;
}

// Call before any early return: whether this notice may show now.
export function useNoticeTurn(id: NoticeId, wants: boolean): boolean {
  const slot = useContext(SlotCtx);
  const set = slot?.set;
  useEffect(() => {
    if (!set) return;
    set(id, wants);
    return () => set(id, false);
  }, [set, id, wants]);
  if (!slot) return wants;
  if (!wants) return false;
  // The first in ORDER that wants to show (before this one's effect has
  // run, it shows if nothing is waiting at all).
  const first = ORDER.find((o) => slot.wanting.has(o));
  return first === undefined || first === id;
}

// For a notice that's drawn inline (Today's announcement banner).
export function NoticeTurn({ id, show, children }: { id: NoticeId; show: boolean; children: React.ReactNode }) {
  const turn = useNoticeTurn(id, show);
  return show && turn ? <>{children}</> : null;
}
