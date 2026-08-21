/**
 * The design tokens from `mobile/src/design/theme.ts`, as CSS.
 *
 * Copied rather than imported: the theme is TypeScript inside the Expo bundle
 * and there is no build step here. Values only — if a token changes there, these
 * assets are derived and get rebuilt.
 *
 * One translation to be aware of. React Native stops honouring `fontWeight`
 * once a custom `fontFamily` is set, so the app selects weight by picking a
 * Poppins family; here the same four faces are registered under one family at
 * 400/500/600/700 and selected by weight. `fonts.regular` → 400, `medium` → 500,
 * `semibold` → 600, `bold` → 700.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

export const C = {
  bg: "#F4F7FC",
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
  confHigh: "#16A34A",
  confMed: "#D97706",
  confLow: "#DC2626",
};

/** `gradients.brand` — Deep Blue to Bright Blue, "The Fusion". */
export const BRAND_FROM = "#1D4ED8";
export const BRAND_TO = "#3B82F6";

/** `shadow.card`: #0F172A, offset (0,2), opacity 0.06, radius 10. */
export const SHADOW_CARD = "0 2px 10px rgba(15,23,42,0.06)";

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
  "notifications-outline": "F47F",
  "musical-notes": "F469",
  "musical-notes-outline": "F46A",
  "musical-note": "F466",
  "chevron-forward": "F23B",
  "star": "F595",
  "key-outline": "F3A4",
  "speedometer-outline": "F590",
  "grid-outline": "F356",
  "arrow-back": "F127",
  "ellipsis-vertical": "F2D4",
  "text": "F5CB",
  "search-outline": "F563",
  "options-outline": "F48B",
  "sparkles-outline": "F58D",
  "document-text-outline": "F2B4",
  "share-outline": "F572",
  "play": "F4C6",
  "checkmark": "F21D",
  "stop-circle-outline": "F5A0",
};

const MOBILE = join(import.meta.dirname, "..", "..");
const POPPINS = join(MOBILE, "node_modules/@expo-google-fonts/poppins");
const IONICONS = join(
  MOBILE,
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
);

const url = (p) => pathToFileURL(p).href;

/**
 * `@font-face` for the four Poppins faces the app loads plus Ionicons, pointing
 * straight at the installed packages. The pages are written to disk and opened
 * over `file://` so these resolve same-origin.
 */
export const FONT_FACES = `
@font-face { font-family: Poppins; font-weight: 400; src: url("${url(join(POPPINS, "400Regular/Poppins_400Regular.ttf"))}"); }
@font-face { font-family: Poppins; font-weight: 500; src: url("${url(join(POPPINS, "500Medium/Poppins_500Medium.ttf"))}"); }
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
