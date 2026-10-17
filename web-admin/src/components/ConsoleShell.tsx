"use client";

import {
  Activity,
  BookOpenText,
  ChevronDown,
  HeartPulse,
  Inbox,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  MessageSquareHeart,
  Moon,
  Music2,
  Newspaper,
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
import { LiveNotices } from "@/components/LiveNotices";
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
import { cn } from "@/lib/utils";

const PRIMARY_NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/insights", label: "Insights", icon: ChartNoAxesCombined },
  { to: "/blog", label: "Blog posts", icon: Newspaper },
  { to: "/blog-analytics", label: "Blog analytics", icon: BookOpenText },
  { to: "/users", label: "Users", icon: Users2 },
  { to: "/transcriptions", label: "Transcriptions", icon: Music2 },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/feedback", label: "Feedback", icon: MessageSquareHeart },
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

/**
 * The console's frame: a branded sidebar (the app icon, the wordmark, an amber "Admin" plaque, the
 * nav, and a card saying who is signed in), a top bar, and the canvas every page sits on.
 *
 * Colours come from the theme tokens in src/app/globals.css, never from a hex here, so Day and
 * Night both follow; the canvas's staff-line texture and brand light are `.nf-canvas`.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const { user, avatarUrl } = useAuth();
  const router = useRouter();

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = new FormData(event.currentTarget).get("q");
    const query = typeof term === "string" ? term.trim() : "";
    router.push(query ? `/users?q=${encodeURIComponent(query)}` : "/users");
  }

  const firstName = user?.fullName
    ? user.fullName.trim().split(/\s+/)[0]
    : user?.email
    ? user.email.split("@")[0]
    : "Admin";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="relative gap-0 overflow-hidden border-b border-sidebar-border p-0">
          {/* The app's colours in a row along the top edge: blue, sky, mint, amber. */}
          <div aria-hidden="true" className="h-[3px] w-full shrink-0" style={{ background: "var(--brand-strip)" }} />
          <Link
            href="/"
            aria-label="NoteFusion Admin — Overview"
            className="relative flex items-center gap-3 px-4 py-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-3"
          >
            {/* Stage light behind the logo. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -left-10 -top-14 size-44 rounded-full bg-[radial-gradient(circle,var(--canvas-light-1),transparent_68%)]"
            />
            {/* The launcher icon itself (web-site/assets/icon-192.png), not a redrawing of it. A
                plain <img>: a 14 KB local PNG at a fixed size gains nothing from next/image. */}
            <img
              src="/brand/app-icon-192.png"
              alt=""
              width={40}
              height={40}
              className="relative size-10 shrink-0 rounded-[12px] shadow-fusion group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:rounded-[10px]"
            />
            <span className="relative min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block font-wordmark text-[21px] leading-none tracking-[-0.01em] text-foreground">
                Note<span className="text-brand">Fusion</span>
              </span>
              <span className="mt-1.5 inline-flex items-center rounded-pill bg-linear-to-r from-[#fbd27a] to-[#f59e0b] px-2 py-[3px] text-[9.5px] font-extrabold uppercase leading-none tracking-[0.18em] text-premium-ink shadow-[0_4px_12px_-4px_rgba(245,158,11,0.6)]">
                Admin
              </span>
            </span>
          </Link>
        </SidebarHeader>

        <ConsoleNav />

        <SidebarFooter className="border-t border-sidebar-border p-3">
          <SignedInCard name={user?.fullName || firstName || "Admin"} email={user?.email ?? ""} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 w-full overflow-x-hidden">
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border/70 bg-background/85 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl items-center">
            <SidebarTrigger className="mr-3 size-9 rounded-[10px] text-muted-foreground hover:bg-accent hover:text-foreground" />

            <form onSubmit={onSearch} className="relative w-full max-w-md">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                name="q"
                type="search"
                aria-label="Search users"
                placeholder="Search users, transactions, or anything..."
                className="h-9.5 w-full rounded-[12px] border border-[color:var(--panel-line)] bg-card/70 pl-10 pr-4 text-xs text-foreground outline-none transition placeholder:text-faint focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand/20 sm:text-sm"
              />
            </form>

            <div className="ml-auto flex items-center gap-3">
              <LiveNotices />

              <ThemeToggle />

              <NotificationBell />

              <div className="h-6 w-px bg-border" />

              <div className="flex items-center gap-2.5">
                {avatarUrl ? (
                  <Avatar name={user?.fullName || user?.email || "Admin"} src={avatarUrl} size={32} />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-ice ring-1 ring-brand/30">
                    {userInitials(user?.fullName || user?.email || "Admin")}
                  </div>
                )}

                <div className="hidden sm:flex items-center gap-1.5 cursor-pointer">
                  <span className="text-xs font-semibold text-foreground">{firstName}</span>
                  <ChevronDown size={14} className="text-faint" />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="nf-canvas min-h-[calc(100vh-4rem)] w-full min-w-0 px-4 py-6 text-foreground sm:px-6 sm:py-7 lg:px-8">
          <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * One nav entry. The page you are on wears "The Fusion" — the brand gradient with its glow — the
 * way the app marks its selected tab; the rest are quiet until pointed at.
 */
function NavItem({
  to,
  label,
  icon: Icon,
  active,
  small = false,
}: {
  to: string;
  label: string;
  icon: (typeof PRIMARY_NAV)[number]["icon"];
  active: boolean;
  small?: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        className={cn(
          "rounded-[12px] px-3 transition",
          small ? "h-9 text-[13px] font-medium" : "h-10 text-sm font-medium",
          active
            ? "nf-fusion font-semibold hover:text-white active:text-white data-[active=true]:font-semibold data-[active=true]:text-white"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        <Link href={to} onClick={() => setOpenMobile(false)} className="flex items-center gap-3">
          <Icon
            size={small ? 16 : 18}
            className={active ? "text-white" : "text-faint"}
            aria-hidden="true"
          />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ConsoleNav() {
  const pathname = usePathname();

  return (
    <SidebarContent className="px-3 py-4 space-y-5">
      <SidebarGroup className="p-0">
        <SidebarMenu className="gap-1">
          {PRIMARY_NAV.map(({ to, label, icon }) => (
            <NavItem key={`${to}-${label}`} to={to} label={label} icon={icon} active={isActivePath(pathname, to)} />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="p-0 pt-2 border-t border-sidebar-border">
        <SidebarGroupLabel className="nf-eyebrow mb-1 px-3 text-[10px] text-faint">Operations</SidebarGroupLabel>
        <SidebarMenu className="gap-1">
          {SECONDARY_NAV.map(({ to, label, icon }) => (
            <NavItem key={`${to}-${label}`} to={to} label={label} icon={icon} active={isActivePath(pathname, to)} small />
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  );
}

/** Who is at the desk, and the way out. Collapsed to an icon, only the way out stays. */
function SignedInCard({ name, email }: { name: string; email: string }) {
  const { signOut } = useAuth();

  return (
    <>
      <div className="nf-panel p-3 group-data-[collapsible=icon]:hidden">
        <p className="nf-eyebrow text-[10px] text-muted-foreground">Signed in as</p>
        <p className="mt-1 truncate text-sm font-bold text-ice" title={name}>{name}</p>
        {email && <p className="truncate text-[11px] text-muted-foreground" title={email}>{email}</p>}
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] border border-[color:var(--panel-line)] bg-muted/70 px-3 py-2 text-xs font-semibold text-foreground transition hover:border-[color:var(--panel-line-hover)] hover:bg-accent motion-safe:active:scale-[0.97]"
        >
          <LogOut size={14} aria-hidden="true" />
          Sign out
        </button>
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out"
        className="hidden size-8 items-center justify-center rounded-[10px] text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:flex"
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </>
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
      className="size-8 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-100"
      {...(mounted ? { title: label, "aria-label": label } : { "aria-label": "Switch theme" })}
    >
      {mounted ? dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" /> : null}
    </Button>
  );
}
