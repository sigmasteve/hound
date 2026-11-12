import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { blockDogUploads, getUserDogPhoto, signedPhotoUrls, type UserDogPhoto } from '../dogPhotos/dogPhotos';

// A person's Admin page → Photo uploads (0191): their dog photo, what the
// check turned down, and a block on uploading, for a while or for good.
// Blocking takes their photo down; they can still use Hound.
export function UserDogPhotoAdmin({ userId, name }: { userId: string; name: string }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<UserDogPhoto | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getUserDogPhoto(userId)
      .then(async (d) => {
        setData(d);
        setUrl(d.path ? ((await signedPhotoUrls([d.path]).catch(() => new Map<string, string>())).get(d.path) ?? null) : null);
      })
      .catch(() => setData(null));
  }, [userId]);
  useEffect(() => load(), [load]);

  if (!data) return null;
  const blocked = !!data.blockedUntil;
  const until =
    data.blockedUntil && !data.blockedUntil.startsWith('infinity') && new Date(data.blockedUntil).getFullYear() < 9000
      ? `until ${new Date(data.blockedUntil).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      : 'for good';

  const block = (days: number) => {
    const label = days < 0 ? 'for good' : `for ${days} days`;
    Alert.alert(
      days === 0 ? `Let ${name} upload again?` : `Block ${name}'s uploads ${label}?`,
      days === 0 ? 'They can pick a dog photo again.' : 'Their photo comes down and they go back to their hound. They can still use Hound.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: days === 0 ? 'Unblock' : 'Block',
          style: days === 0 ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await blockDogUploads(userId, days);
              load();
            } catch (e) {
              Alert.alert('Photo uploads', e instanceof Error ? e.message : 'Try again.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Card style={{ gap: 10, padding: 18 }} elevated={false}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={text.h4}>Photo uploads</Text>
        <Text style={[styles.status, { color: blocked ? colors.amber : colors.green }]}>{blocked ? `Blocked ${until}` : 'Allowed'}</Text>
      </View>
      {data.status && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {url ? <Image source={{ uri: url }} style={styles.photo} /> : null}
          <Text style={styles.note}>{data.status === 'hidden' ? 'Their dog photo is hidden after reports.' : 'Using a dog photo now.'}</Text>
        </View>
      )}
      <Text style={styles.note}>
        {data.turnedDown} {data.turnedDown === 1 ? 'photo' : 'photos'} turned down by the check · {data.removed} removed by an admin
      </Text>
      {blocked ? (
        <Button label="Unblock uploads" variant="secondary" small disabled={busy} onPress={() => block(0)} />
      ) : (
        <>
          <Text style={styles.small}>Block uploads for</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="7 days" variant="secondary" small block disabled={busy} onPress={() => block(7)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="30 days" variant="secondary" small block disabled={busy} onPress={() => block(30)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="For good" variant="primary" small block disabled={busy} onPress={() => block(-1)} />
            </View>
          </View>
        </>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    status: { fontFamily: font.heading, fontSize: 13 },
    note: { flex: 1, fontSize: 13.5, color: withAlpha(colors.text, 0.75) },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    photo: { width: 48, height: 48, borderRadius: 24 },
  });
}
