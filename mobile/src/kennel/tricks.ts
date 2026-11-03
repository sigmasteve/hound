// Tricks (0158_tricks.sql): bought once with Bones, then the hound does
// one when you double-tap it in the Yard. Mirrors the kennel_items rows
// (slot 'trick'); buy_kennel_item is the real price check. How each one
// moves lives in YardArt.tsx.

export type TrickId = 'trick_rollover' | 'trick_highfive' | 'trick_spin' | 'trick_playdead';

export interface Trick {
  id: TrickId;
  name: string;
  costBones: number;
  // What the hound says when it's done.
  line: string;
}

export const TRICKS: Trick[] = [
  { id: 'trick_highfive', name: 'High Five', costBones: 200, line: 'High five!' },
  { id: 'trick_spin', name: 'Spin', costBones: 200, line: 'Wheee!' },
  { id: 'trick_rollover', name: 'Roll Over', costBones: 250, line: 'Ta-da!' },
  { id: 'trick_playdead', name: 'Play Dead', costBones: 300, line: '…just kidding!' },
];

export function isTrick(id: string): id is TrickId {
  return TRICKS.some((t) => t.id === id);
}

export function trickById(id: string | null | undefined): Trick | null {
  return TRICKS.find((t) => t.id === id) ?? null;
}
