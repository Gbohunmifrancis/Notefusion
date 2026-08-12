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
  signup: { icon: UserPlus, tint: "bg-blue/10 text-blue", verb: "Signed up" },
  transcription: { icon: Music4, tint: "bg-sky/10 text-sky", verb: "Saved" },
  login: { icon: LogIn, tint: "bg-success/10 text-success", verb: "Signed in" },
};

const FALLBACK = { icon: UserPlus, tint: "bg-surface-alt text-muted", verb: "Activity" };

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
    <ul className="space-y-1">
      {items.map((item, i) => {
        const meta = KIND[item.kind] ?? FALLBACK;
        const Icon = meta.icon;
        return (
          <li
            key={`${item.kind}-${item.occurredAtUtc}-${i}`}
            className="flex items-center gap-3 rounded-md px-1 py-2"
          >
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${meta.tint}`}
            >
              <Icon size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                <span className="text-muted">{meta.verb} · </span>
                <span className="font-medium">{item.title}</span>
              </p>
              {item.subtitle && (
                <p className="truncate text-xs text-muted">{item.subtitle}</p>
              )}
            </div>
            <time
              className="shrink-0 text-xs tabular-nums text-faint"
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
