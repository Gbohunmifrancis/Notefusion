/**
 * The design tokens from `mobile/src/design/theme.ts`, as CSS.
 *
 * Copied rather than imported: the theme is TypeScript inside the Expo bundle
 * and there is no build step here. Values only — if a token changes there, these
 * assets are derived and get rebuilt.
 *
 * Two translations to be aware of.
 *
 * 1. **Weight, not family.** React Native stops honouring `fontWeight` once a
 *    custom `fontFamily` is set, so the app selects weight by picking a family
 *    (`fonts.bold` is literally `"Inter_700Bold"`); here the faces are registered
 *    under one family name per typeface and selected by weight. `fonts.regular`
 *    → 400, `medium` → 500, `semibold` → 600, `bold` → 700. Two families, as in
 *    the app: **Inter reads, Poppins announces** — Poppins is reached only through
 *    the `.display` class, which stands in for `typography.hero`/`display`/
 *    `screenTitle` and the splash wordmark.
 *
 * 2. **Palette by custom property.** `C.accent` is the *string* `var(--accent)`,
 *    not a hex value, so a screen module's module-scope CSS can be written once
 *    and still come out in either mode — `shell()` injects the `:root` block. The
 *    one place that cannot work is an SVG presentation attribute (`fill="…"`,
 *    `stroke="…"`), where `var()` is not substituted; those callers take a raw
 *    palette from `paletteFor(mode)` instead.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

// ─── Palettes ────────────────────────────────────────────────────────────────

/** `colors` — the light palette, verbatim. */
export const LIGHT = {
  bg: "#F4F7FC",
  bgElevated: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF3FB",
  border: "#E2E8F0",
  borderLight: "#EFF3F9",
  purple: "#2563EB",
  purpleDark: "#1D4ED8",
  gold: "#3B82F6",
  pink: "#0EA5E9",
  ink: "#1D4ED8",
  accent: "#2563EB",
  accentAlt: "#3B82F6",
  accentSoft: "rgba(37, 99, 235, 0.10)",
  accentGlow: "rgba(37, 99, 235, 0.22)",
  pinkSoft: "rgba(14, 165, 233, 0.10)",
  premium: "#F59E0B",
  premiumDeep: "#B45309",
  premiumSoft: "rgba(245, 158, 11, 0.12)",
  premiumBorder: "rgba(245, 158, 11, 0.35)",
  text: "#0F172A",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",
  dangerSoft: "rgba(220, 38, 38, 0.12)",
  dangerBorder: "rgba(220, 38, 38, 0.30)",
  scrim: "rgba(15, 23, 42, 0.55)",
  confHigh: "#16A34A",
  confMed: "#D97706",
  confLow: "#DC2626",
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",

  // ── Not in `colors`: chrome these pages draw and the app gets from the OS ──
  /** `shadow.card`: #0F172A, offset (0,2), opacity 0.06, radius 10. */
  shadowCard: "0 2px 10px rgba(15,23,42,0.06)",
  /** The gesture-navigation pill. Dark on a light canvas, light on a dark one. */
  gesture: "rgba(15,23,42,0.30)",
};

/** `darkColors` — the dimmed-navy twin, verbatim. */
export const DARK = {
  bg: "#0B1220",
  bgElevated: "#111A2B",
  surface: "#131D30",
  surfaceAlt: "#1B2739",
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
  dangerSoft: "rgba(248, 113, 113, 0.16)",
  dangerBorder: "rgba(248, 113, 113, 0.38)",
  scrim: "rgba(2, 2, 8, 0.74)",
  confHigh: "#22C55E",
  confMed: "#F59E0B",
  confLow: "#F87171",
  onInk: "#FFFFFF",
  onAccent: "#FFFFFF",

  /** `darkShadow.card`: #000, opacity 0.45, radius 12 — a near-black drop shadow
   *  is invisible on navy, so dark mode leans on a stronger one. */
  shadowCard: "0 2px 12px rgba(0,0,0,0.45)",
  gesture: "rgba(232,238,249,0.36)",
};

/**
 * Every token as a `var()` reference. This is what screen modules interpolate,
 * so their CSS is written once and themed by the `:root` block `shell()` emits.
 */
export const C = Object.fromEntries(
  Object.keys(LIGHT).map((k) => [k, `var(--${k})`]),
);

/** The raw hex map for a mode. For SVG presentation attributes and the frame page. */
export const paletteFor = (mode = "light") => (mode === "dark" ? DARK : LIGHT);

/** The `:root` block that gives `C`'s `var()` references their values. */
export function paletteVars(mode = "light") {
  const p = paletteFor(mode);
  return `:root {\n${Object.entries(p)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n")}\n}`;
}

/** `gradients.brand` — Deep Blue to Bright Blue, "The Fusion". Mode-independent:
 *  it is a module constant in the theme, not a palette entry. */
export const BRAND_FROM = "#1D4ED8";
export const BRAND_TO = "#3B82F6";

/** Kept for callers that predate `C.shadowCard`. */
export const SHADOW_CARD = "var(--shadowCard)";

/** Ionicons codepoints, read out of the package's own glyphmap. */
export const ICON = {
  "home": "F382",
  "home-outline": "F383",
  "folder": "F325",
  "folder-outline": "F329",
  "folder-open-outline": "F327",
  "mic": "F454",
  "mic-outline": "F45E",
  "person-outline": "F4AC",
  "card-outline": "F1E8",
  "mic-off-outline": "F45C",
  "pause": "F493",
  "moon-outline": "F461",
  "sunny-outline": "F5AE",
  "notifications-outline": "F47F",
  "musical-notes": "F469",
  "musical-notes-outline": "F46A",
  "musical-note": "F466",
  "chevron-forward": "F23B",
  "chevron-back": "F229",
  "star": "F595",
  "star-outline": "F599",
  "key-outline": "F3A4",
  "speedometer-outline": "F590",
  "grid-outline": "F356",
  "arrow-back": "F127",
  "arrow-forward": "F133",
  "ellipsis-vertical": "F2D4",
  "text": "F5CB",
  "search-outline": "F563",
  "options-outline": "F48B",
  "sparkles-outline": "F58D",
  "document-text-outline": "F2B4",
  "share-outline": "F572",
  "play": "F4C6",
  "checkmark": "F21D",
  "checkmark-circle": "F21E",
  "stop-circle-outline": "F5A0",
  "settings-outline": "F56C",
  "help-circle-outline": "F37E",
  "log-out-outline": "F3D1",
  "alert-circle-outline": "F114",
  "eye-outline": "F2EA",
  "bookmark": "F1A8",
  "lock-closed-outline": "F3C8",
  "close": "F24A",
};

const MOBILE = join(import.meta.dirname, "..", "..");
const INTER = join(MOBILE, "node_modules/@expo-google-fonts/inter");
const POPPINS = join(MOBILE, "node_modules/@expo-google-fonts/poppins");
const IONICONS = join(
  MOBILE,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
);

const url = (p) => pathToFileURL(p).href;

/** The white brand silhouette. Recoloured here with a CSS mask, the way the app
 *  recolours it with `tintColor`. 331×438, so the aspect is baked in below. */
export const MARK_PNG = url(join(MOBILE, "assets/brand/mark.png"));
export const MARK_ASPECT = 331 / 438;

/**
 * `@font-face` for the six faces the app loads plus Ionicons, pointing straight
 * at the installed packages. The pages are written to disk and opened over
 * `file://` so these resolve same-origin.
 */
export const FONT_FACES = `
@font-face { font-family: Inter; font-weight: 400; src: url("${url(join(INTER, "400Regular/Inter_400Regular.ttf"))}"); }
@font-face { font-family: Inter; font-weight: 500; src: url("${url(join(INTER, "500Medium/Inter_500Medium.ttf"))}"); }
@font-face { font-family: Inter; font-weight: 600; src: url("${url(join(INTER, "600SemiBold/Inter_600SemiBold.ttf"))}"); }
@font-face { font-family: Inter; font-weight: 700; src: url("${url(join(INTER, "700Bold/Inter_700Bold.ttf"))}"); }
@font-face { font-family: Poppins; font-weight: 600; src: url("${url(join(POPPINS, "600SemiBold/Poppins_600SemiBold.ttf"))}"); }
@font-face { font-family: Poppins; font-weight: 700; src: url("${url(join(POPPINS, "700Bold/Poppins_700Bold.ttf"))}"); }
@font-face { font-family: Ionicons; font-weight: 400; src: url("${url(IONICONS)}"); }
`;

/** An Ionicons glyph. `name` must be a key of ICON — a typo would silently draw a box. */
export function ic(name, size, color, extra = "") {
  const cp = ICON[name];
  if (!cp) throw new Error(`no codepoint recorded for Ionicons "${name}"`);
  return `<i class="ion" style="font-size:${size}px;color:${color};${extra}">&#x${cp};</i>`;
}

/** The brand gradient as CSS. `deg` 90 matches LinearGradient start/end {x} only. */
export const brand = (deg = 90) => `linear-gradient(${deg}deg, ${BRAND_FROM}, ${BRAND_TO})`;
