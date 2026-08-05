/**
 * NoteFusion design tokens — Luxury Dark Mode ("The Fusion" edition).
 *
 * Root canvas is Pitch Black (#000000); elevated layers sit on Deep Space
 * Charcoal (#0A0A0C). Every card uses Glassmorphism (5 % white fill +
 * 10 % white border). The signature brand gradient — "The Fusion" — runs
 * from Electric Purple (#A855F7) to Warm Gold (#F59E0B) and is used for
 * primary buttons, active states, and energetic accents.
 *
 * All legacy aliases (ink, accent, accentSoft, …) are preserved so existing
 * screen/component imports keep compiling without changes.
 */

// ─── Colours ────────────────────────────────────────────────────────────────

export const colors = {
  // Root & elevated surfaces
  bg: "#000000", // Pitch Black — root canvas
  bgElevated: "#0A0A0C", // Deep Space Charcoal — modals, sheets

  // Glassmorphism card surfaces
  surface: "rgba(255, 255, 255, 0.05)",
  surfaceAlt: "rgba(255, 255, 255, 0.08)",

  // Glass borders
  border: "rgba(255, 255, 255, 0.10)",
  borderLight: "rgba(255, 255, 255, 0.06)",

  // ── "The Fusion" brand palette ──────────────────────────────────────────
  purple: "#A855F7", // Electric Purple  — gradient start
  purpleDark: "#7C3AED", // Deep Violet      — pressed / darker shade
  gold: "#F59E0B", // Warm Gold        — gradient end
  pink: "#D946EF", // Electric Pink    — logo "Note" half, accents

  // ── Legacy aliases (used by existing screens / components) ──────────────
  /** Primary action colour — maps to Electric Purple in dark theme. */
  ink: "#A855F7",
  accent: "#A855F7",
  accentAlt: "#7C3AED",
  accentSoft: "rgba(168, 85, 247, 0.15)",
  accentGlow: "rgba(168, 85, 247, 0.35)",
  pinkSoft: "rgba(217, 70, 239, 0.15)",

  // ── Typography ──────────────────────────────────────────────────────────
  text: "#FFFFFF", // Crisp White — primary text
  textMuted: "#A1A1AA", // Soft Ash    — secondary / subtitles
  textFaint: "#52525B", // Dim Zinc    — placeholder / tertiary

  // ── Semantic signals ────────────────────────────────────────────────────
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",

  // ── Confidence scale (PRD: honest confidence, never hidden) ─────────────
  confHigh: "#22C55E",
  confMed: "#F59E0B",
  confLow: "#EF4444",

  // ── Foreground on coloured fills ────────────────────────────────────────
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",
} as const;

// ─── Gradients ──────────────────────────────────────────────────────────────

export const gradients = {
  /** "The Fusion" — primary CTA, active states, energetic accents. */
  brand: ["#A855F7", "#F59E0B"] as const,

  /** Pink → Purple — logo wordmark, onboarding icons. */
  brandStart: ["#D946EF", "#A855F7"] as const,

  /** Dim tinted version of brand — subtle background washes. */
  brandDim: ["rgba(168, 85, 247, 0.20)", "rgba(245, 158, 11, 0.20)"] as const,

  /** Recording-state button — deep purple pulse. */
  record: ["#A855F7", "#7C3AED"] as const,

  /** Gold accent — confidence high, saved state. */
  gold: ["#F59E0B", "#D97706"] as const,

  /** Glass wash — subtle top→bottom sheen on glass cards. */
  glass: ["rgba(255, 255, 255, 0.08)", "rgba(255, 255, 255, 0.02)"] as const,

  /** Legacy aliases kept for backward compatibility. */
  pink: ["#D946EF", "#A855F7"] as const,
} as const;

// ─── Spacing ────────────────────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// ─── Border radii ───────────────────────────────────────────────────────────

export const radii = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────

export const typography = {
  display: { fontSize: 34, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 14, fontWeight: "600" as const },
  caption: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.2 },
  mono: {
    fontSize: 17,
    fontWeight: "600" as const,
    fontFamily: "monospace" as const,
  },
} as const;

// ─── Shadows / Glows ────────────────────────────────────────────────────────

export const shadow = {
  /** Subtle purple-tinted halo — default card lift. */
  card: {
    shadowColor: "#A855F7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },

  /** Strong purple glow — hero buttons, record button. */
  glow: {
    shadowColor: "#A855F7",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 10,
  },

  /** Gold glow — save/confirm actions, high-confidence badges. */
  goldGlow: {
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },

  /** Pink glow — wordmark "Note" half on splash. */
  pinkGlow: {
    shadowColor: "#D946EF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 8,
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map a 0‥1 confidence value to the traffic-light colour.
 * PRD requirement: surface confidence honestly, never hide low results.
 */
export function confidenceColor(conf: number): string {
  if (conf >= 0.75) return colors.confHigh;
  if (conf >= 0.5) return colors.confMed;
  return colors.confLow;
}

/**
 * Human-readable label for a confidence value.
 * PRD requirement: explicit wording so users know when to double-check.
 */
export function confidenceLabel(conf: number): string {
  if (conf >= 0.75) return "High confidence";
  if (conf >= 0.5) return "Fair — worth a review";
  return "Low — please double-check";
}

// ─── Barrel export ──────────────────────────────────────────────────────────

export const theme = {
  colors,
  gradients,
  spacing,
  radii,
  typography,
  shadow,
} as const;
export type Theme = typeof theme;
