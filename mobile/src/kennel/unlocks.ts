// The Kennel opens up as you level up (Steve, Nov 2026: "for new users it
// will be overwhelming"). Day 1 is Walks, Finds and Bath day on Today, the
// basics of Style, and the Yard and the Park on Home; the rest arrives one
// level at a time. Locked things are hidden, not greyed out, and anyone
// already using something keeps it. 0216_kennel_unlocks.sql holds the
// server's side of the same levels.
//
// Pure data, no React or Supabase, so ladder.ts (the "Next" line, the
// whole ladder, the level-up pop-up) can use it too.

export type KennelUnlock = 'tricks' | 'garden' | 'kitchen' | 'porch' | 'wardrobe' | 'houses' | 'room' | 'gifting';

export const KENNEL_UNLOCKS: Record<KennelUnlock, { level: number; name: string; line: string }> = {
  tricks: { level: 2, name: 'Tricks', line: 'Teach your hound tricks, then double-tap it to show one off.' },
  garden: { level: 3, name: 'The Garden', line: 'Plant seeds that grow with your steps. The first seed each week is free.' },
  kitchen: { level: 4, name: 'The Kitchen', line: 'Bake treats from what your walks find.' },
  porch: { level: 5, name: 'The Porch', line: 'A hot tub, a swing and a fire pit, round the back of the house.' },
  wardrobe: { level: 6, name: 'The whole wardrobe', line: 'Neck, face, body and feet join the hats.' },
  houses: { level: 7, name: 'Bougie houses', line: 'Swap the Hound House for a barn, a cabin or a castle.' },
  room: { level: 8, name: 'The Room', line: 'Inside the house: a fireplace, a sofa and a bookshelf.' },
  gifting: { level: 9, name: 'Gifting', line: 'Send a friend’s hound something for their yard, with a note.' },
};

// Is it open at this level? `already` is true when this person is using it
// anyway (they keep what they had before the ladder).
export function opens(what: KennelUnlock, level: number, already = false): boolean {
  return already || level >= KENNEL_UNLOCKS[what].level;
}

// What opens at exactly this level, if anything.
export function unlockAt(level: number): (typeof KENNEL_UNLOCKS)[KennelUnlock] | null {
  return Object.values(KENNEL_UNLOCKS).find((u) => u.level === level) ?? null;
}

// The wardrobe's slots that wait for 'wardrobe'.
export const LATER_WARDROBE = ['neck', 'face', 'body', 'feet'] as const;
