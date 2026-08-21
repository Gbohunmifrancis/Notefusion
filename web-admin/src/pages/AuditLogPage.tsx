import { Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getAuditLog } from "@/api/endpoints";
import type { AuditAction, AuditLogRow, PagedResult } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { StateView } from "@/components/StateView";
import { AUDIT_ACTIONS, auditMeta } from "@/lib/audit";
import { UNKNOWN, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TD, TH, THEAD_TR, TR } from "@/lib/tableClasses";
import { useAsync, useDebounced } from "@/lib/useAsync";

const PAGE_SIZE = 30;

/**
 * The record of what operators did. Read-only by design: rows are written by the handlers that
 * perform the actions and there is no edit or delete path, here or on the server.
 *
 * The account filter lives in the URL (`?target=<id>`) rather than in state, because the only way
 * anyone arrives at it is the link from a user's detail page, and it has to survive a refresh and be
 * shareable to be worth anything to a second person looking at the same incident.
 */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const targetUserId = params.get("target") ?? "";

  const [action, setAction] = useState<AuditAction | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [action, debouncedSearch, targetUserId]);

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      getAuditLog(
        page,
        PAGE_SIZE,
        {
          ...(action ? { action } : {}),
          ...(targetUserId ? { targetUserId } : {}),
          ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
        },
        signal,
      ),
    [page, action, targetUserId, debouncedSearch],
  );
  const state = useAsync<PagedResult<AuditLogRow>>(fetcher);

  const offset = getReportingOffset();

  const clearTarget = () => {
    const next = new URLSearchParams(params);
    next.delete("target");
    setParams(next, { replace: true });
  };

  const filtered = Boolean(action || targetUserId || debouncedSearch.trim());

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Audit log" breadcrumb={["Dashboard", "Operations", "Audit log"]} />

      <Card
        title="Operator actions"
        hint="Newest first. Append-only — nothing in this console can edit or delete a row."
        bleed
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as AuditAction | "")}
              aria-label="Filter by action"
              className="h-9 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-ink outline-none transition focus:border-blue"
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>

            <label className="relative block">
              <span className="sr-only">Search by email or summary</span>
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Actor, target or summary"
                className="w-56 rounded-sm border border-border bg-surface py-1.5 pl-9 pr-3 text-[13px] text-ink outline-none transition focus:border-blue"
              />
            </label>
          </div>
        }
      >
        {targetUserId && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
            <span className="text-xs text-muted">Filtered to one account</span>
            <button
              type="button"
              onClick={clearTarget}
              className="inline-flex items-center gap-1 rounded-pill border border-border px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:bg-surface-alt"
            >
              Clear
              <X size={12} aria-hidden="true" />
            </button>
            <Link
              to={`/users/${targetUserId}`}
              className="text-xs font-semibold text-accent transition hover:opacity-80"
            >
              Open the account →
            </Link>
          </div>
        )}

        <StateView
          state={state}
          isEmpty={(data) => data.items.length === 0}
          emptyMessage={filtered ? "No entries match those filters" : "No operator actions yet"}
          {...(filtered
            ? {}
            : {
                emptyHint:
                  "Gifting Pro, suspending an account or changing a role each write a row here.",
              })}
          loadingLabel="Loading the audit log"
        >
          {(data) => (
            <>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[64rem]">
                  <thead>
                    <tr className={THEAD_TR}>
                      <th className={TH}>When</th>
                      <th className={TH}>Action</th>
                      <th className={TH}>By</th>
                      <th className={TH}>On</th>
                      <th className={TH}>IP</th>
                      <th className={TH}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => {
                      const meta = auditMeta(row.action);
                      return (
                        <tr key={row.id} className={TR}>
                          <td className={`${TD} whitespace-nowrap`}>
                            {formatInstantDateTime(row.occurredAtUtc, offset)}
                          </td>
                          <td className={TD}>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                          </td>
                          {/* Both emails are snapshots taken when the action happened, so a row
                              still names the people involved after an account is gone — which is
                              also why neither is a link unless there is still an id to follow. */}
                          <td className={TD}>{row.actorEmail}</td>
                          <td className={TD}>
                            {row.targetUserId ? (
                              <Link
                                to={`/users/${row.targetUserId}`}
                                className="transition hover:text-accent"
                              >
                                {row.targetEmail ?? row.targetUserId}
                              </Link>
                            ) : (
                              (row.targetEmail ?? UNKNOWN)
                            )}
                          </td>
                          <td className={TD}>
                            <span className="font-mono text-[11.5px]">
                              {row.ipAddress ?? UNKNOWN}
                            </span>
                          </td>
                          <td className={TD}>
                            <p className="text-ink">{row.summary}</p>
                            {row.note && <p className="mt-0.5 italic text-faint">“{row.note}”</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pager
                page={data.page}
                pageSize={data.pageSize}
                totalCount={data.totalCount}
                totalPages={data.totalPages}
                busy={state.loading}
                onPage={setPage}
              />
            </>
          )}
        </StateView>
      </Card>
    </div>
  );
}
