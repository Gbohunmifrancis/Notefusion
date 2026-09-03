"use client";

import {
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
import { Input } from "@/components/ui/input";
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

/**
 * The application shell: a left rail that collapses to icons from `md` up, an off-canvas sheet
 * below it, and a sticky top bar at every width.
 *
 * The bar holds the things that are about the operator rather than about the page — search, the
 * theme switch, and who is signed in. They used to be in the rail, where the account block was
 * three levels below the fold on a short window and search vanished entirely when the rail was
 * collapsed. It deliberately carries no greeting: the overview page's own title is one already.
 *
 * Search submits to the accounts page rather than filtering the nav, because searching an admin
 * tool means searching its records, and a nav this short does not need a filter.
 *
 * Built on shadcn's sidebar block, which supplies the sheet, the icon rail, the cmd/ctrl-B
 * shortcut and the collapsed-state tooltips. Two hand-rolled controls went with it: the hamburger
 * and the expand button are now one `SidebarTrigger` — it toggles the sheet below `md` and the
 * rail above it — which also retires the awkward branch where a collapsed rail could only be
 * reopened from a button in the top bar, because its own control had collapsed with it.
 */

const NAV_GROUPS = [
  {
    label: "Analytics",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/users", label: "Users", icon: Users2 },
    ],
  },
  {
    // The money. Its own group rather than more Operations rows, because these three are read
    // together during a billing incident — a stuck payment, the callback that should have settled
    // it, the entry it did or did not write — and none of them is about an account's access.
    //
    // Three sibling routes rather than `/payments/webhooks` and `/payments/ledger`: nesting them
    // would light both the parent and the child at once, since `isActivePath` keeps a parent lit
    // for its children. `/payments/<id>` is a child on purpose, and it is the only one.
    label: "Payments",
    items: [
      { to: "/payments", label: "Transactions", icon: CreditCard },
      { to: "/webhooks", label: "Webhook inbox", icon: Webhook },
      { to: "/ledger", label: "Ledger", icon: Scale },
    ],
  },
  {
    // Doing and checking, as opposed to reading. Both pages are about the console's own actions
    // and the state of the tiers behind them, which is a different job from the numbers above.
    label: "Operations",
    items: [
      { to: "/audit-log", label: "Audit log", icon: ScrollText },
      { to: "/health", label: "System health", icon: HeartPulse },
    ],
  },
] as const;

/** `/users/8f2…` keeps Users lit; only the overview matches exactly, or it would light on every page. */
function isActivePath(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
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
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-16 justify-center px-4 group-data-[collapsible=icon]:px-2">
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <BrandMark size={24} className="shrink-0 text-brand" />
            <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground group-data-[collapsible=icon]:hidden">
              NoteFusion
            </span>
          </Link>
        </SidebarHeader>

        <ConsoleNav />

        <SidebarFooter className="border-t border-border">
          <SignOutItem />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card px-4 lg:px-8">
          <SidebarTrigger className="size-9 shrink-0 text-muted-foreground" />

          <form onSubmit={onSearch} className="min-w-0 flex-1">
            <label className="relative block max-w-sm">
              <span className="sr-only">Search accounts by name or email</span>
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <Input
                name="q"
                type="search"
                placeholder="Search accounts"
                className="rounded-pill bg-muted pl-9 text-[13px] placeholder:text-faint"
              />
            </label>
          </form>

          <ThemeToggle />

          {/* Display only. The two controls a menu here would hold — the theme switch and sign
              out — are each already one click away, in the bar and in the rail. */}
          <div className="flex shrink-0 items-center gap-2.5 border-l border-border pl-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                {user?.fullName}
              </p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                {user?.role}
              </p>
            </div>
            <Avatar name={user?.fullName ?? ""} src={avatarUrl} size={34} />
          </div>
        </header>

        <div className="px-5 py-6 lg:px-8">
          <div className="mx-auto max-w-[1440px] space-y-5">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Separate from the shell only because it needs `useSidebar`, which is not available until
 * `SidebarProvider` is above it. It uses it to dismiss the sheet after a tap: on a phone the
 * navigation is what the sheet was opened for, so it has no reason to stay.
 */
function ConsoleNav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarContent>
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
            {group.label}
          </SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                {/* A filled pill rather than an edge marker: the row is what the pointer aims at,
                    so the row is what should look selected. Brand rather than the block's own
                    `sidebar-accent`, which is also its hover tint — an active row and a hovered
                    one would otherwise be the same colour. */}
                <SidebarMenuButton
                  asChild
                  isActive={isActivePath(pathname, to)}
                  tooltip={label}
                  className="h-9 text-[13.5px] font-medium data-[active=true]:bg-brand/10 data-[active=true]:text-brand-deep"
                >
                  <Link href={to} onClick={() => setOpenMobile(false)}>
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  );
}

function SignOutItem() {
  const { signOut } = useAuth();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => void signOut()}
          tooltip="Sign out"
          className="h-9 text-[13px] font-medium text-muted-foreground hover:bg-danger/10 hover:text-danger-deep"
        >
          <LogOut aria-hidden="true" />
          <span>Sign out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The icon names the destination, not the current state — a moon meaning "you are in light mode"
 * and a moon meaning "go dark" look identical, so the label says which it is.
 *
 * Nothing renders until after mount. next-themes only knows the stored preference on the client,
 * so a server-rendered sun against a client-rendered moon is a hydration mismatch; the button
 * keeps its size either way, so the bar does not shift when the icon arrives.
 */
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
      className="size-9 shrink-0 text-muted-foreground disabled:opacity-100"
      {...(mounted ? { title: label, "aria-label": label } : { "aria-label": "Switch theme" })}
    >
      {mounted ? dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" /> : null}
    </Button>
  );
}
