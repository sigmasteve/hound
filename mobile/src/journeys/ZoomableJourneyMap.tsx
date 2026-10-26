import React, { useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { ArrowsOutSimpleIcon, XIcon } from 'phosphor-react-native';
import { useTheme } from '../theme/ThemeContext';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { JourneyMap, type MapPerson } from './JourneyMap';
import type { Course, CourseStop } from './courses';

const MAX_ZOOM = 4;

// A Journey map with a button to open it full screen, where it can be
// pinched to zoom (up to 4×), dragged, and double-tapped to zoom in and
// back out. Stops stay tappable there. The map is drawn at the full
// screen's width, so a bundled picture has its pixels to spare at 2×
// and goes soft past that; the drawn kind stays sharp.
export function ZoomableJourneyMap({
  course,
  width,
  height,
  miles,
  people,
  labels = 'few',
  onStopPress,
}: {
  course: Course;
  width: number;
  height: number;
  miles: number | null;
  people?: MapPerson[];
  labels?: 'none' | 'few' | 'all';
  onStopPress?: (stop: CourseStop) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  return (
    <View style={{ width, height }}>
      <JourneyMap course={course} width={width} height={height} miles={miles} people={people} labels={labels} onStopPress={onStopPress} />
      <Pressable onPress={() => setOpen(true)} style={styles.expand} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open the map full screen">
        <ArrowsOutSimpleIcon size={16} color="#1e1e28" weight="bold" />
      </Pressable>
      {open && (
        <MapZoomModal course={course} miles={miles} people={people} onStopPress={onStopPress} onClose={() => setOpen(false)} />
      )}
    </View>
  );
}

function MapZoomModal({
  course,
  miles,
  people,
  onStopPress,
  onClose,
}: {
  course: Course;
  miles: number | null;
  people?: MapPerson[];
  onStopPress?: (stop: CourseStop) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const w = screenW;
  const h = Math.round(screenH * 0.82);

  // Where the map is: the animated values drive the transform, the ref
  // is what the gestures build on (no Reanimated here, so the callbacks
  // run on the JS thread and keep their own copy).
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const start = useRef({ s: 1, x: 0, y: 0 });

  const clampXY = (s: number, x: number, y: number) => {
    const maxX = (w * (s - 1)) / 2;
    const maxY = (h * (s - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const apply = (s: number, x: number, y: number, animated = false) => {
    const c = clampXY(s, x, y);
    cur.current = { s, x: c.x, y: c.y };
    if (animated) {
      Animated.parallel([
        Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 8 }),
        Animated.spring(tx, { toValue: c.x, useNativeDriver: true, friction: 8 }),
        Animated.spring(ty, { toValue: c.y, useNativeDriver: true, friction: 8 }),
      ]).start();
    } else {
      scale.setValue(s);
      tx.setValue(c.x);
      ty.setValue(c.y);
    }
  };

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      start.current = { ...cur.current };
    })
    .onUpdate((e) => {
      const s = Math.max(1, Math.min(MAX_ZOOM, start.current.s * e.scale));
      // Zoom about the fingers: keep the point under them still.
      const fx = e.focalX - w / 2;
      const fy = e.focalY - h / 2;
      const k = s / start.current.s;
      apply(s, fx - (fx - start.current.x) * k, fy - (fy - start.current.y) * k);
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minPointers(1)
    .maxPointers(2)
    .onStart(() => {
      start.current = { ...cur.current };
    })
    .onUpdate((e) => {
      apply(cur.current.s, start.current.x + e.translationX, start.current.y + e.translationY);
    });
  const doubleTap = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .onEnd((e) => {
      if (cur.current.s > 1.05) {
        apply(1, 0, 0, true);
      } else {
        const s = 2.5;
        const fx = e.x - w / 2;
        const fy = e.y - h / 2;
        apply(s, fx - fx * s, fy - fy * s, true);
      }
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={[styles.full, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {course.name}
              </Text>
              <Text style={styles.headerSub}>Pinch to zoom · drag to move · double-tap to zoom in or out</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={22} color={colors.text} />
            </Pressable>
          </View>
          <GestureDetector gesture={gesture}>
            <View style={{ width: w, height: h, overflow: 'hidden' }}>
              <Animated.View style={{ width: w, height: h, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
                <JourneyMap course={course} width={w} height={h} miles={miles} people={people} labels="all" onStopPress={onStopPress} />
              </Animated.View>
            </View>
          </GestureDetector>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    expand: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(255,255,255,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    full: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    headerTitle: { fontFamily: font.headingSemibold, fontSize: 18, color: colors.text },
    headerSub: { fontSize: 12, color: withAlpha(colors.text, 0.55) },
  });
}
