import type { HoundEars, HoundMarkings, HoundTail } from './kennelItems';

// Your Kennel hound as your avatar (0106_hound_avatar.sql): the hound's
// look is written into equipped_icon_id as a short code, so every avatar
// already carries it.
//
//   hound:<coat>.<ears>.<tail>.<markings>.<neck>.<head>.<face>[.<breed>]
//
// The breed (0132) is only there while one is on, so older codes and
// older builds read the same.

export const HOUND_AVATAR_PREFIX = 'hound:';

export interface HoundAvatarLook {
  coatId: string | null;
  ears: HoundEars;
  tail: HoundTail;
  markings: HoundMarkings;
  neckId: string | null;
  headId: string | null;
  faceId: string | null;
  breedId: string | null;
}

const EARS: HoundEars[] = ['floppy', 'perky', 'short'];
const TAILS: HoundTail[] = ['wavy', 'curly', 'stubby'];
const MARKINGS: HoundMarkings[] = ['none', 'eye_patch', 'spots'];

// Null for anything that isn't a hound code. Unknown parts fall back to
// the default look rather than failing, so a newer code still draws.
export function parseHoundAvatar(iconId: string | null | undefined): HoundAvatarLook | null {
  if (!iconId || !iconId.startsWith(HOUND_AVATAR_PREFIX)) return null;
  const [coat, ears, tail, markings, neck, head, face, breed] = iconId.slice(HOUND_AVATAR_PREFIX.length).split('.');
  return {
    coatId: coat || null,
    ears: EARS.includes(ears as HoundEars) ? (ears as HoundEars) : 'floppy',
    tail: TAILS.includes(tail as HoundTail) ? (tail as HoundTail) : 'wavy',
    markings: MARKINGS.includes(markings as HoundMarkings) ? (markings as HoundMarkings) : 'none',
    neckId: neck || null,
    headId: head || null,
    faceId: face || null,
    breedId: breed || null,
  };
}
