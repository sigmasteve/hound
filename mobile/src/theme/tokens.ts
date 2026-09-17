// Nocturne design tokens, ported from the web app's styles.css (:root block).
// Keep this file as the single source of truth for color/space/radius/type —
// screens should read from `theme`, never hardcode a hex value.

export const color = {
  bg: '#161826',
  surface: '#232532',
  text: '#e9e9ed',
  divider: 'rgba(233,233,237,0.16)',

  neutral100: '#f3f5fe',
  neutral200: '#e4e7f5',
  neutral300: '#cfd3e5',
  neutral400: '#b2b6ca',
  neutral500: '#9397ab',
  neutral600: '#75798c',
  neutral700: '#595d6c',
  neutral800: '#3f424d',
  neutral900: '#292b31',

  accent: '#9184d9',
  accent100: '#f5f4ff',
  accent200: '#e7e5fe',
  accent300: '#d2cefd',
  accent400: '#b5abfc',
  accent500: '#968ae0',
  accent600: '#796cbf',
  accent700: '#5d5294',
  accent800: '#423a6a',
  accent900: '#2b2741',

  section: '#262a60',
  sectionGlow: '#353b80',

  amber: '#e0a94f',
  green: '#7fd39b',

  // Finished-challenge medal colors — 1st/2nd/3rd only, everything
  // 4th-or-worse keeps the plain neutral500 the medal icon always used
  // before these existed.
  gold: '#e0b84f',
  silver: '#c4c8d6',
  bronze: '#c17f4f',
} as const;

// Fixed alpha compositing of `color-mix(in srgb, X N%, transparent)` calls
// from the CSS, pre-computed against their specific backgrounds where the
// web version relied on the browser doing the mixing live.
export const overlay = {
  textMuted: 'rgba(233,233,237,0.55)',
  headerBg: 'rgba(22,24,38,0.88)',
  accentWash9: 'rgba(145,132,217,0.09)',
  accentWash10: 'rgba(145,132,217,0.10)',
} as const;

export const space = {
  1: 2.8,
  2: 5.6,
  3: 8.4,
  4: 11.2,
  6: 16.8,
  8: 22.4,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 14,
} as const;

// React Native has no box-shadow string or `inset`; these are elevation
// stand-ins used for the web's hairline `--shadow-*` tokens. Applied as a
// thin border (an "inset" ring) rather than a drop shadow, which is what
// the web tokens actually read as visually (a 1px ring, not a blur).
export const ring = {
  sm: color.neutral800,
  md: color.neutral700,
  lg: color.neutral500,
} as const;

export const font = {
  heading: 'Inter_500Medium',
  headingSemibold: 'Inter_600SemiBold',
  body: 'Inter_400Regular',
} as const;

export const type = {
  h1: 42,
  h2: 32,
  h3: 25,
  h4: 20,
  h5: 16,
  h6: 13,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

export const TINT_A = color.accent800;
export const TINT_N = color.neutral800;
export const AMBER = color.amber;
export const GREEN = color.green;
