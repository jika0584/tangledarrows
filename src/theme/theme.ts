/**
 * High-contrast minimalist palette.
 * Sized for readability first: large type, generous spacing, no decoration.
 */
export const colors = {
  background: '#D6F0F7',
  surface: '#FFFFFF',
  boardShape: '#C2E6F0',
  arrow: '#265A6E',
  arrowHighlight: '#0F3D4F',
  arrowBlocked: '#E4572E',
  heart: '#F0544F',
  heartEmpty: '#B9D6DE',
  textPrimary: '#123543',
  textSecondary: '#4A7787',
  accent: '#1F9E7A',
  overlay: 'rgba(18, 53, 67, 0.55)',
} as const;

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
