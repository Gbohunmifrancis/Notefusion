/**
 * An account's avatar: the stored photo when there is one, initials over a hashed tint when
 * there is not.
 *
 * The tint is hashed rather than picked at random, so one person keeps one colour across the
 * accounts table and the sidebar instead of reshuffling on every render. It also stays behind
 * the photo as its ground, which is what keeps a transparent PNG or a slow load from showing
 * as a hole in the surface.
 *
 * Not shadcn's `Avatar`. That one swaps between `AvatarImage` and `AvatarFallback` — one or the
 * other — so a photo with transparency lands on the page background rather than on a tint, and
 * the fallback it would show has no per-account colour.
 */

"use client";

import { useState } from "react";

import { useTheme } from "next-themes";

import type { ThemeMode } from "@/lib/chart";
import { cn } from "@/lib/utils";

interface AvatarProps {
  name: string;
  /**
   * The account's `profilePictureUrl`. Typed to accept null because that is what the API
   * returns for an account with no photo, and `exactOptionalPropertyTypes` will not let a
   * nullable value through an optional-only prop.
   */
  src?: string | null;
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

export function Avatar({ name, src, size = 32, className }: AvatarProps) {
  const { resolvedTheme } = useTheme();
  const tint = tintFor(name, resolvedTheme === "dark" ? "dark" : "light");

  // The URL that failed, not a boolean: a row that re-renders with a different `src` has to
  // try the new one, and a flag would keep the fallback forever.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;

  return (
    <span
      // The name is always rendered as text beside this, so announcing the initials too
      // would just make a screen reader say the person twice.
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold leading-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: tint.bg,
        color: tint.fg,
        fontSize: Math.max(10, Math.round(size * 0.36)),
      }}
    >
      {initials(name)}
      {photo && (
        /*
         * A plain `<img>`, not `next/image`. These URLs come from whatever storage the account
         * used — Google's CDN today, R2 for uploads — and `next/image` would need every one of
         * those hosts allow-listed in `next.config.ts`, so the next storage change would show
         * up as blank avatars rather than as a build error.
         *
         * Not lazy, either. Twenty 32px thumbnails on a page of accounts are all within a
         * screen or two of the viewport, so `loading="lazy"` saves nothing and costs a request
         * that only fires once something scrolls.
         */
        <img
          src={photo}
          alt=""
          // Google serves avatars from lh3.googleusercontent.com and answers 403 to some
          // referrers, which is one of the ways this used to end up blank.
          referrerPolicy="no-referrer"
          onError={() => setFailed(photo)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
