import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { TextField } from './TextField';
import { getMinAppVersion, isBelow, setMinAppVersion } from '../updates/versionGate';
import { Text } from './Text';
import { useFocusEffect } from '@react-navigation/native';
import { CheckCircleIcon, ClockCounterClockwiseIcon } from 'phosphor-react-native';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { groupApps, listActiveApps, sourceCounts, STATUS_LABEL, type ReportedApp } from '../admin/appVersions';

const ACTIVE_DAYS = 14;
const NAMES_SHOWN = 4;

function namesLine(names: string[]): string {
  if (names.length <= NAMES_SHOWN) return names.join(', ');
  return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;
}

// Admin → App versions: everyone who's opened the app recently, grouped
// by the exact build and update they're running (0076_app_version_tracking.sql),
// with who's on the latest code. Reloads each time Admin comes into view.
export function AppVersionsCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [apps, setApps] = useState<ReportedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 0188: the minimum version, and the one being typed.
  const [min, setMin] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listActiveApps(ACTIVE_DAYS)
        .then((a) => {
          setApps(a);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load app versions.'));
      getMinAppVersion()
        .then((m) => {
          setMin(m);
          setDraft(m ?? '');
        })
        .catch(() => {});
    }, []),
  );

  // Who a minimum would send to "Update Hound": anyone whose installed
  // version is below it (unknown versions never are).
  const blockedBy = (v: string) => (apps ?? []).filter((a) => isBelow(a.appVersion, v));
  const draftOk = /^\d+\.\d+\.\d+$/.test(draft.trim());
  const saveMin = (next: string | null) => {
    const blocked = next ? blockedBy(next) : [];
    const go = () => {
      setSaving(true);
      setMinAppVersion(next)
        .then(() => setMin(next))
        .catch((e) => Alert.alert('Couldn’t save it', e instanceof Error ? e.message : 'Try again.'))
        .finally(() => setSaving(false));
    };
    if (!next) return go();
    Alert.alert(
      `Require ${next}?`,
      blocked.length
        ? `${blocked.length} ${blocked.length === 1 ? 'person' : 'people'} active in the last ${ACTIVE_DAYS} days will see “Time to update Hound” until they install ${next}: ${namesLine(blocked.map((a) => a.name))}.`
        : `Nobody active in the last ${ACTIVE_DAYS} days is below ${next}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Require it', style: 'destructive', onPress: go },
      ],
    );
  };

  const summary = useMemo(() => (apps ? groupApps(apps) : null), [apps]);
  // Android phones by where the app came from (0163).
  const sources = useMemo(() => (apps ? sourceCounts(apps) : null), [apps]);
  const sourceLine = (c: { play: number; website: number; unknown: number }) =>
    [c.play && `${c.play} from Play`, c.website && `${c.website} from the website`, c.unknown && `${c.unknown} not known yet`]
      .filter(Boolean)
      .join(' · ');

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>App versions</Text>
      <Text style={styles.footNote}>
        What everyone who&rsquo;s opened Hound in the last {ACTIVE_DAYS} days is running, reported each time the app
        opens. &ldquo;Latest&rdquo; is the newest build and update anyone has reported. An older build needs the
        new TestFlight build installed; an older update just needs the app fully closed and reopened.
      </Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !summary ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Text style={styles.headline}>
            {summary.latestCount} of {apps!.length} on the latest code
          </Text>
          {sources && sources.play + sources.website + sources.unknown > 0 && (
            <Text style={styles.footNote}>
              Android: {sourceLine(sources)}. Play Console only counts the ones from Play.
            </Text>
          )}
          {summary.groups.map((g) => (
            <View key={g.key} style={styles.row}>
              {g.status !== 'latest' ? (
                <ClockCounterClockwiseIcon size={17} color={colors.amber} />
              ) : (
                <CheckCircleIcon size={17} color={colors.green} weight="fill" />
              )}
              <View style={{ flex: 1, gap: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.build}>{g.build}</Text>
                  <Text style={[styles.status, { color: g.status === 'latest' ? colors.green : colors.amber }]}>
                    {STATUS_LABEL[g.status]}
                  </Text>
                </View>
                <Text style={styles.footNote}>{g.update}</Text>
                {g.sources.play + g.sources.website + g.sources.unknown > 0 && (
                  <Text style={styles.footNote}>{sourceLine(g.sources)}</Text>
                )}
                <Text style={styles.people}>
                  {g.people.length} · {namesLine(g.people)}
                </Text>
              </View>
            </View>
          ))}
          {summary.unreported.length > 0 && (
            <View style={styles.row}>
              <ClockCounterClockwiseIcon size={17} color={withAlpha(colors.text, 0.45)} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.build}>Not reported yet</Text>
                <Text style={styles.footNote}>
                  Their app predates version reporting — they&rsquo;ll show up the next time they open it on newer
                  code.
                </Text>
                <Text style={styles.people}>
                  {summary.unreported.length} · {namesLine(summary.unreported)}
                </Text>
              </View>
            </View>
          )}
          {apps!.length === 0 && <Text style={styles.footNote}>Nobody has opened the app in that time.</Text>}

          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
            <Text style={styles.build}>Minimum version</Text>
            <Text style={styles.footNote}>
              {min
                ? `Anyone below ${min} sees “Time to update Hound” with the App Store or download link instead of the app (${blockedBy(min).length} right now). Admins can continue past it.`
                : 'Off: every version can use Hound. Set it once a new build is released on the App Store and the new APK is on the website, to move everyone onto it.'}
            </Text>
            <TextField
              label="Require at least"
              value={draft}
              onChangeText={setDraft}
              placeholder="1.1.0"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
            {draftOk && draft.trim() !== (min ?? '') && (
              <Text style={styles.footNote}>
                Would block {blockedBy(draft.trim()).length} of {apps!.length} active in the last {ACTIVE_DAYS} days.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label={saving ? 'Saving…' : 'Save'} variant="primary" small disabled={saving || !draftOk || draft.trim() === (min ?? '')} onPress={() => saveMin(draft.trim())} />
              </View>
              {min && (
                <View style={{ flex: 1 }}>
                  <Button label="Turn off" variant="secondary" small disabled={saving} onPress={() => saveMin(null)} />
                </View>
              )}
            </View>
          </View>
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
    build: { fontFamily: font.heading, fontSize: 14.5, color: colors.text, flexShrink: 1 },
    status: { fontFamily: font.heading, fontSize: 12 },
    people: { fontSize: 12.5, color: withAlpha(colors.text, 0.75) },
  });
}
