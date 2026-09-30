import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from './Button';
import { Card } from './Card';
import { SegmentedControl } from './SegmentedControl';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  getTrashTalkConfig,
  listTrashTalkReports,
  resolveTrashTalkReport,
  RETENTION_OPTIONS,
  setTrashTalkConfig,
  type TrashTalkConfig,
  type TrashTalkReport,
} from '../social/trashTalk';

const RETENTION_LABEL: Record<number, string> = { 0: 'At end', 3: '3 days', 7: '7 days', 30: '30 days' };

// Admin → Trash talk (0083_trash_talk.sql). Each switch saves the moment
// it's flipped and takes effect everywhere at once: the server checks it
// on every post, and open walls pick it up within 15 seconds.
export function TrashTalkAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [config, setConfig] = useState<TrashTalkConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<TrashTalkReport[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadReports = useCallback(() => {
    listTrashTalkReports()
      .then(setReports)
      .catch(() => setReports(null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      getTrashTalkConfig().then((c) => {
        setConfig(c);
        setLoadFailed(!c);
      });
      loadReports();
    }, [loadReports]),
  );

  const save = async (patch: Partial<TrashTalkConfig>) => {
    if (!config) return;
    const before = config;
    setConfig({ ...config, ...patch });
    setSaving(true);
    setError(null);
    try {
      await setTrashTalkConfig(patch);
    } catch (e) {
      setConfig(before);
      setError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (messageId: string, remove: boolean) => {
    setBusyId(messageId);
    try {
      await resolveTrashTalkReport(messageId, remove);
      setReports((cur) => (cur ? cur.filter((r) => r.messageId !== messageId) : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that — try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Trash talk</Text>
      <Text style={styles.footNote}>
        The message wall on each challenge. Taunts are one-tap lines Hound writes, so they&rsquo;re always safe;
        typed messages are what these switches control.
      </Text>
      {loadFailed ? (
        <Text style={styles.error}>Couldn&rsquo;t load these settings. Has 0083_trash_talk.sql been run?</Text>
      ) : config ? (
        <>
          <ToggleRow
            label="Typed messages"
            note={
              saving
                ? 'Saving…'
                : config.freeTextEnabled
                  ? 'On — turn off to hide every typed message now'
                  : 'Off — taunts only; typed messages hidden'
            }
            value={config.freeTextEnabled}
            onChange={(v) => save({ freeTextEnabled: v })}
          />
          <ToggleRow
            label="Filter swear words"
            note={config.filterProfanity ? 'On — masked like f***' : 'Off'}
            value={config.filterProfanity}
            onChange={(v) => save({ filterProfanity: v })}
          />
          <Text style={styles.footNote}>Slurs are always refused, whatever these are set to.</Text>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Clear a wall after its challenge ends</Text>
            <SegmentedControl
              options={RETENTION_OPTIONS.map((d) => ({ value: String(d), label: RETENTION_LABEL[d] }))}
              value={String(config.retentionDays)}
              onChange={(v) => save({ retentionDays: Number(v) as TrashTalkConfig['retentionDays'] })}
            />
            <Text style={styles.footNote}>
              A daily cleanup deletes finished challenges&rsquo; messages after this, and keeps any one wall to its
              newest 500. Reported messages wait for you here first.
            </Text>
          </View>
        </>
      ) : null}

      {reports && (
        <View style={{ gap: 10 }}>
          <Text style={styles.label}>Reported messages{reports.length > 0 ? ` · ${reports.length}` : ''}</Text>
          {reports.length === 0 ? (
            <Text style={styles.footNote}>Nothing to review.</Text>
          ) : (
            reports.map((r) => (
              <View key={r.messageId} style={styles.report}>
                <Text style={styles.reportBody}>&ldquo;{r.body}&rdquo;</Text>
                <Text style={styles.footNote}>
                  {r.authorName} in {r.challengeName} · reported {r.reportCount === 1 ? 'once' : `${r.reportCount} times`}
                  {r.reasons.length > 0 ? ` · ${r.reasons[0]}` : ''}
                </Text>
                <View style={styles.reportButtons}>
                  <Button
                    label={busyId === r.messageId ? '…' : 'Remove'}
                    variant="primary"
                    small
                    disabled={busyId !== null}
                    onPress={() => resolve(r.messageId, true)}
                  />
                  <Button
                    label="Keep"
                    variant="secondary"
                    small
                    disabled={busyId !== null}
                    onPress={() => resolve(r.messageId, false)}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    error: { fontSize: 12.5, color: colors.amber },
    label: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55) },
    report: {
      gap: 6,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.amber, 0.4),
      backgroundColor: withAlpha(colors.amber, 0.08),
    },
    reportBody: { fontSize: 14, fontFamily: font.heading, color: colors.text },
    reportButtons: { flexDirection: 'row', gap: 8 },
  });
}
