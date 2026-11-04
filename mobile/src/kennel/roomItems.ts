// The room inside the house (0169, lifestyle phase 4): open to everyone,
// with eight things to buy, each in its own place. Mirrors 0169's
// kennel_items rows by hand (ids, names, prices); buy_kennel_item is the
// real check. How each one looks lives in RoomArt.tsx.

export const ROOM_ITEMS: { id: string; name: string; costBones: number; note: string }[] = [
  { id: 'room_fireplace', name: 'Fireplace', costBones: 900, note: 'Lit in the evening and all winter' },
  { id: 'room_sofa', name: 'Sofa', costBones: 600, note: 'Your hound’s favourite seat' },
  { id: 'room_bookshelf', name: 'Bookshelf', costBones: 350, note: 'Books, and a toy on the top shelf' },
  { id: 'room_photos', name: 'Photo Wall', costBones: 300, note: 'With your hound’s portrait' },
  { id: 'room_cushion', name: 'Fireside Cushion', costBones: 250, note: 'Where your hound naps' },
  { id: 'room_rug', name: 'Cozy Rug', costBones: 200, note: 'A round rug in the middle' },
  { id: 'room_lamp', name: 'Floor Lamp', costBones: 150, note: 'Glows in the evening' },
  { id: 'room_fern', name: 'Potted Fern', costBones: 150, note: 'A bit of green in the corner' },
];

export const isRoomItem = (id: string) => id.startsWith('room_');
