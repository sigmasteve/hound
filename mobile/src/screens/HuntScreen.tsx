import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppleLogoIcon,
  AndroidLogoIcon,
  ArrowLeftIcon,
  ChatCircleIcon,
  DogIcon,
  PersonSimpleRunIcon,
  PlusIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  SneakerMoveIcon,
} from 'phosphor-react-native';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { InlineBadge } from '../components/Chip';
import { text } from '../theme/text';
import { color, font } from '../theme/tokens';
import { TALLY } from '../data/sampleData';

const TALLY_ICON: Record<string, React.ComponentType<any>> = {
  run: PersonSimpleRunIcon,
  walk: SneakerMoveIcon,
  blocked: ProhibitIcon,
  dog: DogIcon,
};

export function HuntScreen({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.container}>
      <Button label="All challenges" variant="ghost" small icon={<ArrowLeftIcon size={13} color={color.accent} />} onPress={onBack} />

      <View style={styles.headerRow}>
        <View style={{ gap: 6, flex: 1 }}>
          <Text style={text.eyebrow}>HUNTER & HUNTED · 21 DAYS</Text>
          <Text style={[text.h2, { fontSize: 26 }]}>Marcus is hunting you</Text>
        </View>
        <View style={styles.headerBtns}>
          <Button label="Trash talk" small icon={<ChatCircleIcon size={14} color={color.text} />} />
          <Button label="Log" small variant="primary" icon={<PlusIcon size={14} color={color.accent} />} />
        </View>
      </View>

      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <View>
            <Text style={styles.progressLead}>7.4 mi</Text>
            <Text style={styles.progressSub}>of open road between you</Text>
          </View>
          <Text style={styles.progressMeta}>Head start: 2 days{'\n'}Ends Sat 28 Mar, 11:59pm</Text>
        </View>

        <View style={styles.track}>
          <View style={styles.dashedLine} />
          <View style={[styles.marker, styles.hunterMarker, { left: '58%' }]}>
            <DogIcon size={18} color={color.text} weight="fill" />
          </View>
          <Text style={[styles.markerLabel, { left: '58%' }]}>Marcus · 33.8 mi</Text>
          <View style={[styles.marker, styles.huntedMarker, { left: '78%' }]}>
            <SneakerMoveIcon size={18} color={color.accent100} weight="fill" />
          </View>
          <Text style={[styles.markerLabel, styles.markerLabelAccent, { left: '78%', top: 0 }]}>
            You · 41.2 mi
          </Text>
        </View>

        <View style={styles.statGrid}>
          <Stat label="Your pace" value="4.6 mi / day" />
          <Stat label="His pace" value="5.4 mi / day" valueColor={color.amber} />
          <Stat label="Caught by" value="Fri 27 Mar" />
          <Stat label="Counts toward" value="Runs & walks" />
        </View>
      </View>

      <Card style={{ gap: 4 }} elevated={false}>
        <Text style={[text.h4, { marginBottom: 4 }]}>The tally</Text>
        {TALLY.map((t, i) => {
          const Icon = TALLY_ICON[t.iconKind];
          return (
            <View key={i} style={styles.tallyRow}>
              <View style={[styles.tallyIcon, { backgroundColor: t.tint }]}>
                <Icon size={14} color={color.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tallyLabel}>{t.label}</Text>
                <Text style={styles.tallyMeta}>{t.meta}</Text>
              </View>
              <Text style={styles.tallyDist}>{t.dist}</Text>
            </View>
          );
        })}
      </Card>

      <Card style={{ gap: 14 }} elevated={false}>
        <Text style={text.h4}>Where the numbers come from</Text>
        <View style={styles.sourceRow}>
          <Avatar initials="JL" tint={color.accent800} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <Text style={styles.sourceName}>You</Text>
              <InlineBadge icon={<AppleLogoIcon size={11} color={color.neutral200} weight="fill" />} label="Apple Health · iPhone 15" />
            </View>
            <Text style={styles.sourceNote}>GPS distance from Apple Workouts. Synced 4 minutes ago.</Text>
          </View>
        </View>
        <View style={styles.sourceRow}>
          <Avatar initials="MR" tint={color.neutral800} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <Text style={styles.sourceName}>Marcus</Text>
              <InlineBadge icon={<AndroidLogoIcon size={11} color={color.neutral200} />} label="Health Connect · Pixel 8" />
            </View>
            <Text style={styles.sourceNote}>GPS distance from Google Fit sessions. Synced 22 minutes ago.</Text>
          </View>
        </View>
        <View style={styles.notice}>
          <ShieldCheckIcon size={13} color={color.accent200} />
          <Text style={styles.noticeText}>
            Both sides are scored on GPS distance only, so a treadmill or a phone left on a desk
            can&rsquo;t pad the tally.
          </Text>
        </View>
      </Card>
    </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ minWidth: 130 }}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 18, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  headerBtns: { flexDirection: 'row', gap: 8 },
  progressCard: {
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#232a54',
    gap: 20,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  progressLead: { fontFamily: font.heading, fontSize: 32, color: color.text },
  progressSub: { fontSize: 13, color: 'rgba(233,233,237,0.7)' },
  progressMeta: { fontSize: 12, color: 'rgba(233,233,237,0.55)', textAlign: 'right' },
  track: { height: 90, position: 'relative' },
  dashedLine: { position: 'absolute', left: 0, right: 0, top: 50, height: 3, backgroundColor: 'rgba(233,233,237,0.15)' },
  marker: {
    position: 'absolute',
    top: 30,
    width: 38,
    height: 38,
    marginLeft: -19,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hunterMarker: { backgroundColor: color.neutral800 },
  huntedMarker: { backgroundColor: color.accent800, borderWidth: 1, borderColor: color.accent, top: 8 },
  markerLabel: { position: 'absolute', top: 70, fontSize: 11, color: color.text, marginLeft: -40, width: 80, textAlign: 'center' },
  markerLabelAccent: { color: color.accent200 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  statLabel: { fontSize: 11, letterSpacing: 0.6, color: 'rgba(233,233,237,0.6)' },
  statValue: { fontFamily: font.heading, fontSize: 18, color: color.text, marginTop: 3 },
  tallyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233,233,237,0.07)',
  },
  tallyIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tallyLabel: { fontSize: 13.5, color: color.text },
  tallyMeta: { fontSize: 11.5, color: 'rgba(233,233,237,0.55)' },
  tallyDist: { fontFamily: font.heading, fontSize: 14, color: color.text },
  sourceRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  sourceName: { fontSize: 14, color: color.text },
  sourceNote: { fontSize: 12, color: 'rgba(233,233,237,0.55)' },
  notice: {
    flexDirection: 'row',
    gap: 6,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(145,132,217,0.10)',
    alignItems: 'flex-start',
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: color.accent200 },
});
