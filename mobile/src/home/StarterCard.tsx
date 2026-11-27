import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { STARTER_TEXT, starterLeft, type StarterPath, type StarterStep, type StarterStepId } from './starterPath';

// Your first week (0282) on Today, under Your day: a row per step with its
// button, Bones as each is done, "Not for me" to drop one, and the claim
// (Bones and the Starter Bandana) once every step left is done.
export function StarterCard({
  path,
  houndName,
  claiming,
  onStep,
  onSkip,
  onClaim,
}: {
  path: StarterPath;
  houndName: string | null;
  claiming: boolean;
  onStep: (id: StarterStepId) => void;
  onSkip: (id: StarterStepId) => void;
  onClaim: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const counted = path.steps.filter((s) => !s.skipped);
  const done = counted.filter((s) => s.doneAt).length;
  const left = starterLeft(path);
  const next = left[0]?.id ?? null;
  const total = counted.reduce((n, s) => n + s.bones, 0) + path.finishBones;
  const by = path.endsAt ? new Date(path.endsAt).toLocaleDateString([], { weekday: 'long' }) : null;
  const finished = !!path.finishedAt;

  const row = (s: StarterStep, i: number) => {
    const t = STARTER_TEXT[s.id];
    const isNext = s.id === next;
    return (
      <View key={s.id} style={[styles.step, i > 0 && styles.line, s.skipped && { opacity: 0.45 }]}>
        <View style={[styles.dot, isNext && styles.dotOn, !!s.doneAt && styles.dotOk]}>
          <Text style={[styles.dotText, isNext && { color: colors.accentActive }, !!s.doneAt && { color: '#fff' }]}>
            {s.doneAt ? '✓' : s.skipped ? '–' : i + 1}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, !!s.doneAt && styles.titleDone]} numberOfLines={1}>
            {t.title}
          </Text>
          {s.doneAt ? (
            <Text style={styles.sub}>Done · +{s.bones} Bones</Text>
          ) : s.skipped ? (
            <Text style={styles.sub}>Not for you</Text>
          ) : (
            <>
              <Text style={styles.sub} numberOfLines={1}>
                {t.sub}
              </Text>
              {/* Only on the step you're on, so the rest stay one line. */}
              {isNext && (
                <Pressable
                  onPress={() => onSkip(s.id)}
                  hitSlop={6}
                  style={{ alignSelf: 'flex-start' }}
                  accessibilityRole="button"
                  accessibilityLabel={`Not for me: ${t.title}`}
                >
                  <Text style={styles.skip}>Not for me</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
        {!s.doneAt && !s.skipped ? (
          <Pressable
            onPress={() => onStep(s.id)}
            style={({ pressed }) => [styles.btn, isNext ? styles.btnMain : styles.btnQuiet, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={`${t.button}: ${t.title}, +${s.bones} Bones`}
          >
            <Text style={[styles.btnText, isNext ? { color: '#fff' } : { color: colors.accentActive }]}>{t.button}</Text>
          </Pressable>
        ) : (
          <Text style={styles.bones}>{s.doneAt ? `+${s.bones}` : ''}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker}>
          YOUR FIRST WEEK · {done} OF {counted.length}
        </Text>
        <Text style={styles.headBones}>{path.bonesPaid > 0 ? `+${path.bonesPaid} so far` : `+${total} Bones`}</Text>
      </View>
      {path.steps.map(row)}
      {finished ? (
        <Pressable
          onPress={onClaim}
          disabled={claiming}
          style={({ pressed }) => [styles.claim, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          {claiming ? (
            <ActivityIndicator color="#1b1d29" />
          ) : (
            <Text style={styles.claimText}>
              All done! Claim +{path.finishBones} Bones and the Starter Bandana
            </Text>
          )}
        </Pressable>
      ) : (
        <Text style={styles.foot}>
          {counted.length > 1 ? `All ${counted.length}` : 'It'}
          {by ? ` by ${by}` : ''}: +{path.finishBones} Bones and the Starter Bandana{houndName ? ` for ${houndName}` : ''}.
        </Text>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { borderRadius: 20, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    kicker: { fontSize: 11.5, letterSpacing: 0.8, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.6) },
    headBones: { fontSize: 12.5, fontFamily: font.headingSemibold, color: colors.amber },
    step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(colors.text, 0.12) },
    dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: withAlpha(colors.text, 0.18), alignItems: 'center', justifyContent: 'center' },
    dotOn: { borderColor: colors.accentActive },
    dotOk: { backgroundColor: colors.green, borderColor: colors.green },
    dotText: { fontSize: 12, fontFamily: font.headingSemibold, color: withAlpha(colors.text, 0.55) },
    title: { fontSize: 14.5, fontFamily: font.headingSemibold, color: colors.text },
    titleDone: { color: withAlpha(colors.text, 0.55) },
    sub: { fontSize: 12.5, color: withAlpha(colors.text, 0.6), flexShrink: 1 },
    skip: { fontSize: 12, color: withAlpha(colors.text, 0.45), textDecorationLine: 'underline', marginTop: 2 },
    btn: { minWidth: 62, minHeight: 36, borderRadius: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
    // A fixed purple: dark mode's accentActive is near-white, under white text.
    btnMain: { backgroundColor: '#6b5bd6' },
    btnQuiet: { backgroundColor: withAlpha(colors.accentActive, 0.12) },
    btnText: { fontSize: 13, fontFamily: font.headingSemibold },
    bones: { fontSize: 13, fontFamily: font.headingSemibold, color: colors.amber, minWidth: 30, textAlign: 'right' },
    foot: { fontSize: 12.5, lineHeight: 17, color: withAlpha(colors.text, 0.6), paddingTop: 6 },
    claim: { marginTop: 8, minHeight: 44, borderRadius: 12, backgroundColor: '#f0c24a', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    claimText: { fontSize: 14, fontFamily: font.headingSemibold, color: '#1b1d29', textAlign: 'center' },
  });
}
