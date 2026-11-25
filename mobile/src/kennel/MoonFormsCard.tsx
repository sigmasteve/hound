import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LockSimpleIcon, PlayIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { HoundArt } from './HoundArt';
import { MoonScene, lookFromKennel } from './MoonScene';
import { MOON_FORMS, type MoonForm } from './moonForms';
import { getMoonState, logMoonWatched, setMoonOn, type MoonRank, type MoonState } from './moonApi';
import type { Kennel } from './kennelApi';

// The Kennel's Moon forms (0264): every rank's transformation, to watch
// again once reached (the rest locked, with the level they open at), and
// the switch for your hound's moon look.
export function MoonFormsCard({ kennel, level }: { kennel: Kennel; level: number }) {
  const { colors, text } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<MoonState | null>(null);
  const [playing, setPlaying] = useState<MoonForm | null>(null);

  useFocusEffect(
    useCallback(() => {
      getMoonState()
        .then(setState)
        .catch(() => {});
    }, []),
  );

  const on = state?.on ?? true;
  const look = lookFromKennel(kennel);

  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <View style={styles.head}>
        <Text style={text.h4}>Moon forms</Text>
        <Text style={styles.small}>
          {MOON_FORMS.filter((f) => level >= f.level).length} of {MOON_FORMS.length}
        </Text>
      </View>
      <Text style={styles.small}>Each new rank is a transformation under the moon. Tap one to watch it again.</Text>
      <View style={styles.grid}>
        {MOON_FORMS.map((f) => {
          const reached = level >= f.level;
          return (
            <Pressable
              key={f.rank}
              disabled={!reached}
              onPress={() => setPlaying(f)}
              style={({ pressed }) => [styles.tile, { backgroundColor: f.sky[0] }, pressed && { opacity: 0.8 }]}
              accessibilityRole="button"
              accessibilityLabel={reached ? `Watch ${f.title}, ${f.form}` : `${f.form}, opens at level ${f.level}`}
            >
              <View style={[styles.moon, { backgroundColor: f.phase === 'blue' ? '#cfe0ff' : '#f6efcf', opacity: reached ? 1 : 0.35 }]} />
              <View style={{ opacity: reached ? 1 : 0.18 }}>
                <HoundArt {...look} rank={f.rank} moon={f.rank} mood="happy" size={62} animate={false} />
              </View>
              <Text style={styles.tileTitle} numberOfLines={1}>
                {f.form}
              </Text>
              <View style={styles.tileFoot}>
                {reached ? <PlayIcon size={11} color="#f6efcf" weight="fill" /> : <LockSimpleIcon size={11} color="#c9cff5" />}
                <Text style={styles.tileSub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {reached ? f.title : `Level ${f.level}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.head}>
        <Text style={[styles.body, { flex: 1 }]}>Show my hound’s moon look</Text>
        <Switch
          value={on}
          onValueChange={(v) => {
            setState((s) => (s ? { ...s, on: v } : s));
            setMoonOn(v).catch(() => setState((s) => (s ? { ...s, on: !v } : s)));
          }}
        />
      </View>
      <Text style={styles.small}>Off: the crescent, mane, glowing eyes and moonlight come off your hound. The scenes stay here.</Text>
      {playing && (
        <MoonScene
          form={playing}
          look={look}
          level={playing.level}
          replay
          onWatched={(skipped) => logMoonWatched(playing.rank as MoonRank, 'replay', skipped)}
          onClose={() => setPlaying(null)}
        />
      )}
    </Card>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    small: { fontSize: 12.5, color: withAlpha(colors.text, 0.62), fontFamily: font.body },
    body: { fontSize: 14, color: colors.text, fontFamily: font.body },
    grid: { flexDirection: 'row', gap: 8 },
    tile: { flex: 1, borderRadius: 14, alignItems: 'center', paddingTop: 8, paddingBottom: 8, paddingHorizontal: 4, overflow: 'hidden', gap: 2 },
    moon: { position: 'absolute', top: 6, right: 8, width: 14, height: 14, borderRadius: 7 },
    tileTitle: { color: '#ffffff', fontSize: 12.5, fontFamily: font.heading },
    tileFoot: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '100%', paddingHorizontal: 2 },
    tileSub: { flexShrink: 1, color: '#c9cff5', fontSize: 10, fontFamily: font.headingSemibold },
  });
}
