import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from './Text';
import { CaretRightIcon, CheckCircleIcon, GlobeHemisphereWestIcon, TrophyIcon, UsersThreeIcon, XIcon } from 'phosphor-react-native';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { useTheme } from '../theme/ThemeContext';
import { color, font, withAlpha, type Palette } from '../theme/tokens';
import { CHALLENGE_TYPES } from '../data/sampleData';
import { canJoin, globalTimingLine, joinDeadlineLine, type GlobalChallenge } from '../challenges/globalChallenges';
import { SponsorLine } from './SponsorLine';

// Today's "Global Hound Challenges" — challenges an admin published to
// everyone (0075_global_challenges.sql). Each row is either joinable
// (a Join button) or already joined (tap to open it). Ones the viewer
// can no longer join, and never did, are left out by the caller.
//
// One that has already started is a single line (name, time left, Joined
// or Join): testers found the full card took too much of Today for
// something they'd already seen. One that hasn't started yet gets a
// compact card: its name, what and when, prizes, sponsor and when
// joining closes.
//
// Four or five at once took the top of Today, so at most two show and
// the rest fold behind "+N more". Each row has an × that hides that
// challenge on this phone (Today is the only place to join one, so
// "N hidden · Show" brings them back).
const MAX_SHOWN = 2;
const HIDDEN_KEY = 'globals:hidden';

export function GlobalChallengesCard({
  challenges,
  joiningId,
  onJoin,
  onOpen,
}: {
  challenges: GlobalChallenge[];
  joiningId: string | null;
  onJoin: (c: GlobalChallenge) => void;
  onOpen: (c: GlobalChallenge) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currencyName = useCurrencyName();
  const now = Date.now();
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_KEY)
      .then((raw) => setHidden(new Set(raw ? (JSON.parse(raw) as string[]) : [])))
      .catch(() => setHidden(new Set()));
  }, []);
  const saveHidden = (next: Set<string>) => {
    setHidden(next);
    // Only ids still on offer are kept, so the list never grows stale.
    const keep = Array.from(next).filter((id) => challenges.some((c) => c.id === id));
    AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(keep)).catch(() => {});
  };
  const hide = (c: GlobalChallenge) => saveHidden(new Set([...(hidden ?? []), c.id]));
  const showHidden = () => saveHidden(new Set());

  if (hidden === null) return null;
  const visible = challenges.filter((c) => !hidden.has(c.id));
  const hiddenCount = challenges.length - visible.length;
  const shown = expanded ? visible : visible.slice(0, MAX_SHOWN);
  const folded = visible.length - shown.length;
  const started = shown.filter((c) => now >= new Date(c.startsAt).getTime());
  const upcoming = shown.filter((c) => now < new Date(c.startsAt).getTime());
  if (visible.length === 0 && hiddenCount === 0) return null;

  const hideButton = (c: GlobalChallenge) => (
    <Pressable onPress={() => hide(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Hide ${c.name} from Today`}>
      <XIcon size={14} color={withAlpha(colors.text, 0.4)} />
    </Pressable>
  );

  const joinButton = (c: GlobalChallenge, small = false) => (
    <Pressable
      style={({ pressed }) => [styles.joinButton, small && styles.joinButtonSmall, pressed && { opacity: 0.8 }]}
      onPress={() => onJoin(c)}
      disabled={joiningId !== null}
      accessibilityRole="button"
      accessibilityLabel={`Join ${c.name}`}
    >
      {joiningId === c.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.joinText}>Join</Text>}
    </Pressable>
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <GlobeHemisphereWestIcon size={14} color={colors.accentActive} />
        <Text style={styles.title}>{challenges.length === 1 ? 'GLOBAL HOUND CHALLENGE' : 'GLOBAL HOUND CHALLENGES'}</Text>
        <Text style={styles.titleNote}>Everyone on Hound can join</Text>
      </View>
      {started.map((c) => (
        <Pressable
          key={c.id}
          style={({ pressed }) => [styles.line, pressed && { opacity: 0.8 }]}
          onPress={() => onOpen(c)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${c.name}${c.joined ? ', joined' : ''}`}
        >
          <Text style={styles.lineText} numberOfLines={1}>
            <Text style={styles.lineName}>{c.name}</Text> · {globalTimingLine(c, now)}
          </Text>
          {c.joined ? (
            <>
              <CheckCircleIcon size={15} color={colors.green} weight="fill" />
              <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
            </>
          ) : (
            <>
              {hideButton(c)}
              {joinButton(c, true)}
            </>
          )}
        </Pressable>
      ))}
      {upcoming.length > 0 && renderRows(upcoming)}
      {(folded > 0 || hiddenCount > 0) && (
        <View style={styles.moreRow}>
          {folded > 0 && (
            <Pressable onPress={() => setExpanded(true)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.moreText}>
                +{folded} more Global Hound {folded === 1 ? 'Challenge' : 'Challenges'}
              </Text>
            </Pressable>
          )}
          {folded > 0 && hiddenCount > 0 && <Text style={styles.moreText}> · </Text>}
          {hiddenCount > 0 && (
            <Pressable onPress={showHidden} hitSlop={8} accessibilityRole="button">
              <Text style={styles.moreText}>
                {hiddenCount} hidden · Show
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  function renderRows(list: GlobalChallenge[]) {
    return (
    <View style={{ gap: 8 }}>
      {list.map((c, i) => {
        const typeName = CHALLENGE_TYPES.find((t) => t.id === c.kind)?.name ?? 'Challenge';
        const joinable = canJoin(c);
        const deadline = joinable ? joinDeadlineLine(c) : null;
        const body = (
          <>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>
                {c.name}
              </Text>
              <View style={styles.metaRow}>
                <UsersThreeIcon size={12} color={withAlpha(colors.text, 0.55)} />
                <Text style={[styles.meta, { flexShrink: 1 }]} numberOfLines={1}>
                  {typeName} · {globalTimingLine(c)} · {c.participantCount.toLocaleString()} joined
                </Text>
              </View>
              {c.prizes && (
                <View style={styles.metaRow}>
                  <TrophyIcon size={12} color={color.amber} weight="fill" />
                  <Text style={[styles.meta, { flexShrink: 1 }]} numberOfLines={1}>
                    Top 3 win {c.prizes.filter((b) => b > 0).join(' / ')} {currencyName}
                  </Text>
                </View>
              )}
              {c.sponsor && <SponsorLine challengeId={c.id} sponsor={c.sponsor} compact />}
              {deadline && <Text style={styles.deadline}>{deadline}</Text>}
            </View>
          </>
        );
        if (c.joined) {
          return (
            <Pressable
              key={c.id}
              style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.8 }]}
              onPress={() => onOpen(c)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
            >
              {body}
              <View style={styles.joinedPill}>
                <CheckCircleIcon size={13} color={colors.green} weight="fill" />
                <Text style={styles.joinedText}>Joined</Text>
              </View>
              <CaretRightIcon size={14} color={withAlpha(colors.text, 0.4)} />
            </Pressable>
          );
        }
        return (
          <View key={c.id} style={[styles.row, i > 0 && styles.rowDivider]}>
            {body}
            {hideButton(c)}
            {joinButton(c)}
          </View>
        );
      })}
    </View>
    );
  }
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: {
      gap: 8,
      padding: 12,
      borderRadius: 16,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { fontSize: 11, letterSpacing: 0.8, fontFamily: font.heading, color: colors.accentActive },
    titleNote: { flex: 1, textAlign: 'right', fontSize: 11, color: withAlpha(colors.text, 0.5) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowDivider: {
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: withAlpha(colors.text, 0.1),
    },
    name: { fontSize: 14.5, fontFamily: font.heading, color: colors.text },
    meta: { fontSize: 12, color: withAlpha(colors.text, 0.6) },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    deadline: { fontSize: 12, color: colors.amber, fontFamily: font.heading },
    joinButton: {
      minWidth: 64,
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.accent,
    },
    joinButtonSmall: { minWidth: 52, height: 28, paddingHorizontal: 10, borderRadius: 8 },
    joinText: { fontSize: 14, color: '#fff', fontFamily: font.heading },
    // The one-line version, for a challenge that has already started.
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    lineText: { flex: 1, fontSize: 13.5, color: withAlpha(colors.text, 0.7) },
    lineName: { fontFamily: font.heading, color: colors.text },
    moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
    moreText: { fontSize: 12.5, color: colors.accentActive, fontFamily: font.heading },
    joinedPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    joinedText: { fontSize: 12.5, color: colors.green, fontFamily: font.heading },
  });
}
