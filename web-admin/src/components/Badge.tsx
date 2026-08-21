/**
 * A small status pill. Lifted out of `UsersPage` once the detail, audit-log and health pages all
 * needed the same thing — three copies of a colour map would have drifted apart by the second one.
 *
 * Tones are named for what they mean, not for their colour: `premium` is the Pro/gift gold from the
 * mobile app, and every value resolves through the theme tokens, so both modes come for free.
 */

const TONES = {
  neutral: "bg-surface-alt text-muted",
  blue: "bg-accent/10 text-accent-deep",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  premium: "bg-premium/15 text-premium-deep",
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
      className={`inline-flex items-center rounded-[6px] px-2 py-[3px] text-[11px] font-semibold ${TONES[tone]}`}
      {...(title ? { title } : {})}
    >
      {children}
    </span>
  );
}
