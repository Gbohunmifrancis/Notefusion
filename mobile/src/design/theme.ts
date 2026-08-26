/**
 * NoteFusion design tokens — Light mode (the default) and its dark twin.
 *
 * Root canvas is Mist (#F4F7FC); cards sit on pure white with a hairline
 * slate border and a very soft shadow instead of the old glass fill. The
 * signature brand gradient — "The Fusion" — runs from Deep Blue (#1D4ED8) to
 * Bright Blue (#3B82F6) and is used for primary buttons, active states, and
 * energetic accents.
 *
 * Every export name from the original dark theme is preserved (ink, accent,
 * purple, gold, pink, …) so existing screen/component imports keep
 * compiling. Only the values changed. Semantic signals (success / warning /
 * danger / confidence) keep their meaningful hues.
 *
 * ── Runtime theming ────────────────────────────────────────────────────────
 * `colors` is the light palette and stays a plain export: it is the fallback
 * for module-scope constants and the shape every palette must satisfy. Screens
 * do NOT import it directly — they call `useColors()` (see ../lib/theme) and
 * build styles through a factory, because StyleSheet.create captures values at
 * module-evaluation time and could never re-run on a mode change.
 *
 * That last rule was widely broken: roughly forty-five sites across thirteen
 * files retyped the *light* accent as a literal `#2563EB` / `#EFF6FF` /
 * `rgba(37,99,235,…)`, so those controls stayed light-mode blue on a navy
 * canvas and ignored the theme switch entirely. If you find yourself typing a
 * brand hex into a screen, reach for `useColors()` instead.
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
  /**
   * The two have different jobs, and mixing them up is what breaks contrast:
   *
   *   `ink`    — a *fill* that carries white text (active chips, the mic
   *              circle, the tab-bar mic). Stays dark in both modes so
   *              `onAccent` white holds well past AA on top of it.
   *   `accent` — brand colour *on* a surface: text, icons, hairlines. Lifts in
   *              dark mode, where a fill-weight blue goes muddy on navy.
   */
  ink: "#1D4ED8",
  accent: "#2563EB",
  accentAlt: "#3B82F6",
  accentSoft: "rgba(37, 99, 235, 0.10)",
  accentGlow: "rgba(37, 99, 235, 0.22)",
  pinkSoft: "rgba(14, 165, 233, 0.10)",

  // ── Premium (Pro subscribers) ───────────────────────────────────────────
  /** Genuine amber. `gold` above is blue — it kept its name through the light
   *  redesign and only the value changed — so the premium treatment needs its
   *  own tokens rather than the misleading alias. Used for the Pro avatar ring
   *  and plan badge, and nowhere a free account can see. */
  premium: "#F59E0B",
  premiumDeep: "#B45309",
  premiumSoft: "rgba(245, 158, 11, 0.12)",
  premiumBorder: "rgba(245, 158, 11, 0.35)",

  // ── Typography ──────────────────────────────────────────────────────────
  text: "#0F172A", // Ink Navy   — primary text
  textMuted: "#64748B", // Slate      — secondary / subtitles
  textFaint: "#94A3B8", // Light Slate — placeholder / tertiary

  // ── Semantic signals ────────────────────────────────────────────────────
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",

  /** Destructive washes. These were retyped as literal `rgba(220, 38, 38, …)`
   *  in eight places, which meant dark mode painted a light-mode maroon fill
   *  under a lightened salmon label — the tint and the text came from
   *  different hues. */
  dangerSoft: "rgba(220, 38, 38, 0.12)",
  dangerBorder: "rgba(220, 38, 38, 0.30)",

  /** Modal/drawer backdrop. `rgba(0,0,0,0.45)` was hardcoded in both, and on a
   *  navy canvas it barely darkened anything: dialogs read as floating *among*
   *  the screen behind them rather than above it. Dark mode needs the heavier
   *  wash because it has less headroom to darken into. */
  scrim: "rgba(15, 23, 42, 0.55)",

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

  // Fill, so it does *not* lift: white on #2563EB is 5.2:1, but white on the
  // lifted accent #3B82F6 is 3.7:1 and fails AA at chip-label sizes.
  ink: "#2563EB",
  accent: "#3B82F6",
  accentAlt: "#60A5FA",
  accentSoft: "rgba(59, 130, 246, 0.16)",
  accentGlow: "rgba(59, 130, 246, 0.30)",
  pinkSoft: "rgba(56, 189, 248, 0.16)",

  // Amber lifts a step on navy, same reason the brand blues do.
  premium: "#FBBF24",
  premiumDeep: "#D97706",
  premiumSoft: "rgba(251, 191, 36, 0.16)",
  premiumBorder: "rgba(251, 191, 36, 0.40)",

  text: "#E8EEF9",
  textMuted: "#94A3B8",
  textFaint: "#64748B",

  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#F87171",

  // Derived from the *lifted* danger, so the wash and its label finally agree.
  dangerSoft: "rgba(248, 113, 113, 0.16)",
  dangerBorder: "rgba(248, 113, 113, 0.38)",

  // Heavier than light mode's: there is far less headroom to darken a navy
  // canvas into, and 0.45 black over #0B1220 is almost a no-op.
  scrim: "rgba(2, 2, 8, 0.74)",

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

  /** Brand at 40 % — the record button while a job is analysing. Half-strength
   *  rather than greyed out, because the button is busy, not disabled. */
  brandMuted: ["rgba(29, 78, 216, 0.4)", "rgba(59, 130, 246, 0.4)"] as const,

  /** Recording-state button — deep blue pulse. */
  record: ["#2563EB", "#1D4ED8"] as const,

  /** Light accent — confidence high, saved state. */
  gold: ["#3B82F6", "#60A5FA"] as const,

  /** Real amber — the Pro avatar ring. Four stops so the ring reads as
   *  brushed metal rather than a flat band. */
  premium: ["#FBBF24", "#F59E0B", "#D97706", "#B45309"] as const,

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
 * Two families, loaded together in `lib/appReady.ts` via `useFonts`.
 *
 * **Inter reads, Poppins announces.** Poppins used to do both jobs, and it is
 * only good at one: its near-circular geometric letterforms and wide sidebearings
 * make a handsome 36px wordmark and a juvenile 13px paragraph. Worse, the old
 * scale was bold at every tier, so a dialog's cancel button landed at the same
 * visual weight as the dialog's own title and the hierarchy collapsed.
 *
 * So the four workhorse names now resolve to Inter — every existing
 * `fontFamily: fonts.bold` call site gets it, which is the right default because
 * those sites are UI text. Poppins survives behind `display`/`displayBold`, used
 * only by `typography.hero`/`display`/`screenTitle` and the splash wordmark.
 *
 * These are family names, not weights, and that distinction matters: once a
 * custom `fontFamily` is set, React Native stops honouring `fontWeight` —
 * iOS resolves the exact PostScript face and ignores the weight, while Android
 * looks for a variant that isn't registered and silently falls back. So weight
 * is selected by *picking a family*, and no style in this app should pair the
 * two. Every token below therefore carries `fontFamily` and no `fontWeight`.
 */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",

  /** Display only — wordmarks, splash, onboarding titles. Never body copy. */
  display: "Poppins_600SemiBold",
  displayBold: "Poppins_700Bold",
} as const;

/**
 * The type scale. `hero`/`screenTitle` cover the large centred headings on
 * splash, login, and onboarding and are the Poppins tier; the rest are the
 * everyday in-app sizes and read in Inter.
 */
export const typography = {
  /** Splash + login wordmark. */
  hero: { fontSize: 40, fontFamily: fonts.displayBold, letterSpacing: -1 },
  display: { fontSize: 34, fontFamily: fonts.displayBold, letterSpacing: -0.5 },
  /** Onboarding slide titles, "Welcome back!". */
  screenTitle: {
    fontSize: 26,
    fontFamily: fonts.displayBold,
    letterSpacing: -0.5,
  },
  /** In-app screen titles. Inter, not Poppins — this is chrome, not display. */
  title: { fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontFamily: fonts.semibold, letterSpacing: -0.2 },
  /** Inter carries a larger x-height than Poppins, so 14.5 here reads as large
   *  as the old 15 did while fitting more words on a line. */
  body: { fontSize: 14.5, fontFamily: fonts.regular },
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

  /** Amber lift — the Pro avatar ring. */
  premiumGlow: {
    shadowColor: "#F59E0B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
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
  premiumGlow: {
    shadowColor: "#FBBF24",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 6,
  },
};

export function shadowsFor(mode: ThemeMode): Shadows {
  return mode === "dark" ? darkShadow : shadow;
}

// ─── Motion ─────────────────────────────────────────────────────────────────

/**
 * Press-feedback motion, shared by `components/Touchable.tsx` and anything else
 * that springs under a finger.
 *
 * The house style is snappy and restrained: settle in roughly 120 ms with no
 * perceptible overshoot. In a `withSpring` config that comes from keeping `damping`
 * high relative to `stiffness` — a bouncier feel would mean dropping damping, not
 * lengthening a duration, because springs here are driven by physics rather than a
 * curve and a time.
 */
export const motion = {
  /** The one press spring. Passed straight to Reanimated's `withSpring`. */
  press: { damping: 20, stiffness: 400, mass: 0.4 },

  /** How far a control travels under the finger, by target shape. */
  scale: {
    /** Cards, chips, icon buttons — the default. */
    default: 0.97,
    /** Large circular targets (the tab-bar mic, Home's mic stage). At that
     *  diameter 0.97 is too small a move to read. */
    large: 0.94,
    /** Full-bleed rows. Anything deeper reveals the canvas down both edges. */
    row: 0.99,
  },
} as const;

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

/** The seven letter names, in the order the white keys run. */
export type PitchLetter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/**
 * One hue per letter name, for the piano's stave and its key labels.
 *
 * A seventh colour wheel of its own, deliberately outside the brand palette: the
 * palette is entirely blue (`purple`, `gold` and `pink` all hold blues since the
 * light redesign kept the names and changed the values), so seven distinguishable
 * hues cannot be drawn from it. Nor should they be — these say "this chip is the
 * key under your finger", which is a different job from an accent or a signal.
 *
 * Not a palette token for the same reason `gradients` is not: `Palette` maps every
 * key to a flat `string`, and this is a record per mode.
 *
 * An accidental takes its *letter's* colour — E♭ is a green E, not a colour of its
 * own — because that is what makes a chip match the key you have to press.
 */
const PITCH_INK: Record<ThemeMode, Record<PitchLetter, string>> = {
  light: {
    C: "#8B5CF6",
    D: "#F97316",
    E: "#16A34A",
    F: "#DB2777",
    G: "#2563EB",
    A: "#E11D48",
    B: "#0D9488",
  },
  // Lifted a step for the navy canvas, exactly as the confidence scale is.
  dark: {
    C: "#A78BFA",
    D: "#FB923C",
    E: "#22C55E",
    F: "#F472B6",
    G: "#3B82F6",
    A: "#FB7185",
    B: "#2DD4BF",
  },
};

export function pitchColor(letter: PitchLetter, mode: ThemeMode = "light"): string {
  return PITCH_INK[mode][letter];
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

