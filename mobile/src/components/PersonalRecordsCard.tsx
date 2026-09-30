import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import type { HealthProvider } from '../health/types';
import {
  formatRecordDate,
  formatRecordValue,
  getMyRecords,
  RECORD_KINDS,
  RECORD_TITLE,
  STREAK_DAY_STEPS,
  syncPersonalRecords,
  type PersonalRecord,
} from '../records/personalRecords';
import { RECORD_ICON } from '../records/recordIcons';

// Records set in the last few days get a "New" tag.
const NEW_FOR_MS = 3 * 86_400_000;

// Your data → Personal records (0084_personal_records.sql). Syncs first
// (at most every six hours), then shows what the server has.
export function PersonalRecordsCard({ health, userId }: { health: HealthProvider; userId: string }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [records, setRecords] = useState<PersonalRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await syncPersonalRecords(health, userId);
        try {
          const r = await getMyRecords(userId);
          if (!cancelled) {
            setRecords(r);
            setFailed(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [health, userId]),
  );

  // Before 0084 has run, or offline with nothing loaded: leave it out.
  if (failed && !records) return null;

  const byKind = new Map((records ?? []).map((r) => [r.kind, r]));

  return (
    <Card style={{ gap: 14, padding: 18 }} elevated={false}>
      <Text style={text.h4}>Personal records</Text>
      <View style={styles.grid}>
        {RECORD_KINDS.map((kind) => {
          const r = byKind.get(kind);
          const Icon = RECORD_ICON[kind];
          const isNew = !!r?.updatedAt && Date.now() - new Date(r.updatedAt).getTime() < NEW_FOR_MS;
          return (
            <View key={kind} style={styles.tile}>
              <View style={styles.tileHead}>
                <Icon size={15} color={r ? color.gold : withAlpha(colors.text, 0.35)} weight="fill" />
                <Text style={styles.label} numberOfLines={1}>
                  {RECORD_TITLE[kind]}
                </Text>
              </View>
              <Text style={[styles.value, !r && styles.valueEmpty]} numberOfLines={1}>
                {r ? formatRecordValue(kind, r.value) : '—'}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta} numberOfLines={1}>
                  {r
                    ? `${r.detail ? `${r.detail} · ` : ''}${formatRecordDate(r.achievedOn)}`
                    : records
                      ? 'Not set yet'
                      : 'Loading…'}
                </Text>
                {isNew && (
                  <View style={styles.newPill}>
                    <Text style={styles.newLabel}>New</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.footNote}>
        From your connected health data. A streak day is {STREAK_DAY_STEPS.toLocaleString('en-US')}+ steps. Beat a
        record and your friends see it in their activity feed.
      </Text>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      minWidth: 0,
      gap: 4,
      padding: 12,
      borderRadius: 12,
      backgroundColor: withAlpha(colors.text, 0.04),
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.08),
    },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { fontSize: 12.5, fontFamily: font.heading, color: withAlpha(colors.text, 0.65), flexShrink: 1 },
    value: { fontFamily: font.headingSemibold, fontSize: 19, color: colors.text, fontVariant: ['tabular-nums'] },
    valueEmpty: { color: withAlpha(colors.text, 0.35) },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    meta: { flex: 1, fontSize: 11.5, color: withAlpha(colors.text, 0.55) },
    newPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: withAlpha(color.gold, 0.2) },
    newLabel: { fontSize: 10, fontFamily: font.heading, color: color.gold },
    footNote: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
  });
}
