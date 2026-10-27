import React from 'react';
import { Text as NativeText, type TextProps } from 'react-native';

// The app's Text: React Native's, with a cap on how far the phone's text
// size setting can grow it. Hound's screens are drawn at one size, and
// without a cap the largest accessibility settings (about 3×) clip the
// Today tiles, the top bar and the tab bar. 1.3× keeps every layout
// intact while still honouring a bigger setting. Long-form screens can
// pass LONG_FORM_SCALE_CAP, since their text just reflows. Every screen
// imports Text from here, not from 'react-native'.
export const TEXT_SCALE_CAP = 1.3;
export const LONG_FORM_SCALE_CAP = 2;

export const Text = React.forwardRef<React.ComponentRef<typeof NativeText>, TextProps>(function Text(props, ref) {
  return <NativeText ref={ref} maxFontSizeMultiplier={TEXT_SCALE_CAP} {...props} />;
});

export type { TextProps };
