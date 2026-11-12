import React, { useMemo, useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { BoneIcon, CrosshairIcon } from 'phosphor-react-native';
import { Text } from '../components/Text';
import { Avatar } from '../components/Avatar';
import { useTheme } from '../theme/ThemeContext';
import { withAlpha, type Palette } from '../theme/tokens';
import type { PackFunMember } from './packFunApi';
import { hasLiveFeatures } from './packFunSensors';

// The live map: the pack's spots and the bones dropped near them.
// iPhone uses Apple Maps; Android uses Google Maps when the build has a
// key (GOOGLE_MAPS_ANDROID_KEY, see app.config.js). Anywhere else (or on
// an older build) it's a plain drawing of the same spots.

type Spot = { lat: number; lng: number };

let maps: typeof import('react-native-maps') | null | undefined;
function mapsModule() {
  if (maps !== undefined) return maps;
  maps = null;
  if (!hasLiveFeatures()) return maps;
  if (Platform.OS === 'android' && !Constants.expoConfig?.extra?.androidMaps) return maps;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    maps = require('react-native-maps');
  } catch {
    maps = null;
  }
  return maps;
}

export function packCentre(members: PackFunMember[]): Spot | null {
  const spots = members.filter((m) => m.lat != null && m.lng != null);
  if (!spots.length) return null;
  return {
    lat: spots.reduce((s, m) => s + (m.lat as number), 0) / spots.length,
    lng: spots.reduce((s, m) => s + (m.lng as number), 0) / spots.length,
  };
}

export function PackFunMap({
  members,
  bones,
  me,
  myId,
  height = 340,
}: {
  members: PackFunMember[];
  bones: { id: string; lat: number; lng: number }[];
  me: Spot | null;
  myId: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const placed = members.filter((m) => m.lat != null && m.lng != null);
  const centre = me ?? packCentre(members);
  const M = mapsModule();
  const ref = useRef<any>(null);

  if (!centre) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Nobody’s spot yet. The map fills in as the pack shares theirs.</Text>
      </View>
    );
  }

  const all: Spot[] = [...placed.map((m) => ({ lat: m.lat as number, lng: m.lng as number })), ...bones, ...(me ? [me] : [])];
  const latSpan = Math.max(0.006, (Math.max(...all.map((s) => s.lat)) - Math.min(...all.map((s) => s.lat))) * 1.6);
  const lngSpan = Math.max(0.006, (Math.max(...all.map((s) => s.lng)) - Math.min(...all.map((s) => s.lng))) * 1.6);
  const region = { latitude: centre.lat, longitude: centre.lng, latitudeDelta: latSpan, longitudeDelta: lngSpan };

  const pin = (m: PackFunMember) => (
    <View style={styles.pin}>
      <View style={[styles.pinRing, m.userId === myId && { borderColor: colors.accent }, !m.live && { opacity: 0.55 }]}>
        <Avatar initials={m.initials} tint={colors.accent800} size={34} fontSize={12} iconId={m.iconId} frameId={m.frameId} backgroundId={m.backgroundId} />
      </View>
      <Text style={styles.pinName} numberOfLines={1}>
        {m.userId === myId ? 'You' : m.name.split(' ')[0]}
      </Text>
    </View>
  );
  const bone = (
    <View style={styles.bone}>
      <BoneIcon size={18} color="#1b1d29" weight="fill" />
    </View>
  );

  if (M) {
    const MapView = M.default;
    const { Marker } = M;
    return (
      <View style={[styles.frame, { height }]}>
        <MapView
          ref={ref}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          provider={Platform.OS === 'android' ? M.PROVIDER_GOOGLE : undefined}
          showsUserLocation={!!me}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
        >
          {placed.map((m) => (
            <Marker key={m.userId} coordinate={{ latitude: m.lat as number, longitude: m.lng as number }} anchor={{ x: 0.5, y: 0.5 }}>
              {pin(m)}
            </Marker>
          ))}
          {bones.map((b) => (
            <Marker key={b.id} coordinate={{ latitude: b.lat, longitude: b.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              {bone}
            </Marker>
          ))}
        </MapView>
        <Pressable
          style={styles.recentre}
          onPress={() => ref.current?.animateToRegion?.(region, 400)}
          accessibilityRole="button"
          accessibilityLabel="Show the whole pack"
        >
          <CrosshairIcon size={20} color={colors.text} />
        </Pressable>
      </View>
    );
  }

  // The plain drawing: north up, spots placed by their offset from the centre.
  const toXY = (s: Spot, w: number) => ({
    left: w / 2 + ((s.lng - centre.lng) / lngSpan) * w,
    top: height / 2 - ((s.lat - centre.lat) / latSpan) * height,
  });
  return (
    <View style={[styles.frame, styles.plain, { height }]}>
      <PlainLayer>
        {(w) => (
          <>
            {[0.25, 0.5, 0.75].map((f) => (
              <View key={`h${f}`} style={[styles.gridH, { top: height * f }]} />
            ))}
            {[0.25, 0.5, 0.75].map((f) => (
              <View key={`v${f}`} style={[styles.gridV, { left: w * f }]} />
            ))}
            {bones.map((b) => {
              const p = toXY(b, w);
              return (
                <View key={b.id} style={[styles.abs, { left: p.left - 15, top: p.top - 15 }]}>
                  {bone}
                </View>
              );
            })}
            {placed.map((m) => {
              const p = toXY({ lat: m.lat as number, lng: m.lng as number }, w);
              return (
                <View key={m.userId} style={[styles.abs, { left: p.left - 30, top: p.top - 20, width: 60 }]}>
                  {pin(m)}
                </View>
              );
            })}
          </>
        )}
      </PlainLayer>
    </View>
  );
}

function PlainLayer({ children }: { children: (width: number) => React.ReactNode }) {
  const [w, setW] = React.useState(0);
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && children(w)}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    frame: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    plain: { backgroundColor: withAlpha(colors.green, 0.12) },
    gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: withAlpha(colors.text, 0.08) },
    gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: withAlpha(colors.text, 0.08) },
    abs: { position: 'absolute', alignItems: 'center' },
    empty: { borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyText: { textAlign: 'center', color: withAlpha(colors.text, 0.65), fontSize: 14.5, lineHeight: 20 },
    pin: { alignItems: 'center', width: 60 },
    pinRing: { borderRadius: 22, borderWidth: 3, borderColor: '#ffffff', backgroundColor: '#ffffff' },
    pinName: { marginTop: 2, fontSize: 11, fontWeight: '600', color: '#1b1d29', backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 5, borderRadius: 6, overflow: 'hidden' },
    bone: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#e0b84f', borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
    recentre: { position: 'absolute', right: 10, top: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  });
}
