"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { getSessionErrorRecording, getSessionErrors, getSessionRecordings } from "@/api/endpoints";
import type { SessionIssue, SessionRecording, SessionSource } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatInstantDateTime, formatRelative } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { clock, screensLine } from "@/lib/sessions";
import { TBODY, TD, TH } from "@/lib/tableClasses";

type Tab = "recordings" | "errors";
type RecordingFilter = "all" | "errors";
type ErrorFilter = "all" | SessionSource;

/** While the page is open the lists are read again this often (a hidden tab is not), since Sentry tells us nothing. */
const REFRESH_MS = 30_000;

/**
 * Sessions (board k-sessions): the phone's Sentry recordings, newest first, a session still recording on top, and every
 * project's errors. A recording opens in the player; an error from the phone opens its latest recording, one from
 * anywhere else opens in Sentry. The console only reads: resolving and ignoring stay in Sentry.
 */
export function SessionsView() {
  const [tab, setTab] = useState<Tab>("recordings");

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Sessions"
        subtitle="Recordings from the phone app and errors from everywhere, from Sentry. Kept there for 90 days."
        breadcrumb={["Dashboard", "Sessions"]}
        actions={
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: "recordings", label: "Recordings" },
              { value: "errors", label: "Errors" },
            ]}
          />
        }
      />
      {tab === "recordings" ? <Recordings /> : <Errors />}
    </div>
  );
}

function Recordings() {
  const [filter, setFilter] = useState<RecordingFilter>("all");
  // Sentry pages by cursor: the stack is the way back.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;

  const state = useQuery({
    queryKey: ["sessions", "recordings", filter, cursor],
    queryFn: ({ signal }) => getSessionRecordings(filter === "errors", cursor, signal),
    placeholderData: keepPreviousData,
    // Only the first page moves: newer sessions arrive at its top.
    refetchInterval: cursor === null ? REFRESH_MS : false,
  });

  const offset = getReportingOffset();
  const now = Date.now();

  return (
    <Card
      title="Recordings"
      hint="About 1 in 10 sessions, and every session that hit an error. Names come from our own accounts."
      bleed
      action={
        <Segmented
          label="Filter recordings"
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setCursors([null]);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "errors", label: "With an error" },
          ]}
        />
      }
    >
      <StateView
        state={state}
        isEmpty={(data) => data.items.length === 0}
        emptyMessage={filter === "errors" ? "No recording hit an error" : "No session has been recorded yet"}
        emptyHint="The phone app records about one session in ten, and every session with an error."
        loadingLabel="Loading recordings"
      >
        {(data) => (
          <>
            <div className="w-full min-w-0">
              <Table className="w-full min-w-[56rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={TH}>Who</TableHead>
                    <TableHead className={TH}>Phone</TableHead>
                    <TableHead className={TH}>When</TableHead>
                    <TableHead className={TH}>Went through</TableHead>
                    <TableHead className={TH}>
                      <span className="sr-only">Errors</span>
                    </TableHead>
                    <TableHead className={`${TH} text-right`}>
                      <span className="sr-only">Watch</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={TBODY}>
                  {data.items.map((row) => (
                    <RecordingRow key={row.id} row={row} offset={offset} now={now} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-[12.5px] text-muted-foreground">
              <span>{state.isFetching ? "Checking for new sessions…" : `Updated ${formatRelative(new Date(state.dataUpdatedAt).toISOString(), now)}`}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((s) => s.slice(0, -1))}
                  className="rounded-sm px-2 py-1 font-medium text-brand transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Newer
                </button>
                <button
                  type="button"
                  disabled={!data.nextCursor}
                  onClick={() => data.nextCursor && setCursors((s) => [...s, data.nextCursor])}
                  className="rounded-sm px-2 py-1 font-medium text-brand transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Older
                </button>
              </div>
            </div>
          </>
        )}
      </StateView>
    </Card>
  );
}

function RecordingRow({ row, offset, now }: { row: SessionRecording; offset: number; now: number }) {
  return (
    <TableRow>
      <TableCell className={TD}>
        {row.person ? (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.person.name || row.person.email} size={26} />
            <div className="min-w-0">
              <Link href={`/users/${row.person.id}`} className="block truncate font-medium text-foreground transition hover:text-brand">
                {row.person.name || row.person.email}
              </Link>
              <p className="truncate text-[11.5px] text-faint">{row.person.email}</p>
            </div>
          </div>
        ) : (
          <span className="text-faint">Not signed in</span>
        )}
      </TableCell>
      <TableCell className={TD}>
        <p className="text-foreground">{row.device ?? "Unknown phone"}</p>
        <p className="text-[11.5px] text-faint">{[row.os, row.build ? `build ${row.build}` : null].filter(Boolean).join(" · ")}</p>
      </TableCell>
      <TableCell className={TD}>
        {row.recordingNow ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11.5px] font-medium text-success-deep">
            <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden="true" />
            Recording now
          </span>
        ) : (
          <span className="text-foreground">{formatInstantDateTime(row.startedAt, offset)}</span>
        )}
        <p className="text-[11.5px] text-faint">
          {row.recordingNow ? `${formatRelative(row.startedAt, now).replace(" ago", "")} so far` : clock(row.durationSeconds * 1000)}
        </p>
      </TableCell>
      <TableCell className={`${TD} max-w-[18rem] truncate text-[12.5px]`} title={row.screens.join(" → ")}>
        {screensLine(row.screens)}
      </TableCell>
      <TableCell className={TD}>
        {row.errorCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-warning-deep">
            <TriangleAlert size={14} aria-hidden="true" />
            {row.errorCount === 1 ? "1 error" : `${formatCount(row.errorCount)} errors`}
          </span>
        )}
      </TableCell>
      <TableCell className={`${TD} text-right`}>
        <Link
          href={`/sessions/${row.id}`}
          className={
            row.recordingNow
              ? "rounded-sm bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-brand-deep"
              : "rounded-sm px-2 py-1 text-[12.5px] font-medium text-brand transition hover:bg-muted"
          }
        >
          {row.recordingNow ? "Watch live" : "Watch"}
        </Link>
      </TableCell>
    </TableRow>
  );
}

function Errors() {
  const [source, setSource] = useState<ErrorFilter>("all");
  const state = useQuery({
    queryKey: ["sessions", "errors", source],
    queryFn: ({ signal }) => getSessionErrors(source === "all" ? null : source, signal),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const now = Date.now();

  return (
    <Card
      title="Errors"
      hint="Unresolved, the last 7 days, the most people affected first. Resolve and ignore them in Sentry."
      bleed
      action={
        <Segmented
          label="Filter errors"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "All" },
            { value: "Phone", label: "Phone" },
            { value: "API", label: "API" },
            { value: "Worker", label: "Worker" },
            { value: "Web", label: "Web" },
          ]}
        />
      }
    >
      <StateView
        state={state}
        isEmpty={(data) => data.length === 0}
        emptyMessage="No unresolved errors in the last 7 days"
        loadingLabel="Loading errors"
      >
        {(data) => (
          <ul className="divide-y divide-border/60">
            {data.map((issue) => (
              <IssueRow key={issue.id} issue={issue} now={now} />
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}

function IssueRow({ issue, now }: { issue: SessionIssue; now: number }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  async function watch() {
    setOpening(true);
    try {
      const { recordingId } = await getSessionErrorRecording(issue.id);
      if (recordingId) router.push(`/sessions/${recordingId}`);
      else toast("The latest time this happened was not recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't open the recording.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <span className="grid size-8 flex-none place-items-center rounded-md bg-warning/10 text-warning-deep">
        <TriangleAlert size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground" title={issue.title}>
          {issue.title}
        </p>
        <p className="flex items-center gap-2 truncate text-[12px] text-faint">
          <Badge tone="blue">{issue.source}</Badge>
          <span className="truncate">{issue.where || "—"}</span>
          <span>· first seen {formatRelative(issue.firstSeen, now)}</span>
        </p>
      </div>
      <div className="w-36 flex-none text-right text-[12px] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{issue.count === 1 ? "1 time" : `${formatCount(issue.count)} times`}</span>
          {" · "}
          {issue.people === 1 ? "1 person" : `${formatCount(issue.people)} people`}
        </p>
        <p>last {formatRelative(issue.lastSeen, now)}</p>
      </div>
      {issue.source === "Phone" ? (
        <button
          type="button"
          onClick={() => void watch()}
          disabled={opening}
          className="flex-none rounded-sm border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {opening ? "Opening…" : "Watch"}
        </button>
      ) : (
        <a
          href={issue.sentryUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-none items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:bg-muted"
        >
          Open in Sentry <ExternalLink size={13} aria-hidden="true" />
        </a>
      )}
    </li>
  );
}
