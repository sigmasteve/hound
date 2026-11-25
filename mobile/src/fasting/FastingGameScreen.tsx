import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeftIcon } from "phosphor-react-native";
import { Text } from "../components/Text";
import { Button } from "../components/Button";
import { useTheme } from "../theme/ThemeContext";
import { font, withAlpha, type Palette } from "../theme/tokens";
import { STAGE_COLOR } from "./fasting";
import { GAME_INFO, SLOT_NAME, type GameSlot } from "./fastingGames";
import {
  finishFastingGame,
  startFastingGame,
  type GameFinish,
  type GameRun,
} from "./fastingApi";
import { GamePlay, type FinishLines } from "./FastingGamesPlay";

// One phase game (0269): starts the slot's run on the server (the day's
// game and seed), plays it, sends the numbers, and shows the score.
export function slotColor(slot: GameSlot, green: string): string {
  return slot === "goal" ? green : STAGE_COLOR[slot];
}

export function FastingGameScreen({
  fastId,
  slot,
  onBack,
  onOpenBoard,
}: {
  fastId: string;
  slot: GameSlot;
  onBack: () => void;
  onOpenBoard: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [run, setRun] = useState<GameRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    (GameFinish & { lines: FinishLines }) | null
  >(null);
  const [sending, setSending] = useState(false);
  const playing = useRef(false);
  const accent = slotColor(slot, colors.green);

  useEffect(() => {
    startFastingGame(fastId, slot)
      .then(setRun)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not start the game."),
      );
  }, [fastId, slot]);

  const back = () => {
    if (!run || result || !playing.current) return onBack();
    Alert.alert(
      "Leave the game?",
      "Come back within 15 minutes to play it. After that it counts as played, with 0.",
      [
        { text: "Keep playing", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: onBack },
      ],
    );
  };

  const finish = (stats: Record<string, number>, lines: FinishLines) => {
    if (!run) return;
    playing.current = false;
    setSending(true);
    finishFastingGame(run.id, stats)
      .then((r) => setResult({ ...r, lines }))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not save your score."),
      )
      .finally(() => setSending(false));
  };

  const info = run ? GAME_INFO[run.game] : null;
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Pressable
          onPress={back}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: "center" }]}>
          {info?.name ?? "Fasting game"}
        </Text>
        <View style={{ width: 20 }} />
      </View>
      <View style={styles.body}>
        <View
          style={[styles.pill, { backgroundColor: withAlpha(accent, 0.16) }]}
        >
          <View style={[styles.pillDot, { backgroundColor: accent }]} />
          <Text style={[styles.pillText, { color: accent }]}>
            {SLOT_NAME[slot]}
          </Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        {!run && !error && (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        )}
        {run && info && !result && (
          <>
            <Text style={styles.how}>{info.how}</Text>
            <View
              style={{ flex: 1 }}
              onTouchStart={() => {
                playing.current = true;
              }}
            >
              <GamePlay
                game={run.game}
                seed={run.seed}
                accent={accent}
                onFinish={finish}
              />
            </View>
            {sending && <ActivityIndicator color={colors.accent} />}
          </>
        )}
        {result && (
          <View style={styles.result}>
            {result.timedOut ? (
              <Text style={styles.how}>
                That run was left for over 15 minutes, so it counts as played,
                with 0.
              </Text>
            ) : (
              <>
                <Text style={styles.of}>Score</Text>
                <Text style={styles.big}>{result.score}</Text>
                <Text style={styles.of}>
                  out of 100
                  {result.topPct !== null
                    ? ` · top ${result.topPct}% today`
                    : " · first to play today"}
                </Text>
                <View style={styles.stats}>
                  {[
                    ...result.lines,
                    [`+${result.score}`, "Fast Points"] as [string, string],
                    [`+${result.bones}`, "Bones"] as [string, string],
                  ].map(([a, b]) => (
                    <View key={b} style={styles.stat}>
                      <Text style={styles.statValue}>{a}</Text>
                      <Text style={styles.of}>{b}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.of}>
                  {result.points.toLocaleString()} Fast Points all-time
                </Text>
              </>
            )}
          </View>
        )}
      </View>
      {result && (
        <View style={styles.pinned}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Boards"
              block
              style={{ flex: 1 }}
              onPress={onOpenBoard}
            />
            <Button
              label="Done"
              variant="primary"
              block
              style={{ flex: 1 }}
              onPress={onBack}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    top: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 8,
      gap: 12,
    },
    body: { flex: 1, paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    pill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 99,
    },
    pillDot: { width: 7, height: 7, borderRadius: 4 },
    pillText: { fontSize: 12.5, fontFamily: font.headingSemibold },
    how: { fontSize: 14, lineHeight: 20, color: withAlpha(colors.text, 0.65) },
    error: { fontSize: 14, color: colors.amber },
    result: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
    of: {
      fontSize: 13,
      color: withAlpha(colors.text, 0.6),
      textAlign: "center",
    },
    big: {
      fontSize: 72,
      lineHeight: 78,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    stats: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginVertical: 14,
      justifyContent: "center",
    },
    stat: {
      width: "47%",
      borderRadius: 12,
      backgroundColor: colors.surface,
      padding: 10,
      alignItems: "center",
    },
    statValue: {
      fontSize: 19,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    pinned: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
  });
}
