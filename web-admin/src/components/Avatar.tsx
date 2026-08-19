/**
 * An account's avatar.
 *
 * No image is stored against a user, so this is initials over a tint derived from the
 * name. The tint is hashed rather than picked at random, so one person keeps one colour
 * across the accounts table and the sidebar instead of reshuffling on every render.
 */

interface AvatarProps {
  name: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

const TINTS = [
  { bg: "#e8f1fe", fg: "#1d4ed8" },
  { bg: "#e7f6ec", fg: "#15803d" },
  { bg: "#fdf0e3", fg: "#b45309" },
  { bg: "#ede9fe", fg: "#6d28d9" },
  { bg: "#e6f6fb", fg: "#0369a1" },
  { bg: "#fde8ec", fg: "#be123c" },
] as const;

/** First letter of the first and last word: `"Ada Lovelace"` → `"AL"`. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

function tintFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length] ?? TINTS[0];
}

export function Avatar({ name, size = 32, className = "" }: AvatarProps) {
  const tint = tintFor(name);

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
