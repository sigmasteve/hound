import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../components/Text';
import { font } from '../theme/tokens';
import { HoundArt } from './HoundArt';
import { lookFromKennel } from './MoonScene';
import type { MoonForm } from './moonForms';
import type { Kennel } from './kennelApi';

// The one-time catch-up (0264): ranks reached before moon forms shipped.
// Your hound in its newest form under the moon, and Watch (every scene in
// order) or Later (the Kennel's Moon forms still has them all).
export function MoonCatchupModal({
  forms,
  kennel,
  onWatch,
  onLater,
}: {
  forms: MoonForm[];
  kennel: Kennel | null;
  onWatch: () => void;
  onLater: () => void;
}) {
  const newest = forms[forms.length - 1];
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onLater}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.scene}>
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 300 200">
              <Defs>
                <LinearGradient id="cuSky" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={newest.sky[0]} />
                  <Stop offset="1" stopColor={newest.sky[1]} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={300} height={200} fill="url(#cuSky)" />
              <Circle cx={230} cy={46} r={26} fill={newest.phase === 'blue' ? '#cfe0ff' : '#f6efcf'} />
              <Rect x={0} y={170} width={300} height={30} fill={newest.ground} />
            </Svg>
            {kennel && (
              <View style={{ position: 'absolute', bottom: 14, alignSelf: 'center' }}>
                <HoundArt {...lookFromKennel(kennel)} rank={newest.rank} moon={newest.rank} mood="happy" size={120} animate={false} />
              </View>
            )}
          </View>
          <View style={styles.body}>
            <Text style={styles.eyebrow}>NEW · MOON FORMS</Text>
            <Text style={styles.title}>Your hound has changed under the moon</Text>
            <Text style={styles.text}>
              Every new rank is now a transformation. You’ve reached {forms.length === 1 ? 'one' : forms.length}: {forms.map((f) => f.form).join(', ')}. Watch
              how your hound got here.
            </Text>
            <Pressable style={styles.primary} onPress={onWatch} accessibilityRole="button">
              <Text style={styles.primaryText}>{forms.length === 1 ? 'Watch it' : `Watch all ${forms.length}`}</Text>
            </Pressable>
            <Pressable style={styles.later} onPress={onLater} accessibilityRole="button">
              <Text style={styles.laterText}>Later (they’re in the Kennel)</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(6,8,20,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 22, overflow: 'hidden', backgroundColor: '#161a33' },
  scene: { height: 200, overflow: 'hidden' },
  body: { padding: 18, gap: 8, alignItems: 'center' },
  eyebrow: { color: '#c9cff5', fontSize: 11.5, letterSpacing: 1.5, fontFamily: font.headingSemibold },
  title: { color: '#fff', fontSize: 21, fontFamily: font.heading, textAlign: 'center' },
  text: { color: '#dfe3ff', fontSize: 14, fontFamily: font.body, textAlign: 'center', lineHeight: 20 },
  primary: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: '#f6efcf', borderRadius: 12, paddingVertical: 12, marginTop: 6 },
  primaryText: { color: '#1b1d29', fontFamily: font.heading, fontSize: 15 },
  later: { paddingVertical: 8 },
  laterText: { color: '#c9cff5', fontFamily: font.headingSemibold, fontSize: 13.5 },
});
