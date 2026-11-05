import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text as NativeText, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from './Text';
import { Card } from './Card';
import { DayCard } from './DayCard';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { MAP_COLS, MAP_ROWS, PACKS, marchable, packOf, type PackId, type Territory } from '../challenges/packWars';

export type MapStyle = 'grid' | 'hood';

export interface PackWarsView {
  day: number;
  days: number;
  map: Territory[];
  myPack: PackId;
  members: Record<PackId, number>;
  // Today: where you voted (null for none, -1 for Hold), and your pack's
  // votes so far by territory (-1 Hold).
  myVote: number | null;
  packVotes: { idx: number; votes: number }[];
  votedToday: number;
  // Last night: territories that changed hands.
  lastNight: { idx: number; to: PackId; from: PackId | null; avg: number; vsAvg: number | null }[];
}

export function PackWarsCard({ view, mapStyle, onVote }: { view: PackWarsView; mapStyle: MapStyle; onVote: (idx: number) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const me = packOf(view.myPack);
  const counts = PACKS.map((p) => ({ pack: p, n: view.map.filter((t) => t.owner === p.id).length }));
  const can = marchable(view.map, view.myPack);
  const taken = new Set(view.lastNight.map((l) => l.idx));
  const nameOf = (idx: number) => (idx === -1 ? 'Hold' : view.map[idx].name);
  const target = view.myVote;

  return (
    <Card style={{ gap: 14 }} elevated={false}>
      <View style={{ gap: 2 }}>
        <Text style={text.h4}>Pack Wars</Text>
        <Text style={styles.meta}>
          Four packs, one map · Day {view.day} of {view.days} · most ground at the end wins
        </Text>
      </View>

      <View style={[styles.myPack, { borderColor: me.color, backgroundColor: withAlpha(me.color, 0.1) }]}>
        <View style={[styles.flag, { backgroundColor: me.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.myPackName}>You’re a {me.name.replace(/s$/, '')}</Text>
          <Text style={styles.meta}>
            {view.members[view.myPack]} in your pack · {view.votedToday} voted today
          </Text>
        </View>
      </View>

      {/* Ground held, as one bar. */}
      <View style={{ gap: 6 }}>
        <View style={styles.bar}>
          {counts.map(({ pack, n }) => (
            <View key={pack.id} style={{ flex: Math.max(n, 0.0001), backgroundColor: pack.color }} />
          ))}
          <View style={{ flex: Math.max(view.map.filter((t) => !t.owner).length, 0.0001), backgroundColor: withAlpha(colors.text, 0.12) }} />
        </View>
        <View style={styles.legend}>
          {counts.map(({ pack, n }) => (
            <View key={pack.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: pack.color }]} />
              <Text style={[styles.legendText, pack.id === view.myPack && styles.legendMine]}>
                {pack.name.split(' ')[0]} {n}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {mapStyle === 'grid' ? (
        <GridMap view={view} can={can} taken={taken} onVote={onVote} />
      ) : (
        <HoodMap view={view} can={can} taken={taken} onVote={onVote} />
      )}

      <View style={styles.vote}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.voteTitle}>TODAY’S MARCH</Text>
          <Text style={styles.voteValue}>{target == null ? 'No vote yet' : target === -1 ? 'Holding our ground' : `Marching on ${nameOf(target)}`}</Text>
          <Text style={styles.meta} numberOfLines={2}>
            Your pack: {view.packVotes.map((v) => `${nameOf(v.idx)} ${v.votes}`).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={() => onVote(-1)} style={[styles.hold, target === -1 && { backgroundColor: me.color, borderColor: me.color }]} accessibilityRole="button">
          <Text style={[styles.holdText, target === -1 && { color: '#fff' }]}>Hold</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>
        Tap a dashed territory next to your ground to vote. Only members who vote add their steps today; the pack goes where most of you voted.
      </Text>

      <DayCard
        title="Last night"
        summary={view.lastNight.length ? `${view.lastNight.length} territories changed hands` : 'Nothing changed hands'}
        defaultOpen
      >
        {view.lastNight.map((l) => {
          const to = packOf(l.to);
          return (
            <View key={l.idx} style={styles.nightRow}>
              <View style={[styles.dot, { backgroundColor: to.color }]} />
              <Text style={styles.nightText}>
                {l.to === view.myPack ? 'You' : to.name} took {nameOf(l.idx)}
                {l.from ? ` from ${l.from === view.myPack ? 'you' : packOf(l.from).name}` : ''}: {l.avg.toLocaleString()} a member
                {l.vsAvg != null ? ` against ${l.vsAvg.toLocaleString()}` : ''}
              </Text>
            </View>
          );
        })}
      </DayCard>
    </Card>
  );
}

// A grid of parks, 6 by 4.
function GridMap({ view, can, taken, onVote }: { view: PackWarsView; can: Set<number>; taken: Set<number>; onVote: (idx: number) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const gap = 4;
  const cell = (Math.min(width, 500) - 32 - 24 - gap * (MAP_COLS - 1)) / MAP_COLS;
  const label = Math.max(8, Math.min(11, cell * 0.19));
  const me = packOf(view.myPack);
  return (
    <View style={[styles.gridWrap, { gap }]}>
      {Array.from({ length: MAP_ROWS }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {view.map.slice(r * MAP_COLS, (r + 1) * MAP_COLS).map((t) => {
            const owner = t.owner ? packOf(t.owner) : null;
            const target = view.myVote === t.idx;
            const open = can.has(t.idx);
            return (
              <Pressable
                key={t.idx}
                disabled={!open}
                onPress={() => onVote(t.idx)}
                style={[
                  styles.tile,
                  { width: cell, height: cell * 1.05, backgroundColor: owner ? owner.wash : '#ece6d6' },
                  open && { borderColor: me.color, borderStyle: 'dashed', borderWidth: 1.5 },
                  target && { borderColor: me.color, borderStyle: 'solid', borderWidth: 3 },
                ]}
              >
                {owner && <View style={[styles.tileBand, { backgroundColor: owner.color }]} />}
                {!owner && <NativeText style={styles.tree}>🌳</NativeText>}
                {taken.has(t.idx) && <NativeText style={styles.spark}>✦</NativeText>}
                <View style={{ paddingHorizontal: 3, paddingBottom: 3 }}>
                  {t.name.split(' ').map((w) => (
                    <NativeText key={w} allowFontScaling={false} numberOfLines={1} style={[styles.tileName, { fontSize: label, lineHeight: label * 1.15 }]}>
                      {w}
                    </NativeText>
                  ))}
                </View>
                {target && (
                  <View style={[styles.paw, { backgroundColor: me.color }]}>
                    <NativeText style={styles.pawText}>🐾</NativeText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// A neighborhood: the same 24 territories as blocks between streets,
// with a river, trees and houses.
function HoodMap({ view, can, taken, onVote }: { view: PackWarsView; can: Set<number>; taken: Set<number>; onVote: (idx: number) => void }) {
  const W = 600;
  const H = 440;
  const me = packOf(view.myPack);
  // A lattice of corners, nudged so the blocks aren't square. Edges stay put.
  const pts = useMemo(() => {
    const out: [number, number][][] = [];
    for (let r = 0; r <= MAP_ROWS; r++) {
      const row: [number, number][] = [];
      for (let c = 0; c <= MAP_COLS; c++) {
        const edgeX = c === 0 || c === MAP_COLS;
        const edgeY = r === 0 || r === MAP_ROWS;
        const jx = edgeX ? 0 : Math.sin(r * 7.1 + c * 3.3) * 22;
        const jy = edgeY ? 0 : Math.cos(r * 5.3 + c * 2.7) * 18;
        row.push([(c / MAP_COLS) * W + jx, (r / MAP_ROWS) * H + jy]);
      }
      out.push(row);
    }
    return out;
  }, []);

  const block = (idx: number) => {
    const r = Math.floor(idx / MAP_COLS);
    const c = idx % MAP_COLS;
    const corners = [pts[r][c], pts[r][c + 1], pts[r + 1][c + 1], pts[r + 1][c]];
    const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
    // Pulled in toward the middle, leaving the streets between.
    const inset = corners.map(([x, y]) => [cx + (x - cx) * 0.86, cy + (y - cy) * 0.84] as [number, number]);
    return { corners: inset, cx, cy };
  };

  return (
    <View style={{ borderRadius: 14, overflow: 'hidden' }}>
      <Svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
        {/* Streets underneath everything. */}
        <Rect x={0} y={0} width={W} height={H} fill="#d9d3c3" />
        {view.map.map((t) => {
          const { corners, cx, cy } = block(t.idx);
          const owner = t.owner ? packOf(t.owner) : null;
          const open = can.has(t.idx);
          const target = view.myVote === t.idx;
          const words = t.name.split(' ');
          return (
            <G key={t.idx} onPress={open ? () => onVote(t.idx) : undefined}>
              <Polygon
                points={corners.map((p) => p.join(',')).join(' ')}
                fill={owner ? owner.wash : '#e8efd9'}
                stroke={target ? me.color : open ? me.color : owner ? owner.color : '#c9d3b4'}
                strokeWidth={target ? 6 : open ? 3 : 2}
                strokeDasharray={open && !target ? '10 7' : undefined}
                strokeLinejoin="round"
              />
              {/* A few trees and rooftops, so it reads as a neighborhood. */}
              <Circle cx={cx - 28} cy={cy - 24} r={7} fill={owner ? withAlpha(owner.color, 0.35) : '#9cc58a'} />
              <Circle cx={cx + 30} cy={cy + 22} r={6} fill={owner ? withAlpha(owner.color, 0.35) : '#9cc58a'} />
              <Rect x={cx + 18} y={cy - 30} width={14} height={11} rx={2} fill={owner ? withAlpha(owner.color, 0.45) : '#c9b99a'} />
              <Rect x={cx - 36} y={cy + 16} width={12} height={10} rx={2} fill={owner ? withAlpha(owner.color, 0.45) : '#c9b99a'} />
              {owner && <Rect x={cx - 22} y={cy - 44} width={44} height={8} rx={4} fill={owner.color} />}
              {words.map((w, i) => (
                <SvgText
                  key={w}
                  x={cx}
                  y={cy + 4 + (i - (words.length - 1) / 2) * 17}
                  fontSize={16}
                  fontFamily={font.headingSemibold}
                  fill="#2b2620"
                  textAnchor="middle"
                >
                  {w}
                </SvgText>
              ))}
              {taken.has(t.idx) && (
                <SvgText x={cx + 34} y={cy - 28} fontSize={20} fill="#2b2620" textAnchor="middle">
                  ✦
                </SvgText>
              )}
              {target && (
                <>
                  <Circle cx={cx} cy={cy + 42} r={13} fill={me.color} />
                  <SvgText x={cx} y={cy + 47} fontSize={14} textAnchor="middle">
                    🐾
                  </SvgText>
                </>
              )}
            </G>
          );
        })}
        {/* The river, along one street, with a bridge. */}
        <Path
          d={`M 0 ${H * 0.5 + 6} C ${W * 0.12} ${H * 0.44}, ${W * 0.22} ${H * 0.58}, ${W * 0.34} ${H * 0.5} S ${W * 0.48} ${H * 0.47}, ${W * 0.52} ${H * 0.52}`}
          stroke="#7fb3d9"
          strokeWidth={12}
          fill="none"
          strokeLinecap="round"
        />
        <Rect x={W * 0.22 - 10} y={H * 0.5 - 14} width={20} height={30} rx={3} fill="#b9ad94" />
      </Svg>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.58) },
    note: { fontSize: 12, color: withAlpha(colors.text, 0.6), lineHeight: 17 },
    myPack: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5 },
    flag: { width: 22, height: 22, borderRadius: 6 },
    myPackName: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    bar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendText: { fontSize: 12, color: withAlpha(colors.text, 0.65), fontVariant: ['tabular-nums'] },
    legendMine: { fontFamily: font.headingSemibold, color: colors.text },
    dot: { width: 10, height: 10, borderRadius: 5 },
    gridWrap: { alignItems: 'center' },
    tile: { borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end', borderWidth: 1, borderColor: 'transparent' },
    tileBand: { position: 'absolute', top: 0, left: 0, right: 0, height: 6 },
    tileName: { fontFamily: font.body, color: '#2b2620' },
    tree: { position: 'absolute', top: 6, right: 4, fontSize: 11 },
    spark: { position: 'absolute', top: 8, left: 4, fontSize: 11, color: '#2b2620' },
    paw: { position: 'absolute', top: 8, right: 3, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    pawText: { fontSize: 10 },
    vote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08) },
    voteTitle: { fontSize: 11, letterSpacing: 0.6, color: withAlpha(colors.text, 0.55), fontFamily: font.headingSemibold },
    voteValue: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    hold: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: withAlpha(colors.text, 0.18) },
    holdText: { fontFamily: font.headingSemibold, fontSize: 13.5, color: colors.text },
    nightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    nightText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.8) },
  });
}
