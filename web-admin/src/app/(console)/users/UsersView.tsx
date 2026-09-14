"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Mail, MoreHorizontal, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getUsers } from "@/api/endpoints";
import type { AdminUserRow } from "@/api/types";
import { Avatar } from "@/components/Avatar";
import { SendEmailDialog, type SendEmailTarget } from "@/components/SendEmailDialog";
import { StateView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  formatInstantDate,
  formatInstantDateTime,
  formatRelative,
} from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { useClampPage } from "@/lib/useClampPage";
import { useDebounced } from "@/lib/useDebounced";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "online", label: "Online" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const IS_ACTIVE: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  online: undefined,
  active: true,
  suspended: false,
};

const IS_ONLINE: Record<StatusFilter, boolean | undefined> = {
  all: undefined,
  online: true,
  active: undefined,
  suspended: undefined,
};

function isUserOnline(lastLoginAt: string | null): boolean {
  if (!lastLoginAt) return false;
  const time = new Date(lastLoginAt).getTime();
  if (Number.isNaN(time)) return false;
  const diff = Date.now() - time;
  return diff >= 0 && diff < 5 * 60 * 1000;
}

function LastSeenCell({
  lastLoginAt,
  offset,
}: {
  lastLoginAt: string | null;
  offset: number;
}) {
  if (!lastLoginAt) {
    return <span className="text-slate-400">Never</span>;
  }
  const time = new Date(lastLoginAt).getTime();
  if (Number.isNaN(time)) {
    return <span className="text-slate-400">Never</span>;
  }
  const now = Date.now();
  const diff = now - time;

  if (diff >= 0 && diff < 5 * 60 * 1000) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span>Online now</span>
      </span>
    );
  }

  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
    return (
      <span
        title={formatInstantDateTime(lastLoginAt, offset)}
        className="cursor-default text-slate-600 dark:text-slate-400"
      >
        {formatRelative(lastLoginAt, now)}
      </span>
    );
  }

  return (
    <span
      title={formatInstantDateTime(lastLoginAt, offset)}
      className="cursor-default text-slate-600 dark:text-slate-400"
    >
      {formatInstantDate(lastLoginAt, offset)}
    </span>
  );
}

function PlanBadge({ user }: { user: AdminUserRow }) {
  if (!user.hasProAccess) {
    return (
      <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Basic
      </span>
    );
  }
  if (user.isGiftedPro) {
    return (
      <span className="inline-flex items-center rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-[#4F46E5] dark:bg-indigo-950/60 dark:text-indigo-400">
        Team
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#2563EB] dark:bg-blue-950/60 dark:text-blue-400">
      Pro
    </span>
  );
}

function StatusBadge({ user, online }: { user: AdminUserRow; online: boolean }) {
  if (online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Online
      </span>
    );
  }
  if (user.isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Suspended
    </span>
  );
}

export function UsersView() {
  const params = useSearchParams();
  const incoming = params.get("q") ?? "";
  const [search, setSearch] = useState(incoming);
  useEffect(() => setSearch(incoming), [incoming]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<SendEmailTarget | null>(null);
  const debouncedSearch = useDebounced(search);

  useEffect(() => setPage(1), [debouncedSearch, status, planFilter]);

  const term = debouncedSearch.trim();
  const state = useQuery({
    queryKey: ["users", page, term, status],
    queryFn: ({ signal }) =>
      getUsers(page, PAGE_SIZE, term, IS_ACTIVE[status], IS_ONLINE[status], signal),
    placeholderData: keepPreviousData,
  });

  useClampPage(page, state.data?.totalPages, setPage);
  const offset = getReportingOffset();

  const items = useMemo(() => {
    if (!state.data?.items) return [];
    if (planFilter === "all") return state.data.items;
    if (planFilter === "pro") return state.data.items.filter((u) => u.hasProAccess && !u.isGiftedPro);
    if (planFilter === "team") return state.data.items.filter((u) => u.isGiftedPro);
    if (planFilter === "basic") return state.data.items.filter((u) => !u.hasProAccess);
    return state.data.items;
  }, [state.data?.items, planFilter]);

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(items.map((u) => u.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExport() {
    if (!items || items.length === 0) return;
    const header = "ID,Name,Email,Role,Active,Joined,LastLogin\n";
    const rows = items
      .map(
        (u) =>
          `"${u.id}","${u.fullName.replace(/"/g, '""')}","${u.email}","${u.role}",${u.isActive},"${u.createdAt}","${u.lastLoginAt ?? ""}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "notefusion-users.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCount = state.data?.totalCount ?? 0;
  const totalPages = Math.max(1, state.data?.totalPages ?? 1);
  const startItem = totalCount > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const endItem = Math.min(page * PAGE_SIZE, totalCount);

  const pageNumbers = useMemo(() => {
    const list: number[] = [];
    const max = Math.min(totalPages, 5);
    for (let i = 1; i <= max; i++) list.push(i);
    return list;
  }, [totalPages]);

  const allSelected = items.length > 0 && items.every((u) => selectedIds.has(u.id));

  return (
    <div className="animate-fade-in space-y-6">
      {/* HEADER MATCHING MOCKUP */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Users</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage your users, plans and account status.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="h-9 gap-1.5 rounded-lg border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <Download size={14} />
            Export
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEmailTarget(null);
              setEmailDialogOpen(true);
            }}
            className="h-9 gap-1.5 rounded-lg bg-[#2563EB] px-3.5 text-xs font-medium text-white shadow-xs hover:bg-[#1D4ED8]"
          >
            <Plus size={14} />
            Add user
          </Button>
        </div>
      </div>

      {/* FILTER BAR MATCHING MOCKUP */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or email..."
            className="h-9 w-full rounded-lg border border-slate-200/90 bg-white pl-9 text-xs shadow-xs placeholder:text-slate-400 focus:border-[#2563EB] dark:border-zinc-800 dark:bg-[#09090b] dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200/90 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-200"
          >
            <option value="all">All plans</option>
            <option value="pro">Pro</option>
            <option value="team">Team</option>
            <option value="basic">Basic</option>
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="h-9 rounded-lg border border-slate-200/90 bg-white px-3 text-xs font-medium text-slate-700 shadow-xs outline-none dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-200"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="online">Online</option>
          </select>
        </div>
      </div>

      {/* TABLE CARD MATCHING MOCKUP */}
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-[#09090b] overflow-hidden">
        <StateView
          state={state}
          isEmpty={() => items.length === 0}
          emptyMessage={
            term
              ? "No accounts match that search"
              : status === "online"
                ? "No users currently online on the app"
                : status === "suspended"
                  ? "No suspended accounts"
                  : "No accounts yet"
          }
          loadingLabel="Loading accounts"
        >
          {() => (
            <>
              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50/50 text-slate-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <tr>
                      <th className="w-12 px-4 py-3">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(checked) => toggleAll(Boolean(checked))}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Plan</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Last active</th>
                      <th className="w-12 px-4 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                    {items.map((user) => {
                      const online = isUserOnline(user.lastLoginAt);
                      const isSelected = selectedIds.has(user.id);
                      return (
                        <tr
                          key={user.id}
                          className={`transition hover:bg-slate-50/70 dark:hover:bg-zinc-900/60 ${
                            isSelected ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleOne(user.id)}
                              aria-label={`Select ${user.fullName}`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={user.fullName} src={user.profilePictureUrl} size={30} />
                              <Link
                                href={`/users/${user.id}`}
                                className="truncate font-semibold text-slate-900 transition hover:text-[#2563EB] dark:text-slate-100 dark:hover:text-blue-400"
                              >
                                {user.fullName}
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                            {user.email}
                          </td>
                          <td className="px-4 py-3">
                            <PlanBadge user={user} />
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge user={user} online={online} />
                          </td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                            <LastSeenCell lastLoginAt={user.lastLoginAt} offset={offset} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                                title={`Email ${user.fullName}`}
                                onClick={() => {
                                  setEmailTarget(user);
                                  setEmailDialogOpen(true);
                                }}
                              >
                                <Mail size={13} />
                              </Button>
                              <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="size-7 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                                title="Manage user"
                              >
                                <Link href={`/users/${user.id}`}>
                                  <MoreHorizontal size={15} />
                                </Link>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* FOOTER PAGINATION MATCHING MOCKUP */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 px-5 py-3.5 dark:border-zinc-800">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {startItem}-{endItem} of {totalCount} users
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  {pageNumbers.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition ${
                        page === p
                          ? "bg-[#2563EB] text-white"
                          : "text-slate-600 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </StateView>
      </div>

      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        targetUser={emailTarget}
        onSuccess={() => {
          void state.refetch();
        }}
      />
    </div>
  );
}
