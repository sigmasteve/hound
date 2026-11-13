import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  DEFAULT_SPORT_BONUS_CONFIG,
  GAME_SPORT,
  gameDayEffect,
  playedForRealTag,
  sportBonusHint,
  strengthEffect,
  type SportBonusConfig,
  type SportGameKind,
} from '../challenges/sportBonus';
import { getSportBonusConfig, getSportBonuses, type SportBonusDay } from '../challenges/sportBonusApi';

// Sport bonuses in the six sports games (0198): your strength workout and
// game day today, the "Played for real" tag on last night's plays, and a
// small sport badge on a hound in the court art.

// One fetch per challenge and day for a minute, shared by the row and the
// tags on the same screen.
const cache = new Map<string, { at: number; p: Promise<SportBonusDay | null> }>();
function fetchBonuses(challengeId: string, day: string | null): Promise<SportBonusDay | null> {
  const key = `${challengeId}:${day ?? 'today'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  // Before 0198 runs (or offline), there's simply nothing to show.
  const p = getSportBonuses(challengeId, day).catch(() => null);
  cache.set(key, { at: Date.now(), p });
  return p;
}

let configP: Promise<SportBonusConfig> | null = null;
function fetchConfig(): Promise<SportBonusConfig> {
  if (!configP) configP = getSportBonusConfig().catch(() => DEFAULT_SPORT_BONUS_CONFIG);
  return configP;
}

export function useSportBonuses(challengeId: string | null | undefined, day: string | null = null): SportBonusDay | null {
  const [data, setData] = useState<SportBonusDay | null>(null);
  useEffect(() => {
    if (!challengeId) return;
    let live = true;
    fetchBonuses(challengeId, day).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [challengeId, day]);
  return data;
}

// Who had a game day on that day (user ids), for the tags and badges.
export function useGameDayIds(challengeId: string | null | undefined, day: string | null): Set<string> {
  const data = useSportBonuses(challengeId, day);
  return useMemo(() => new Set((data?.enabled ? data.players : []).filter((p) => p.gameDay).map((p) => p.userId)), [data]);
}

// Today's line for me, under "your steps today" in each game's card.
export function SportBonusRow({ challengeId, kind, userId }: { challengeId: string | null | undefined; kind: SportGameKind; userId: string | null | undefined }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const data = useSportBonuses(challengeId, null);
  const [cfg, setCfg] = useState<SportBonusConfig>(DEFAULT_SPORT_BONUS_CONFIG);
  useEffect(() => {
    fetchConfig().then(setCfg);
  }, []);
  if (!data || !data.enabled || !userId) return null;
  const me = data.players.find((p) => p.userId === userId);
  if (!me) return null;
  const sport = GAME_SPORT[kind];
  if (me.strength === 0 && !me.gameDay) {
    return (
      <Text style={styles.hint}>
        💪 {sportBonusHint(kind)}
        {me.strengthMin > 0 ? ` (${me.strengthMin} min of strength so far: ${cfg.strength_first_min} gets a bonus.)` : ''}
      </Text>
    );
  }
  return (
    <View style={styles.box} accessibilityLabel="Your workout bonuses today">
      {me.strength > 0 && (
        <Text style={styles.line}>
          💪 <Text style={styles.strong}>Strength {me.strengthMin} min</Text> · {strengthEffect(kind, me.strength, cfg)}
          {me.strength < cfg.strength_max ? (
            <Text style={styles.sub}> · another at {cfg.strength_first_min + cfg.strength_extra_min * me.strength} min</Text>
          ) : null}
        </Text>
      )}
      {me.gameDay && (
        <Text style={styles.line}>
          {sport.emoji} <Text style={styles.strong}>Game day</Text> · {me.workout ?? sport.name} {me.gameDayMin} min · {gameDayEffect(kind, cfg)}
        </Text>
      )}
      <Text style={styles.sub}>Counted tonight, when today plays.</Text>
    </View>
  );
}

// "🏀 Played for real", after a play by someone with a game day.
export function PlayedForReal({ kind }: { kind: SportGameKind }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{playedForRealTag(kind)}</Text>
    </View>
  );
}

// The sport's emoji in a small round badge, for a hound on the court.
export function SportBadge({ kind, size = 16, style }: { kind: SportGameKind; size?: number; style?: object }) {
  return (
    <View
      pointerEvents="none"
      style={[
        { position: 'absolute', right: -3, top: -3, width: size, height: size, borderRadius: size / 2, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
        style,
      ]}
    >
      <Text style={{ fontSize: size * 0.66, lineHeight: size * 0.9 }}>{GAME_SPORT[kind].emoji}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    box: { gap: 4, padding: 10, borderRadius: 10, backgroundColor: withAlpha(colors.green, 0.12) },
    line: { fontSize: 13.5, lineHeight: 19, color: colors.text },
    strong: { fontFamily: font.headingSemibold },
    sub: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    hint: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6) },
    tag: { alignSelf: 'flex-start', marginTop: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(colors.amber, 0.18) },
    tagText: { fontSize: 11.5, fontFamily: font.headingSemibold, color: colors.amber },
  });
}

// One line under a day's report: who played the real sport that day.
export function GameDayLine({
  challengeId,
  day,
  kind,
  nameOf,
}: {
  challengeId: string | null | undefined;
  day: string | null;
  kind: SportGameKind;
  nameOf: (userId: string) => string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ids = useGameDayIds(challengeId, day);
  if (!day || ids.size === 0) return null;
  return (
    <View style={[styles.tag, { flexDirection: 'row', flexWrap: 'wrap' }]}>
      <Text style={styles.tagText}>
        {playedForRealTag(kind)}: {[...ids].map(nameOf).join(', ')}
      </Text>
    </View>
  );
}
