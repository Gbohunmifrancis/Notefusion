import { AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { StaffRibbon } from "@/components/StaffRibbon";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";

interface FromState {
  from?: string;
}

/**
 * LoginPage — full-bleed immersive branded sign-in.
 *
 * Deep brand-blue canvas with a frosted white card centred on screen, matching
 * the mobile app's login aesthetic adapted for the web dashboard. The staff ribbon
 * sits pinned behind the card at the foot of the viewport.
 *
 * Field and control metrics track `mobile/src/components/{TextField,Button}.tsx` —
 * 56 px fields at radius 14, a 54 px pill button — so the two sign-ins are the same
 * shape regardless of platform.
 */
export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: sending them back to the form would be a dead end.
  if (isAdmin(user)) return <Navigate to="/" replace />;

  const from = (location.state as FromState | null)?.from ?? "/";
  const canSubmit = email.trim().length > 3 && password.length > 0;

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
        cause instanceof ApiError || cause instanceof Error ? cause.message : "Sign in failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    /*
     * Outer shell — deep brand blue gradient fills the whole viewport. The staff
     * ribbon is absolutely positioned behind the card at the bottom edge.
     */
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #1e40af 0%, #1d4ed8 40%, #2563eb 100%)" }}
    >
      {/* Subtle ambient glow blobs — echo the mobile canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full"
        style={{ background: "rgba(255,255,255,0.06)", filter: "blur(80px)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 bottom-0 h-80 w-80 rounded-full"
        style={{ background: "rgba(255,255,255,0.04)", filter: "blur(72px)" }}
      />

      {/* ── White frosted card ─────────────────────────────────────────────── */}
      <div
        className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 shadow-2xl p-10 animate-fade-in"
        style={{ backdropFilter: "blur(16px)" }}
      >
        {/* ── Brand ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center">
          <BrandMark size={88} color="#2563eb" waveColor="#3b82f6" showWaves />
          <h1
            className="mt-3 text-[36px] font-bold leading-none text-ink"
            style={{ fontFamily: "Poppins, sans-serif", letterSpacing: "-1px" }}
          >
            Notefusion
          </h1>
          <p className="mt-1.5 text-sm font-medium text-muted tracking-wide uppercase">
            Admin Console
          </p>
        </div>

        {/* ── Divider ─────────────────────────────────────────────────────── */}
        <div className="my-8 h-px bg-border" />

        {/* ── Heading ─────────────────────────────────────────────────────── */}
        <h2
          className="text-[22px] font-bold text-ink"
          style={{ fontFamily: "Poppins, sans-serif", letterSpacing: "-0.5px" }}
        >
          Welcome back!
        </h2>
        <p className="mt-1 text-sm text-muted">Sign in to continue to the admin console.</p>

        {/* ── Form ────────────────────────────────────────────────────────── */}
        <form onSubmit={onSubmit} className="mt-6">
          <label className="block text-sm font-semibold text-ink" htmlFor="email">
            Email
          </label>
          <div className="mt-1.5 flex h-14 items-center gap-3 rounded-md border border-border bg-surface px-4 transition focus-within:border-blue focus-within:shadow-glow">
            <Mail size={20} className="shrink-0 text-blue" aria-hidden="true" />
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
            />
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="password">
            Password
          </label>
          <div className="mt-1.5 flex h-14 items-center gap-3 rounded-md border border-border bg-surface px-4 transition focus-within:border-blue focus-within:shadow-glow">
            <Lock size={20} className="shrink-0 text-muted" aria-hidden="true" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              // Typing a long password blind is the top cause of a false "wrong
              // password", so the app offers this and so does the dashboard.
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="shrink-0 rounded-sm p-1 text-muted transition hover:text-ink"
            >
              {showPassword ? (
                <EyeOff size={19} aria-hidden="true" />
              ) : (
                <Eye size={19} aria-hidden="true" />
              )}
            </button>
          </div>

          <label className="mt-5 flex cursor-pointer select-none items-center gap-2.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded-[4px] border-border accent-blue"
            />
            Keep me signed in on this device
          </label>

          {error && (
            <p
              role="alert"
              className="mt-5 flex items-start gap-2 rounded-sm bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
            >
              <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !canSubmit}
            className="mt-7 flex h-[54px] w-full items-center justify-center gap-2.5 rounded-pill bg-fusion-contrast text-base font-semibold text-white shadow-glow transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {pending ? (
              <Loader2 size={19} className="animate-spin" aria-hidden="true" />
            ) : null}
            {pending ? "Signing in" : "Login"}
            {!pending && <ArrowRight size={19} aria-hidden="true" />}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-faint">
          Internal analytics. Admin accounts only — access is enforced by the server on every
          request.
        </p>
      </div>

      {/* ── Decorative staff ribbon — behind the card, pinned to the bottom ─ */}
      {/* Colour via currentColor (text-*) since StaffRibbon has no style prop. */}
      <StaffRibbon
        className="pointer-events-none absolute bottom-0 left-0 h-[120px] w-full text-white"
        opacity={0.15}
      />
    </div>
  );
}
