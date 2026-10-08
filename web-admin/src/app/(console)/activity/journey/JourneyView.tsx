"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { getJourney } from "@/api/endpoints";
import type { JourneySubject } from "@/api/types";
import { JourneyTimeline } from "@/components/activity/JourneyTimeline";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { getReportingOffset } from "@/lib/reporting";

const WINDOWS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "180", label: "180d" },
] as const;
type Window = (typeof WINDOWS)[number]["value"];

/** A short, stable label for an opaque id: enough to tell two apart on screen. */
function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * One account's, device's or browser's journey: everything it did on the site and in the app,
 * newest first, from every browser and device known to be the same person.
 */
export function JourneyView() {
  const params = useSearchParams();
  const subject: JourneySubject = {
    userId: params.get("userId") ?? undefined,
    device: params.get("device") ?? undefined,
    visitor: params.get("visitor") ?? undefined,
  };
  const [days, setDays] = useState<Window>("30");
  const offset = getReportingOffset();
  const hasSubject = Boolean(subject.userId || subject.device || subject.visitor);

  const state = useQuery({
    queryKey: ["journey", subject, days],
    queryFn: ({ signal }) => getJourney(subject, Number(days), signal),
    placeholderData: keepPreviousData,
    enabled: hasSubject,
  });

  const title = state.data?.userName || state.data?.userEmail || (subject.userId ? "Account" : "Anonymous visitor");

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={`Journey · ${title}`}
        breadcrumb={["Dashboard", "Activity", "Journey"]}
        actions={
          <div className="flex items-center gap-2">
            <Segmented label="Window" options={WINDOWS} value={days} onChange={setDays} />
            <Button asChild variant="outline" className="h-9 gap-1.5 text-xs">
              <Link href={subject.userId ? `/users/${subject.userId}` : "/activity"}>
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {subject.userId ? "Account" : "Activity"}
              </Link>
            </Button>
          </div>
        }
      />

      {!hasSubject ? (
        <p className="text-[13px] text-muted-foreground">Open a journey from a user, or from a row on the Activity page.</p>
      ) : (
        <StateView state={state} loadingLabel="Loading journey">
          {(j) => (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">{`${j.sessions} visits`}</Badge>
                <Badge tone="neutral">{`${j.pageviews} pages viewed`}</Badge>
                <Badge tone="blue">{`${j.transcriptions} transcriptions`}</Badge>
                <Badge tone="premium">{`${j.payments} payment attempts`}</Badge>
                <Badge tone="neutral">{`${j.visitorIds.length} browsers · ${j.deviceHashes.length} devices`}</Badge>
              </div>

              {j.otherAccounts.length > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Seen signed in as{" "}
                  {j.otherAccounts.map((id, i) => (
                    <span key={id}>
                      {i > 0 && ", "}
                      <Link href={`/activity/journey?userId=${id}`} className="text-brand hover:underline">
                        account {shortId(id)}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              )}
              {j.truncated && (
                <p className="text-[13px] text-warning-deep">
                  This window has more activity than one page shows; the newest is listed. Narrow the window to see older events.
                </p>
              )}

              <Card title="Timeline" hint="Newest first, grouped into visits" bleed>
                <JourneyTimeline items={j.items} offset={offset} />
              </Card>
            </div>
          )}
        </StateView>
      )}
    </div>
  );
}
