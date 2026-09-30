import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { BellRingingIcon, BellSlashIcon, ClockCounterClockwiseIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { listPushReach, REACH_LABEL, REACH_NOTE, REACH_ORDER, type PushReach, type PushReachRow } from '../admin/pushReach';

const NAMES_SHOWN = 4;

function namesLine(names: string[]): string {
  if (names.length <= NAMES_SHOWN) return names.join(', ');
  return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;
}

// Admin → Push reach: how many people a server push can actually get to,
// and why the rest can't (0081_push_permission.sql). Reloads each time
// Admin comes into view.
export function PushReachCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<PushReachRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listPushReach()
        .then((r) => {
          setRows(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load push reach.'));
    }, []),
  );

  const groups = useMemo(() => {
    if (!rows) return null;
    const by = new Map<PushReach, string[]>();
    for (const r of rows) by.set(r.reach, [...(by.get(r.reach) ?? []), r.name]);
    return REACH_ORDER.filter((k) => by.has(k)).map((k) => ({ reach: k, names: by.get(k)! }));
  }, [rows]);

  const iconFor = (reach: PushReach) =>
    reach === 'reachable' ? (
      <BellRingingIcon size={17} color={colors.green} weight="fill" />
    ) : reach === 'denied' ? (
      <BellSlashIcon size={17} color={colors.amber} />
    ) : (
      <ClockCounterClockwiseIcon size={17} color={withAlpha(colors.text, 0.45)} />
    );

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Push reach</Text>
      <Text style={styles.footNote}>
        Who Hound&rsquo;s pushes can get to. A push only reaches a phone that&rsquo;s allowed notifications and
        registered with Hound, which the app now does on every open.
      </Text>
      {error ? (
        <Text style={styles.loadError}>
          {/admin_push_reach/.test(error) ? 'Run 0081_push_permission.sql to see this.' : error}
        </Text>
      ) : !groups ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Text style={styles.headline}>
            {groups.find((g) => g.reach === 'reachable')?.names.length ?? 0} of {rows!.length} can get push
          </Text>
          {groups.map((g) => (
            <View key={g.reach} style={styles.row}>
              {iconFor(g.reach)}
              <View style={{ flex: 1, gap: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.label}>{REACH_LABEL[g.reach]}</Text>
                  <Text style={styles.count}>{g.names.length}</Text>
                </View>
                <Text style={styles.footNote}>{REACH_NOTE[g.reach]}</Text>
                <Text style={styles.people}>{namesLine(g.names)}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    headline: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.07),
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    label: { fontFamily: font.heading, fontSize: 14.5, color: colors.text, flexShrink: 1 },
    count: { fontFamily: font.heading, fontSize: 14.5, color: withAlpha(colors.text, 0.75) },
    people: { fontSize: 12.5, color: withAlpha(colors.text, 0.75) },
  });
}
