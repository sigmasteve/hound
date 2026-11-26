import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetData } from '../widgetModel';

// The Android Fasting widget (1.3.0), like the iPhone one
// (HoundFastingLayout): the fast's hours, the bar to the goal and when it
// ends, or "Start a fast". Android redraws it every 30 minutes and when
// Hound has news, so the hours are as of the last draw; the start and end
// times are always right. Tapping opens Fasting.

type Hex = `#${string}`;

const PALETTES = {
  light: { bg: '#f5f4ff' as Hex, text: '#161826' as Hex, muted: '#5f6274' as Hex, accent: '#5d5294' as Hex, track: '#dedbf5' as Hex, green: '#2e8b57' as Hex },
  dark: { bg: '#161826' as Hex, text: '#f3f5fe' as Hex, muted: '#a3a6b8' as Hex, accent: '#b5abfc' as Hex, track: '#2e3044' as Hex, green: '#7fd39b' as Hex },
};
type Palette = (typeof PALETTES)['light'];
const AMBER: Hex = '#e0a94f';

const FORK = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path fill="${color}" d="M72 24a8 8 0 0 1 8 8v56a8 8 0 0 0 8 8V32a8 8 0 0 1 16 0v64a8 8 0 0 0 8-8V32a8 8 0 0 1 16 0v56a24 24 0 0 1-24 24h-8v112a8 8 0 0 1-16 0V112h-8a24 24 0 0 1-24-24V32a8 8 0 0 1 8-8Zm128 0c-26 0-40 40-40 88v32a8 8 0 0 0 8 8h24v72a8 8 0 0 0 16 0V32a8 8 0 0 0-8-8Z"/></svg>`;

function Bar({ pct, color, p }: { pct: number; color: Hex; p: Palette }) {
  const done = Math.max(0, Math.min(100, pct));
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', height: 6, borderRadius: 3, backgroundColor: p.track }}>
      {done > 0 && <FlexWidget style={{ flex: done, height: 6, borderRadius: 3, backgroundColor: color }} />}
      {done < 100 && <FlexWidget style={{ flex: 100 - done, height: 6 }} />}
    </FlexWidget>
  );
}

function Layout({ data, p }: { data: WidgetData; p: Palette }) {
  const f = data.ready ? data.fasting : null;
  const o = f && f.ok ? f.open : null;
  const shell = {
    width: 'match_parent' as const,
    height: 'match_parent' as const,
    padding: 14,
    borderRadius: 22,
    backgroundColor: p.bg,
  };
  const click = { clickAction: 'OPEN_URI', clickActionData: { uri: 'hound://fasting?from=widget' } };
  const head = (label: string, color: Hex) => (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', flexGap: 5 }}>
      <SvgWidget svg={FORK(color)} style={{ width: 13, height: 13 }} />
      <TextWidget text={label} style={{ flex: 1, fontSize: 12, fontWeight: '600', color } as any} />
      {f && f.streak > 0 ? <TextWidget text={`🔥 ${f.streak}`} style={{ fontSize: 11, fontWeight: '600', color: AMBER }} /> : <FlexWidget />}
    </FlexWidget>
  );

  if (!f || !f.ok) {
    return (
      <FlexWidget {...click} style={{ ...shell, justifyContent: 'center', alignItems: 'center', flexGap: 8 }}>
        <SvgWidget svg={FORK(p.accent)} style={{ width: 30, height: 30 }} />
        <TextWidget text="Open Hound to start fasting" maxLines={2} style={{ fontSize: 13, fontWeight: '600', color: p.text }} />
      </FlexWidget>
    );
  }
  if (!o) {
    return (
      <FlexWidget {...click} style={{ ...shell, justifyContent: 'space-between' }}>
        {head('FASTING', p.accent)}
        <FlexWidget style={{ flexGap: 2 }}>
          <TextWidget text="Start a fast" maxLines={1} style={{ fontSize: 22, fontWeight: '600', color: p.text }} />
          <TextWidget text={`${f.planLabel} · ${f.planHours} h`} maxLines={1} style={{ fontSize: 12, color: p.muted }} />
        </FlexWidget>
      </FlexWidget>
    );
  }
  const color = f.reached ? p.green : p.accent;
  const started = new Date(o.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <FlexWidget {...click} style={{ ...shell, justifyContent: 'space-between' }}>
      {head(f.reached ? 'GOAL REACHED' : 'FASTING', color)}
      <FlexWidget style={{ width: 'match_parent', flexGap: 4 }}>
        <TextWidget text={f.hoursText} maxLines={1} style={{ fontSize: 26, fontWeight: '600', color: p.text, adjustsFontSizeToFit: true }} />
        <Bar pct={f.pct} color={color} p={p} />
        <TextWidget
          text={f.reached ? `${o.goalHours} h done · end when you eat` : `Since ${started} · ${o.endsText}`}
          maxLines={1}
          style={{ fontSize: 11, color: p.muted }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

export function HoundFastingWidget({ data }: { data: WidgetData }) {
  return {
    light: <Layout data={data} p={PALETTES.light} />,
    dark: <Layout data={data} p={PALETTES.dark} />,
  };
}
