import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CaretRightIcon, CheckCircleIcon, InfoIcon, WarningIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import type { HealthProvider } from '../health/types';
import { ANDROID_SETUP_CHECKLIST, diagnose, type DataSourcesReport } from '../health/dataSources';

const DAYS = 7;

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Connect screen, Android: which apps shared steps and workouts with
// Health Connect this week, which one Hound's step total counts, notes
// on anything that looks off, and the setup checklist.
export function DataSourcesCard({ health }: { health: HealthProvider }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [report, setReport] = useState<DataSourcesReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  const load = useCallback(() => {
    if (!health.getDataSources) return;
    setFailed(false);
    health
      .getDataSources(DAYS)
      .then(setReport)
      .catch(() => setFailed(true));
  }, [health]);

  useFocusEffect(load);

  if (!health.getDataSources) return null;
  const issues = report ? diagnose(report) : [];

  return (
    <Card style={{ gap: 12, alignSelf: 'stretch' }} elevated={false}>
      <Text style={text.h4}>Where your data comes from</Text>
      <Text style={styles.footNote}>
        Apps that shared with Health Connect in the last {DAYS} days. Hound reads Health Connect, so anything missing here
        can&rsquo;t reach your challenges.
      </Text>

      {failed ? (
        <Text style={styles.warnText}>Couldn&rsquo;t read Health Connect just now. Check Hound&rsquo;s permissions, then refresh.</Text>
      ) : !report ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {report.sources.length === 0 ? (
            <Text style={styles.footNote}>Nothing yet — no app has shared steps or workouts this week.</Text>
          ) : (
            <View style={styles.table}>
              {report.sources.map((s) => (
                <View key={s.packageName} style={styles.row}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.nameRow}>
                      <Text style={styles.name} numberOfLines={1}>
                        {s.name}
                      </Text>
                      {s.countedForSteps && (
                        <View style={styles.countedPill}>
                          <CheckCircleIcon size={11} color={colors.green} weight="fill" />
                          <Text style={styles.countedLabel}>Counted</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.detail}>
                      {s.steps > 0 ? `${s.steps.toLocaleString()} steps` : 'No steps'}
                      {' · '}
                      {s.workouts === 1 ? '1 workout' : `${s.workouts} workouts`}
                      {s.lastAt ? ` · last ${ago(s.lastAt)}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
              <Text style={styles.total}>
                Hound counts {report.countedSteps.toLocaleString()} steps this week — Health Connect&rsquo;s total, with
                overlapping minutes counted once.
              </Text>
            </View>
          )}

          {issues.map((issue, i) => (
            <View key={i} style={[styles.issue, issue.tone === 'warn' && styles.issueWarn]}>
              {issue.tone === 'warn' ? (
                <WarningIcon size={15} color={colors.amber} weight="fill" />
              ) : (
                <InfoIcon size={15} color={colors.accentActive} />
              )}
              <Text style={styles.issueText}>{issue.text}</Text>
            </View>
          ))}
        </>
      )}

      <Pressable style={styles.checklistHeader} onPress={() => setShowChecklist((v) => !v)} accessibilityRole="button">
        <Text style={styles.checklistTitle}>Steps or workouts missing? Setup checklist</Text>
        <CaretRightIcon
          size={15}
          color={withAlpha(colors.text, 0.5)}
          style={{ transform: [{ rotate: showChecklist ? '90deg' : '0deg' }] }}
        />
      </Pressable>
      {showChecklist && (
        <View style={{ gap: 10 }}>
          {ANDROID_SETUP_CHECKLIST.map((item, i) => (
            <View key={item.title} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.stepTitle}>{item.title}</Text>
                <Text style={styles.footNote}>{item.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.buttons}>
        {health.openSettings && (
          <Button label="Open Health Connect" variant="secondary" small onPress={() => health.openSettings?.()} />
        )}
        <Button label="Refresh" variant="ghost" small onPress={load} />
      </View>
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    warnText: { fontSize: 12.5, color: colors.amber },
    table: { gap: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { fontSize: 14.5, fontFamily: font.heading, color: colors.text, flexShrink: 1 },
    countedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: withAlpha(colors.green, 0.14),
    },
    countedLabel: { fontSize: 10.5, fontFamily: font.heading, color: colors.green },
    detail: { fontSize: 12.5, color: withAlpha(colors.text, 0.65), fontVariant: ['tabular-nums'] },
    total: {
      fontSize: 12.5,
      color: withAlpha(colors.text, 0.75),
      paddingTop: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    issue: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      padding: 10,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.08),
    },
    issueWarn: { backgroundColor: withAlpha(colors.amber, 0.12) },
    issueText: { flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 18 },
    checklistHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.08),
    },
    checklistTitle: { fontSize: 13.5, fontFamily: font.heading, color: colors.text },
    step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    stepNum: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.6),
    },
    stepNumText: { fontSize: 11.5, fontFamily: font.heading, color: colors.accentActive },
    stepTitle: { fontSize: 13.5, fontFamily: font.heading, color: colors.text },
    buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  });
}
