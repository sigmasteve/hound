import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

// The four homemade treats (0169's treat_recipes), drawn small for the
// kitchen and the pantry. A 40 × 40 box.

function Bone({ x, y, w, color, edge, rotate = 0 }: { x: number; y: number; w: number; color: string; edge: string; rotate?: number }) {
  const r = w * 0.17;
  const h = w * 0.22;
  return (
    <G transform={`rotate(${rotate} ${x} ${y})`}>
      <Rect x={x - w / 2 + r} y={y - h / 2} width={w - 2 * r} height={h} fill={color} stroke={edge} strokeWidth={1} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sy) => (
          <Circle key={`${sx}${sy}`} cx={x + sx * (w / 2 - r)} cy={y + sy * r * 0.75} r={r} fill={color} stroke={edge} strokeWidth={1} />
        )),
      )}
      <Rect x={x - w / 2 + r} y={y - h / 2 + 0.6} width={w - 2 * r} height={h - 1.2} fill={color} />
    </G>
  );
}

export function TreatArt({ id, size = 40 }: { id: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {id === 'pumpkin_biscuits' ? (
        <>
          <Bone x={17} y={24} w={24} color="#e69a3e" edge="#b86a1f" rotate={-18} />
          <Bone x={23} y={15} w={20} color="#efad55" edge="#b86a1f" rotate={12} />
          <Circle cx={20} cy={14} r={0.9} fill="#b86a1f" />
          <Circle cx={25} cy={16} r={0.9} fill="#b86a1f" />
          <Circle cx={14} cy={25} r={0.9} fill="#b86a1f" />
        </>
      ) : id === 'pb_pupcake' ? (
        <>
          <Path d="M 9 22 L 31 22 L 28 36 L 12 36 Z" fill="#7a4b2a" />
          {[13, 17, 21, 25, 29].map((x) => (
            <Path key={x} d={`M ${x} 22 L ${x - 1} 36`} stroke="#5c361d" strokeWidth={1} />
          ))}
          <Path d="M 7 23 Q 8 13 20 12 Q 32 13 33 23 Q 20 26 7 23 Z" fill="#d9a066" />
          <Path d="M 12 18 Q 20 15 28 18" stroke="#c48a4e" strokeWidth={1.2} fill="none" />
          <Bone x={20} y={10} w={14} color="#f4ead8" edge="#c9b89a" rotate={-8} />
        </>
      ) : id === 'frosty_paws' ? (
        <>
          <Path d="M 9 20 L 31 20 L 28 36 L 12 36 Z" fill="#8fc3e8" />
          <Path d="M 9 20 L 31 20 L 30.4 23 L 9.6 23 Z" fill="#6aa9d6" />
          <Path d="M 8 20 Q 9 11 16 11 Q 17 6 22 7 Q 28 8 27 12 Q 33 13 32 20 Z" fill="#fbf7ef" />
          <Path d="M 14 15 Q 20 12 26 15" stroke="#e8dfcf" strokeWidth={1.2} fill="none" />
          <Ellipse cx={20} cy={30} rx={3} ry={2.4} fill="#ffffff" />
          {[-3.4, -1.2, 1.2, 3.4].map((dx, i) => (
            <Circle key={i} cx={20 + dx} cy={i === 0 || i === 3 ? 27.2 : 26.2} r={1} fill="#ffffff" />
          ))}
        </>
      ) : (
        <>
          <Rect x={7} y={24} width={26} height={11} rx={2} fill="#f6d2dc" />
          <Rect x={11} y={16} width={18} height={9} rx={2} fill="#fbe3ea" />
          <Path d="M 7 26 Q 10 29 13 26 Q 16 29 20 26 Q 24 29 27 26 Q 30 29 33 26" stroke="#e37f9c" strokeWidth={2} fill="none" />
          <Path d="M 11 18 Q 14 21 17 18 Q 20 21 23 18 Q 26 21 29 18" stroke="#e37f9c" strokeWidth={1.8} fill="none" />
          <Rect x={19} y={9} width={2} height={7} fill="#6aa9d6" />
          <Path d="M 20 4 Q 22.5 7 20 9 Q 17.5 7 20 4 Z" fill="#f2b43a" />
          <Circle cx={12} cy={31} r={1} fill="#e37f9c" />
          <Circle cx={20} cy={32} r={1} fill="#6aa9d6" />
          <Circle cx={28} cy={31} r={1} fill="#f2b43a" />
        </>
      )}
    </Svg>
  );
}
