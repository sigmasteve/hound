import React from 'react';
import { FlexWidget, ImageWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetData } from '../widgetModel';

// The Android home screen widget: the same as the iPhone one
// (ios/layouts.tsx), drawn with react-native-android-widget. One widget
// that you resize: small shows your hound and steps, wider adds each goal.
// Android asks for a light and a dark version and shows the one that
// matches the phone.

type Hex = `#${string}`;

const PALETTES = {
  light: { bg: '#f5f4ff' as Hex, text: '#161826' as Hex, muted: '#5f6274' as Hex, accent: '#5d5294' as Hex, track: '#dedbf5' as Hex, green: '#2e8b57' as Hex },
  dark: { bg: '#161826' as Hex, text: '#f3f5fe' as Hex, muted: '#a3a6b8' as Hex, accent: '#b5abfc' as Hex, track: '#2e3044' as Hex, green: '#7fd39b' as Hex },
};
type Palette = (typeof PALETTES)['light'];

const AMBER: Hex = '#e0a94f';

// Wide enough for the goals beside the hound (dp).
const MEDIUM_MIN_WIDTH = 250;

function ring(pct: number, color: string, track: string): string {
  const r = 17;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
<circle cx="22" cy="22" r="${r}" fill="none" stroke="${track}" stroke-width="5"/>
<circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
 stroke-dasharray="${filled} ${c}" transform="rotate(-90 22 22)"/></svg>`;
}

const PAW = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><g fill="${color}">
<circle cx="80" cy="84" r="24"/><circle cx="128" cy="64" r="24"/><circle cx="176" cy="84" r="24"/>
<circle cx="52" cy="132" r="22"/><circle cx="204" cy="132" r="22"/>
<path d="M128 112c-34 0-70 46-70 76 0 22 18 30 36 30 14 0 22-8 34-8s20 8 34 8c18 0 36-8 36-30 0-30-36-76-70-76z"/></g></svg>`;

function Hound({ data, size, p }: { data: WidgetData; size: number; p: Palette }) {
  return data.houndImage ? (
    // The whole hound is 1.2 times as tall as wide (WidgetHound).
    <ImageWidget image={data.houndImage as `data:image${string}`} imageWidth={Math.round(size / 1.2)} imageHeight={size} />
  ) : (
    <SvgWidget svg={PAW(p.accent)} style={{ width: size * 0.7, height: size * 0.7 }} />
  );
}

// A goal's bar: two pieces sharing the width by how far along it is.
function Bar({ pct, color, p }: { pct: number; color: Hex; p: Palette }) {
  const done = Math.max(0, Math.min(100, pct));
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', height: 5, borderRadius: 3, backgroundColor: p.track }}>
      {done > 0 && <FlexWidget style={{ flex: done, height: 5, borderRadius: 3, backgroundColor: color }} />}
      {done < 100 && <FlexWidget style={{ flex: 100 - done, height: 5 }} />}
    </FlexWidget>
  );
}

function goalsLine(data: WidgetData): string {
  if (data.total === 0) return 'No goals yet';
  return data.done === data.total ? 'All goals done' : `${data.done} of ${data.total} goals`;
}

function Layout({ data, width, p }: { data: WidgetData; width: number; p: Palette }) {
  const shell = {
    width: 'match_parent' as const,
    height: 'match_parent' as const,
    padding: 14,
    borderRadius: 22,
    backgroundColor: p.bg,
  };

  if (!data.ready) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ ...shell, justifyContent: 'center', alignItems: 'center', flexGap: 8 }}>
        <Hound data={data} size={44} p={p} />
        <TextWidget text="Open Hound to set up your widget" maxLines={2} style={{ fontSize: 13, fontWeight: '600', color: p.text }} />
      </FlexWidget>
    );
  }

  if (width >= MEDIUM_MIN_WIDTH) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ ...shell, flexDirection: 'row', alignItems: 'center', flexGap: 14 }}>
        <FlexWidget style={{ width: 104, alignItems: 'center', flexGap: 2 }}>
          <Hound data={data} size={96} p={p} />
          <TextWidget text={data.moodLine} maxLines={2} style={{ fontSize: 11, color: p.muted }} />
          {data.streak > 1 && (
            <TextWidget text={`🔥 ${data.streak}-day streak`} style={{ fontSize: 11, fontWeight: '600', color: AMBER }} />
          )}
        </FlexWidget>
        <FlexWidget style={{ flex: 1, height: 'match_parent', justifyContent: 'center', flexGap: 7 }}>
          <TextWidget text={goalsLine(data)} style={{ fontSize: 15, fontWeight: '600', color: p.text }} />
          {data.goals.slice(0, 3).map((g, i) => (
            <FlexWidget key={i} style={{ width: 'match_parent', flexGap: 3 }}>
              <FlexWidget style={{ flexDirection: 'row', width: 'match_parent' }}>
                <TextWidget text={g.title} maxLines={1} truncate="END" style={{ flex: 1, fontSize: 12, fontWeight: '500', color: p.text } as any} />
                <TextWidget
                  text={g.done ? '✓' : `${g.value} / ${g.target}`}
                  style={{ fontSize: 11, color: g.done ? p.green : p.muted }}
                />
              </FlexWidget>
              <Bar pct={g.pct} color={g.done ? p.green : p.accent} p={p} />
            </FlexWidget>
          ))}
          {data.goals.length === 0 && (
            <TextWidget text="Set goals in Hound and they'll show here." style={{ fontSize: 12, color: p.muted }} />
          )}
        </FlexWidget>
      </FlexWidget>
    );
  }

  const streak = data.streak > 1 ? ` · 🔥 ${data.streak}` : '';
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...shell, justifyContent: 'space-between' }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <Hound data={data} size={60} p={p} />
        {data.stepsGoal !== null && (
          <SvgWidget svg={ring(data.stepsPct, data.stepsPct >= 100 ? p.green : p.accent, p.track)} style={{ width: 40, height: 40 }} />
        )}
      </FlexWidget>
      <FlexWidget style={{ flexGap: 1 }}>
        <TextWidget text={data.stepsText} maxLines={1} style={{ fontSize: 26, fontWeight: '600', color: p.text, adjustsFontSizeToFit: true }} />
        <TextWidget
          text={data.stepsGoalText ? `of ${data.stepsGoalText} steps` : 'steps today'}
          maxLines={1}
          style={{ fontSize: 12, color: p.muted }}
        />
        <TextWidget text={`${goalsLine(data)}${streak}`} maxLines={1} style={{ fontSize: 12, fontWeight: '600', color: p.accent }} />
      </FlexWidget>
    </FlexWidget>
  );
}

export function HoundGoalsWidget({ data, width }: { data: WidgetData; width: number }) {
  return {
    light: <Layout data={data} width={width} p={PALETTES.light} />,
    dark: <Layout data={data} width={width} p={PALETTES.dark} />,
  };
}
