// Nocturne design tokens, ported from the web app's styles.css (:root block).
// Keep this file as the single source of truth for color/space/radius/type —
// screens should read from `theme` (or, once migrated, `useTheme()`), never
// hardcode a hex value.

// Converts a '#rrggbb' token into an rgba() string at the given alpha —
// every "muted text"/"faint divider" color in this app (the many
// `rgba(233,233,237,0.NN)` literals scattered across screens before Light
// mode existed) turned out to just be `color.text` at some alpha, and
// `rgba(22,24,38,0.NN)` was always `color.bg` the same way. Routing those
// through this helper against whichever theme's `text`/`bg` is current
// means a muted-text color automatically flips with the theme instead of
// needing its own hand-picked light-mode value.
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Neutral/accent/status scales are fixed across both themes — the accent
// purple, amber, green, and the medal colors all read fine against either
// a dark or a light page background, and the neutral scale is used almost
// entirely as fixed tinted-chip/avatar backgrounds (TINT_A/TINT_N below)
// rather than as page chrome, so it doesn't need a light counterpart
// either. Only the page's own surface/text tokens (see ThemeSurface below)
// actually flip.
const neutralScale = {
  neutral100: '#f3f5fe',
  neutral200: '#e4e7f5',
  neutral300: '#cfd3e5',
  neutral400: '#b2b6ca',
  neutral500: '#9397ab',
  neutral600: '#75798c',
  neutral700: '#595d6c',
  neutral800: '#3f424d',
  neutral900: '#292b31',
} as const;

const accentScale = {
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
} as const;

const fixedTokens = {
  ...neutralScale,
  ...accentScale,

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

interface ThemeSurface {
  bg: string;
  surface: string;
  text: string;
  divider: string;
  // React Native has no box-shadow string or `inset`; these are elevation
  // stand-ins used for the web's hairline `--shadow-*` tokens. Applied as a
  // thin border (an "inset" ring) rather than a drop shadow, which is what
  // the web tokens actually read as visually (a 1px ring, not a blur).
  // Picked from the light or dark end of the fixed neutral scale above,
  // whichever sits close enough to that theme's own surface color to read
  // as a subtle ring rather than a hard line.
  ring: { sm: string; md: string; lg: string };
  // The accent shade to use as *text or an icon* sitting directly on this
  // theme's own bg/surface (or on a wash of the accent color over that
  // same bg — see TopNav's active tab), as opposed to on a fixed, always-
  // dark tinted chip (an avatar, a badge on its own accent800 background)
  // which reads fine with accent200 regardless of theme and doesn't need
  // this. Dark mode's own bg/surface is dark, so a near-white accent
  // shade (accent200) reads there; Light mode's is light, so the same
  // near-white shade would be reading white-on-white — this picks a dark,
  // saturated shade (accent700) instead for exactly that case.
  accentActive: string;
}

const darkSurface: ThemeSurface = {
  bg: '#161826',
  surface: '#232532',
  text: '#e9e9ed',
  divider: 'rgba(233,233,237,0.16)',
  ring: { sm: neutralScale.neutral800, md: neutralScale.neutral700, lg: neutralScale.neutral500 },
  accentActive: accentScale.accent200,
};

const lightSurface: ThemeSurface = {
  bg: '#f4f4f8',
  surface: '#ffffff',
  text: '#1b1d29',
  divider: 'rgba(27,29,41,0.12)',
  ring: { sm: neutralScale.neutral200, md: neutralScale.neutral300, lg: neutralScale.neutral500 },
  accentActive: accentScale.accent700,
};

export type Palette = typeof fixedTokens & ThemeSurface;
export type ThemeMode = 'light' | 'dark';

export function buildPalette(mode: ThemeMode): Palette {
  return { ...fixedTokens, ...(mode === 'light' ? lightSurface : darkSurface) };
}

// The app's only look until the Settings "Light mode" toggle (see
// src/theme/ThemeContext.tsx) existed — kept as a plain, static export so
// any screen that hasn't been migrated to useTheme() yet keeps compiling
// and keeps rendering exactly as it always has, unaffected by the toggle
// until it is.
export const color: Palette = buildPalette('dark');

// Fixed alpha compositing of `color-mix(in srgb, X N%, transparent)` calls
// from the CSS, pre-computed against their specific backgrounds where the
// web version relied on the browser doing the mixing live. Static/dark,
// same caveat as `color` above.
export const overlay = {
  textMuted: withAlpha(color.text, 0.55),
  headerBg: withAlpha(color.bg, 0.88),
  accentWash9: withAlpha(color.accent, 0.09),
  accentWash10: withAlpha(color.accent, 0.1),
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

// Static/dark alias of color.ring, kept for any unmigrated file that still
// imports the old standalone `ring` export directly.
export const ring = color.ring;

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

// Tinted avatar/badge backgrounds — deliberately fixed across both themes
// (see fixedTokens' own comment above): a dark accent/neutral tint reads
// fine as a small chip regardless of the page's own background, and
// Avatar's initials are always white to match.
export const TINT_A = color.accent800;
export const TINT_N = color.neutral800;
export const AMBER = color.amber;
export const GREEN = color.green;

// A status tone → this theme's own color, for anything that maps a small
// closed set of states (readiness, sync status, ...) onto a color —
// this app only has two real status colors (amber, green), so 'amber'
// covers every "worth noticing" state rather than each getting its own
// shade, same as Tag's own amber variant already does.
export type StatusTone = 'green' | 'neutral' | 'amber' | 'muted';

export function toneColor(tone: StatusTone, colors: Palette): string {
  switch (tone) {
    case 'green':
      return colors.green;
    case 'amber':
      return colors.amber;
    case 'muted':
      return withAlpha(colors.text, 0.5);
    default:
      return colors.text;
  }
}
