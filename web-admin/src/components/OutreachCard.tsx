"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { request } from "@/api/client";
import { Badge } from "@/components/Badge";
import type { BadgeTone } from "@/components/Badge";
import { Card } from "@/components/Card";
import { StateView } from "@/components/StateView";
import { formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";

/**
 * The founder's customer-research outreach (`GET /api/admin/outreach`): whether it is sending, how many
 * accounts each segment has reached, and the newest sends. Self-contained (types and call here) because
 * nothing else in the console reads this endpoint.
 */

type OutreachSegment = "checkoutAbandoned" | "activeUser" | "triedOnce" | "neverTranscribed";
type OutreachStatus = "pending" | "sent" | "failed";

interface OutreachMessage {
  id: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  segment: OutreachSegment;
  channel: "email" | "push";
  status: OutreachStatus;
  attempts: number;
  error: string | null;
  createdAtUtc: string;
  sentAtUtc: string | null;
}

interface OutreachOverview {
  enabled: boolean;
  disabledReason: string | null;
  unsubscribed: number;
  segments: {
    segment: OutreachSegment;
    users: number;
    emailsSent: number;
    pushesSent: number;
    failed: number;
    pending: number;
  }[];
  recent: OutreachMessage[];
}

const getOutreach = (signal?: AbortSignal) =>
  request<OutreachOverview>("/api/admin/outreach?take=50", signal ? { signal } : {});

const SEGMENTS: Record<OutreachSegment, string> = {
  checkoutAbandoned: "Unfinished checkout",
  activeUser: "Active free user",
  triedOnce: "Tried once",
  neverTranscribed: "Never transcribed",
};

const STATUS_TONES: Record<OutreachStatus, BadgeTone> = { sent: "success", pending: "warning", failed: "danger" };

export function OutreachCard() {
  const state = useQuery({ queryKey: ["admin-outreach"], queryFn: ({ signal }) => getOutreach(signal) });
  const offset = getReportingOffset();

  return (
    <Card
      title="Founder outreach"
      hint="Research emails and pushes sent automatically, once per segment per account"
      info="Unfinished checkouts are asked what stopped them, active free users are invited to a chat, one-time users are asked whether their sheet came out right, and those who never transcribed are asked what was in the way. At most one message a week per account, 09:00–19:00 WAT. Replies go to the founder."
      bleed
    >
      <StateView state={state} loadingLabel="Loading outreach">
        {(o) => (
          <div className="border-t border-border">
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-xs text-muted-foreground">
              <Badge tone={o.enabled ? "success" : "neutral"}>{o.enabled ? "Sending" : "Off"}</Badge>
              {o.disabledReason && <span>{o.disabledReason}</span>}
              <span>· {o.unsubscribed} unsubscribed</span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Segment</th>
                  <th className="px-2 py-2 text-right font-medium">Accounts</th>
                  <th className="px-2 py-2 text-right font-medium">Emails</th>
                  <th className="px-2 py-2 text-right font-medium">Pushes</th>
                  <th className="px-5 py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.segments.map((s) => (
                  <tr key={s.segment}>
                    <td className="px-5 py-1.5 text-foreground">{SEGMENTS[s.segment] ?? s.segment}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{s.users}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{s.emailsSent}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{s.pushesSent}</td>
                    <td className="px-5 py-1.5 text-right tabular-nums text-foreground">{s.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.recent.length === 0 ? (
              <p className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {o.recent.map((m) => (
                  <li key={m.id} className="grid gap-1 px-5 py-2.5 text-xs sm:grid-cols-[12rem_1fr_auto] sm:items-center">
                    <Link href={`/users/${m.userId}`} className="truncate font-semibold text-foreground hover:text-brand">
                      {m.fullName || m.email || m.userId}
                    </Link>
                    <span className="text-muted-foreground">
                      {SEGMENTS[m.segment] ?? m.segment} · {m.channel} · {formatInstantDateTime(m.createdAtUtc, offset)}
                      {m.error && <span className="block text-danger-deep">{m.error}</span>}
                    </span>
                    <Badge tone={STATUS_TONES[m.status] ?? "neutral"}>{m.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </StateView>
    </Card>
  );
}
