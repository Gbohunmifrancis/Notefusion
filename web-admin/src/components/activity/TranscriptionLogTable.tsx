import Link from "next/link";

import type { TranscriptionLogRow } from "@/api/types";
import { Badge } from "@/components/Badge";
import type { BadgeTone } from "@/components/Badge";
import { formatBytes, formatInstantDateTime } from "@/lib/format";

const TH = "px-4 py-3 font-medium whitespace-nowrap";
const TD = "px-4 py-3 align-top";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  refused: { label: "Refused", tone: "danger" },
  submitted: { label: "Running", tone: "neutral" },
};

const KIND: Record<string, string> = {
  upload: "Recording / file",
  song: "Song (voice isolated)",
  score: "Score file",
  link: "Song link",
};

function seconds(value: number | null): string | null {
  if (value == null) return null;
  const total = Math.round(value);
  return total >= 60 ? `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s` : `${total}s`;
}

/** What was sent: the file's name, or the song behind a link. */
function What({ row }: { row: TranscriptionLogRow }) {
  if (row.kind === "link") {
    const title = row.songTitle ? `${row.songTitle}${row.songArtist ? ` · ${row.songArtist}` : ""}` : null;
    return (
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground" title={title ?? row.linkUrl ?? undefined}>
          {title ?? "Song link"}
        </div>
        {row.linkUrl && (
          <a
            href={row.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-[11px] text-brand hover:underline"
            title={row.linkUrl}
          >
            {row.linkUrl}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="truncate font-medium text-foreground" title={row.fileName ?? undefined}>
      {row.fileName ?? "Unnamed file"}
    </div>
  );
}

/**
 * The activity log's rows: one per transcription asked for, saved or not, with the upload's
 * metadata (never the audio), the settings it was sent with and how it ended.
 */
export function TranscriptionLogTable({
  rows,
  offset,
  showUser = true,
}: {
  rows: TranscriptionLogRow[];
  offset: number;
  showUser?: boolean;
}) {
  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-xs">
        <thead className="border-b border-border bg-muted/40 text-muted-foreground">
          <tr>
            <th className={TH}>When</th>
            {showUser && <th className={TH}>Who</th>}
            <th className={TH}>What was sent</th>
            <th className={TH}>Details</th>
            <th className={TH}>Outcome</th>
            <th className={`${TH} text-right`}>Saved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const status = STATUS[row.status] ?? { label: row.status, tone: "neutral" as BadgeTone };
            const details = [
              KIND[row.kind] ?? row.kind,
              row.contentType,
              row.sizeBytes != null ? formatBytes(row.sizeBytes) : null,
              seconds(row.audioSeconds),
              row.mode,
              row.client === "unknown" ? null : row.client === "app" ? "mobile app" : "web",
            ].filter(Boolean);
            const asked = [
              row.keyRequested && `key ${row.keyRequested}`,
              row.tempoRequested && `${row.tempoRequested} BPM`,
              row.timeSignatureRequested,
              row.startSeconds != null || row.endSeconds != null
                ? `section ${seconds(row.startSeconds ?? 0)}–${seconds(row.endSeconds) ?? "end"}`
                : null,
            ].filter(Boolean);
            const took =
              row.finishedAtUtc && row.status !== "refused"
                ? seconds((Date.parse(row.finishedAtUtc) - Date.parse(row.createdAtUtc)) / 1000)
                : null;
            const journey = row.userId
              ? `/activity/journey?userId=${row.userId}`
              : row.deviceHash
                ? `/activity/journey?device=${encodeURIComponent(row.deviceHash)}`
                : null;

            return (
              <tr key={row.id} className="transition hover:bg-muted/40">
                <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                  {formatInstantDateTime(row.createdAtUtc, offset)}
                  {row.origin === "preview" && (
                    <div className="mt-1">
                      <Badge title="The website's anonymous try-it-free">Free preview</Badge>
                    </div>
                  )}
                </td>
                {showUser && (
                  <td className={`${TD} max-w-[13rem]`}>
                    {row.userId ? (
                      <Link href={`/users/${row.userId}`} className="block truncate font-medium text-foreground hover:text-brand">
                        {row.userName || row.userEmail}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Anonymous visitor</span>
                    )}
                    {row.userEmail && row.userName && (
                      <div className="truncate text-[11px] text-muted-foreground">{row.userEmail}</div>
                    )}
                    {journey && (
                      <Link href={journey} className="text-[11px] text-brand hover:underline">
                        View journey
                      </Link>
                    )}
                  </td>
                )}
                <td className={`${TD} max-w-[18rem]`}>
                  <What row={row} />
                </td>
                <td className={`${TD} max-w-[16rem] text-muted-foreground`}>
                  <div>{details.join(" · ")}</div>
                  {asked.length > 0 && <div className="text-[11px]">Asked for: {asked.join(", ")}</div>}
                </td>
                <td className={`${TD} max-w-[18rem]`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {row.usedStorePreview && (
                      <Badge tone="warning" title="The platform refused the song; the store's 30-second preview was used">
                        Store preview
                      </Badge>
                    )}
                    {took && <span className="text-[11px] text-muted-foreground">in {took}</span>}
                  </div>
                  {row.status === "done" && row.detectedKey && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {row.detectedKey} · {row.detectedTempo} BPM · {row.noteCount} notes
                      {row.confidence != null && ` · ${Math.round(row.confidence * 100)}% sure`}
                    </div>
                  )}
                  {row.failureReason && (
                    <div className="mt-1 text-[11px] text-danger-deep" title={row.failureReason}>
                      {row.failureReason}
                    </div>
                  )}
                </td>
                <td className={`${TD} text-right`}>
                  {row.saved ? <Badge tone="success">Saved</Badge> : <span className="text-muted-foreground">No</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
