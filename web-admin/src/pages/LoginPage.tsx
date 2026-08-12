import { AlertTriangle, Check, Loader2, Music4 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";

interface FromState {
  from?: string;
}

/** The value props on the navy panel. Kept honest — every one is a real page in the app. */
const FEATURES = [
  "Live signup, activity, and retention analytics",
  "Full user directory with account health at a glance",
  "Transcription success rates and confidence trends",
  "Storage, geography, and platform breakdowns",
] as const;

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: sending them back to the form would be a dead end.
  if (isAdmin(user)) return <Navigate to="/" replace />;

  const from = (location.state as FromState | null)?.from ?? "/";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email.trim(), password, remember);
      navigate(from, { replace: true });
    } catch (cause) {
      // The server's message is shown as-is for a 401 so the reader knows whether the
      // credentials were wrong or the account is locked, which it distinguishes.
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "Sign in failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      {/* ── Left: sign-in form ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-center bg-bg px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-fusion text-white shadow-glow">
              <Music4 size={20} aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-ink">NoteFusion</p>
              <p className="text-xs text-muted">Admin console</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Welcome back, Admin
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Sign in to manage your music platform.
          </p>

          <form onSubmit={onSubmit} className="mt-8">
            <label className="block text-sm font-medium text-ink" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@notefusion.studio"
              className="mt-1.5 w-full rounded-sm border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-faint focus:border-blue"
            />

            <label
              className="mt-4 block text-sm font-medium text-ink"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="mt-1.5 w-full rounded-sm border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-faint focus:border-blue"
            />

            <label className="mt-4 flex cursor-pointer select-none items-center gap-2.5 text-sm text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="h-4 w-4 rounded-[4px] border-border text-blue accent-blue"
              />
              Keep me signed in on this device
            </label>

            {error && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-xs text-danger"
              >
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-pill bg-fusion-contrast px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending && (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              )}
              {pending ? "Signing in" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-xs text-faint">
            Internal analytics. Admin accounts only — access is enforced by the
            server on every request.
          </p>
        </div>
      </div>

      {/* ── Right: navy value panel ────────────────────────────────────────── */}
      {/* Hidden on small screens: the form is the whole job on a phone, and a
          decorative panel below it would just be scroll. */}
      <div className="relative hidden overflow-hidden bg-navy lg:block">
        {/* Soft brand glows, echoing the app's "Fusion" gradient on a dark ground. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-blue-bright/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-blue/20 blur-3xl"
        />

        <div className="relative flex h-full flex-col justify-center px-14 py-16 text-white">
          <span className="inline-flex w-fit items-center rounded-pill bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15">
            NoteFusion Admin
          </span>

          <h2 className="mt-6 max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Powerful tools to manage your music platform
          </h2>
          <p className="mt-3 max-w-md text-sm text-white/60">
            Everything happening across transcription, accounts, and growth — in
            one honest dashboard.
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-bright/25 ring-1 ring-blue-bright/40">
                  <Check size={13} className="text-white" aria-hidden="true" />
                </span>
                <span className="text-sm text-white/85">{feature}</span>
              </li>
            ))}
          </ul>

          {/* A small dashboard glyph — a stand-in for the mockup's illustration,
              drawn rather than shipped as a raster so it stays crisp and themed. */}
          <div className="mt-12 max-w-md rounded-lg bg-white/[0.06] p-5 ring-1 ring-white/10">
            <div className="flex items-center justify-between">
              <div className="h-2 w-24 rounded-pill bg-white/25" />
              <div className="h-2 w-10 rounded-pill bg-blue-bright/50" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-md bg-white/[0.06] p-3">
                  <div className="h-1.5 w-8 rounded-pill bg-white/20" />
                  <div className="mt-2 h-3 w-12 rounded-pill bg-white/40" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex h-16 items-end gap-1.5">
              {[40, 65, 45, 80, 55, 90, 70, 100, 60, 75].map((h, i) => (
                <div
                  key={i}
                  style={{ height: `${h}%` }}
                  className="flex-1 rounded-t-[3px] bg-gradient-to-t from-blue/40 to-blue-bright/80"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
