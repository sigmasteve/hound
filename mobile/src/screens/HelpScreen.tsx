import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeftIcon,
  CaretDownIcon,
  CaretRightIcon,
  FlagCheckeredIcon,
  HouseIcon,
  LightbulbIcon,
  MagnifyingGlassIcon,
  PlugsIcon,
} from 'phosphor-react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { TextField } from '../components/TextField';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { useLabels } from '../labels/LabelsContext';
import { useCurrencyName } from '../organizations/useCurrencyName';
import { buildHelpTopics, HELP_SECTIONS, type HelpTopic } from '../help/helpTopics';

const QUICK_START: { Icon: React.ComponentType<any>; title: string; body: string }[] = [
  { Icon: PlugsIcon, title: 'Connect your health app', body: 'Connect tab → Apple Health or Health Connect.' },
  { Icon: FlagCheckeredIcon, title: 'Start or join a challenge', body: 'Challenges tab → New challenge, or Join an invite.' },
  { Icon: HouseIcon, title: 'Check Today every day', body: 'See your standing, grab your daily bonus, and clear anything waiting on you.' },
];

function matches(topic: HelpTopic, q: string): boolean {
  return [topic.title, topic.summary, topic.tip ?? '', ...topic.steps].some((s) => s.toLowerCase().includes(q));
}

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { labelsForOrg } = useLabels();
  const labels = labelsForOrg(user?.organizationId);
  const currency = useCurrencyName();
  const topics = useMemo(() => buildHelpTopics({ currency, labels }), [currency, labels]);

  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const visible = searching ? topics.filter((t) => matches(t, q)) : topics;

  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="ghost" small icon={<ArrowLeftIcon size={13} color={colors.accent} />} onPress={onBack} />
        <View style={{ gap: 4 }}>
          <Text style={text.h2}>Help</Text>
          <Text style={styles.footNote}>How to use Hound, one topic at a time.</Text>
        </View>

        <TextField
          label="Search help"
          value={query}
          onChangeText={setQuery}
          placeholder="e.g. streak, invite, Locker"
          autoCapitalize="none"
          autoCorrect={false}
          icon={<MagnifyingGlassIcon size={15} color={withAlpha(colors.text, 0.55)} />}
        />

        {!searching && (
          <Card style={styles.quickStart} elevated={false}>
            <Text style={styles.sectionTitle}>Quick start</Text>
            {QUICK_START.map(({ Icon, title, body }, i) => (
              <View key={title} style={styles.quickRow}>
                <View style={styles.quickBadge}>
                  <Text style={styles.quickBadgeText}>{i + 1}</Text>
                </View>
                <Icon size={18} color={colors.accentActive} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.topicTitle}>{title}</Text>
                  <Text style={styles.footNote}>{body}</Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {HELP_SECTIONS.map((section) => {
          const sectionTopics = visible.filter((t) => t.section === section.id);
          if (sectionTopics.length === 0) return null;
          return (
            <View key={section.id} style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <Card style={styles.topicCard} elevated={false}>
                {sectionTopics.map((topic, i) => {
                  // Every match opens on its own while searching, so a
                  // search result never needs a second tap to read.
                  const open = searching || openIds.has(topic.id);
                  return (
                    <View key={topic.id} style={i > 0 && styles.topicDivider}>
                      <Pressable
                        onPress={() => toggle(topic.id)}
                        disabled={searching}
                        style={styles.topicHeader}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.topicTitle}>{topic.title}</Text>
                          {!open && <Text style={styles.footNote}>{topic.summary}</Text>}
                        </View>
                        {open ? (
                          <CaretDownIcon size={14} color={withAlpha(colors.text, 0.5)} />
                        ) : (
                          <CaretRightIcon size={14} color={withAlpha(colors.text, 0.5)} />
                        )}
                      </Pressable>
                      {open && (
                        <View style={styles.topicBody}>
                          {topic.steps.map((step, n) => (
                            <View key={n} style={styles.stepRow}>
                              <Text style={styles.stepMarker}>{topic.numbered ? `${n + 1}.` : '•'}</Text>
                              <Text style={styles.stepText}>{step}</Text>
                            </View>
                          ))}
                          {topic.tip && (
                            <View style={styles.tip}>
                              <LightbulbIcon size={14} color={colors.accentActive} weight="fill" />
                              <Text style={[styles.stepText, { flex: 1 }]}>{topic.tip}</Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </Card>
            </View>
          );
        })}

        {searching && visible.length === 0 && (
          <Text style={styles.footNote}>Nothing matches “{query.trim()}” — try a different word.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { padding: 16, gap: 14, paddingBottom: 48 },
    footNote: { fontSize: 12.5, color: withAlpha(colors.text, 0.55) },
    sectionTitle: { fontSize: 15, fontFamily: font.heading, color: colors.text },
    sectionLabel: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: withAlpha(colors.text, 0.55) },
    // Same accent-wash spotlight as the Friends tab's invite card, so the
    // three first steps read as the place to start.
    quickStart: {
      gap: 12,
      backgroundColor: withAlpha(colors.accent, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accent, 0.4),
    },
    quickRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    quickBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.3),
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickBadgeText: { fontSize: 11, color: colors.text, fontFamily: font.heading },
    topicCard: { paddingVertical: 4 },
    topicDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
    topicHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
    topicTitle: { fontSize: 14.5, color: colors.text, fontFamily: font.heading },
    topicBody: { gap: 8, paddingBottom: 14 },
    stepRow: { flexDirection: 'row', gap: 8 },
    stepMarker: { width: 16, fontSize: 13.5, lineHeight: 20, color: colors.accentActive },
    stepText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: withAlpha(colors.text, 0.85) },
    tip: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      padding: 10,
      borderRadius: 10,
      backgroundColor: withAlpha(colors.accent, 0.1),
    },
  });
}
