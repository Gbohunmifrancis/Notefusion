/**
 * A small status pill. Lifted out of `UsersPage` once the detail, audit-log and health pages all
 * needed the same thing — three copies of a colour map would have drifted apart by the second one.
 *
 * Tones are named for what they mean, not for their colour: `premium` is the Pro/gift gold from the
 * mobile app, and every value resolves through the theme tokens, so both modes come for free.
 *
 * Separate from shadcn's `Badge`, whose four variants (default/secondary/destructive/outline) are
 * about emphasis while these six are about account state — there is no `outline` subscription and
 * no `secondary` suspension. It also stays a tint-plus-deep-text pair rather than a solid fill,
 * because a row of solid pills in a table reads as the loudest thing on the page.
 */

import { cn } from "@/lib/utils";

// Each tint carries a hairline of its own colour, so a pill reads as a lit chip on the night
// canvas rather than a smudge.
const TONES = {
  neutral: "bg-muted text-muted-foreground ring-border",
  blue: "bg-brand/12 text-brand-deep ring-brand/25",
  success: "bg-success/12 text-success-deep ring-success/25",
  warning: "bg-warning/12 text-warning-deep ring-warning/25",
  danger: "bg-danger/12 text-danger-deep ring-danger/25",
  premium: "bg-premium/15 text-premium-deep ring-premium/30",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: string;
  tone?: BadgeTone;
  /** A native tooltip for the cases where the pill is shorter than the truth it stands for. */
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-[3px] text-[11px] font-semibold ring-1 ring-inset",
        TONES[tone],
      )}
      {...(title ? { title } : {})}
    >
      {children}
    </span>
  );
}
