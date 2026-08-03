/**
 * NoteFusion design tokens — single source of visual truth.
 *
 * A refined, ultra-clean minimalist studio palette inspired by Athena Mobile
 * and Shazam: deep charcoal canvas (#111111), subtle card surfaces (#1A1A1A / #222222),
 * crisp typography (#F5F5F5), and a signature Shazam listening blue (#0088FF) accent.
 */

export const colors = {
  // Canvas & Surfaces (Minimalist dark palette)
  bg: '#111111',
  bgElevated: '#1A1A1A',
  surface: '#222222',
  surfaceAlt: '#2A2A2A',
  border: '#2E2E2E',
  borderLight: '#1F1F1F',

  // Shazam-inspired signature accent
  accent: '#0088FF',
  accentAlt: '#0055FF',
  accentSoft: 'rgba(0, 136, 255, 0.12)',
  accentGlow: 'rgba(0, 136, 255, 0.25)',

  // Text
  text: '#F5F5F5',
  textMuted: '#AAAAAA',
  textFaint: '#666666',

  // Signals
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',

  // Confidence scale (PRD: surface confidence honestly)
  confHigh: '#10B981',
  confMed: '#F59E0B',
  confLow: '#EF4444',
} as const;

export const gradients = {
  brand: ['#1A1A1A', '#222222'] as const,
  brandDim: ['#141414', '#1F1F1F'] as const,
  record: ['#0088FF', '#0055FF'] as const,
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
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 14, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },
  mono: { fontSize: 17, fontWeight: '600' as const, fontFamily: 'monospace' as const },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  glow: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
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
