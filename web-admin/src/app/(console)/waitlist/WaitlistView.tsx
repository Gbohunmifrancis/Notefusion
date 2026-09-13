"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Mail, Search, Sparkles, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { getWaitlist } from "@/api/endpoints";
import type { AdminWaitlistRow } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { SendEmailDialog, type SendEmailTarget } from "@/components/SendEmailDialog";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatInstantDateTime, formatRelative } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 25;

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-faint">—</span>;
  const lower = role.toLowerCase();
  if (lower.includes("director") || lower.includes("leader")) {
    return <Badge tone="blue">{role}</Badge>;
  }
  if (lower.includes("teacher") || lower.includes("instructor")) {
    return <Badge tone="premium">{role}</Badge>;
  }
  return <Badge>{role}</Badge>;
}

export function WaitlistView() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<SendEmailTarget | null>(null);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [debouncedSearch]);

  const term = debouncedSearch.trim();
  const state = useQuery({
    queryKey: ["waitlist", page, term],
    queryFn: ({ signal }) => getWaitlist(page, PAGE_SIZE, term, signal),
    placeholderData: keepPreviousData,
  });

  useClampPage(page, state.data?.totalPages, setPage);
  const offset = getReportingOffset();

  function onOpenEmail(subscriber: AdminWaitlistRow) {
    setEmailTarget({
      id: subscriber.id,
      fullName: subscriber.fullName ?? subscriber.email,
      email: subscriber.email,
    });
    setEmailDialogOpen(true);
  }

  function exportCsv() {
    const items = state.data?.items ?? [];
    if (items.length === 0) return;
    const header = ["Email", "Full Name", "Role", "Source", "Joined At UTC"];
    const rows = items.map((r) => [
      `"${r.email}"`,
      `"${r.fullName ?? ""}"`,
      `"${r.role ?? ""}"`,
      `"${r.source ?? ""}"`,
      `"${r.createdAtUtc}"`,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [header.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `notefusion_waitlist_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        subtitle="Subscribers registered for early access while NoteFusion is under Google Play review."
        breadcrumb={["Analytics", "Waitlist"]}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!state.data?.items || state.data.items.length === 0}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
        }
      />

      {/* Overview Stat Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex items-center justify-between p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Waitlist
            </p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {state.data ? formatCount(state.data.totalCount) : "—"}
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <Sparkles className="h-5 w-5" />
          </div>
        </Card>
        <Card className="flex items-center justify-between p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Store Status
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              In Google Play Review
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
            <UserCheck className="h-5 w-5" />
          </div>
        </Card>
      </div>

      {/* Search Bar */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, name, or role..."
            className="pl-9"
          />
        </div>
      </Card>

      {/* Waitlist Table */}
      <Card className="overflow-hidden">
        <StateView
          state={state}
          isEmpty={(d) => d.items.length === 0}
          emptyMessage={term ? "No matching subscribers" : "No waitlist subscribers yet"}
          emptyHint={
            term
              ? "No subscribers match your search term. Clear the filter to view all."
              : "When users join the waitlist on the landing page, they will appear here."
          }
        >
          {(data) => (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TH}>Subscriber</TableHead>
                      <TableHead className={TH}>Role / Focus</TableHead>
                      <TableHead className={TH}>Source</TableHead>
                      <TableHead className={TH}>Joined</TableHead>
                      <TableHead className={`${TH} text-right`}>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={TBODY}>
                    {data.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className={TD}>
                          <div className="flex items-center gap-3">
                            <Avatar
                              name={row.fullName || row.email}
                              src={null}
                              size={36}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">
                                {row.fullName || "—"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {row.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className={TD}>
                          <RoleBadge role={row.role} />
                        </TableCell>

                        <TableCell className={TD}>
                          <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {row.source || "organic"}
                          </span>
                        </TableCell>

                        <TableCell className={TD}>
                          <div className="flex flex-col">
                            <span
                              title={formatInstantDateTime(row.createdAtUtc, offset)}
                              className="cursor-default font-medium text-foreground"
                            >
                              {formatRelative(row.createdAtUtc, Date.now())}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatInstantDateTime(row.createdAtUtc, offset)}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell className={`${TD} text-right`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenEmail(row)}
                            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            <span>Email</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {data.totalPages > 1 && (
                <div className="border-t border-border p-4">
                  <Pager
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalCount={data.totalCount}
                    totalPages={data.totalPages}
                    onPage={setPage}
                  />
                </div>
              )}
            </>
          )}
        </StateView>
      </Card>

      {/* Direct email dialog */}
      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        targetUser={emailTarget}
      />
    </div>
  );
}
