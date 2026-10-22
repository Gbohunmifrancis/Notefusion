"use client";

import {
  Activity,
  BookOpenText,
  ChevronDown,
  CreditCard,
  ShoppingCart,
  Flag,
  HeartPulse,
  Inbox,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  MessageSquareHeart,
  MicVocal,
  MonitorPlay,
  Moon,
  Music2,
  Newspaper,
  Scale,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Sun,
  TicketPercent,
  TrendingUp,
  Users2,
  Webhook,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Avatar } from "@/components/Avatar";
import { ConsoleLock } from "@/components/ConsoleLock";
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
  { to: "/growth", label: "Growth", icon: TrendingUp },
  { to: "/practice", label: "Practice", icon: MicVocal },
  { to: "/listen", label: "Listen anywhere", icon: Radio },
  { to: "/blog", label: "Blog posts", icon: Newspaper },
  { to: "/blog-analytics", label: "Blog analytics", icon: BookOpenText },
  { to: "/users", label: "Users", icon: Users2 },
  { to: "/transcriptions", label: "Transcriptions", icon: Music2 },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/feedback", label: "Feedback", icon: MessageSquareHeart },
  { to: "/health", label: "System Health", icon: HeartPulse },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const SECONDARY_NAV = [
  { to: "/waitlist", label: "Waitlist", icon: Sparkles },
  { to: "/inbox", label: "Mail", icon: Inbox },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  { to: "/payments", label: "Payments", icon: CreditCard, badge: "New" },
  { to: "/checkouts", label: "Unpaid checkouts", icon: ShoppingCart, badge: "New" },
  { to: "/webhooks", label: "Webhooks", icon: Webhook },
  { to: "/ledger", label: "Ledger", icon: Scale },
  { to: "/flags", label: "Feature flags", icon: Flag, badge: "New" },
  { to: "/offers", label: "Offers", icon: TicketPercent, badge: "New" },
  { to: "/sessions", label: "Sessions", icon: MonitorPlay, badge: "New" },
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
 * The console's frame: a sidebar (the app icon, the wordmark, an "Admin" marker, the nav, and who
 * is signed in), a top bar, and the plain page every view sits on.
 *
 * Colours come from the theme tokens in src/app/globals.css, never from a hex here, so Day and
 * Night both follow.
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
        <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-3 py-0">
          <Link
            href="/"
            aria-label="NoteFusion Admin — Overview"
            className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            {/* The launcher icon itself (web-site/assets/icon-192.png), not a redrawing of it. A
                plain <img>: a 14 KB local PNG at a fixed size gains nothing from next/image. */}
            <img
              src="/brand/app-icon-192.png"
              alt=""
              width={28}
              height={28}
              className="size-7 shrink-0 rounded-[7px]"
            />
            <span className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
              <span className="font-wordmark text-[17px] leading-none text-foreground">NoteFusion</span>
              <span className="rounded-[5px] border border-border px-1.5 py-px text-[11px] font-medium leading-4 text-muted-foreground">
                Admin
              </span>
            </span>
          </Link>
        </SidebarHeader>

        <ConsoleNav />

        <SidebarFooter className="border-t border-sidebar-border p-2">
          <SignedInCard name={user?.fullName || firstName || "Admin"} email={user?.email ?? ""} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 w-full overflow-x-hidden">
        {/* TOP BAR */}
        <header className="sticky top-0 z-20 flex h-14 items-center border-b border-border bg-background px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl items-center">
            <SidebarTrigger className="mr-3 size-8 rounded-[8px] text-muted-foreground hover:bg-accent hover:text-foreground" />

            <form onSubmit={onSearch} className="relative w-full max-w-md">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                name="q"
                type="search"
                aria-label="Search users"
                placeholder="Search users, transactions, or anything..."
                className="h-8 w-full rounded-[8px] border border-border bg-card pl-9 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-faint focus:border-ring sm:text-sm"
              />
            </form>

            <div className="ml-auto flex items-center gap-2">
              <LiveNotices />

              <ThemeToggle />

              <NotificationBell />

              <div className="h-6 w-px bg-border" />

              <div className="flex items-center gap-2.5">
                {avatarUrl ? (
                  <Avatar name={user?.fullName || user?.email || "Admin"} src={avatarUrl} size={32} />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground ring-1 ring-inset ring-border">
                    {userInitials(user?.fullName || user?.email || "Admin")}
                  </div>
                )}

                <div className="hidden sm:flex items-center gap-1.5 cursor-pointer">
                  <span className="text-[13px] font-medium text-foreground">{firstName}</span>
                  <ChevronDown size={14} aria-hidden="true" className="text-faint" />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-[calc(100vh-3.5rem)] w-full min-w-0 bg-background px-4 py-6 text-foreground sm:px-6 sm:py-8 lg:px-8">
          <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6">{children}</div>
        </div>
      </SidebarInset>

      <ConsoleLock />
    </SidebarProvider>
  );
}

/**
 * One nav entry. The page you are on is a neutral raised row with its icon in brand blue; the
 * rest are quiet until pointed at.
 */
function NavItem({
  to,
  label,
  icon: Icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: (typeof PRIMARY_NAV)[number]["icon"];
  active: boolean;
  /** A small blue pill after the label ("New"); hidden when the sidebar is folded to icons. */
  badge?: string;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={label}
        className={cn(
          "h-8 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors",
          active
            ? "bg-sidebar-accent text-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
        )}
      >
        <Link href={to} onClick={() => setOpenMobile(false)} className="flex items-center gap-2.5">
          <Icon
            size={16}
            className={active ? "text-brand" : "text-faint"}
            aria-hidden="true"
          />
          <span>{label}</span>
          {badge && (
            <span className="ml-auto rounded-[5px] bg-brand/10 px-1.5 py-px text-[10.5px] font-medium text-brand-deep group-data-[collapsible=icon]:hidden">
              {badge}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ConsoleNav() {
  const pathname = usePathname();

  return (
    <SidebarContent className="gap-4 px-2 py-3">
      <SidebarGroup className="p-0">
        <SidebarMenu className="gap-0.5">
          {PRIMARY_NAV.map(({ to, label, icon }) => (
            <NavItem key={`${to}-${label}`} to={to} label={label} icon={icon} active={isActivePath(pathname, to)} />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup className="p-0">
        <SidebarGroupLabel className="h-7 px-2.5 text-xs font-medium text-faint">Operations</SidebarGroupLabel>
        <SidebarMenu className="gap-0.5">
          {SECONDARY_NAV.map((item) => (
            <NavItem
              key={`${item.to}-${item.label}`}
              to={item.to}
              label={item.label}
              icon={item.icon}
              active={isActivePath(pathname, item.to)}
              {...("badge" in item ? { badge: item.badge } : {})}
            />
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
    <div className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground ring-1 ring-inset ring-border group-data-[collapsible=icon]:hidden">
        {userInitials(name)}
      </div>
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-[13px] font-medium text-foreground" title={name}>{name}</p>
        {email && <p className="truncate text-xs text-muted-foreground" title={email}>{email}</p>}
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out"
        className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </div>
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
      {mounted ? dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" /> : null}
    </Button>
  );
}
