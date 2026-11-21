import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getStepStoryOverview, type StepStoryOverview } from '../challenges/stepStoryApi';

// Admin → Step challenges (0233): Most steps' race, yesterday's replay,
// rivals, bounties, checkpoints, the Blackout and the finish, and the
// Distance pool's trail. Who saw each, this week.
export function StepStoryAdminCard({ onChanged }: { onChanged?: (o: StepStoryOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<StepStoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getStepStoryOverview()
        .then((d) => {
          setData(d);
          setError(null);
          onChanged?.(d);
        })
        .catch((e) =>
          setError(
            e instanceof Error && /admin_step_story_overview/.test(e.message)
              ? 'Run 0233_step_story.sql to see these numbers.'
              : e instanceof Error
                ? e.message
                : 'Could not load the step challenge numbers.',
          ),
        );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const rows: [string, string][] = data
    ? [
        ['On now', `${data.liveSteps} Most steps · ${data.livePools} Distance pools`],
        ['Most steps options, on now', `${data.liveBlackout} with a Blackout · ${data.liveNoRivals} without rivals · ${data.liveNoBounties} without bounties`],
        ['Saw any of it this week', `${data.people7d}`],
        ['Watched the race', `${data.racePeople7d} ${data.racePeople7d === 1 ? 'person' : 'people'} · ${data.raceDays7d} days`],
        ['Watched yesterday’s replay', `${data.replayPeople7d} ${data.replayPeople7d === 1 ? 'person' : 'people'} · ${data.replays7d} replays`],
        ['Rivals beaten · bounty stars · checkpoints first', `${data.rivalsBeaten7d} · ${data.bountyStars7d} · ${data.checkpoints7d}`],
        ['Saw a finish · walked a pool’s trail', `${data.finishPeople7d} · ${data.trailPeople7d}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Step challenges</Text>
      <Text style={styles.footNote}>Most steps as a race, with a daily rival, bounties, checkpoints and the finish; the Distance pool as a trail. Counted once a day per person.</Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
  });
}
