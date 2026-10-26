import React, { useMemo } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { font as fonts, withAlpha } from '../theme/tokens';
import { pathTo, pointAt, type Course, type LatLng } from './courses';
import { COURSE_MAPS } from './courseMaps';

export interface MapPerson {
  id: string;
  miles: number;
  initials: string;
  color: string;
}

// A course drawn as one simplified line, the way it looks on Journeys:
// gold dots for the stops (filled once passed), the walked part in
// purple, and you (a paw) or your friends (their initials) on it. On a
// real map where the course has one (courseMaps.ts, OpenStreetMap);
// otherwise water and rivers for context, in the app's own colours. A
// stop's close-up (focus) is always the drawn kind.

// Web Mercator, the tiles' projection: x and y in 0..1 across the world.
function mercator([lat, lng]: LatLng): [number, number] {
  const r = (lat * Math.PI) / 180;
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2];
}
export function JourneyMap({
  course,
  width,
  height,
  miles,
  people = [],
  labels = 'few',
  compact = false,
  focus,
}: {
  course: Course;
  width: number;
  height: number;
  // How far you've gone; null draws the course alone.
  miles: number | null;
  people?: MapPerson[];
  labels?: 'none' | 'few' | 'all';
  // A thumbnail (the Today tile): thinner line, smaller paw, only the
  // start and finish marked.
  compact?: boolean;
  // Show this many miles across, centred on a point, instead of the
  // whole course (a stop's postcard).
  focus?: { at: LatLng; miles: number };
}) {
  const { colors } = useTheme();
  const w = width;
  const h = height;
  const basemap = focus ? undefined : COURSE_MAPS[course.id];

  const { project, image } = useMemo(() => {
    if (basemap) {
      // The picture covers exactly its bounds; fit it in the box and
      // project onto it the way the tiles were drawn.
      const b = basemap.bounds;
      const [x0, y1] = mercator([b.minLat, b.minLng]);
      const [x1, y0] = mercator([b.maxLat, b.maxLng]);
      const s = Math.min(w / (x1 - x0), h / (y1 - y0));
      const ox = (w - (x1 - x0) * s) / 2;
      const oy = (h - (y1 - y0) * s) / 2;
      return {
        project: (p: LatLng): [number, number] => {
          const [mx, my] = mercator(p);
          return [ox + (mx - x0) * s, oy + (my - y0) * s];
        },
        image: { left: ox, top: oy, width: (x1 - x0) * s, height: (y1 - y0) * s },
      };
    }
    const lats = course.path.map((p) => p[0]);
    const lngs = course.path.map((p) => p[1]);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLng = Math.min(...lngs);
    let maxLng = Math.max(...lngs);
    const padLat = (maxLat - minLat) * 0.08 || 0.002;
    const padLng = (maxLng - minLng) * 0.08 || 0.002;
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
    if (focus) {
      const half = focus.miles / 2;
      const dLat = half / 69;
      const dLng = half / (69 * Math.cos((focus.at[0] * Math.PI) / 180));
      minLat = focus.at[0] - dLat;
      maxLat = focus.at[0] + dLat;
      minLng = focus.at[1] - dLng;
      maxLng = focus.at[1] + dLng;
    }
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const s = Math.min(w / ((maxLng - minLng) * kx), h / (maxLat - minLat));
    const ox = (w - (maxLng - minLng) * kx * s) / 2;
    const oy = (h - (maxLat - minLat) * s) / 2;
    return {
      project: ([la, ln]: LatLng): [number, number] => [ox + (ln - minLng) * kx * s, oy + (maxLat - la) * s],
      image: null,
    };
  }, [course, w, h, focus, basemap]);

  const d = (pts: LatLng[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${project(p)[0].toFixed(1)},${project(p)[1].toFixed(1)}`).join(' ');

  const line = compact ? Math.max(2, w / 90) : Math.max(3, w / 70);
  const dot = compact ? Math.max(2.5, w / 110) : Math.max(3, w / 95);
  const font = Math.max(9, w / 38);
  const done = miles ?? 0;
  const last = course.stops.length - 1;
  // A thumbnail (no labels, nobody on it, or compact) keeps just the start and finish.
  const stopsToDraw = compact || (labels === 'none' && miles === null) ? course.stops.filter((_, i) => i === 0 || i === last) : course.stops;
  const candidates =
    labels === 'none'
      ? []
      : labels === 'all'
        ? course.stops
        : course.stops.filter((s, i) => i === 0 || i === last || s.name === 'Halfway');
  // Skip a label that would land on one already placed; a finish next to
  // the start (both in the same park) becomes "Start & finish".
  const stopsToLabel: { mi: number; text: string; at: [number, number] }[] = [];
  for (const s of candidates) {
    const at = project(pointAt(course, s.mi));
    const clash = stopsToLabel.find((l) => Math.abs(l.at[0] - at[0]) < font * 6 && Math.abs(l.at[1] - at[1]) < font * 1.6);
    if (clash) {
      if (s.mi === course.miles && clash.mi === 0) clash.text = 'Start & finish';
      continue;
    }
    stopsToLabel.push({ mi: s.mi, text: s.mi === 0 ? 'Start' : s.mi === course.miles ? 'Finish' : s.name, at });
  }

  // On a picture the line and the words need a light halo to read over
  // streets and hills; the drawn map uses the theme's own contrast.
  const halo = basemap ? 'rgba(255,255,255,0.85)' : null;
  const ink = basemap ? '#1e1e28' : withAlpha(colors.text, 0.8);
  const pathInk = basemap ? 'rgba(64,64,84,0.8)' : withAlpha(colors.text, 0.22);
  const haloWidth = Math.max(1.5, w / 160);

  const svg = (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {!basemap && <Rect width={w} height={h} rx={12} fill={withAlpha(colors.text, 0.04)} />}
      {!basemap && (course.water ?? []).map((poly, i) => (
        <Path key={`w${i}`} d={`${d(poly)} Z`} fill={withAlpha('#3b6fb5', 0.22)} />
      ))}
      {!basemap && (course.rivers ?? []).map((r, i) => (
        <Path key={`r${i}`} d={d(r)} stroke={withAlpha('#4a7bc4', 0.45)} strokeWidth={line * 0.7} fill="none" strokeLinecap="round" />
      ))}
      {!basemap && labels !== 'none' && (course.labels ?? []).map((l) => {
        const [x, y] = project(l.at);
        return (
          <SvgText key={l.text} x={x} y={y} fill={withAlpha('#8fb0e0', 0.55)} fontSize={font * 0.9} fontFamily={fonts.headingSemibold} textAnchor="middle" letterSpacing={1.5}>
            {l.text}
          </SvgText>
        );
      })}
      {halo && <Path d={d(course.path)} stroke={halo} strokeWidth={line + haloWidth * 2} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
      <Path d={d(course.path)} stroke={pathInk} strokeWidth={line} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {done > 0 && (
        <Path d={d(pathTo(course, done))} stroke={colors.accent} strokeWidth={line} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {stopsToDraw.map((s) => {
        const [x, y] = project(pointAt(course, s.mi));
        const passed = s.mi <= done && done > 0;
        return (
          <Circle key={`s${s.mi}`} cx={x} cy={y} r={dot} fill={passed ? colors.gold : colors.bg} stroke={colors.gold} strokeWidth={Math.max(1, w / 320)} />
        );
      })}
      {stopsToLabel.map((s) => {
        const [x, y] = s.at;
        const left = x > w * 0.6;
        const tx = left ? x - dot * 2 : x + dot * 2;
        const anchor = left ? 'end' : 'start';
        return (
          <G key={`l${s.mi}`}>
            {halo && (
              <SvgText x={tx} y={y + font * 0.35} stroke={halo} strokeWidth={haloWidth * 2} strokeLinejoin="round" fill={halo} fontSize={font} fontFamily={fonts.headingSemibold} textAnchor={anchor}>
                {s.text}
              </SvgText>
            )}
            <SvgText x={tx} y={y + font * 0.35} fill={ink} fontSize={font} fontFamily={fonts.headingSemibold} textAnchor={anchor}>
              {s.text}
            </SvgText>
          </G>
        );
      })}
      {basemap && !compact && (
        <G>
          <SvgText x={w - 6} y={h - 5} stroke={halo ?? undefined} strokeWidth={haloWidth * 1.5} strokeLinejoin="round" fill={halo ?? undefined} fontSize={font * 0.7} fontFamily={fonts.body} textAnchor="end">
            {basemap.attribution}
          </SvgText>
          <SvgText x={w - 6} y={h - 5} fill={ink} fontSize={font * 0.7} fontFamily={fonts.body} textAnchor="end">
            {basemap.attribution}
          </SvgText>
        </G>
      )}
      {people.map((p) => {
        const [x, y] = project(pointAt(course, p.miles));
        const r = Math.max(9, w / 34);
        return (
          <G key={p.id}>
            <Circle cx={x} cy={y} r={r} fill={p.color} stroke={colors.bg} strokeWidth={2} />
            <SvgText x={x} y={y + r * 0.33} fill="#161826" fontSize={r * 0.85} fontFamily={fonts.headingSemibold} textAnchor="middle">
              {p.initials}
            </SvgText>
          </G>
        );
      })}
      {miles !== null && people.length === 0 && (() => {
        const [x, y] = project(pointAt(course, done));
        const r = compact ? Math.max(7, w / 20) : Math.max(10, w / 28);
        return (
          <G>
            <Circle cx={x} cy={y} r={r} fill={colors.accent} stroke={colors.text} strokeWidth={2} />
            <SvgText x={x} y={y + r * 0.38} fontSize={r * 1.05} textAnchor="middle">
              🐾
            </SvgText>
          </G>
        );
      })()}
    </Svg>
  );

  if (!basemap || !image) return svg;
  return (
    <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: withAlpha(colors.text, 0.04) }}>
      <Image
        source={basemap.source}
        style={{ position: 'absolute', left: image.left, top: image.top, width: image.width, height: image.height }}
        resizeMode="stretch"
        accessibilityIgnoresInvertColors
      />
      {svg}
    </View>
  );
}
