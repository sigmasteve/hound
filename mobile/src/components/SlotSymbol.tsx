import React from 'react';
import { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { SlotSymbol } from '../challenges/slots';
import { font } from '../theme/tokens';

// Paw Slots' symbols (0242), drawn on a 56 × 56 tile inside an Svg: the
// machine, its paytable and Today's pinned view.
export function SlotSymbolArt({ sym }: { sym: SlotSymbol }) {
  switch (sym) {
    case 'gold':
      return (
        <G>
          <Ellipse cx={12} cy={27} rx={7} ry={13} fill="#b8862a" />
          <Ellipse cx={44} cy={27} rx={7} ry={13} fill="#b8862a" />
          <Ellipse cx={28} cy={28} rx={15} ry={16} fill="#f0c24a" />
          <Ellipse cx={28} cy={37} rx={9} ry={7} fill="#f7dc8a" />
          <Ellipse cx={28} cy={33} rx={4} ry={3} fill="#161826" />
          <Circle cx={22} cy={25} r={2} fill="#161826" />
          <Circle cx={34} cy={25} r={2} fill="#161826" />
          <Path d="M20 10 L22 14 M28 7 L28 11 M36 10 L34 14" stroke="#b8862a" strokeWidth={2} strokeLinecap="round" />
        </G>
      );
    case 'bone':
      return (
        <G>
          <Line x1={16} y1={40} x2={40} y2={16} stroke="#e8d9b4" strokeWidth={9} strokeLinecap="round" />
          <Circle cx={11.5} cy={37.5} r={6} fill="#e8d9b4" />
          <Circle cx={18.5} cy={44.5} r={6} fill="#e8d9b4" />
          <Circle cx={37.5} cy={11.5} r={6} fill="#e8d9b4" />
          <Circle cx={44.5} cy={18.5} r={6} fill="#e8d9b4" />
        </G>
      );
    case 'ball':
      return (
        <G>
          <Circle cx={28} cy={28} r={16} fill="#b9d33a" />
          <Path d="M17 17 Q27 28 17 39" stroke="#ffffff" strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <Path d="M39 17 Q29 28 39 39" stroke="#ffffff" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </G>
      );
    case 'treat':
      return (
        <G>
          <Circle cx={28} cy={28} r={16} fill="#c08a52" />
          <Circle cx={28} cy={28} r={12.5} fill="#cf9a62" />
          <Circle cx={22} cy={23} r={2} fill="#7a5230" />
          <Circle cx={33} cy={21} r={2} fill="#7a5230" />
          <Circle cx={31} cy={32} r={2} fill="#7a5230" />
          <Circle cx={21} cy={33} r={2} fill="#7a5230" />
          <Circle cx={37} cy={29} r={1.6} fill="#7a5230" />
        </G>
      );
    case 'hydrant':
      return (
        <G>
          <Path d="M18 21 Q28 8 38 21 Z" fill="#e05b5b" />
          <Circle cx={28} cy={10} r={3} fill="#b03a3a" />
          <Rect x={19} y={21} width={18} height={23} fill="#e05b5b" />
          <Rect x={15} y={44} width={26} height={5} fill="#b03a3a" />
          <Rect x={12} y={26} width={7} height={7} fill="#b03a3a" />
          <Rect x={37} y={26} width={7} height={7} fill="#b03a3a" />
          <Circle cx={28} cy={30} r={3} fill="#b03a3a" />
        </G>
      );
    case 'paw':
      return (
        <G fill="#7d6fd0">
          <Ellipse cx={28} cy={36} rx={10} ry={8} />
          <Ellipse cx={16} cy={24} rx={4} ry={5.5} />
          <Ellipse cx={23} cy={16} rx={4} ry={5.5} />
          <Ellipse cx={33} cy={16} rx={4} ry={5.5} />
          <Ellipse cx={40} cy={24} rx={4} ry={5.5} />
        </G>
      );
    case 'collar':
      return (
        <G>
          <Circle cx={28} cy={28} r={19} fill="#4f7be0" />
          <Circle cx={28} cy={28} r={13} fill="#2c4f9e" />
          <Circle cx={28} cy={49} r={5} fill="#f0c24a" />
          <SvgText fontFamily={font.headingSemibold} x={28} y={33} textAnchor="middle" fontSize={14} fontWeight="800" fill="#ffffff">
            2×
          </SvgText>
        </G>
      );
  }
}
