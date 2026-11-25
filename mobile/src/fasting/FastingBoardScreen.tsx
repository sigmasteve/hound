import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeftIcon } from "phosphor-react-native";
import { Text } from "../components/Text";
import { useTheme } from "../theme/ThemeContext";
import { font, withAlpha, type Palette } from "../theme/tokens";
import { getFastingGamesBoard, type GamesBoard } from "./fastingApi";
import { PersonAvatar } from "./FastingParts";

// Fast Points boards (0269): all-time, this week (from Monday) and
// friends. Only people who share their fasting are on them.
type Scope = "all" | "week" | "friends";
const TABS: { key: Scope; label: string; foot: string }[] = [
  {
    key: "all",
    label: "All-time",
    foot: "Every phase game since you started: up to 4 a fast, each scored out of 100.",
  },
  {
    key: "week",
    label: "This week",
    foot: "Since Monday. Starts over every Monday.",
  },
  {
    key: "friends",
    label: "Friends",
    foot: "You and friends who fast and share their numbers.",
  },
];

export function FastingBoardScreen({ onBack }: { onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [scope, setScope] = useState<Scope>("all");
  const [boards, setBoards] = useState<Partial<Record<Scope, GamesBoard>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((s: Scope) => {
    getFastingGamesBoard(s)
      .then((b) => setBoards((x) => ({ ...x, [s]: b })))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load the board."),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(scope);
    }, [load, scope]),
  );

  const b = boards[scope];
  const tab = TABS.find((t) => t.key === scope)!;
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.top}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeftIcon size={20} color={colors.accentActive} />
        </Pressable>
        <Text style={[text.h4, { flex: 1, textAlign: "center" }]}>
          Fast Points
        </Text>
        <View style={{ width: 20 }} />
      </View>
      <View style={styles.body}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setScope(t.key)}
              style={[styles.tab, scope === t.key && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope === t.key }}
            >
              <Text
                style={[
                  styles.tabText,
                  scope === t.key && { color: colors.text },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={styles.small}>{error}</Text>}
        {!b ? (
          !error && (
            <ActivityIndicator
              color={colors.accent}
              style={{ marginTop: 30 }}
            />
          )
        ) : (
          <>
            <View style={styles.me}>
              <Text style={styles.small}>
                {b.me
                  ? `You · #${b.me.rank} of ${b.of}`
                  : "You haven’t played yet"}
                {b.me
                  ? `\n${b.me.games} ${b.me.games === 1 ? "game" : "games"} · avg ${b.me.avg}`
                  : ""}
              </Text>
              <Text style={styles.mePts}>
                {(b.me?.points ?? 0).toLocaleString()}
              </Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              {b.rows.length === 0 ? (
                <Text style={styles.small}>
                  No one’s on this board yet. Games open at each phase of a
                  fast, up to your goal.
                </Text>
              ) : (
                b.rows.map((r) => (
                  <View key={r.id} style={[styles.row, r.me && styles.rowMe]}>
                    <Text style={styles.rank}>{r.rank}</Text>
                    <PersonAvatar p={r} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.me ? "You" : r.name}</Text>
                      <Text style={styles.small}>
                        {r.games} {r.games === 1 ? "game" : "games"} · avg{" "}
                        {r.avg}
                      </Text>
                    </View>
                    <Text style={styles.pts}>{r.points.toLocaleString()}</Text>
                  </View>
                ))
              )}
              <Text style={[styles.small, { marginTop: 10 }]}>{tab.foot}</Text>
            </ScrollView>
          </>
        )}
      </View>
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
    body: { flex: 1, paddingHorizontal: 16, gap: 10 },
    tabs: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 4,
      gap: 4,
    },
    tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
    tabOn: { backgroundColor: withAlpha(colors.text, 0.08) },
    tabText: {
      fontSize: 13,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.6),
    },
    me: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 12,
    },
    mePts: {
      fontSize: 26,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    small: {
      fontSize: 12.5,
      lineHeight: 17,
      color: withAlpha(colors.text, 0.6),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 9,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(colors.text, 0.1),
    },
    rowMe: {
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderRadius: 10,
      borderBottomColor: "transparent",
    },
    rank: {
      width: 24,
      textAlign: "right",
      fontSize: 13,
      fontFamily: font.headingSemibold,
      color: withAlpha(colors.text, 0.55),
    },
    name: {
      fontSize: 14.5,
      fontFamily: font.headingSemibold,
      color: colors.text,
    },
    pts: {
      fontSize: 16,
      fontFamily: font.headingSemibold,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
  });
}
