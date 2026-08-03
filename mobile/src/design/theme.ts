/**
 * NoteFusion design tokens — the single source of visual truth for the app.
 *
 * A dark, calm "studio at night" palette: deep indigo canvas, a violet→cyan
 * accent that reads as musical/energetic, and warm/amber signals for the
 * confidence cues the PRD asks for (honest messaging over hidden guesses).
 * Every screen pulls from here so a color is never hard-coded twice.
 */

export const colors = {
  // Canvas
  bg: '#0B1020',
  bgElevated: '#141B31',
  surface: '#1B2440',
  surfaceAlt: '#232E4F',
  border: '#2C3A5E',

  // Brand accent (used in gradients + primary actions)
  accent: '#7C5CFF',
  accentAlt: '#22D3EE',
  accentSoft: 'rgba(124, 92, 255, 0.16)',

  // Text
  text: '#F5F7FF',
  textMuted: '#A9B4D0',
  textFaint: '#6C7899',

  // Signals
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',

  // Confidence scale (PRD: surface confidence honestly)
  confHigh: '#34D399',
  confMed: '#FBBF24',
  confLow: '#F87171',
} as const;

export const gradients = {
  brand: ['#7C5CFF', '#22D3EE'] as const,
  brandDim: ['#3A2E7A', '#164E5B'] as const,
  record: ['#F87171', '#7C5CFF'] as const,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 19, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '500' as const },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },
  mono: { fontSize: 18, fontWeight: '600' as const, fontFamily: 'monospace' as const },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  glow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
} as const;

/** Map a 0..1 confidence to a palette color — used by result + library views. */
export function confidenceColor(conf: number): string {
  if (conf >= 0.75) return colors.confHigh;
  if (conf >= 0.5) return colors.confMed;
  return colors.confLow;
}

/** Human label for a confidence value (PRD: never hide low confidence). */
export function confidenceLabel(conf: number): string {
  if (conf >= 0.75) return 'High confidence';
  if (conf >= 0.5) return 'Fair — worth a review';
  return 'Low — please double-check';
}

export const theme = { colors, gradients, spacing, radii, typography, shadow } as const;
export type Theme = typeof theme;
