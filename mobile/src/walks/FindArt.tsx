import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

// A small drawing of each walk find (0161), on a 48 × 48 grid. `hidden`
// draws it as a flat silhouette, for kinds not found yet.

type Paint = (hex: string) => string;

const ART: Record<string, (c: Paint) => React.ReactNode> = {
  stick: (c) => (
    <G>
      <Path d="M8 38 L40 12" stroke={c('#8a5a33')} strokeWidth={5} strokeLinecap="round" />
      <Path d="M24 25 L30 30" stroke={c('#8a5a33')} strokeWidth={3.5} strokeLinecap="round" />
      <Path d="M33 18 L36 9" stroke={c('#8a5a33')} strokeWidth={3} strokeLinecap="round" />
      <Ellipse cx={36.5} cy={8.5} rx={3.5} ry={2} fill={c('#6fb35a')} transform="rotate(-30 36.5 8.5)" />
    </G>
  ),
  pebble: (c) => (
    <G>
      <Ellipse cx={24} cy={27} rx={15} ry={11} fill={c('#9aa3ad')} />
      <Ellipse cx={19} cy={23} rx={5} ry={2.5} fill={c('#c3cad1')} />
    </G>
  ),
  feather: (c) => (
    <G>
      <Path d="M14 40 C16 26 26 12 38 8 C38 20 30 32 14 40 Z" fill={c('#e9e4da')} stroke={c('#b9b1a2')} strokeWidth={1.5} />
      <Path d="M12 42 L34 13" stroke={c('#8f8676')} strokeWidth={1.5} strokeLinecap="round" />
    </G>
  ),
  clover: (c) => (
    <G>
      <Path d="M24 26 L24 42" stroke={c('#3f8f45')} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={18} cy={20} r={7} fill={c('#5cb85f')} />
      <Circle cx={30} cy={20} r={7} fill={c('#5cb85f')} />
      <Circle cx={24} cy={12} r={7} fill={c('#5cb85f')} />
    </G>
  ),
  old_ball: (c) => (
    <G>
      <Circle cx={24} cy={24} r={15} fill={c('#c9d45a')} />
      <Path d="M11 18 C18 22 18 30 12 33" stroke={c('#f2f2e8')} strokeWidth={2.5} fill="none" />
      <Path d="M37 15 C30 19 30 29 37 33" stroke={c('#f2f2e8')} strokeWidth={2.5} fill="none" />
      <Circle cx={30} cy={30} r={2.5} fill={c('#9a8f5a')} opacity={0.5} />
    </G>
  ),
  snail_shell: (c) => (
    <G>
      <Circle cx={24} cy={25} r={14} fill={c('#d99a5b')} />
      <Path d="M24 25 m-4 0 a4 4 0 1 1 8 0 a8 8 0 1 1 -16 0 a12 12 0 1 1 24 0" stroke={c('#9c5f2e')} strokeWidth={2} fill="none" />
    </G>
  ),
  marble: (c) => (
    <G>
      <Circle cx={24} cy={24} r={14} fill={c('#5b8fd9')} />
      <Path d="M14 28 C20 20 26 32 34 22" stroke={c('#f4b942')} strokeWidth={3.5} fill="none" strokeLinecap="round" />
      <Circle cx={19} cy={18} r={3} fill={c('#ffffff')} opacity={0.7} />
    </G>
  ),
  heart_stone: (c) => (
    <G>
      <Path d="M24 40 C10 30 8 22 12 16 C16 11 22 13 24 18 C26 13 32 11 36 16 C40 22 38 30 24 40 Z" fill={c('#a7a09a')} />
      <Ellipse cx={17} cy={19} rx={3.5} ry={2} fill={c('#cbc5bf')} />
    </G>
  ),
  four_leaf: (c) => (
    <G>
      <Path d="M24 25 L28 42" stroke={c('#2f7d3a')} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={17} cy={18} r={6.5} fill={c('#3fae4f')} />
      <Circle cx={31} cy={18} r={6.5} fill={c('#3fae4f')} />
      <Circle cx={17} cy={30} r={6.5} fill={c('#3fae4f')} />
      <Circle cx={31} cy={30} r={6.5} fill={c('#3fae4f')} />
      <Circle cx={24} cy={24} r={2.5} fill={c('#f4d35e')} />
    </G>
  ),
  dog_tag: (c) => (
    <G>
      <Circle cx={24} cy={9} r={3} stroke={c('#9aa3ad')} strokeWidth={2} fill="none" />
      <Path d="M24 12 L24 15" stroke={c('#9aa3ad')} strokeWidth={2} />
      <Path d="M24 15 L36 24 L32 40 L16 40 L12 24 Z" fill={c('#e0b84a')} stroke={c('#b48a2a')} strokeWidth={1.5} />
      <Path d="M19 28 L29 28 M20 33 L28 33" stroke={c('#b48a2a')} strokeWidth={1.8} strokeLinecap="round" />
    </G>
  ),
  autumn_leaf: (c) => (
    <G>
      <Path d="M24 6 L28 16 L38 13 L33 22 L42 27 L31 29 L32 39 L24 33 L16 39 L17 29 L6 27 L15 22 L10 13 L20 16 Z" fill={c('#d9622b')} />
      <Path d="M24 14 L24 44" stroke={c('#8a3a17')} strokeWidth={2} strokeLinecap="round" />
    </G>
  ),
  acorn: (c) => (
    <G>
      <Ellipse cx={24} cy={29} rx={10} ry={12} fill={c('#c98a4a')} />
      <Path d="M12 21 C12 13 36 13 36 21 C36 24 12 24 12 21 Z" fill={c('#7a5232')} />
      <Path d="M24 14 L26 8" stroke={c('#7a5232')} strokeWidth={2.5} strokeLinecap="round" />
    </G>
  ),
  golden_acorn: (c) => (
    <G>
      <Ellipse cx={24} cy={29} rx={10} ry={12} fill={c('#f2c443')} />
      <Path d="M12 21 C12 13 36 13 36 21 C36 24 12 24 12 21 Z" fill={c('#c4901d')} />
      <Path d="M24 14 L26 8" stroke={c('#c4901d')} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M20 27 L22 33" stroke={c('#fff4c4')} strokeWidth={2.5} strokeLinecap="round" />
      <Path d="M39 9 L40 12 L43 13 L40 14 L39 17 L38 14 L35 13 L38 12 Z" fill={c('#f2c443')} />
    </G>
  ),
  snowball: (c) => (
    <G>
      <Circle cx={24} cy={25} r={14} fill={c('#f4f8fc')} stroke={c('#c9d8e6')} strokeWidth={1.5} />
      <Circle cx={19} cy={21} r={2} fill={c('#dce7f1')} />
      <Circle cx={29} cy={29} r={2.5} fill={c('#dce7f1')} />
    </G>
  ),
  icicle: (c) => (
    <G>
      <Rect x={9} y={8} width={30} height={5} rx={2.5} fill={c('#dfeaf3')} />
      <Path d="M12 12 L15 32 L18 12 Z M20 12 L24 42 L28 12 Z M30 12 L33 28 L36 12 Z" fill={c('#a9d2ef')} />
    </G>
  ),
  snowflake: (c) => (
    <G stroke={c('#6fb5e6')} strokeWidth={2.5} strokeLinecap="round">
      <Path d="M24 7 L24 41 M9.3 15.5 L38.7 32.5 M9.3 32.5 L38.7 15.5" />
      <Path d="M20 10 L24 14 L28 10 M20 38 L24 34 L28 38 M10 21 L15 21 L13 16 M38 27 L33 27 L35 32 M10 27 L15 27 L13 32 M38 21 L33 21 L35 16" />
    </G>
  ),
  blossom: (c) => (
    <G>
      <Circle cx={24} cy={14} r={7} fill={c('#f7b6c8')} />
      <Circle cx={33.5} cy={21} r={7} fill={c('#f7b6c8')} />
      <Circle cx={30} cy={32} r={7} fill={c('#f7b6c8')} />
      <Circle cx={18} cy={32} r={7} fill={c('#f7b6c8')} />
      <Circle cx={14.5} cy={21} r={7} fill={c('#f7b6c8')} />
      <Circle cx={24} cy={24} r={4.5} fill={c('#f4d35e')} />
    </G>
  ),
  eggshell: (c) => (
    <G>
      <Path d="M10 26 C10 14 18 8 24 8 C30 8 38 14 38 26 L33 22 L29 27 L24 22 L19 27 L15 22 Z" fill={c('#8fd3d9')} />
      <Path d="M11 31 L15 28 L19 32 L24 28 L29 32 L33 28 L37 31 C36 38 31 42 24 42 C17 42 12 38 11 31 Z" fill={c('#8fd3d9')} />
      <Circle cx={18} cy={16} r={1.5} fill={c('#5aa9b0')} />
      <Circle cx={29} cy={36} r={1.5} fill={c('#5aa9b0')} />
    </G>
  ),
  rainbow_feather: (c) => (
    <G>
      <Path d="M14 40 C16 26 26 12 38 8 C38 20 30 32 14 40 Z" fill={c('#e85d75')} />
      <Path d="M17 36 C20 26 27 16 36 11 C35 20 29 29 17 36 Z" fill={c('#f4b942')} />
      <Path d="M20 32 C23 25 28 18 34 14 C33 20 28 27 20 32 Z" fill={c('#5cb85f')} />
      <Path d="M23 28 C25 24 28 20 32 17 C31 21 28 25 23 28 Z" fill={c('#5b8fd9')} />
      <Path d="M12 42 L34 13" stroke={c('#7a6f9a')} strokeWidth={1.5} strokeLinecap="round" />
    </G>
  ),
  wildflower: (c) => (
    <G>
      <Path d="M24 24 L24 43" stroke={c('#3f8f45')} strokeWidth={2.5} strokeLinecap="round" />
      <Ellipse cx={17} cy={36} rx={5} ry={2.5} fill={c('#5cb85f')} transform="rotate(-30 17 36)" />
      <Circle cx={24} cy={11} r={5} fill={c('#b18cf0')} />
      <Circle cx={31} cy={17} r={5} fill={c('#b18cf0')} />
      <Circle cx={24} cy={23} r={5} fill={c('#b18cf0')} />
      <Circle cx={17} cy={17} r={5} fill={c('#b18cf0')} />
      <Circle cx={24} cy={17} r={3.5} fill={c('#f4d35e')} />
    </G>
  ),
  frisbee: (c) => (
    <G>
      <Ellipse cx={24} cy={26} rx={17} ry={8} fill={c('#e8524a')} />
      <Ellipse cx={24} cy={24} rx={12} ry={5} fill={c('#f37b6f')} />
      <Path d="M30 32 L33 30" stroke={c('#b33a33')} strokeWidth={2} strokeLinecap="round" />
    </G>
  ),
  sea_glass: (c) => (
    <G>
      <Path d="M14 18 C18 10 32 10 36 17 C40 24 34 36 25 37 C15 38 9 28 14 18 Z" fill={c('#7fd1b9')} opacity={0.9} />
      <Path d="M18 19 C21 15 26 15 28 17" stroke={c('#e6fbf4')} strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </G>
  ),
};

export function hasFindArt(id: string): boolean {
  return id in ART;
}

export function FindArt({ id, size = 40, hidden = false, hiddenColor = '#888' }: { id: string; size?: number; hidden?: boolean; hiddenColor?: string }) {
  const draw = ART[id] ?? ART.pebble;
  const paint: Paint = hidden ? () => hiddenColor : (hex) => hex;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" opacity={hidden ? 0.35 : 1}>
      {draw(paint)}
    </Svg>
  );
}
