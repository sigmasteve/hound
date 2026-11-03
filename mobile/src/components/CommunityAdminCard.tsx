import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { SegmentedControl } from './SegmentedControl';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import {
  adminListCommunity,
  adminReviewCommunity,
  adminSetCommunityConfig,
  formatCode,
  getCommunityConfig,
  type AdminCommunityAction,
  type AdminCommunityRow,
  type CommunityConfig,
} from '../challenges/communityApi';

const STATE_LABEL: Record<AdminCommunityRow['state'], string> = {
  pending: 'Waiting for approval',
  listed: 'Code works',
  hidden: 'Paused by reports',
  removed: 'Removed',
};

const NUMBERS: { key: keyof CommunityConfig; label: string }[] = [
  { key: 'min_level', label: 'Level to publish' },
  { key: 'min_account_days', label: 'Account age to publish (days)' },
  { key: 'max_live', label: 'Live per creator' },
  { key: 'max_per_week', label: 'Published per creator a week' },
  { key: 'max_players', label: 'Players per challenge' },
  { key: 'max_joined', label: 'Joined at once per member' },
  { key: 'report_threshold', label: 'Reports that pause one' },
  { key: 'wrong_codes_per_hour', label: 'Wrong codes an hour' },
];

// Admin → Social → Community challenges (K-04, 0152): the switches, the
// limits, and the queue of ones waiting, paused or reported.
export function CommunityAdminCard({ onQueueChange }: { onQueueChange?: (n: number) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [config, setConfig] = useState<CommunityConfig | null>(null);
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [rows, setRows] = useState<AdminCommunityRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showLimits, setShowLimits] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<keyof CommunityConfig, string>>>({});

  const load = useCallback(() => {
    getCommunityConfig().then(setConfig).catch(() => setConfig(null));
    adminListCommunity(filter)
      .then((r) => {
        setRows(r);
        if (filter === 'review') onQueueChange?.(r.length);
      })
      .catch(() => setRows([]));
  }, [filter, onQueueChange]);

  useEffect(load, [load]);

  if (config === null) return null;

  const setSwitch = (key: 'enabled' | 'pre_review' | 'age_gate', value: boolean) => {
    setConfig({ ...config, [key]: value });
    adminSetCommunityConfig({ [key]: value }).catch((e) => {
      setConfig(config);
      Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.');
    });
  };

  const saveLimits = () => {
    const patch: Partial<CommunityConfig> = {};
    for (const { key } of NUMBERS) {
      const v = draft[key];
      if (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v))) (patch as any)[key] = Math.max(0, Math.round(Number(v)));
    }
    adminSetCommunityConfig(patch)
      .then(() => {
        setDraft({});
        load();
      })
      .catch((e) => Alert.alert('Couldn’t save the limits', e instanceof Error ? e.message : 'Try again.'));
  };

  const act = (row: AdminCommunityRow, action: AdminCommunityAction) => {
    const run = () => {
      setBusyId(row.id);
      adminReviewCommunity(row.id, action)
        .then(load)
        .catch((e) => Alert.alert('Couldn’t do that', e instanceof Error ? e.message : 'Try again.'))
        .finally(() => setBusyId(null));
    };
    if (action === 'remove') {
      Alert.alert(
        `Remove “${row.name}”?`,
        `It ends for everyone with no results, and @${row.creator} can’t publish for 30 days (a second removal is for good).`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: run },
        ],
      );
    } else run();
  };

  const switches: { key: 'enabled' | 'pre_review' | 'age_gate'; label: string; note: string }[] = [
    { key: 'enabled', label: 'Community challenges on', note: 'Off: nobody can publish or use a code.' },
    { key: 'pre_review', label: 'Approve each new one', note: 'On: a new code works only once you approve it.' },
    { key: 'age_gate', label: '13+ check', note: 'On: a one-time "I’m 13 or older", and no codes for school organizations that haven’t opted in.' },
  ];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Community challenges</Text>
      {switches.map((s) => (
        <View key={s.key} style={styles.switchRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.label}>{s.label}</Text>
            <Text style={styles.note}>{s.note}</Text>
          </View>
          <Switch
            value={config[s.key]}
            onValueChange={(v) => setSwitch(s.key, v)}
            trackColor={{ true: colors.accent, false: withAlpha(colors.text, 0.2) }}
          />
        </View>
      ))}

      <Pressable onPress={() => setShowLimits((v) => !v)} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>{showLimits ? 'Hide the limits' : 'Change the limits'}</Text>
      </Pressable>
      {showLimits && (
        <View style={{ gap: 8 }}>
          {NUMBERS.map(({ key, label }) => (
            <View key={key} style={styles.limitRow}>
              <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
              <TextInput
                maxFontSizeMultiplier={1.3}
                keyboardType="number-pad"
                value={draft[key] ?? String(config[key])}
                onChangeText={(t) => setDraft((d) => ({ ...d, [key]: t }))}
                style={styles.limitInput}
              />
            </View>
          ))}
          <Button label="Save the limits" variant="primary" small onPress={saveLimits} />
        </View>
      )}

      <SegmentedControl
        options={[
          { value: 'review', label: 'Needs a look' },
          { value: 'all', label: 'All recent' },
        ]}
        value={filter}
        onChange={(v) => setFilter(v as 'review' | 'all')}
      />
      {rows === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : rows.length === 0 ? (
        <Text style={styles.note}>{filter === 'review' ? 'Nothing waiting, paused or reported.' : 'None yet.'}</Text>
      ) : (
        rows.map((r) => {
          const type = CHALLENGE_TYPES.find((t) => t.id === r.kind);
          const actions: { action: AdminCommunityAction; label: string }[] = [];
          if (r.state === 'pending') actions.push({ action: 'approve', label: 'Approve' });
          if (r.state === 'hidden') actions.push({ action: 'restore', label: 'Restore' });
          if (r.state === 'listed') actions.push({ action: r.featured ? 'unfeature' : 'feature', label: r.featured ? 'Unfeature' : 'Feature' });
          if (r.state !== 'removed') actions.push({ action: 'remove', label: 'Remove' });
          return (
            <View key={r.id} style={styles.row}>
              <Text style={styles.name}>{r.name}</Text>
              <Text style={styles.note}>
                {type?.name ?? r.kind} · by @{r.creator} · {r.participantCount} joined · {formatCode(r.code)}
              </Text>
              {r.description ? <Text style={styles.desc}>{r.description}</Text> : null}
              <Text style={[styles.note, { color: r.state === 'listed' ? colors.green : colors.amber }]}>
                {STATE_LABEL[r.state]}
                {r.featured ? ' · featured' : ''}
                {r.codeOff ? ' · code off by creator' : ''}
                {r.reportCount > 0 ? ` · ${r.reportCount} report${r.reportCount === 1 ? '' : 's'} (${r.reasons.join(', ')})` : ''}
              </Text>
              <View style={styles.actions}>
                {busyId === r.id ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  actions.map((a) => (
                    <Button
                      key={a.action}
                      label={a.label}
                      small
                      variant={a.action === 'remove' ? 'ghost' : 'primary'}
                      onPress={() => act(r, a.action)}
                    />
                  ))
                )}
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    label: { fontSize: 14.5, color: colors.text, fontFamily: font.body },
    note: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    link: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive },
    limitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    limitInput: {
      width: 72,
      textAlign: 'right',
      fontSize: 15,
      color: colors.text,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.2),
    },
    row: { gap: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    name: { fontFamily: font.headingSemibold, fontSize: 15, color: colors.text },
    desc: { fontSize: 13.5, color: colors.text },
    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  });
}
