import { BarChart3, LogOut, Menu, Music4, Users2, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/", label: "Overview", icon: BarChart3 },
  { to: "/users", label: "Users", icon: Users2 },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive
      ? "bg-fusion-contrast text-white shadow-glow"
      : "text-muted hover:bg-surface-alt hover:text-ink"
  }`;

export function Layout() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2.5 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-fusion text-white">
          <Music4 size={18} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight text-ink">NoteFusion</p>
          <p className="text-xs leading-tight text-muted">Admin</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={linkClass}
            onClick={() => setMenuOpen(false)}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-border pt-4">
        <p className="truncate px-1 text-sm font-medium text-ink" title={user?.fullName}>
          {user?.fullName}
        </p>
        <p className="truncate px-1 text-xs text-muted" title={user?.email}>
          {user?.email}
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-alt hover:text-danger"
        >
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Off-canvas on small screens, permanent from lg up. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block">
        {sidebar}
      </aside>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-40 w-60 border-r border-border bg-surface lg:hidden">
            {sidebar}
          </aside>
        </>
      )}

      <div className="lg:pl-60">
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="grid h-9 w-9 place-items-center rounded-md border border-border text-ink"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="text-sm font-semibold text-ink">NoteFusion Admin</span>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
