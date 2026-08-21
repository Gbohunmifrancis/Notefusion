import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Music4,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { StaffRibbon } from "@/components/StaffRibbon";
import { useAuth } from "@/lib/auth";
import { FIELD, INPUT, LABEL, SUBMIT } from "@/lib/formClasses";
import { isAdmin } from "@/lib/session";

interface FromState {
  from?: string;
}

/**
 * LoginPage — the console's sign-in, laid out for a desktop browser.
 *
 * Two panels from `lg` up: a navy panel carrying the brand and saying plainly what this
 * tool is, and a white panel holding the form in a single narrow column. Below `lg` the
 * navy panel drops away and the form panel fills the viewport.
 *
 * The controls are the dashboard's, not the app's — 44 px fields at radius 8, hairline
 * borders, 13.5 px type, a rectangular submit — so signing in reads as the first screen
 * of the console rather than as a phone screen stretched to fit a monitor.
 */

/** What the console actually shows, in its own words. Each line is a real page. */
const POINTS = [
  {
    icon: BarChart3,
    text: "Users, transcriptions and outcomes for any window you pick.",
  },
  {
    icon: Music4,
    text: "Most-transcribed keys, average confidence, and stored MusicXML.",
  },
  {
    icon: ShieldCheck,
    text: "Admin accounts only. The server authorises every request.",
  },
] as const;

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
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-2">
      {/* ── Brand panel — desktop only, since a phone has no room to spare ──── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 lg:flex">
        {/* Ambient blue light, so the navy reads as a lit surface rather than a flat fill. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full"
          style={{ background: "rgba(37, 99, 235, 0.38)", filter: "blur(90px)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 right-0 h-72 w-72 rounded-full"
          style={{ background: "rgba(14, 165, 233, 0.20)", filter: "blur(90px)" }}
        />
        {/* Colour via currentColor (text-*) since StaffRibbon has no style prop. */}
        <StaffRibbon
          className="pointer-events-none absolute bottom-0 left-0 h-[132px] w-full text-white"
          opacity={0.1}
        />

        <div className="relative flex items-center gap-2.5">
          <BrandMark size={26} className="text-white" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">
            NoteFusion
          </span>
          <span className="rounded-pill border border-white/20 px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.08em] text-white/70">
            Admin
          </span>
        </div>

        <div className="relative max-w-[27rem]">
          <h2 className="text-[30px] font-semibold leading-[1.18] tracking-[-0.02em] text-white">
            The numbers the platform actually measured.
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-white/10 text-white">
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span className="text-[13.5px] leading-relaxed text-white/75">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-white/45">
          Internal tool · nothing here is customer-facing
        </p>
      </aside>

      {/* ── Form panel ───────────────────────────────────────────────────────── */}
      <main className="flex items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[368px] animate-fade-in">
          {/* The lockup the navy panel would have carried, for the narrow layout. */}
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={24} className="text-accent" />
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
              NoteFusion
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              Admin
            </span>
          </div>

          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Sign in
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">
            Use your NoteFusion admin account to open the console.
          </p>

          <form onSubmit={onSubmit} className="mt-8">
            <div className="space-y-4">
              <div>
                <label className={LABEL} htmlFor="email">
                  Email
                </label>
                <div className={FIELD}>
                  <Mail size={15} className="shrink-0 text-faint" aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@notefusion.app"
                    className={INPUT}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL} htmlFor="password">
                  Password
                </label>
                <div className={FIELD}>
                  <Lock size={15} className="shrink-0 text-faint" aria-hidden="true" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className={INPUT}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    // Typing a long password blind is the top cause of a false "wrong
                    // password", so the app offers this and so does the dashboard.
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="shrink-0 rounded-sm p-1 text-faint transition hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <Eye size={16} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer select-none items-center gap-2.5 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-border accent-blue"
                />
                Keep me signed in on this device
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-sm bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger"
              >
                <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || !canSubmit}
              className={SUBMIT}
            >
              {pending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {pending ? "Signing in" : "Sign in"}
              {!pending && <ArrowRight size={16} aria-hidden="true" />}
            </button>
          </form>

          <p className="mt-8 text-[11px] leading-relaxed text-faint">
            Internal analytics. Admin accounts only — access is enforced by the server on every
            request.
          </p>
        </div>
      </main>
    </div>
  );
}
