import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from './Text';
import { HashIcon, QrCodeIcon } from 'phosphor-react-native';
import { Button } from './Button';
import { ScanCodeModal } from './ScanCodeModal';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { CHALLENGE_KIND_ICON } from '../data/challengeIcons';
import {
  codeFrom,
  confirmCommunityAge,
  formatCode,
  joinByCode,
  normCode,
  previewByCode,
  type CodePreview,
} from '../challenges/communityApi';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "Have a code?" (K-04): type, paste or scan a community challenge's
// code, see what it is, and join. On the Challenges tab, and on the
// screen a houndchallenge.net/c/ or hound://c/ link opens.
export function CodeJoinCard({
  initialCode,
  onJoined,
  onPickUsername,
  onCancel,
}: {
  // From a link: shown and looked up straight away.
  initialCode?: string;
  onJoined: (challengeId: string) => void;
  onPickUsername: () => void;
  // Shown as Cancel beside Join; without it the preview just clears.
  onCancel?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [code, setCode] = useState(initialCode ? formatCode(initialCode) : '');
  const [preview, setPreview] = useState<CodePreview | null>(null);
  const [looking, setLooking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const lookUp = async (raw: string) => {
    const c = codeFrom(raw);
    if (!c) {
      setNote('A code is 7 letters and numbers, like HND-7K2Q.');
      return;
    }
    setCode(formatCode(c));
    setNote(null);
    setLooking(true);
    try {
      const p = await previewByCode(c);
      setPreview(p);
      if (!p) setNote('No challenge has that code. Check it and try again.');
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

  const clear = () => {
    setPreview(null);
    setCode('');
    setNote(null);
    onCancel?.();
  };

  const join = async () => {
    if (!preview) return;
    if (preview.joined) {
      onJoined(preview.id);
      return;
    }
    if (preview.problem === 'age') {
      Alert.alert(
        'Are you 13 or older?',
        'Community challenges are open to people you don’t know, so they’re for ages 13 and up.',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'I’m 13 or older',
            onPress: () =>
              confirmCommunityAge()
                .then(() => lookUp(code))
                .catch((e) => Alert.alert('Couldn’t save that', e instanceof Error ? e.message : 'Try again.')),
          },
        ],
      );
      return;
    }
    if (preview.problem === 'username') {
      Alert.alert('Pick a username first', 'Community leaderboards show usernames, not names.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Pick one', onPress: onPickUsername },
      ]);
      return;
    }
    setJoining(true);
    try {
      const id = await joinByCode(normCode(code));
      if (!id) {
        setPreview(null);
        setNote('No challenge has that code. Check it and try again.');
        return;
      }
      setPreview(null);
      setCode('');
      onJoined(id);
    } catch (e) {
      Alert.alert('Couldn’t join', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setJoining(false);
    }
  };

  const type = preview ? CHALLENGE_TYPES.find((t) => t.id === preview.kind) : null;
  const KindIcon = preview ? CHALLENGE_KIND_ICON[preview.kind] : null;
  const blocked = preview && preview.problem && preview.problem !== 'age' && preview.problem !== 'username' ? preview.problem : null;

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
            // A pasted link or a full code looks itself up.
            const c = codeFrom(t);
            if (c && (t.includes('/') || normCode(t).length === 7)) lookUp(t);
          }}
          placeholder="Have a code? HND-7K2Q"
          placeholderTextColor={withAlpha(colors.text, 0.45)}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => lookUp(code)}
          style={styles.input}
          accessibilityLabel="Enter a challenge code"
        />
        <Pressable
          onPress={() => setScanning(true)}
          style={styles.scan}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Scan a challenge QR code"
        >
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
            <View style={[styles.icon, { backgroundColor: type?.tint }]}>{KindIcon && <KindIcon size={20} color={type?.iconColor} weight="fill" />}</View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name}>{preview.name}</Text>
              <Text style={styles.meta}>
                {type?.name ?? preview.kind}
                {preview.creator ? ` · by @${preview.creator}` : ''} · {preview.participantCount} joined
              </Text>
            </View>
          </View>
          {preview.description ? <Text style={styles.desc}>{preview.description}</Text> : null}
          <Text style={styles.meta}>
            {preview.durationDays} days · starts {day(preview.startsAt)}
            {new Date(preview.joinClosesAt) < new Date(preview.endsAt) ? ` · joining closes ${day(preview.joinClosesAt)}` : ''}
          </Text>
          {blocked ? <Text style={styles.blocked}>{blocked}</Text> : null}
          <View style={styles.buttons}>
            <Button label="Cancel" variant="ghost" onPress={clear} />
            <Button
              label={preview.joined ? 'Open it' : joining ? 'Joining…' : 'Join'}
              variant="primary"
              disabled={joining || !!blocked}
              onPress={join}
            />
          </View>
        </View>
      )}

      <ScanCodeModal
        visible={scanning}
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
    scan: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.16),
    },
    go: { minWidth: 44, height: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    goText: { fontFamily: font.headingSemibold, fontSize: 14, color: '#161826' },
    note: { fontSize: 13, color: colors.amber },
    preview: {
      gap: 10,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.5),
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    name: { fontFamily: font.headingSemibold, fontSize: 16, color: colors.text },
    meta: { fontSize: 13, color: withAlpha(colors.text, 0.65) },
    desc: { fontSize: 14, lineHeight: 20, color: colors.text },
    blocked: { fontSize: 13, color: colors.amber },
    buttons: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  });
}
