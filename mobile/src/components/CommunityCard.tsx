import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { FlagIcon, ShareNetworkIcon, UsersThreeIcon } from 'phosphor-react-native';
import { Text } from './Text';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import {
  cancelCommunityChallenge,
  codeLink,
  formatCode,
  reportCommunityChallenge,
  setCommunityCode,
  type CommunityInfo,
  type ReportReason,
} from '../challenges/communityApi';

// A community challenge (K-04) on its own screen. The creator gets the
// invite card: the code, the link and a QR code, ways to share them, and
// the code's controls. Everyone else sees the code too (they can bring
// people) and can report it.
export function CommunityCard({
  challengeId,
  name,
  info,
  isCreator,
  othersJoined,
  onChanged,
  onSharePicture,
  onCancelled,
}: {
  challengeId: string;
  name: string;
  info: CommunityInfo;
  isCreator: boolean;
  // Whether anyone besides the creator is in it (it can't be called off then).
  othersJoined: boolean;
  onChanged: (info: CommunityInfo) => void;
  onSharePicture: () => void;
  onCancelled: () => void;
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const code = info.code ?? '';

  const status =
    info.state === 'pending'
      ? 'Waiting for approval: the code starts working once it’s checked.'
      : info.state === 'hidden'
        ? 'Paused: it’s been reported, and it’s being looked at. New people can’t join until then.'
        : info.state === 'removed'
          ? 'This challenge was taken down.'
          : info.codeOff
            ? 'The code is off, so new people can’t join. Turn it back on any time.'
            : null;

  const shareLink = () => {
    Share.share({
      message: `Join my challenge "${name}" on Hound: ${codeLink(code)} (or enter code ${formatCode(code)} under Challenges)`,
    }).catch(() => {});
  };

  const changeCode = async (action: 'off' | 'on' | 'new') => {
    setBusy(true);
    try {
      const next = await setCommunityCode(challengeId, action);
      onChanged({ ...info, code: next, codeOff: action === 'off' });
    } catch (e) {
      Alert.alert('Couldn’t change the code', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmNewCode = () =>
    Alert.alert('Get a new code?', 'The old code, link and QR code stop working. People already in stay in.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'New code', onPress: () => changeCode('new') },
    ]);

  const confirmCancel = () =>
    Alert.alert('Call it off?', 'Nobody else has joined yet. It ends now, and it still counts toward your week.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Call it off',
        style: 'destructive',
        onPress: () =>
          cancelCommunityChallenge(challengeId)
            .then(onCancelled)
            .catch((e) => Alert.alert('Couldn’t call it off', e instanceof Error ? e.message : 'Try again.')),
      },
    ]);

  const report = () => {
    const send = (reason: ReportReason) =>
      reportCommunityChallenge(challengeId, reason)
        .then(() => Alert.alert('Thanks for telling us', 'Someone will take a look.'))
        .catch((e) => Alert.alert('Couldn’t report it', e instanceof Error ? e.message : 'Try again.'));
    Alert.alert('Report this challenge', 'What’s wrong with it?', [
      { text: 'Offensive', onPress: () => send('offensive') },
      { text: 'Spam', onPress: () => send('spam') },
      { text: 'Misleading', onPress: () => send('misleading') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const working = info.state === 'listed' && !info.codeOff;

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.titleRow}>
        <UsersThreeIcon size={17} color={colors.accent} />
        <Text style={text.h4}>{isCreator ? 'Invite anyone' : 'Community challenge'}</Text>
        {info.featured && (
          <View style={styles.featured}>
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
      </View>
      <Text style={styles.note}>
        {isCreator
          ? 'Anyone with this code, link or QR code can join. It isn’t listed anywhere else.'
          : 'Anyone with this code can join. Share it to bring people in.'}
      </Text>
      {status && <Text style={styles.status}>{status}</Text>}

      {!!code && info.state !== 'removed' && (
        <>
          <View style={styles.codeRow}>
            <Text style={[styles.code, !working && { opacity: 0.45 }]} selectable>
              {formatCode(code)}
            </Text>
          </View>
          {isCreator && (
            <View style={styles.qrRow}>
              <View style={[styles.qr, !working && { opacity: 0.45 }]}>
                <QRCode value={codeLink(code)} size={84} color="#161826" backgroundColor="#ffffff" quietZone={0} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.link} selectable>
                  {codeLink(code).replace(/^https:\/\//, '')}
                </Text>
                <Text style={styles.note}>Opens Hound on this challenge.</Text>
              </View>
            </View>
          )}
          <View style={styles.buttons}>
            <Button label="Share link" variant="ghost" icon={<ShareNetworkIcon size={15} color={colors.accent} />} onPress={shareLink} />
            <Button label="Share picture" variant="primary" onPress={onSharePicture} />
          </View>
        </>
      )}

      {isCreator && info.state !== 'removed' && (
        <View style={styles.controls}>
          <Pressable onPress={() => changeCode(info.codeOff ? 'on' : 'off')} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={styles.control}>{info.codeOff ? 'Turn the code on' : 'Turn the code off'}</Text>
          </Pressable>
          <Pressable onPress={confirmNewCode} disabled={busy} hitSlop={8} accessibilityRole="button">
            <Text style={styles.control}>New code</Text>
          </Pressable>
          {!othersJoined && (
            <Pressable onPress={confirmCancel} disabled={busy} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.control, { color: colors.amber }]}>Call it off</Text>
            </Pressable>
          )}
        </View>
      )}

      {!isCreator && info.state !== 'removed' && (
        <Pressable onPress={report} hitSlop={8} style={styles.reportRow} accessibilityRole="button">
          <FlagIcon size={14} color={withAlpha(colors.text, 0.6)} />
          <Text style={styles.reportText}>Report this challenge</Text>
        </Pressable>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    featured: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(colors.amber, 0.16) },
    featuredText: { fontFamily: font.headingSemibold, fontSize: 12, color: colors.amber },
    note: { fontSize: 13, lineHeight: 18, color: withAlpha(colors.text, 0.65) },
    status: { fontSize: 13, lineHeight: 18, color: colors.amber },
    codeRow: {
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.45),
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    code: { fontFamily: font.headingSemibold, fontSize: 28, letterSpacing: 4, color: colors.text },
    qrRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    qr: { padding: 6, borderRadius: 10, backgroundColor: '#ffffff' },
    link: { fontSize: 13.5, color: colors.accentActive },
    buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    controls: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
    control: { fontFamily: font.heading, fontSize: 13.5, color: colors.accentActive },
    reportRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    reportText: { fontSize: 13, color: withAlpha(colors.text, 0.6) },
  });
}
