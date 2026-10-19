import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { PlayCircleIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { Card } from './Card';
import { TextField } from './TextField';
import { ToggleRow } from './Selectable';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { getAdSettings, setAdSettings, type AdSettings, type AdStats } from '../ads/adsApi';

// Admin → Rewarded ads (0114_rewarded_ads.sql): the switches for "watch an
// ad for Bones", and how much it's being used.
export function AdsAdminCard() {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [stats, setStats] = useState<AdStats | null>(null);
  const [bonesInput, setBonesInput] = useState('');
  const [capInput, setCapInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getAdSettings()
        .then(({ settings: s, stats: st }) => {
          setSettings(s);
          setStats(st);
          setBonesInput(String(s.bonesPerAd));
          setCapInput(String(s.dailyCap));
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load ad settings.'));
    }, []),
  );

  const change = (patch: Partial<AdSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    const bonesPerAd = Number(bonesInput);
    const dailyCap = Number(capInput);
    if (!Number.isInteger(bonesPerAd) || bonesPerAd < 1 || bonesPerAd > 100) {
      setError('Bones per ad is a whole number from 1 to 100.');
      return;
    }
    if (!Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > 20) {
      setError('Ads a day is a whole number from 0 to 20.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setAdSettings({ ...settings, bonesPerAd, dailyCap });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <PlayCircleIcon size={18} color={colors.accentActive} weight="fill" />
        <Text style={text.h4}>Rewarded ads</Text>
      </View>
      <Text style={styles.note}>
        Members can choose to watch a short ad for Bones from the Locker, up to a daily limit. Needs Hound 0.11.0 or
        later. Leave the ad unit ids blank to show Google&rsquo;s test ads.
      </Text>
      {!settings ? (
        error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )
      ) : (
        <>
          {stats && (
            <Text style={styles.stats}>
              Today: {stats.todayAds} ads · Last 7 days: {stats.weekAds} ads by {stats.weekPeople}{' '}
              {stats.weekPeople === 1 ? 'person' : 'people'}, {stats.weekBones} Bones
            </Text>
          )}
          <ToggleRow
            label="Ads on"
            note={settings.enabled ? 'Members see the offer' : 'Hidden from everyone'}
            value={settings.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <TextField
                label="Bones per ad"
                value={bonesInput}
                onChangeText={(v) => {
                  setBonesInput(v);
                  setSaved(false);
                }}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Ads a day"
                value={capInput}
                onChangeText={(v) => {
                  setCapInput(v);
                  setSaved(false);
                }}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <ToggleRow
            label="Show to organization members"
            note={settings.showToOrgMembers ? 'Schools and companies see ads too' : 'No ads for organization accounts'}
            value={settings.showToOrgMembers}
            onChange={(showToOrgMembers) => change({ showToOrgMembers })}
          />
          <ToggleRow
            label="Google confirms each ad"
            note={
              settings.verifyByServer
                ? 'Only Google’s signed callback pays'
                : 'The app says when an ad was watched (for testing)'
            }
            value={settings.verifyByServer}
            onChange={(verifyByServer) => change({ verifyByServer })}
          />
          <TextField
            label="iPhone rewarded ad unit id"
            value={settings.iosUnitId ?? ''}
            onChangeText={(v) => change({ iosUnitId: v.trim() || null })}
            placeholder="ca-app-pub-…/… (blank: test ads)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="Android rewarded ad unit id"
            value={settings.androidUnitId ?? ''}
            onChangeText={(v) => change({ androidUnitId: v.trim() || null })}
            placeholder="ca-app-pub-…/… (blank: test ads)"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          {saved && !error && <Text style={styles.success}>Saved.</Text>}
          <Button label={saving ? 'Saving…' : 'Save'} variant="primary" disabled={saving} onPress={save} />
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    stats: { fontFamily: font.heading, fontSize: 13, color: colors.text },
    pair: { flexDirection: 'row', gap: 10 },
    error: { fontSize: 13, color: colors.amber },
    success: { fontSize: 13, color: colors.green },
  });
}
