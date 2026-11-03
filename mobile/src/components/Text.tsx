import React from 'react';
import { StyleSheet, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { SMALLEST_TEXT, useTextSize } from '../theme/textSize';

// The app's Text: React Native's, with a cap on how far the phone's text
// size setting can grow it. Hound's screens are drawn at one size, and
// without a cap the largest accessibility settings (about 3×) clip the
// Today tiles, the top bar and the tab bar. 1.3× keeps every layout
// intact while still honouring a bigger setting. Long-form screens can
// pass LONG_FORM_SCALE_CAP, since their text just reflows. Every screen
// imports Text from here, not from 'react-native'.
//
// It also applies the Text size setting (src/theme/textSize.tsx) to
// every screen: no text smaller than SMALLEST_TEXT, sizes scaled by the
// chosen setting, and faint grey text raised to a readable contrast.
// The phone's own setting then only grows text as far as the cap allows
// on top of the app's, so the two together stay within it.
export const TEXT_SCALE_CAP = 1.3;
export const LONG_FORM_SCALE_CAP = 2;

// Text colors with an alpha below this are faint on purpose (disabled
// labels, placeholders, decoration) and are left as they are.
const DELIBERATELY_FAINT = 0.45;
const RGBA = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;

// What the setting changes in one style, or null when nothing does.
export function readableStyle(style: TextProps['style'], scale: number, fadedFloor: number): TextStyle | null {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat) return null;
  const out: TextStyle = {};
  // Only text that sets its own size: text without one inherits its
  // parent's, which is already adjusted.
  if (typeof flat.fontSize === 'number') {
    const size = Math.max(flat.fontSize, SMALLEST_TEXT) * scale;
    if (size !== flat.fontSize) {
      out.fontSize = size;
      if (typeof flat.lineHeight === 'number') out.lineHeight = flat.lineHeight * (size / flat.fontSize);
    }
  }
  if (typeof flat.color === 'string') {
    const m = RGBA.exec(flat.color);
    const alpha = m ? Number(m[4]) : 1;
    if (m && alpha >= DELIBERATELY_FAINT && alpha < fadedFloor) {
      out.color = `rgba(${m[1]},${m[2]},${m[3]},${fadedFloor})`;
    }
  }
  return Object.keys(out).length ? out : null;
}

export const Text = React.forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(function Text(props, ref) {
  const { scale, fadedFloor } = useTextSize();
  const adjust = readableStyle(props.style, scale, fadedFloor);
  const cap = props.maxFontSizeMultiplier ?? TEXT_SCALE_CAP;
  // 0 means no limit, as in React Native.
  const phoneCap = cap > 0 ? Math.max(1, cap / scale) : cap;
  return (
    <NativeText
      ref={ref}
      {...props}
      maxFontSizeMultiplier={phoneCap}
      style={adjust ? [props.style, adjust] : props.style}
    />
  );
});

export type { TextProps };
