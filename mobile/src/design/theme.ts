/**
 * NoteFusion design tokens — Light Blue mode (the default) and its dark twin.
 *
 * Root canvas is Mist (#F4F7FC); cards sit on pure white with a hairline
 * slate border and a very soft shadow instead of the old glass fill. The
 * signature brand gradient — "The Fusion" — runs from Deep Blue (#1D4ED8)
 * to Bright Blue (#3B82F6) and is used for primary buttons, active states,
 * and energetic accents.
 *
 * Every export name from the previous dark theme is preserved (ink, accent,
 * purple, gold, pink, …) so existing screen/component imports keep
 * compiling. Only the values changed — brand names now carry blue-family
 * colours. Semantic signals (success / warning / danger / confidence) keep
 * their meaningful hues.
 *
 * ── Runtime theming ────────────────────────────────────────────────────────
 * `colors` is the light palette and stays a plain export: it is the fallback
 * for module-scope constants and the shape every palette must satisfy. Screens
 * do NOT import it directly — they call `useColors()` (see ../lib/theme) and
 * build styles through a factory, because StyleSheet.create captures values at
 * module-evaluation time and could never re-run on a mode change.
 */

// ─── Colours ────────────────────────────────────────────────────────────────

export const colors = {
  // Root & elevated surfaces
  bg: "#F4F7FC", // Mist — root canvas
  bgElevated: "#FFFFFF", // White — modals, sheets

  // Card surfaces
  surface: "#FFFFFF",
  surfaceAlt: "#EEF3FB", // Faint blue tint — nested rows, chips

  // Borders
  border: "#E2E8F0", // Slate hairline
  borderLight: "#EFF3F9",

  // ── "The Fusion" brand palette ──────────────────────────────────────────
  /** Brand names kept from the dark theme; values are now blue-family. */
  purple: "#2563EB", // Primary Blue    — gradient start
  purpleDark: "#1D4ED8", // Deep Blue       — pressed / darker shade
  gold: "#3B82F6", // Bright Blue     — gradient end
  pink: "#0EA5E9", // Sky             — logo "Note" half, accents

  // ── Legacy aliases (used by existing screens / components) ──────────────
  /** Primary action colour. Deliberately darker than `accent` so text set in
   *  `ink` stays legible on an `accent`-filled surface. */
  ink: "#1D4ED8",
  accent: "#2563EB",
  accentAlt: "#3B82F6",
  accentSoft: "rgba(37, 99, 235, 0.10)",
  accentGlow: "rgba(37, 99, 235, 0.22)",
  pinkSoft: "rgba(14, 165, 233, 0.10)",

  // ── Typography ──────────────────────────────────────────────────────────
  text: "#0F172A", // Ink Navy   — primary text
  textMuted: "#64748B", // Slate      — secondary / subtitles
  textFaint: "#94A3B8", // Light Slate — placeholder / tertiary

  // ── Semantic signals ────────────────────────────────────────────────────
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",

  // ── Confidence scale (PRD: honest confidence, never hidden) ─────────────
  confHigh: "#16A34A",
  confMed: "#D97706",
  confLow: "#DC2626",

  // ── Foreground on coloured fills ────────────────────────────────────────
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",
} as const;

/** The contract every palette satisfies. Adding a token to `colors` requires it here. */
export type Palette = { readonly [K in keyof typeof colors]: string };

/**
 * Dark palette. Surfaces are slate-navy rather than pure black — the previous
 * pitch-black theme was the specific complaint that prompted the light redesign,
 * so dark mode here is "dimmed", not "black".
 *
 * Brand blues are lifted a step (#2563EB → #3B82F6) because the darker values
 * lose contrast against a navy surface, and the confidence colours are lightened
 * for the same reason: an honest confidence signal has to stay readable.
 */
export const darkColors: Palette = {
  bg: "#0B1220", // Deep navy — root canvas
  bgElevated: "#111A2B", // Modals, sheets

  surface: "#131D30", // Cards
  surfaceAlt: "#1B2739", // Nested rows, chips

  border: "#243146",
  borderLight: "#1C2739",

  purple: "#3B82F6",
  purpleDark: "#2563EB",
  gold: "#60A5FA",
  pink: "#38BDF8",

  ink: "#2563EB",
  accent: "#3B82F6",
  accentAlt: "#60A5FA",
  accentSoft: "rgba(59, 130, 246, 0.16)",
  accentGlow: "rgba(59, 130, 246, 0.30)",
  pinkSoft: "rgba(56, 189, 248, 0.16)",

  text: "#E8EEF9",
  textMuted: "#94A3B8",
  textFaint: "#64748B",

  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",

  confHigh: "#22C55E",
  confMed: "#F59E0B",
  confLow: "#F87171",

  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",
};

/** The light palette under its role name; `colors` remains the direct export. */
export const lightColors: Palette = colors;

export type ThemeMode = "light" | "dark";

export function paletteFor(mode: ThemeMode): Palette {
  return mode === "dark" ? darkColors : lightColors;
}

// ─── Gradients ──────────────────────────────────────────────────────────────

export const gradients = {
  /** "The Fusion" — primary CTA, active states, energetic accents. */
  brand: ["#1D4ED8", "#3B82F6"] as const,

  /** Sky → Blue — logo wordmark, onboarding icons. */
  brandStart: ["#0EA5E9", "#2563EB"] as const,

  /** Dim tinted version of brand — subtle background washes. */
  brandDim: ["rgba(29, 78, 216, 0.10)", "rgba(59, 130, 246, 0.10)"] as const,

  /** Recording-state button — deep blue pulse. */
  record: ["#2563EB", "#1D4ED8"] as const,

  /** Light accent — confidence high, saved state. */
  gold: ["#3B82F6", "#60A5FA"] as const,

  /** Soft wash — subtle top→bottom sheen on cards. */
  glass: ["rgba(255, 255, 255, 0.95)", "rgba(238, 243, 251, 0.95)"] as const,

  /** Legacy aliases kept for backward compatibility. */
  pink: ["#0EA5E9", "#2563EB"] as const,
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

/**
 * Poppins families, loaded in App.tsx via `useFonts`.
 *
 * These are family names, not weights, and that distinction matters: once a
 * custom `fontFamily` is set, React Native stops honouring `fontWeight` —
 * iOS resolves the exact PostScript face and ignores the weight, while Android
 * looks for a variant that isn't registered and silently falls back. So weight
 * is selected by *picking a family*, and no style in this app should pair the
 * two. Every token below therefore carries `fontFamily` and no `fontWeight`.
 */
export const fonts = {
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
} as const;

/**
 * The type scale from the design sheet. `hero`/`screenTitle` cover the large
 * centred headings on splash, login, and onboarding; the rest are the everyday
 * in-app sizes.
 */
export const typography = {
  /** Splash + login wordmark. */
  hero: { fontSize: 40, fontFamily: fonts.bold, letterSpacing: -1 },
  display: { fontSize: 34, fontFamily: fonts.bold, letterSpacing: -0.5 },
  /** Onboarding slide titles, "Welcome back!". */
  screenTitle: { fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5 },
  title: { fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontFamily: fonts.semibold },
  body: { fontSize: 15, fontFamily: fonts.regular },
  label: { fontSize: 14, fontFamily: fonts.semibold },
  caption: { fontSize: 12, fontFamily: fonts.medium, letterSpacing: 0.2 },
  /** Solfa syllables and note names — stays monospaced so columns line up. */
  mono: {
    fontSize: 17,
    fontWeight: "600" as const,
    fontFamily: "monospace" as const,
  },
} as const;

// ─── Shadows / Glows ────────────────────────────────────────────────────────

export const shadow = {
  /** Barely-there navy lift — default card. On a light canvas the shadow
   *  does the separating work that the glass border used to do. */
  card: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },

  /** Blue lift — hero buttons, record button. */
  glow: {
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 8,
  },

  /** Lighter blue lift — save/confirm actions, high-confidence badges. */
  goldGlow: {
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
    elevation: 6,
  },

  /** Sky lift — wordmark "Note" half on splash. */
  pinkGlow: {
    shadowColor: "#0EA5E9",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
    elevation: 6,
  },
} as const;

/** One shadow token. Written out rather than inferred from `shadow`, whose
 *  `as const` would freeze the light values as literal types and leave the
 *  dark twin unable to carry different numbers. */
type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type Shadows = Record<keyof typeof shadow, ShadowStyle>;

/**
 * Dark-mode shadows. A near-black drop shadow is invisible on a navy canvas,
 * so the card lift becomes a stronger black (it reads as depth against the
 * lighter surface) and the coloured glows brighten to stay perceptible.
 */
export const darkShadow: Shadows = {
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 2,
  },
  glow: {
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 22,
    elevation: 8,
  },
  goldGlow: {
    shadowColor: "#60A5FA",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 6,
  },
  pinkGlow: {
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.36,
    shadowRadius: 20,
    elevation: 6,
  },
};

export function shadowsFor(mode: ThemeMode): Shadows {
  return mode === "dark" ? darkShadow : shadow;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map a 0‥1 confidence value to the traffic-light colour.
 * PRD requirement: surface confidence honestly, never hide low results.
 * Pass the active palette in dark mode — the light hues lose contrast on navy.
 */
export function confidenceColor(conf: number, palette: Palette = colors): string {
  if (conf >= 0.75) return palette.confHigh;
  if (conf >= 0.5) return palette.confMed;
  return palette.confLow;
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
  fonts,
  typography,
  shadow,
} as const;
export type Theme = typeof theme;

