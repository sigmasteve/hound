import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { SlotSymbolArt } from './SlotSymbol';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { SlotSymbol } from '../challenges/slots';

// Paw Slots' shop window (0242): the machine as a picture, mid-jackpot,
// and what the game is in three steps. On the game's card, the invite
// page and the sheet before Join, so people see what they're signing up
// for. The machine to play on is SlotsScreen (same drawing, moving).

const VW = 358;
const VH = 300;
const RX = [20, 130, 240];
// Top, middle and bottom of each reel: three Golden Hounds on the line.
const SHOWN: SlotSymbol[][] = [
  ['paw', 'gold', 'bone'],
  ['ball', 'gold', 'treat'],
  ['hydrant', 'gold', 'collar'],
];

export function SlotsMachinePicture({ width }: { width: number }) {
  const h = (width * VH) / VW;
  return (
    <Svg width={width} height={h} viewBox={`0 0 ${VW} ${VH}`} accessibilityLabel="The Paw Slots machine: three Golden Hounds on the line">
      <Rect x={1.5} y={1.5} width={355} height={297} rx={22} fill="#23263a" stroke="#f0c24a" strokeWidth={3} />
      <Rect x={16} y={62} width={326} height={200} rx={10} fill="#0f1019" />
      {RX.map((x, r) => (
        <G key={x}>
          <Rect x={x} y={66} width={98} height={192} rx={6} fill="#f6f1e4" />
          {SHOWN[r].map((s, row) => (
            <G key={row} transform={`translate(${x + 21} ${70 + row * 64})`}>
              <SlotSymbolArt sym={s} />
            </G>
          ))}
          <Rect x={x} y={66} width={98} height={32} fill="#161826" opacity={0.22} />
          <Rect x={x} y={226} width={98} height={32} fill="#161826" opacity={0.22} />
          <Rect x={x + 2} y={132} width={94} height={60} rx={8} fill="none" stroke="#f0c24a" strokeWidth={4} />
        </G>
      ))}
      <Path d="M18 162 H340" stroke="#e05b5b" strokeWidth={2.5} opacity={0.8} />
      <Circle cx={9} cy={162} r={6.5} fill="#e05b5b" />
      <Rect x={64} y={9} width={230} height={34} rx={10} fill="#2f2340" stroke="#f0c24a" strokeWidth={1.5} />
      <SvgText x={179} y={33} textAnchor="middle" fontSize={19} fontWeight="800" letterSpacing={3} fill="#f0c24a" fontFamily={font.headingSemibold}>
        PAW SLOTS
      </SvgText>
      {Array.from({ length: 14 }, (_, b) => (
        <Circle key={b} cx={22 + b * 24.2} cy={53} r={3.2} fill={b % 2 === 0 ? '#ffe08a' : '#5a4a2a'} />
      ))}
      <SvgText x={22} y={284} fontSize={11} fontWeight="800" letterSpacing={1} fill="#9a9ba6" fontFamily={font.headingSemibold}>
        WIN
      </SvgText>
      <SvgText x={52} y={285} fontSize={16} fontWeight="800" fill="#f0c24a" fontFamily={font.headingSemibold}>
        250
      </SvgText>
      <SvgText x={336} y={284} textAnchor="end" fontSize={13} fontWeight="800" fill="#ffd2a6" fontFamily={font.headingSemibold}>
        JACKPOT
      </SvgText>
    </Svg>
  );
}

// The game in three steps, with the pool.
export function SlotsHowItWorks({ pool }: { pool: number | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const steps = [
    { n: '1', head: 'Walk', body: 'Every 500 steps is a spin, up to 20 a day, plus 2 for a 20-minute workout.' },
    { n: '2', head: 'Spin', body: 'Line up hounds for Paw Coins. Three Golden Hounds pays 250, and the Collar doubles a win.' },
    {
      n: '3',
      head: 'Win Bones',
      body: `Most Paw Coins when it ends wins the biggest share of ${pool != null ? `${pool.toLocaleString('en-US')} Bones` : 'the Bones'}.`,
    },
  ];
  return (
    <View style={{ gap: 8 }}>
      {steps.map((s) => (
        <View key={s.n} style={styles.step}>
          <View style={styles.num}>
            <Text style={styles.numText}>{s.n}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.head}>{s.head}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.free}>Free to play: no money or Bones go in.</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    num: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#f0c24a', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    numText: { fontFamily: font.headingSemibold, fontSize: 13, color: '#161826' },
    head: { fontFamily: font.headingSemibold, fontSize: 14.5, color: colors.text },
    body: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.75) },
    free: { fontSize: 12, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.6) },
  });
}
