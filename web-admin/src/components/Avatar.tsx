/**
 * An account's avatar.
 *
 * No image is stored against a user, so this is initials over a tint derived from the
 * name. The tint is hashed rather than picked at random, so one person keeps one colour
 * across the accounts table and the sidebar instead of reshuffling on every render.
 */

import { useTheme, type ThemeMode } from "@/lib/theme";

interface AvatarProps {
  name: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/**
 * Six hues, in the same order in both modes so the hash keeps assigning a person the
 * same hue when the theme flips — a colour that identifies an account has to survive
 * the switch, or it identifies nothing.
 *
 * The dark set is not the light set dimmed: a pale tint on a navy card reads as a hole
 * punched in the surface. Each dark ground is the hue taken almost to black, with the
 * foreground taken the other way.
 */
const TINTS: Record<ThemeMode, readonly { bg: string; fg: string }[]> = {
  light: [
    { bg: "#e8f1fe", fg: "#1d4ed8" },
    { bg: "#e7f6ec", fg: "#15803d" },
    { bg: "#fdf0e3", fg: "#b45309" },
    { bg: "#ede9fe", fg: "#6d28d9" },
    { bg: "#e6f6fb", fg: "#0369a1" },
    { bg: "#fde8ec", fg: "#be123c" },
  ],
  dark: [
    { bg: "#16294a", fg: "#93b8fb" },
    { bg: "#14301f", fg: "#6ee7a5" },
    { bg: "#33240e", fg: "#fbbf24" },
    { bg: "#241a44", fg: "#c4b5fd" },
    { bg: "#0d2c3a", fg: "#7dd3fc" },
    { bg: "#3a1520", fg: "#fda4b3" },
  ],
};

/** First letter of the first and last word: `"Ada Lovelace"` → `"AL"`. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

function tintFor(name: string, mode: ThemeMode) {
  const set = TINTS[mode];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return set[Math.abs(hash) % set.length] ?? set[0]!;
}

export function Avatar({ name, size = 32, className = "" }: AvatarProps) {
  const { mode } = useTheme();
  const tint = tintFor(name, mode);

  return (
    <span
      // The name is always rendered as text beside this, so announcing the initials too
      // would just make a screen reader say the person twice.
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: tint.bg,
        color: tint.fg,
        fontSize: Math.max(10, Math.round(size * 0.36)),
      }}
    >
      {initials(name)}
    </span>
  );
}
