"use client";

import {
  ChevronDown,
  CreditCard,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Scale,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users2,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/BrandMark";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

const PRIMARY_NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users2 },
  { to: "/payments", label: "Transactions", icon: CreditCard },
  { to: "/health", label: "System Health", icon: HeartPulse },
  { to: "/audit-log", label: "Settings", icon: Settings },
] as const;

const SECONDARY_NAV = [
  { to: "/waitlist", label: "Waitlist", icon: Sparkles },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/ledger", label: "Ledger", icon: Scale },
] as const;

function isActivePath(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { user, avatarUrl } = useAuth();
  const router = useRouter();

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = new FormData(event.currentTarget).get("q");
    const query = typeof term === "string" ? term.trim() : "";
    router.push(query ? `/users?q=${encodeURIComponent(query)}` : "/users");
  }

  const firstName = user?.fullName ? user.fullName.trim().split(/\s+/)[0] : "Francis";

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r border-slate-200/80 bg-white text-slate-900 transition-colors duration-200 dark:border-[#243146] dark:bg-[#07142f] dark:text-white"
      >
        <SidebarHeader className="h-16 justify-center border-b border-slate-200/80 px-5 transition-colors duration-200 group-data-[collapsible=icon]:px-2 dark:border-[#243146]">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2563EB] text-white shadow-sm">
              <BrandMark size={18} className="text-white" />
            </div>
            <span className="truncate text-base font-bold tracking-tight text-slate-900 transition-colors group-data-[collapsible=icon]:hidden dark:text-white">
              NoteFusion
            </span>
          </Link>
        </SidebarHeader>

        <ConsoleNav />

        <SidebarFooter className="border-t border-slate-200/80 p-3 space-y-2 transition-colors duration-200 dark:border-[#243146]">
          <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#2563EB] text-white text-[10px] font-bold">
              <BrandMark size={14} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">NoteFusion</p>
              <p className="truncate text-[10px] text-slate-400">Secure notes for your team.</p>
            </div>
          </div>
          <SignOutItem />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 w-full overflow-x-hidden">
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur-md sm:px-6 lg:px-8 dark:border-[#243146] dark:bg-[#07142f]/90">
          <div className="mx-auto flex w-full max-w-7xl items-center">
            <SidebarTrigger className="mr-3 size-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white" />

            <form onSubmit={onSearch} className="relative w-full max-w-md">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                name="q"
                type="search"
                placeholder="Search users, transactions, or anything..."
                className="h-9.5 w-full rounded-lg border border-slate-200/90 bg-slate-50/70 pl-10 pr-4 text-xs sm:text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-[#243146] dark:bg-slate-900/70 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-blue-900/30"
              />
            </form>

            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />

              <NotificationBell />

              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />

              <div className="flex items-center gap-2.5">
                {avatarUrl ? (
                  <Avatar name={user?.fullName ?? "Admin"} src={avatarUrl} size={32} />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-[#2563EB] shadow-xs dark:bg-blue-950 dark:text-blue-300">
                    {userInitials(user?.fullName || "Francis")}
                  </div>
                )}

                <div className="hidden sm:flex items-center gap-1.5 cursor-pointer">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {firstName}
                  </span>
                  <ChevronDown size={14} className="text-slate-400" />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-[calc(100vh-4rem)] w-full min-w-0 bg-[#FAFAFA] px-4 py-6 text-slate-900 sm:px-6 sm:py-7 lg:px-8 dark:bg-[#0B1220] dark:text-slate-100">
          <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ConsoleNav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarContent className="px-3 py-4 space-y-5">
      <SidebarGroup className="p-0">
        <SidebarMenu className="gap-1">
          {PRIMARY_NAV.map(({ to, label, icon: Icon }) => {
            const active = isActivePath(pathname, to);
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className={`h-9.5 rounded-lg px-3 text-sm font-medium transition ${
                    active
                      ? "bg-[#EFF6FF] text-[#2563EB] font-semibold dark:bg-blue-950/50 dark:text-blue-400 hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                      : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100"
                  }`}
                >
                  <Link href={to} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                    <Icon
                      size={18}
                      className={active ? "text-[#2563EB] dark:text-blue-400" : "text-slate-500 dark:text-slate-400"}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="p-0 pt-2 border-t border-slate-100 dark:border-slate-800/60">
        <SidebarGroupLabel className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Operations
        </SidebarGroupLabel>
        <SidebarMenu className="gap-1">
          {SECONDARY_NAV.map(({ to, label, icon: Icon }) => {
            const active = isActivePath(pathname, to);
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className={`h-9 rounded-lg px-3 text-xs font-medium transition ${
                    active
                      ? "bg-[#EFF6FF] text-[#2563EB] font-semibold dark:bg-blue-950/50 dark:text-blue-400 hover:bg-[#EFF6FF] hover:text-[#2563EB]"
                      : "text-slate-500 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100"
                  }`}
                >
                  <Link href={to} onClick={() => setOpenMobile(false)} className="flex items-center gap-2.5">
                    <Icon
                      size={16}
                      className={active ? "text-[#2563EB] dark:text-blue-400" : "text-slate-400"}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  );
}

function SignOutItem() {
  const { signOut } = useAuth();

  return (
    <button
      onClick={() => void signOut()}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-slate-100"
    >
      <LogOut size={16} aria-hidden="true" />
      <span>Sign out</span>
    </button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      disabled={!mounted}
      className="size-8 shrink-0 text-slate-500 hover:text-slate-900 disabled:opacity-100 dark:text-slate-400 dark:hover:text-white"
      {...(mounted ? { title: label, "aria-label": label } : { "aria-label": "Switch theme" })}
    >
      {mounted ? dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" /> : null}
    </Button>
  );
}
