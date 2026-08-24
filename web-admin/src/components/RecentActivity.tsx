import { LogIn, Music4, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ActivityItem } from "@/api/types";
import { formatRelative } from "@/lib/format";
import { EmptyView } from "@/components/StateView";

/**
 * The dashboard's activity feed. Each row is a real recorded event — a new account, a saved
 * transcription, or a latest sign-in — not a reconstructed session trail. The relative time is
 * computed against a single "now" sampled by the parent, so every row in one render agrees on it.
 */

const KIND: Record<string, { icon: LucideIcon; tint: string; verb: string }> = {
  // `brand` rather than `primary`: this is a glyph on a tint, so it has to read *as* colour
  // against the card, and the fill blue is too dark to do that once the card goes navy.
  signup: { icon: UserPlus, tint: "bg-brand/10 text-brand", verb: "Signed up" },
  transcription: { icon: Music4, tint: "bg-sky/10 text-sky", verb: "Saved" },
  login: { icon: LogIn, tint: "bg-success/10 text-success-deep", verb: "Signed in" },
};

const FALLBACK = { icon: UserPlus, tint: "bg-muted text-muted-foreground", verb: "Activity" };

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyView
        message="No activity yet"
        hint="Signups, saved transcriptions, and sign-ins will appear here as they happen."
      />
    );
  }

  // One sample of "now" for the whole list, so two rows a second apart don't disagree.
  const now = Date.now();

  return (
    <ul className="divide-y divide-border-light">
      {items.map((item, i) => {
        const meta = KIND[item.kind] ?? FALLBACK;
        const Icon = meta.icon;
        return (
          <li
            key={`${item.kind}-${item.occurredAtUtc}-${i}`}
            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${meta.tint}`}
            >
              <Icon size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-foreground">
                <span className="text-muted-foreground">{meta.verb} · </span>
                <span className="font-medium">{item.title}</span>
              </p>
              {item.subtitle && (
                <p className="truncate text-[11px] text-muted-foreground">{item.subtitle}</p>
              )}
            </div>
            <time
              className="shrink-0 text-[11px] tabular-nums text-faint"
              dateTime={item.occurredAtUtc}
            >
              {formatRelative(item.occurredAtUtc, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
