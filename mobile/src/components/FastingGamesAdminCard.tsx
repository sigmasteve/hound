import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "./Text";
import { Card } from "./Card";
import { useTheme } from "../theme/ThemeContext";
import { font, withAlpha, type Palette } from "../theme/tokens";
import {
  getFastingGamesOverview,
  type FastingGamesOverview,
} from "../fasting/fastingApi";
import { GAME_INFO, type GameKind } from "../fasting/fastingGames";

// Admin → Overview → Fitness → Fasting games (0269): who's tried the phase
// games, who plays now, and how each game scores.
export function fastingGamesSummary(d: FastingGamesOverview): string {
  if (!d.gamesOn) return "Off";
  return `${d.players} played · ${d.games7d} games this week`;
}

export function FastingGamesAdminCard({
  onLoaded,
}: {
  onLoaded?: (d: FastingGamesOverview) => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<FastingGamesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;

  useFocusEffect(
    useCallback(() => {
      getFastingGamesOverview()
        .then((d) => {
          setData(d);
          setError(null);
          loaded.current?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_fasting_games_overview/.test(e.message)
              ? "Run 0269_fasting_games.sql to see these numbers."
              : e instanceof Error
                ? e.message
                : "Could not load the games numbers.",
          ),
        );
    }, []),
  );

  const games = (["craving", "pour", "burn", "clarity", "refeed"] as GameKind[])
    .map((g) => {
      const x = data?.byGame[g];
      return `${GAME_INFO[g].name}: ${x ? `${x.n} · avg ${x.avg}` : "0"}`;
    })
    .join("\n");
  const rows: [string, string, boolean?][] = data
    ? [
        [
          "Games",
          data.gamesOn
            ? `On · ${data.gameBones} Bones a game (Admin → Bones → Fasting)`
            : "Off (Admin → Bones → Fasting)",
          !data.gamesOn,
        ],
        ["Have played", `${data.players}`],
        [
          "Played in the last 7 days",
          `${data.players7d} people · ${data.games7d} games`,
        ],
        [
          "Games per fast, 7 days",
          data.fasts7d ? `${data.gamesPerFast7d} (${data.fasts7d} fasts)` : "—",
        ],
        ["By game, 7 days (plays · avg score)", games],
        ["Left unfinished, 7 days", `${data.left7d}`],
        ["Fast Points, all-time", data.pointsAll.toLocaleString()],
        ["Bones paid, 7 days", data.bones7d.toLocaleString()],
        [
          "Top all-time",
          data.top.length
            ? data.top
                .map(
                  (t) => `${t.name} ${t.points.toLocaleString()} (${t.games})`,
                )
                .join("\n")
            : "—",
        ],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Fasting games</Text>
      <Text style={styles.footNote}>
        A short game at each phase of a fast up to its goal (4 a fast at most),
        scored out of 100. Fast Points are the scores added up.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value, warn]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.value, warn && { color: colors.amber }]}>
              {value}
            </Text>
          </View>
        ))
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    row: {
      gap: 2,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
