import React from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { PlantStage } from './garden';

// Garden plants (0162), drawn standing on the soil at (0, 0) and growing
// upward, about 20 units across. PlantArt is SVG parts for the Yard
// scene; PlantThumb wraps one for a tile.

const STEM = '#4f9a48';
const LEAF = '#5fb456';

// The bud colour, before it opens.
const BUD: Record<string, string> = {
  daisy: '#f4f1e6',
  sunflower: '#f2c443',
  tulip: '#e2525c',
  lavender: '#9b7fd6',
  strawberry: '#f4f1e6',
  rose: '#e04f6f',
  giant_sunflower: '#f2c443',
  pumpkin: '#f0a04b',
  holly: '#c8323c',
  bluebell: '#6f8fe0',
  watermelon: '#7fbf5a',
};

function Stem({ h }: { h: number }) {
  return <Path d={`M0 0 L0 ${-h}`} stroke={STEM} strokeWidth={1.6} strokeLinecap="round" />;
}

function Leaves({ y, s = 1 }: { y: number; s?: number }) {
  return (
    <G>
      <Ellipse cx={-3.5 * s} cy={y} rx={3.5 * s} ry={1.6 * s} fill={LEAF} transform={`rotate(-25 ${-3.5 * s} ${y})`} />
      <Ellipse cx={3.5 * s} cy={y - 1.5} rx={3.5 * s} ry={1.6 * s} fill={LEAF} transform={`rotate(25 ${3.5 * s} ${y - 1.5})`} />
    </G>
  );
}

function Bloom({ id }: { id: string }) {
  switch (id) {
    case 'sunflower':
    case 'giant_sunflower': {
      const big = id === 'giant_sunflower';
      const h = big ? 38 : 27;
      const r = big ? 8.5 : 6;
      return (
        <G>
          <Stem h={h} />
          <Leaves y={-h * 0.45} s={big ? 1.4 : 1.1} />
          <G transform={`translate(0 ${-h})`}>
            {Array.from({ length: 12 }, (_, i) => (
              <Ellipse key={i} cx={0} cy={-r} rx={r * 0.32} ry={r * 0.6} fill="#f2c443" transform={`rotate(${i * 30})`} />
            ))}
            <Circle r={r * 0.55} fill="#7a4a24" />
            <Circle r={r * 0.25} cx={-r * 0.15} cy={-r * 0.15} fill="#9a6232" />
          </G>
        </G>
      );
    }
    case 'daisy':
      return (
        <G>
          <Stem h={15} />
          <Leaves y={-6} />
          <G transform="translate(0 -15)">
            {Array.from({ length: 10 }, (_, i) => (
              <Ellipse key={i} cx={0} cy={-3.2} rx={1.3} ry={2.6} fill="#fbfaf4" transform={`rotate(${i * 36})`} />
            ))}
            <Circle r={1.9} fill="#f4c542" />
          </G>
        </G>
      );
    case 'tulip':
      return (
        <G>
          <Stem h={16} />
          <Ellipse cx={-3} cy={-5} rx={2} ry={5} fill={LEAF} transform="rotate(-20 -3 -5)" />
          <Path d="M-4.5 -16 C-4.5 -24 4.5 -24 4.5 -16 L3 -20 L1.5 -16 L0 -21 L-1.5 -16 L-3 -20 Z" fill="#e2525c" />
          <Path d="M-4.5 -16 C-4 -12 4 -12 4.5 -16 Z" fill="#c43d48" />
        </G>
      );
    case 'lavender':
      return (
        <G>
          {[-4, 0, 4].map((x, j) => (
            <G key={x}>
              <Path d={`M${x * 0.4} 0 L${x} ${-16 - (j === 1 ? 3 : 0)}`} stroke={STEM} strokeWidth={1.2} strokeLinecap="round" />
              {Array.from({ length: 5 }, (_, i) => (
                <Ellipse key={i} cx={x} cy={-12 - i * 2 - (j === 1 ? 3 : 0)} rx={1.5} ry={1.1} fill={i % 2 ? '#9b7fd6' : '#8566c9'} />
              ))}
            </G>
          ))}
        </G>
      );
    case 'strawberry':
      return (
        <G>
          <Ellipse cx={0} cy={-4} rx={9} ry={5} fill={LEAF} />
          <Ellipse cx={-4} cy={-6} rx={3.5} ry={2.2} fill="#6cc463" />
          {[
            [-4, -1],
            [2, -2],
            [6, 0],
          ].map(([x, y]) => (
            <G key={x}>
              <Path d={`M${x - 2} ${y - 1} C${x - 2} ${y + 3} ${x + 2} ${y + 3} ${x + 2} ${y - 1} Z`} fill="#e2404f" />
              <Path d={`M${x - 1.5} ${y - 1.3} L${x + 1.5} ${y - 1.3}`} stroke={STEM} strokeWidth={1} />
            </G>
          ))}
        </G>
      );
    case 'rose':
      return (
        <G>
          <Stem h={18} />
          <Leaves y={-8} />
          <Path d="M0 -12 L1.2 -12.8 M0 -5 L-1.2 -5.8" stroke={STEM} strokeWidth={1} />
          <G transform="translate(0 -20)">
            <Circle r={4.6} fill="#e04f6f" />
            <Path d="M-2.8 0 C-2.8 -3 2.8 -3 2.8 0 C2.8 2 -1 2.5 -1 0.5" stroke="#b83352" strokeWidth={1.1} fill="none" />
            <Circle r={1.2} fill="#b83352" />
          </G>
        </G>
      );
    case 'pumpkin':
      return (
        <G>
          <Path d="M-9 -1 C-6 -5 -2 -3 0 -5" stroke={STEM} strokeWidth={1.3} fill="none" />
          <Ellipse cx={-8} cy={-3} rx={3} ry={1.8} fill={LEAF} />
          <Ellipse cx={1} cy={-5} rx={8} ry={5.5} fill="#e9822f" />
          <Path d="M-2 -10 C-3 -6 -3 -3 -2 0 M4 -10 C5 -6 5 -3 4 0" stroke="#c4651f" strokeWidth={1} fill="none" />
          <Path d="M1 -10.5 L2 -13" stroke="#6a8a3a" strokeWidth={1.8} strokeLinecap="round" />
        </G>
      );
    case 'holly':
      return (
        <G>
          {[
            [-4, -6, -30],
            [4, -7, 30],
            [0, -11, 0],
          ].map(([x, y, r]) => (
            <Path
              key={`${x}${y}`}
              d={`M${x - 4} ${y} L${x - 2.5} ${y - 1.6} L${x - 1} ${y - 0.4} L${x} ${y - 2} L${x + 1} ${y - 0.4} L${x + 2.5} ${y - 1.6} L${x + 4} ${y} L${x + 2.5} ${y + 1.6} L${x} ${y + 1} L${x - 2.5} ${y + 1.6} Z`}
              fill="#2f7d3a"
              transform={`rotate(${r} ${x} ${y})`}
            />
          ))}
          <Circle cx={-1.5} cy={-7.5} r={1.7} fill="#d22f3a" />
          <Circle cx={1.6} cy={-7} r={1.7} fill="#d22f3a" />
          <Circle cx={0} cy={-9.5} r={1.7} fill="#e0414b" />
        </G>
      );
    case 'bluebell':
      return (
        <G>
          <Path d="M0 0 L0 -16 C2 -19 6 -18 7 -15" stroke={STEM} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <Ellipse cx={-3} cy={-5} rx={1.6} ry={5} fill={LEAF} transform="rotate(-15 -3 -5)" />
          {[
            [1.5, -13],
            [4, -15.5],
            [6.8, -13.5],
          ].map(([x, y]) => (
            <Path key={x} d={`M${x - 1.6} ${y} C${x - 1.6} ${y + 3.6} ${x + 1.6} ${y + 3.6} ${x + 1.6} ${y} Z`} fill="#6f8fe0" />
          ))}
        </G>
      );
    case 'watermelon':
      return (
        <G>
          <Path d="M-10 -1 C-7 -4 -4 -2 -2 -4" stroke={STEM} strokeWidth={1.3} fill="none" />
          <Ellipse cx={-9} cy={-3} rx={3} ry={1.8} fill={LEAF} />
          <Ellipse cx={2} cy={-5} rx={9} ry={5.5} fill="#3f8f45" />
          <Path d="M-4 -9.5 C-5 -6 -5 -3 -4 -0.5 M2 -10.5 C1 -6 1 -3 2 0 M8 -9 C9 -6 9 -3 8 -1" stroke="#8bc96a" strokeWidth={1.4} fill="none" />
        </G>
      );
    default:
      return (
        <G>
          <Stem h={14} />
          <Leaves y={-6} />
          <Circle cy={-14} r={3} fill={BUD[id] ?? '#e2525c'} />
        </G>
      );
  }
}

export function PlantArt({ id, stage }: { id: string; stage: PlantStage }) {
  if (stage === 0) {
    return (
      <G>
        <Ellipse cx={0} cy={-0.8} rx={5} ry={2.2} fill="#6b4a2f" />
        <Circle cx={-1.5} cy={-1.8} r={0.8} fill="#e8d7a8" />
        <Circle cx={1.4} cy={-1.4} r={0.8} fill="#e8d7a8" />
      </G>
    );
  }
  if (stage === 1) {
    return (
      <G>
        <Stem h={6} />
        <Ellipse cx={-2.6} cy={-6} rx={2.8} ry={1.4} fill="#7ccc5e" transform="rotate(-30 -2.6 -6)" />
        <Ellipse cx={2.6} cy={-6.5} rx={2.8} ry={1.4} fill="#7ccc5e" transform="rotate(30 2.6 -6.5)" />
      </G>
    );
  }
  if (stage === 2) {
    const ground = id === 'pumpkin' || id === 'watermelon' || id === 'strawberry';
    return ground ? (
      <G>
        <Ellipse cx={0} cy={-3} rx={7} ry={3.6} fill={LEAF} />
        <Ellipse cx={-3} cy={-4.5} rx={3} ry={1.8} fill="#6cc463" />
        <Circle cx={3} cy={-2} r={2.2} fill={BUD[id] ?? '#7fbf5a'} />
      </G>
    ) : (
      <G>
        <Stem h={12} />
        <Leaves y={-5} />
        <Ellipse cx={0} cy={-13.5} rx={2} ry={2.8} fill={BUD[id] ?? '#e2525c'} />
        <Path d="M-1.8 -12.2 L0 -10.6 L1.8 -12.2" stroke={STEM} strokeWidth={1.1} fill="none" />
      </G>
    );
  }
  return <Bloom id={id} />;
}

// A garden bed of 3 plots, centred on (0, 0), for the Yard scene.
export function GardenBedArt({ plots }: { plots: ({ seedId: string; stage: PlantStage } | null)[] }) {
  return (
    <G>
      <Rect x={-34} y={-6} width={68} height={12} rx={4} fill="#8a5a33" />
      <Rect x={-32} y={-5} width={64} height={8} rx={3} fill="#5e3d24" />
      {[-21, 0, 21].map((x, i) => {
        const p = plots[i];
        return (
          <G key={x} transform={`translate(${x} 0)`}>
            {p ? <PlantArt id={p.seedId} stage={p.stage} /> : <Ellipse cx={0} cy={-0.5} rx={4} ry={1.2} fill="#4a301c" />}
          </G>
        );
      })}
    </G>
  );
}

export function PlantThumb({ id, stage, size = 44 }: { id: string; stage: PlantStage; size?: number }) {
  // Room for the tallest at full bloom; everything else sits bigger.
  const tall = stage === 3 && id === 'giant_sunflower' ? 50 : stage === 3 && id === 'sunflower' ? 38 : 28;
  const w = Math.max(26, tall);
  return (
    <Svg width={size} height={size} viewBox={`${-w / 2} ${-tall + 3} ${w} ${tall + 1}`}>
      <Ellipse cx={0} cy={0.5} rx={11} ry={2.6} fill="#6b4a2f" opacity={0.55} />
      <PlantArt id={id} stage={stage} />
    </Svg>
  );
}
