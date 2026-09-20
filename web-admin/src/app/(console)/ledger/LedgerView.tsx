"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { getLedger } from "@/api/endpoints";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Pager } from "@/components/Pager";
import { StateView } from "@/components/StateView";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInstantDateTime } from "@/lib/format";
import { TBODY, TD, TH } from "@/lib/tableClasses";
import { useClampPage } from "@/lib/useClampPage";
import { getReportingOffset } from "@/lib/reporting";

const PAGE_SIZE = 30;

export function LedgerView() {
  const [page, setPage] = useState(1);
  const offset = getReportingOffset();

  const query = useQuery({
    queryKey: ["ledger", page],
    queryFn: ({ signal }) => getLedger(page, PAGE_SIZE, {}, signal),
    placeholderData: keepPreviousData,
  });

  useClampPage(page, query.data?.totalPages, setPage);

  return (
    <>
      <PageHeader
        title="Ledger"
        subtitle="Append-only record of all financial movements across all accounts."
        breadcrumb={["Console", "Ledger"]}
      />

      <Card>
        <StateView
          state={query}
          isEmpty={() => query.data?.items.length === 0}
          emptyMessage="When payments process, their ledger movements will appear here."
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>Timestamp</TableHead>
                    <TableHead className={TH}>Account</TableHead>
                    <TableHead className={TH}>Amount</TableHead>
                    <TableHead className={TH}>Type</TableHead>
                    <TableHead className={TH}>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={TBODY}>
                  {data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className={TD}>
                        {formatInstantDateTime(row.createdAtUtc, offset)}
                      </TableCell>
                      <TableCell className={TD}>
                        <Link
                          href={`/users/${row.userId}`}
                          className="font-medium text-[#101828] hover:text-[#2563EB] dark:text-[#fafafa] dark:hover:text-blue-400"
                        >
                          {row.userEmail}
                        </Link>
                      </TableCell>
                      <TableCell className={TD}>
                        <span
                          className={
                            row.direction === "Credit" ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-600 dark:text-slate-400 font-medium"
                          }
                        >
                          {row.direction === "Credit" ? "+" : "-"}
                          {(row.amountMinor / 100).toFixed(2)} {row.currency}
                        </span>
                      </TableCell>
                      <TableCell className={TD}>
                        <Badge
                          tone={row.reason === "Refund" ? "warning" : "neutral"}
                        >{row.reason}</Badge>
                      </TableCell>
                      <TableCell className={TD}>
                        <span className="truncate max-w-[200px] block">{row.description}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.totalCount > PAGE_SIZE && (
                <Pager
                  page={page}
                  pageSize={PAGE_SIZE}
                  totalCount={data.totalCount}
                  totalPages={data.totalPages}
                  busy={query.isFetching}
                  onPage={setPage}
                />
              )}
            </>
          )}
        </StateView>
      </Card>
    </>
  );
}
