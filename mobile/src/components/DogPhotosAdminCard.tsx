import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  getDogPhotosOverview,
  reviewDogPhoto,
  signedPhotoUrls,
  type DogPhotosOverview,
  type ReportedPhoto,
} from '../dogPhotos/dogPhotos';

// Admin → Dog photos (0191): who uses a photo, what the check turned
// down, look-alike hounds, and reported photos to keep or remove.
export function DogPhotosAdminCard({ onChanged }: { onChanged?: (o: DogPhotosOverview) => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DogPhotosOverview | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    getDogPhotosOverview()
      .then(async (o) => {
        setData(o);
        setError(null);
        changed.current?.(o);
        setUrls(await signedPhotoUrls(o.reported.map((r) => r.path)).catch(() => new Map()));
      })
      .catch((e) =>
        setError(e instanceof Error && /admin_dog_photos_overview/.test(e.message) ? 'Run 0191_dog_photos.sql to see these.' : e instanceof Error ? e.message : 'Could not load.'),
      );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const review = (photo: ReportedPhoto, keep: boolean, blockDays: number | null) => {
    const go = async () => {
      setBusy(photo.photoId);
      try {
        await reviewDogPhoto(photo, keep, blockDays);
        load();
      } catch (e) {
        Alert.alert('Dog photo', e instanceof Error ? e.message : 'Try again.');
      } finally {
        setBusy(null);
      }
    };
    if (keep) return go();
    Alert.alert(
      blockDays ? `Remove and block ${photo.name}?` : `Remove ${photo.name}'s photo?`,
      blockDays
        ? 'Their photo comes down and they can’t upload another (change it on their Admin page). They can still use Hound.'
        : 'They go back to their hound. They can pick another photo.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: blockDays ? 'Remove + block' : 'Remove', style: 'destructive', onPress: go },
      ],
    );
  };

  const stats: [string, string][] = data
    ? [
        ['Using a photo now', `${data.usingNow}`],
        ['Have tried one', `${data.tried}`],
        ['Checks this week', `${data.checks7d} · ${data.turnedDown7d} turned down`],
        ['Look-alike hounds', `${data.looksApplied} by ${data.looksPeople} ${data.looksPeople === 1 ? 'person' : 'people'}`],
        ['Blocked from uploading', `${data.blocked}`],
      ]
    : [];

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <Text style={text.h4}>Dog photos</Text>
      <Text style={styles.footNote}>Photos of people’s dogs as their avatar, seen by their friends. Claude checks each one; friends can report them, and three reports hide one until you look.</Text>
      {error ? (
        <Text style={styles.loadError}>{error}</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {stats.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
          <Text style={[styles.value, { paddingTop: 6 }]}>{data.reported.length ? 'Reported' : 'Nothing reported'}</Text>
          {data.reported.map((r) => (
            <View key={r.photoId} style={styles.report}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {urls.get(r.path) ? <Image source={{ uri: urls.get(r.path)! }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.value}>{r.name}</Text>
                  <Text style={styles.label}>
                    {r.reports} {r.reports === 1 ? 'report' : 'reports'}
                    {r.reasons.length ? ` · ${r.reasons.join(', ')}` : ''}
                    {r.hidden ? ' · hidden' : ''}
                  </Text>
                  {r.breed && <Text style={styles.footNote}>The check said: {r.breed}</Text>}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Keep" variant="secondary" block small onPress={busy ? undefined : () => review(r, true, null)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Remove" variant="secondary" block small onPress={busy ? undefined : () => review(r, false, null)} />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button label="Remove + block" variant="primary" block small onPress={busy ? undefined : () => review(r, false, -1)} />
                </View>
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
    row: { gap: 2, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.07) },
    label: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    value: { fontFamily: font.heading, fontSize: 15, color: colors.text },
    report: { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.text, 0.12) },
    photo: { width: 64, height: 64, borderRadius: 32 },
    photoEmpty: { backgroundColor: withAlpha(colors.text, 0.08) },
  });
}
