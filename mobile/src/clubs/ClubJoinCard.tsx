import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { HashIcon, QrCodeIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { ScanCodeModal } from '../components/ScanCodeModal';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { confirmCommunityAge, normCode } from '../challenges/communityApi';
import { joinClubByCode, previewClubByCode, type Club } from './clubsApi';
import { ClubBadge, clubMeta } from './clubLook';

// A club's code (6 letters and digits, 0185) out of anything typed,
// pasted or scanned: the code, or a houndchallenge.net/c/ or hound://c/
// link.
export function clubCodeFrom(text: string): string | null {
  const t = text.trim();
  const m = /\/c\/([A-Za-z0-9-]{4,12})/.exec(t);
  const c = normCode(m ? m[1] : t);
  return /^[A-Z0-9]{6}$/.test(c) ? c : null;
}

export function formatClubCode(code: string): string {
  const c = normCode(code);
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

// "Have a club code?": type, paste or scan it, see the club, and join.
// On the Clubs tab, and where a club's link opens the app.
export function ClubJoinCard({
  initialCode,
  onJoined,
  onPickUsername,
}: {
  initialCode?: string;
  onJoined: (clubId: string) => void;
  onPickUsername: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [code, setCode] = useState(initialCode ? formatClubCode(initialCode) : '');
  const [preview, setPreview] = useState<(Club & { problem: string | null }) | null>(null);
  const [looking, setLooking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const lookUp = async (raw: string) => {
    const c = clubCodeFrom(raw);
    if (!c) {
      setNote(normCode(raw).length === 7 ? 'That’s a challenge code: enter it on the Challenges tab.' : 'A club code is 6 letters and numbers, like K7M-2QX.');
      return;
    }
    setCode(formatClubCode(c));
    setNote(null);
    setLooking(true);
    try {
      const p = await previewClubByCode(c);
      setPreview(p);
      if (!p) setNote('No club has that code. Check it and try again.');
    } catch (e) {
      setPreview(null);
      setNote(e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setLooking(false);
    }
  };

  useEffect(() => {
    if (initialCode) lookUp(initialCode);
    // Only the code it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const join = async () => {
    if (!preview) return;
    if (preview.role) {
      onJoined(preview.id);
      return;
    }
    if (preview.problem === 'age') {
      Alert.alert('Are you 13 or older?', 'Clubs are open to people you don’t know, so they’re for ages 13 and up.', [
        { text: 'No', style: 'cancel' },
        {
          text: 'I’m 13 or older',
          onPress: () =>
            confirmCommunityAge()
              .then(() => lookUp(code))
              .catch((e) => Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.')),
        },
      ]);
      return;
    }
    if (preview.problem === 'username') {
      Alert.alert('Pick a username first', 'Clubs show usernames, not names.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Pick one', onPress: onPickUsername },
      ]);
      return;
    }
    setJoining(true);
    try {
      const id = await joinClubByCode(normCode(code));
      setPreview(null);
      setCode('');
      onJoined(id);
    } catch (e) {
      Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setJoining(false);
    }
  };

  const blocked = preview?.problem && preview.problem !== 'age' && preview.problem !== 'username' ? preview.problem : null;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.field}>
        <HashIcon size={18} color={withAlpha(colors.text, 0.55)} />
        <TextInput
          maxFontSizeMultiplier={1.3}
          value={code}
          onChangeText={(t) => {
            setCode(t);
            setNote(null);
            if (clubCodeFrom(t) && (t.includes('/') || normCode(t).length === 6)) lookUp(t);
          }}
          placeholder="Have a club code? K7M-2QX"
          placeholderTextColor={withAlpha(colors.text, 0.45)}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => lookUp(code)}
          style={styles.input}
          accessibilityLabel="Enter a club code"
        />
        <Pressable onPress={() => setScanning(true)} style={styles.scan} hitSlop={6} accessibilityRole="button" accessibilityLabel="Scan a club QR code">
          <QrCodeIcon size={18} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => lookUp(code)}
          disabled={looking || !code.trim()}
          style={[styles.go, (!code.trim() || looking) && { opacity: 0.5 }]}
          accessibilityRole="button"
        >
          {looking ? <ActivityIndicator size="small" color="#161826" /> : <Text style={styles.goText}>Go</Text>}
        </Pressable>
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
      {preview && (
        <View style={styles.preview}>
          <View style={styles.row}>
            <ClubBadge sport={preview.sport} color={preview.color} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{preview.name}</Text>
              <Text style={styles.meta}>{clubMeta(preview)}</Text>
            </View>
          </View>
          {preview.description ? <Text style={styles.desc}>{preview.description}</Text> : null}
          {blocked ? <Text style={styles.note}>{blocked}</Text> : null}
          <View style={styles.buttons}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setPreview(null);
                setCode('');
              }}
            />
            <Button label={preview.role ? 'Open it' : joining ? 'Joining…' : 'Join the club'} variant="primary" disabled={joining || !!blocked} onPress={join} />
          </View>
        </View>
      )}
      <ScanCodeModal
        visible={scanning}
        title="Scan a club’s code"
        hint="Ask someone in the club to open it and tap Invite."
        askText="Hound needs the camera to scan the club’s QR code. It’s only used while this screen is open."
        onScanned={(data) => {
          setScanning(false);
          lookUp(data);
        }}
        onClose={() => setScanning(false)}
      />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 48,
      paddingLeft: 14,
      paddingRight: 6,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.1),
    },
    input: { flex: 1, fontSize: 15, fontFamily: font.heading, letterSpacing: 1, color: colors.text, paddingVertical: 10 },
    scan: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: withAlpha(colors.text, 0.16) },
    go: { minWidth: 44, height: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    goText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
    note: { fontSize: 13, color: colors.amber },
    preview: { gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: withAlpha(colors.accent, 0.5) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    meta: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    desc: { fontSize: 14, lineHeight: 20, color: colors.text },
    buttons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  });
}
