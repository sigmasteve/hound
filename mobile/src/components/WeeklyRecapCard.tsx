import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BoneIcon, CalendarCheckIcon, FlagCheckeredIcon, FootprintsIcon, TrophyIcon, XIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { stepsChangePct, type WeeklyRecap } from '../home/weeklyRecap';

// Home's start-of-week recap card — four small stats for last week, the
// steps one compared with the week before. Dismissible; HomeScreen
// remembers the dismissal per week.
export function WeeklyRecapCard({
  recap,
  currencyName,
  onDismiss,
}: {
  recap: WeeklyRecap;
  currencyName: string;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const change = stepsChangePct(recap);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <CalendarCheckIcon size={16} color={colors.accentActive} />
        <Text style={styles.title}>Your week in review</Text>
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss weekly recap">
          <XIcon size={14} color={withAlpha(colors.text, 0.5)} />
        </Pressable>
      </View>
      <View style={styles.grid}>
        <Stat
          Icon={FootprintsIcon}
          value={recap.stepsLastWeek === null ? '—' : recap.stepsLastWeek.toLocaleString()}
          label="steps"
          note={
            change === null
              ? undefined
              : change === 0
                ? { text: 'Same as the week before', up: null }
                : { text: `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}% vs week before`, up: change > 0 }
          }
          styles={styles}
          colors={colors}
        />
        <Stat
          Icon={FlagCheckeredIcon}
          value={String(recap.challengesFinished)}
          label={recap.challengesFinished === 1 ? 'challenge finished' : 'challenges finished'}
          styles={styles}
          colors={colors}
        />
        <Stat
          Icon={TrophyIcon}
          value={`+${recap.scoreGained.toLocaleString()}`}
          label="Hound Score"
          styles={styles}
          colors={colors}
        />
        <Stat
          Icon={BoneIcon}
          value={`+${recap.bonesEarned.toLocaleString()}`}
          label={`${currencyName} earned`}
          styles={styles}
          colors={colors}
        />
      </View>
    </View>
  );
}

function Stat({
  Icon,
  value,
  label,
  note,
  styles,
  colors,
}: {
  Icon: React.ComponentType<any>;
  value: string;
  label: string;
  note?: { text: string; up: boolean | null };
  styles: ReturnType<typeof makeStyles>;
  colors: Palette;
}) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={withAlpha(colors.text, 0.55)} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {note && (
        <Text
          style={[
            styles.statNote,
            { color: note.up === null ? withAlpha(colors.text, 0.6) : note.up ? colors.green : colors.amber },
          ]}
        >
          {note.text}
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 15, fontFamily: font.heading, color: colors.text },
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
    stat: { width: '50%', gap: 2, paddingRight: 8 },
    statValue: { fontSize: 18, fontFamily: font.heading, color: colors.text },
    statLabel: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    statNote: { fontSize: 11.5, fontFamily: font.heading },
  });
}
