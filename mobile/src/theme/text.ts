import { StyleSheet } from 'react-native';
import { font, type, withAlpha, color as defaultColors, type Palette } from './tokens';

// Shared text styles so every screen sets typography the same way the CSS
// did (letter-spacing on headings, muted color via one shared token).
// Parameterized on a Palette so a theme-migrated screen can rebuild these
// against whichever colors are current (see useTheme()'s own `text`)
// instead of always reading the static dark palette below.
export function createTextStyles(colors: Palette) {
  return StyleSheet.create({
    h2: { fontFamily: font.heading, fontSize: type.h2, color: colors.text, letterSpacing: -0.4 },
    h4: { fontFamily: font.heading, fontSize: type.h4, color: colors.text, letterSpacing: -0.3 },
    h5: { fontFamily: font.heading, fontSize: type.h5, color: colors.text },
    body: { fontFamily: font.body, fontSize: type.body, color: colors.text },
    muted: { fontFamily: font.body, fontSize: 13, color: withAlpha(colors.text, 0.55) },
    eyebrow: {
      fontFamily: font.body,
      fontSize: 11,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.accent,
    },
    label: {
      fontFamily: font.body,
      fontSize: 12,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      color: withAlpha(colors.text, 0.6),
    },
  });
}

// Static/dark version — any screen that hasn't been migrated to
// useTheme() yet keeps importing this exactly as before.
export const text = createTextStyles(defaultColors);
