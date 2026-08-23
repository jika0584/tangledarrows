import { useSettingsStore } from '../store/settingsStore';

/**
 * High-contrast minimalist palette.
 * Sized for readability first: large type, generous spacing, no decoration.
 */
export const lightColors = {
  background: '#D6F0F7',
  surface: '#FFFFFF',
  boardShape: '#C2E6F0',
  /** Lattice dots at each playable cell centre. */
  gridDot: 'rgba(38, 90, 110, 0.22)',
  arrow: '#265A6E',
  arrowHighlight: '#0F3D4F',
  /** Pocket / hole-pack fillers that still follow reverse-solve rules. */
  arrowFiller: '#E45C9A',
  /** Last leftover crumbs after the real puzzle is in place. */
  arrowCrumb: '#7B4FD1',
  /** An arrow on its way off the board. */
  arrowEscaping: '#2FBF71',
  arrowBlocked: '#E4572E',
  heart: '#F0544F',
  heartEmpty: '#B9D6DE',
  textPrimary: '#123543',
  textSecondary: '#4A7787',
  accent: '#1F9E7A',
  /** Text and icons sitting on the accent fill (primary buttons). */
  onAccent: '#FFFFFF',
  /** Ruler guide lines — barely there, so they never fight the arrows. */
  rulerGuide: 'rgba(38, 90, 110, 0.28)',
  /** The lane of an arrow the player already tried and failed. */
  rulerBlocked: 'rgba(228, 87, 46, 0.85)',
  rulerActive: '#2FBF71',
  rulerInactive: '#FFFFFF',
  overlay: 'rgba(18, 53, 67, 0.55)',
} as const;

export const darkColors: Palette = {
  background: '#0F2430',
  surface: '#1A3544',
  boardShape: '#16303C',
  gridDot: 'rgba(168, 212, 227, 0.28)',
  arrow: '#A8D4E3',
  arrowHighlight: '#D6F0F7',
  arrowFiller: '#E45C9A',
  arrowCrumb: '#B794F4',
  arrowEscaping: '#3DD68C',
  arrowBlocked: '#FF6B45',
  heart: '#F0544F',
  heartEmpty: '#3A5560',
  textPrimary: '#E8F4F8',
  textSecondary: '#8AADB8',
  accent: '#2FBF71',
  onAccent: '#FFFFFF',
  rulerGuide: 'rgba(168, 212, 227, 0.35)',
  rulerBlocked: 'rgba(255, 107, 69, 0.9)',
  rulerActive: '#2FBF71',
  rulerInactive: '#243C48',
  overlay: 'rgba(4, 12, 16, 0.72)',
};

export type Palette = {
  [K in keyof typeof lightColors]: string;
};

/** Default / PX / tests — the light campaign palette. */
export const colors: Palette = lightColors;

export function useColors(): Palette {
  const darkMode = useSettingsStore((state) => state.darkMode);
  return darkMode ? darkColors : lightColors;
}

export const typography = {
  title: { fontSize: 34, fontWeight: '700' as const },
  heading: { fontSize: 26, fontWeight: '700' as const },
  body: { fontSize: 20, fontWeight: '500' as const },
  label: { fontSize: 18, fontWeight: '600' as const },
} as const;

export const spacing = {
  xs: 6,
  sm: 12,
  md: 20,
  lg: 32,
  xl: 48,
} as const;

/** Minimum touch target per accessibility guidance. */
export const MIN_TOUCH_TARGET = 48;
