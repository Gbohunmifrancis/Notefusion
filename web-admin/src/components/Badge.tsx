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

// Neutral is the default and the common case; a colour is only for meaning — status (green, red,
// amber), Pro (amber), in progress (blue). Each tint is faint with a hairline of its own colour.
const TONES = {
  neutral: "bg-muted text-muted-foreground ring-border",
  blue: "bg-brand/10 text-brand-deep ring-brand/20",
  success: "bg-success/10 text-success-deep ring-success/20",
  warning: "bg-warning/10 text-warning-deep ring-warning/20",
  danger: "bg-danger/10 text-danger-deep ring-danger/20",
  premium: "bg-premium/12 text-premium-deep ring-premium/25",
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
        "inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset",
        TONES[tone],
      )}
      {...(title ? { title } : {})}
    >
      {children}
    </span>
  );
}
