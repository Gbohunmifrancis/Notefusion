"use client";

import {
  Bell,
  ChevronDown,
  CreditCard,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Moon,
  Scale,
  ScrollText,
  Search,
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

const NAV_GROUPS = [
  {
    label: "Analytics",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/users", label: "Users", icon: Users2 },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/audit-log", label: "Audit log", icon: ScrollText },
      { to: "/health", label: "System health", icon: HeartPulse },
    ],
  },
  {
    label: "Payments",
    items: [
      { to: "/payments", label: "Transactions", icon: CreditCard },
      { to: "/webhooks", label: "Webhook inbox", icon: Webhook },
      { to: "/ledger", label: "Ledger", icon: Scale },
    ],
  },
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

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r border-slate-200 bg-white text-slate-900 transition-colors duration-200 dark:border-white/10 dark:bg-[#07142f] dark:text-white"
      >
        <SidebarHeader className="h-20 justify-center border-b border-slate-200 px-6 transition-colors duration-200 group-data-[collapsible=icon]:px-2 dark:border-white/10">
          <Link href="/" className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-900/30">
              <BrandMark size={24} className="text-white" />
            </div>
            <span className="truncate text-lg font-bold tracking-tight text-slate-900 transition-colors group-data-[collapsible=icon]:hidden dark:text-white">
              NoteFusion
            </span>
          </Link>
        </SidebarHeader>

        <ConsoleNav />

        <SidebarFooter className="border-t border-slate-200 p-4 transition-colors duration-200 dark:border-white/10">
          <SignOutItem />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200 bg-white/90 px-5 backdrop-blur-xl lg:px-9 dark:border-slate-800 dark:bg-[#07142f]/90">
          <SidebarTrigger className="mr-4 size-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white" />

          <form onSubmit={onSearch} className="relative w-full max-w-lg">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              name="q"
              type="search"
              placeholder="Search accounts, users, keys..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white dark:focus:bg-slate-900"
            />
          </form>

          <div className="ml-auto flex items-center gap-5">
            <ThemeToggle />

            <button
              type="button"
              className="relative text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              aria-label="Notifications"
            >
              <Bell size={19} />
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                3
              </span>
            </button>

            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />

            <div className="hidden items-center gap-3 sm:flex">
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {user?.fullName || "NoteFusion Admin"}
                </div>
                <div className="text-xs text-slate-400">
                  {user?.role || "Administrator"}
                </div>
              </div>

              {avatarUrl ? (
                <Avatar name={user?.fullName ?? "Admin"} src={avatarUrl} size={40} />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-sm font-bold text-purple-700 shadow-sm dark:bg-purple-950 dark:text-purple-300">
                  {userInitials(user?.fullName || "NA")}
                </div>
              )}

              <ChevronDown size={16} className="text-slate-400" />
            </div>
          </div>
        </header>

        <div className="min-h-[calc(100vh-5rem)] bg-slate-50 px-5 py-8 text-slate-900 lg:px-9 dark:bg-[#0b1220] dark:text-slate-100">
          <div className="mx-auto max-w-[1440px] space-y-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ConsoleNav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarContent className="px-4 py-6">
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label} className="p-0 mb-5 last:mb-0">
          <SidebarGroupLabel className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {group.label}
          </SidebarGroupLabel>
          <SidebarMenu className="gap-1.5">
            {group.items.map(({ to, label, icon: Icon }) => {
              const active = isActivePath(pathname, to);
              return (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={label}
                    className={`h-11 rounded-xl px-4 text-sm font-medium transition ${
                      active
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/25 hover:bg-blue-600 hover:text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                    }`}
                  >
                    <Link href={to} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

function SignOutItem() {
  const { signOut } = useAuth();

  return (
    <button
      onClick={() => void signOut()}
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
    >
      <LogOut size={18} aria-hidden="true" />
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
      className="size-9 shrink-0 text-slate-500 hover:text-slate-900 disabled:opacity-100 dark:text-slate-400 dark:hover:text-white"
      {...(mounted ? { title: label, "aria-label": label } : { "aria-label": "Switch theme" })}
    >
      {mounted ? dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" /> : null}
    </Button>
  );
}
