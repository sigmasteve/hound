import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "../components/Text";
import { Button } from "../components/Button";
import { useTheme } from "../theme/ThemeContext";
import { font, withAlpha, type Palette } from "../theme/tokens";
import { GAME_INFO, SLOT_NAME, type GameSlot } from "./fastingGames";
import {
  getFastingGames,
  type FastingGamesState,
  type GameSlotState,
} from "./fastingApi";
import { slotColor } from "./FastingGameScreen";

// Under the Fasting dial (0269): the fast's game slots, with the open
// one's Play button up top, and your Fast Points with the way to the
// boards. Nothing shows before 0269 is run, or when Admin has games off.
export function FastingGamesStrip({
  refreshKey,
  onPlay,
  onOpenBoard,
}: {
  // Changes when the fast does (started, ended), to reload.
  refreshKey: string;
  onPlay: (fastId: string, slot: GameSlot) => void;
  onOpenBoard: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<FastingGamesState | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    getFastingGames()
      .then(setState)
      .catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
      const t = setInterval(() => setNow(Date.now()), 30000);
      return () => clearInterval(t);
    }, [load]),
  );
  useEffect(load, [refreshKey, load]);

  if (!state || !state.on || !state.fast || state.slots.length === 0)
    return null;
  const f = state.fast;
  const hours =
    ((f.endedAt ? new Date(f.endedAt).getTime() : now) -
      new Date(f.startedAt).getTime()) /
    3600000;
  const status = (s: GameSlotState) =>
    s.status === "locked" && hours >= s.at ? "open" : s.status;
  const open = state.slots.find((s) => status(s) === "open");

  return (
    <View style={styles.wrap}>
      {open && (
        <View
          style={[
            styles.card,
            {
              borderColor: withAlpha(slotColor(open.slot, colors.green), 0.55),
            },
          ]}
        >
          <View style={styles.rowBetween}>
            <View
              style={[
                styles.pill,
                {
                  backgroundColor: withAlpha(
                    slotColor(open.slot, colors.green),
                    0.16,
                  ),
                },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  { backgroundColor: slotColor(open.slot, colors.green) },
                ]}
              />
              <Text
                style={[
                  styles.pillText,
                  { color: slotColor(open.slot, colors.green) },
                ]}
              >
                {open.slot === "goal"
                  ? "Goal reached"
                  : `${SLOT_NAME[open.slot]} reached`}
              </Text>
            </View>
            <Text style={styles.small}>{GAME_INFO[open.game].secs}</Text>
          </View>
          <Text style={styles.title}>{GAME_INFO[open.game].name} is open</Text>
          <Text style={styles.small}>
            {GAME_INFO[open.game].teaser} One try
            {f.endedAt
              ? ", for 12 hours after your fast"
              : ", any time this fast"}
            .
          </Text>
          <Button
            label={`Play ${GAME_INFO[open.game].name}`}
            variant="primary"
            block
            onPress={() => onPlay(f.id, open.slot)}
          />
        </View>
      )}
      <View style={styles.slots}>
        {state.slots.map((s) => {
          const st = status(s);
          const col = slotColor(s.slot, colors.green);
          return (
            <Pressable
              key={s.slot}
              disabled={st !== "open"}
              onPress={() => onPlay(f.id, s.slot)}
              style={[
                styles.slot,
                (st === "played" || st === "open") && { borderColor: col },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${SLOT_NAME[s.slot]}: ${st === "played" ? `scored ${s.score}` : st === "open" ? "open" : st === "left" ? "left, 0" : `opens at ${s.at} hours`}`}
            >
              <Text style={[styles.slotValue, st === "open" && { color: col }]}>
                {st === "played"
                  ? s.score
                  : st === "left"
                    ? "0"
                    : st === "open"
                      ? "Play"
                      : `${s.at} h`}
              </Text>
              <Text style={styles.slotLabel} numberOfLines={1}>
                {s.slot === "fatburn" ? "Fat burn" : SLOT_NAME[s.slot]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={onOpenBoard}
        style={styles.points}
        accessibilityRole="button"
      >
        <Text style={styles.small}>
          Fast Points{" "}
          <Text style={styles.strong}>{state.points.toLocaleString()}</Text>
        </Text>
        <Text style={styles.link}>Boards ›</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    card: {
      borderRadius: 16,
      backgroundColor: colors.surface,
      padding: 12,
      gap: 6,
      borderWidth: 1.5,
    },
    rowBetween: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: 99,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    pillText: { fontSize: 12, fontFamily: font.headingSemibold },
    title: {
      fontSize: 17,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    small: {
      fontSize: 12.5,
      lineHeight: 17,
      color: withAlpha(colors.text, 0.62),
    },
    strong: {
      fontSize: 13.5,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    slots: { flexDirection: "row", gap: 6 },
    slot: {
      flex: 1,
      borderRadius: 10,
      backgroundColor: colors.surface,
      paddingVertical: 8,
      alignItems: "center",
      borderWidth: 1.5,
      borderColor: "transparent",
    },
    slotValue: {
      fontSize: 15,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    slotLabel: { fontSize: 11, color: withAlpha(colors.text, 0.6) },
    points: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 2,
    },
    link: {
      fontSize: 13,
      fontFamily: font.headingSemibold,
      color: colors.accentActive,
    },
  });
}
