import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChatCircleDotsIcon, PaperPlaneRightIcon } from 'phosphor-react-native';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { useTheme } from '../theme/ThemeContext';
import { font, TINT_A, TINT_N, withAlpha, type Palette } from '../theme/tokens';
import {
  deleteTrashTalk,
  getTrashTalkStatus,
  listTrashTalk,
  messageTime,
  myTrashTalkMutes,
  postTaunt,
  postTrashText,
  reportTrashTalk,
  setTrashTalkMute,
  tauntChips,
  TRASH_TALK_MAX_LENGTH,
  TRASH_TALK_REFRESH_MS,
  type Standing,
  type TauntChip,
  type TauntUnit,
  type TrashTalkMessage,
  type TrashTalkStatus,
} from '../social/trashTalk';

const FREE_TEXT_NOTE: Record<string, string> = {
  off: 'Typed messages are turned off right now. Taunts still work.',
  global: 'Global challenges are taunts only.',
};

// A challenge's trash-talk wall (0083_trash_talk.sql): one-tap taunts
// built from the standings, free text where it's allowed, and mute /
// report / delete on each message. Checks for new messages, and for the
// admin's free-text switch, every 15 seconds while it's on screen.
export function TrashTalkCard({
  challengeId,
  myId,
  standings,
  unit,
  participantIds,
}: {
  challengeId: string;
  myId: string | undefined;
  // Where everyone stands, for the taunts with numbers. Null when this
  // kind of challenge has no single number to compare.
  standings: Standing[] | null;
  unit: TauntUnit | null;
  participantIds: string[];
}) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<TrashTalkStatus | null>(null);
  const [messages, setMessages] = useState<TrashTalkMessage[] | null>(null);
  const [muted, setMuted] = useState<{ userId: string; name: string }[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([getTrashTalkStatus(challengeId), listTrashTalk(challengeId)]);
      setStatus(s);
      setMessages(m);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [challengeId]);

  const refreshMutes = useCallback(() => {
    myTrashTalkMutes()
      .then(setMuted)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    refreshMutes();
    let timer = setInterval(refresh, TRASH_TALK_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      clearInterval(timer);
      if (state === 'active') {
        refresh();
        timer = setInterval(refresh, TRASH_TALK_REFRESH_MS);
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh, refreshMutes]);

  const chips = useMemo(() => tauntChips(standings, myId, unit), [standings, myId, unit]);

  const send = async (fn: () => Promise<void>) => {
    setPosting(true);
    setError(null);
    try {
      await fn();
      await refresh();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that — try again.');
      // The switch may have just been turned off.
      refresh();
    } finally {
      setPosting(false);
    }
  };

  const sendTaunt = (chip: TauntChip) => send(() => postTaunt(challengeId, chip));
  const sendText = () =>
    send(async () => {
      await postTrashText(challengeId, draft);
      setDraft('');
    });

  const openMenu = (m: TrashTalkMessage) => {
    if (m.userId === myId) {
      Alert.alert('Your message', m.body, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteTrashTalk(m.id)
              .then(refresh)
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.')),
        },
      ]);
      return;
    }
    Alert.alert(m.name, m.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: `Mute ${m.name}`,
        onPress: () =>
          setTrashTalkMute(m.userId, true)
            .then(() => {
              refresh();
              refreshMutes();
            })
            .catch((e) => Alert.alert('Could not mute', e instanceof Error ? e.message : 'Try again.')),
      },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () =>
          reportTrashTalk(m.id)
            .then(() => Alert.alert('Reported', 'Thanks — an admin will take a look.'))
            .catch((e) => Alert.alert('Could not report', e instanceof Error ? e.message : 'Try again.')),
      },
    ]);
  };

  const unmute = (userId: string) =>
    setTrashTalkMute(userId, false)
      .then(() => {
        refresh();
        refreshMutes();
      })
      .catch(() => {});

  const mutedHere = muted.filter((m) => participantIds.includes(m.userId));

  if (loadFailed && !messages) return null;

  return (
    <Card style={{ gap: 12 }} elevated={false}>
      <View style={styles.header}>
        <ChatCircleDotsIcon size={16} color={colors.accent} />
        <Text style={text.h4}>Trash talk</Text>
      </View>

      {!messages ? (
        <ActivityIndicator color={colors.accent} />
      ) : messages.length === 0 ? (
        <Text style={styles.footNote}>
          {status?.readOnly ? 'Nobody talked any trash in this one.' : 'Quiet in here. Throw the first jab.'}
        </Text>
      ) : (
        <ScrollView
          ref={listRef}
          style={styles.list}
          contentContainerStyle={{ gap: 10 }}
          nestedScrollEnabled
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        >
          {messages.map((m) => {
            const mine = m.userId === myId;
            return (
              <Pressable
                key={m.id}
                onLongPress={() => openMenu(m)}
                onPress={() => openMenu(m)}
                style={styles.message}
                accessibilityHint={mine ? 'Delete your message' : 'Mute or report'}
              >
                <Avatar
                  initials={m.initials}
                  tint={mine ? TINT_A : TINT_N}
                  size={28}
                  fontSize={10}
                  frameId={m.frameId}
                  backgroundId={m.backgroundId}
                  iconId={m.iconId}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.messageHead}>
                    <Text style={styles.name} numberOfLines={1}>
                      {mine ? 'You' : m.name}
                    </Text>
                    <Text style={styles.time}>{messageTime(m.createdAt)}</Text>
                  </View>
                  <View style={[styles.bubble, mine && styles.bubbleMine, m.kind === 'taunt' && styles.bubbleTaunt]}>
                    <Text style={styles.body}>{m.body}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {messages && messages.some((m) => m.userId !== myId) && (
        <Text style={styles.footNote}>Tap a message to report it or mute someone.</Text>
      )}

      {status?.canPost && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {chips.map((c) => (
              <Pressable
                key={`${c.id}-${c.targetId ?? ''}`}
                style={[styles.chip, posting && { opacity: 0.5 }]}
                disabled={posting}
                onPress={() => sendTaunt(c)}
                accessibilityRole="button"
              >
                <Text style={styles.chipLabel}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {status.freeTextAllowed ? (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={(v) => {
                  setDraft(v);
                  if (error) setError(null);
                }}
                placeholder="Talk some trash…"
                placeholderTextColor={withAlpha(colors.text, 0.4)}
                maxLength={TRASH_TALK_MAX_LENGTH}
                style={styles.input}
                multiline
                accessibilityLabel="Message"
              />
              <Pressable
                onPress={sendText}
                disabled={posting || !draft.trim()}
                style={[styles.sendButton, (posting || !draft.trim()) && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                <PaperPlaneRightIcon size={18} color={colors.accentActive} weight="fill" />
              </Pressable>
            </View>
          ) : (
            status.freeTextReason &&
            FREE_TEXT_NOTE[status.freeTextReason] && (
              <Text style={styles.footNote}>{FREE_TEXT_NOTE[status.freeTextReason]}</Text>
            )
          )}
          {status.freeTextAllowed && draft.length > TRASH_TALK_MAX_LENGTH - 20 && (
            <Text style={styles.footNote}>
              {TRASH_TALK_MAX_LENGTH - draft.length} characters left
            </Text>
          )}
        </>
      )}

      {status?.readOnly && (
        <Text style={styles.footNote}>
          This challenge is over, so the wall is read-only.{' '}
          {status.retentionDays === 0
            ? 'It will be cleared soon.'
            : `It's cleared ${status.retentionDays} ${status.retentionDays === 1 ? 'day' : 'days'} after the challenge ends.`}
        </Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {mutedHere.length > 0 && (
        <View style={styles.mutedRow}>
          <Text style={styles.footNote}>Muted: </Text>
          {mutedHere.map((m) => (
            <Pressable key={m.userId} onPress={() => unmute(m.userId)} hitSlop={6}>
              <Text style={styles.unmute}>
                {m.name} · Unmute
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    list: { maxHeight: 360 },
    message: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    messageHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    name: { fontSize: 12.5, fontFamily: font.heading, color: withAlpha(colors.text, 0.8), flexShrink: 1 },
    time: { fontSize: 11, color: withAlpha(colors.text, 0.45) },
    bubble: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 12,
      borderTopLeftRadius: 4,
      backgroundColor: withAlpha(colors.text, 0.06),
    },
    bubbleMine: { backgroundColor: withAlpha(colors.accent, 0.16) },
    bubbleTaunt: { borderWidth: 1, borderColor: withAlpha(colors.accent, 0.35) },
    body: { fontSize: 14, color: colors.text },
    chips: { gap: 8, paddingVertical: 2 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.55),
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
    chipLabel: { fontSize: 13, color: colors.accentActive, fontFamily: font.heading },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      borderWidth: 1,
      borderColor: withAlpha(colors.text, 0.15),
      borderRadius: 12,
      paddingLeft: 12,
      paddingRight: 6,
      paddingVertical: 6,
    },
    input: { flex: 1, minHeight: 32, maxHeight: 96, fontSize: 14, color: colors.text, paddingVertical: 6 },
    sendButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.6) },
    error: { fontSize: 12.5, color: colors.amber },
    mutedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    unmute: { fontSize: 12.5, color: colors.accentActive },
  });
}
