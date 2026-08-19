import { LayoutDashboard, LogOut, Menu, PanelLeft, Search, Users2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";

/**
 * The application shell: a permanent left rail from `lg` up, an off-canvas drawer below it.
 *
 * Every control in here does something. The rail's search submits to the accounts page
 * rather than filtering the nav, because searching an admin tool means searching its
 * records, and two nav items do not need a filter.
 */

const NAV_GROUPS = [
  {
    label: "Analytics",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/users", label: "Users", icon: Users2 },
    ],
  },
] as const;

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // The drawer is always full width: collapsing to icons is a desktop affordance for
  // reclaiming canvas, and on a phone the drawer is dismissed rather than shrunk.
  function rail(drawer: boolean) {
    const narrow = collapsed && !drawer;

    function onSearch(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const term = new FormData(event.currentTarget).get("q");
      const query = typeof term === "string" ? term.trim() : "";
      navigate(query ? `/users?q=${encodeURIComponent(query)}` : "/users");
      setMenuOpen(false);
    }

    return (
      <div className="flex h-full flex-col">
        <div
          className={`flex h-16 shrink-0 items-center gap-2.5 px-4 ${
            narrow ? "justify-center" : ""
          }`}
        >
          <BrandMark size={24} color="#2563eb" />
          {!narrow && (
            <span className="flex-1 truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">
              NoteFusion
            </span>
          )}

          {!narrow && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              className="hidden h-8 w-8 place-items-center rounded-sm text-muted transition hover:bg-surface-alt hover:text-ink lg:grid"
            >
              <PanelLeft size={17} aria-hidden="true" />
            </button>
          )}

          {drawer && (
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="grid h-8 w-8 place-items-center rounded-sm text-muted transition hover:bg-surface-alt hover:text-ink lg:hidden"
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>

        {narrow ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar to search"
            className="mx-auto grid h-9 w-9 place-items-center rounded-sm border border-border text-faint transition hover:text-ink"
          >
            <Search size={15} aria-hidden="true" />
          </button>
        ) : (
          <form onSubmit={onSearch} className="px-4">
            <label className="relative block">
              <span className="sr-only">Search accounts by name or email</span>
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                name="q"
                type="search"
                placeholder="Search"
                className="w-full rounded-sm border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-blue"
              />
            </label>
          </form>
        )}

        <nav className="mt-6 flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {!narrow && (
                <p className="px-4 pb-2 text-[11px] font-medium text-faint">{group.label}</p>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === "/"}
                      onClick={() => setMenuOpen(false)}
                      {...(narrow ? { title: label } : {})}
                      className={({ isActive }) =>
                        `relative flex items-center gap-3 py-2.5 text-[13.5px] font-medium transition ${
                          narrow ? "justify-center px-0" : "px-4"
                        } ${
                          isActive
                            ? "text-blue"
                            : "text-muted hover:bg-surface-alt hover:text-ink"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* Flush to the rail's edge, as a selected-row marker rather than
                              a pill, so the label carries the state and not a filled block. */}
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-1 left-0 w-[3px] rounded-r-pill bg-blue"
                            />
                          )}
                          <Icon size={17} aria-hidden="true" className="shrink-0" />
                          {!narrow && <span className="truncate">{label}</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-border px-4 py-4">
          <div className={`flex items-center gap-2.5 ${narrow ? "flex-col" : ""}`}>
            <Avatar name={user?.fullName ?? ""} size={32} />
            {!narrow && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink" title={user?.fullName}>
                  {user?.fullName}
                </p>
                <p className="truncate text-[11px] text-muted" title={user?.email}>
                  {user?.email}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              title="Sign out"
              aria-label="Sign out"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-muted transition hover:bg-danger/10 hover:text-danger"
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-border bg-surface transition-[width] duration-200 lg:block ${
          collapsed ? "lg:w-[76px]" : "lg:w-[248px]"
        }`}
      >
        {rail(false)}
      </aside>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-40 w-[248px] border-r border-border bg-surface lg:hidden">
            {rail(true)}
          </aside>
        </>
      )}

      <div
        className={`transition-[padding] duration-200 ${
          collapsed ? "lg:pl-[76px]" : "lg:pl-[248px]"
        }`}
      >
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-sm border border-border text-ink"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <BrandMark size={20} color="#2563eb" />
          <span className="text-sm font-semibold text-ink">NoteFusion Admin</span>
        </header>

        <main className="px-5 py-6 lg:px-8">
          <div className="mx-auto max-w-[1440px] space-y-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
