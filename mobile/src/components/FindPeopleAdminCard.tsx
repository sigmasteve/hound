import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from './Button';
import { Card } from './Card';
import { ToggleRow } from './Selectable';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import { getDiscoveryConfig, setDiscoveryConfig, type DiscoveryConfig } from '../friends/discovery';

// Admin → Find people: switches the Friends tab's search and "People you
// may know" on or off for everyone, and holds the beta download links the
// invite page and share message use (0080_friend_discovery.sql).
export function FindPeopleAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [config, setConfig] = useState<DiscoveryConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getDiscoveryConfig().then((c) => {
        setConfig(c);
        setLoadFailed(!c);
      });
    }, []),
  );

  const update = (patch: Partial<DiscoveryConfig>) => {
    setConfig((cur) => (cur ? { ...cur, ...patch } : cur));
    setSaved(false);
  };

  const save = async () => {
    if (!config) return;
    for (const url of [config.iosBetaUrl, config.androidBetaUrl]) {
      if (url && url.trim() && !/^https:\/\//i.test(url.trim())) {
        setError('Links need to start with https://');
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await setDiscoveryConfig(config);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Find people</Text>
      <Text style={styles.footNote}>
        What the Friends tab offers for finding someone new. Results only ever show a name (or username, for anyone
        using one) and avatar — never an email — and anyone can hide themselves in Settings.
      </Text>
      {loadFailed ? (
        <Text style={styles.loadError}>Couldn&rsquo;t load these settings. Has 0080_friend_discovery.sql been run?</Text>
      ) : config ? (
        <>
          <ToggleRow
            label="Search by name"
            note={config.searchEnabled ? 'On' : 'Off'}
            value={config.searchEnabled}
            onChange={(v) => update({ searchEnabled: v })}
          />
          <ToggleRow
            label="People you may know"
            note={config.suggestionsEnabled ? 'On' : 'Off'}
            value={config.suggestionsEnabled}
            onChange={(v) => update({ suggestionsEnabled: v })}
          />
          <Text style={styles.footNote}>
            Beta download links — shown on the invite page a friend link opens, so someone without Hound can get it
            first. Leave one blank to hide that button.
          </Text>
          <TextField
            label="iPhone — TestFlight public link"
            value={config.iosBetaUrl ?? ''}
            onChangeText={(v) => update({ iosBetaUrl: v })}
            placeholder="https://testflight.apple.com/join/…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextField
            label="Android — download link"
            value={config.androidBetaUrl ?? ''}
            onChangeText={(v) => update({ androidBetaUrl: v })}
            placeholder="https://houndchallenge.net/get"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {error && <Text style={styles.loadError}>{error}</Text>}
          {saved && !error && <Text style={styles.successNote}>Saved.</Text>}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" disabled={saving} onPress={save} />
        </>
      ) : null}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    loadError: { fontSize: 12.5, color: colors.amber },
    successNote: { fontSize: 12.5, color: colors.green },
  });
}
