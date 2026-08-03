/**
 * NoteFusion design tokens — single source of visual truth.
 *
 * A calm, light, restrained studio palette inspired by the reference mood-app kit:
 * soft mint canvas (#EAF6F3), crisp white card surfaces, near-black ink for primary
 * actions and type, and two soft pastel accents (sky-cyan + blush pink) used sparingly.
 * The old dark-charcoal / electric-blue theme was retired in the light-pastel redesign.
 */

export const colors = {
  // Canvas & Surfaces (light pastel palette)
  bg: '#EAF6F3',
  bgElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F4F5',
  border: '#E4E9EA',
  borderLight: '#EFF3F3',

  // Primary ink — used for buttons, active chips, key type
  ink: '#141718',

  // Soft pastel accents (used sparingly)
  accent: '#7FD8E8', // sky-cyan
  accentAlt: '#5FC6DA',
  accentSoft: 'rgba(127, 216, 232, 0.18)',
  accentGlow: 'rgba(127, 216, 232, 0.35)',
  pink: '#F3A9D6',
  pinkSoft: 'rgba(243, 169, 214, 0.20)',

  // Text (ink on light)
  text: '#141718',
  textMuted: '#5B6566',
  textFaint: '#9AA5A6',

  // Signals
  success: '#12B886',
  warning: '#F0A020',
  danger: '#F0576B',

  // Confidence scale (PRD: surface confidence honestly)
  confHigh: '#12B886',
  confMed: '#F0A020',
  confLow: '#F0576B',

  // On-accent / on-ink foreground
  onInk: '#FFFFFF',
  onAccent: '#0E3B44',
} as const;

export const gradients = {
  brand: ['#7FD8E8', '#B9EAF2'] as const,
  brandDim: ['#F2F4F5', '#FFFFFF'] as const,
  record: ['#7FD8E8', '#5FC6DA'] as const,
  pink: ['#F3A9D6', '#F7C7E5'] as const,
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
  md: 14,
  lg: 20,
  xl: 28,
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
    shadowColor: '#5B6566',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  glow: {
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
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
