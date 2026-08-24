"use client";

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
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { StaffRibbon } from "@/components/StaffRibbon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";

/**
 * The console's sign-in, laid out for a desktop browser.
 *
 * Two panels from `lg` up: a navy panel carrying the brand and saying plainly what this
 * tool is, and a white panel holding the form in a single narrow column. Below `lg` the
 * navy panel drops away and the form panel fills the viewport.
 *
 * The fields are 44 px rather than the console's 36 px — the one place this page overrides a
 * shadcn metric. A full-page form on an empty panel is not a row in a toolbar, and these are the
 * only two controls on screen.
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

export function LoginView() {
  const { user, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /*
   * Where the guard sent them from, if anywhere. It arrives in the query string because a client
   * navigation carries no state of its own under Next, which means it is reader-supplied and gets
   * checked: a path only, so `?next=https://elsewhere` cannot turn sign-in into an open redirect.
   */
  const requested = params.get("next");
  const from =
    requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  // Already signed in: leaving them on the form would be a dead end. This also carries a
  // successful sign-in through, since it is the same condition a moment later.
  const signedIn = isAdmin(user);
  useEffect(() => {
    if (signedIn) router.replace(from);
  }, [signedIn, from, router]);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email.trim(), password, remember);
      // Deliberately no `setPending(false)`: the effect above is navigating away, and releasing
      // the button first would flash an enabled "Sign in" over a page that is already leaving.
    } catch (cause) {
      // The server's message is shown as-is for a 401 so the reader knows whether the
      // credentials were wrong or the account is locked, which it distinguishes.
      setError(
        cause instanceof ApiError || cause instanceof Error ? cause.message : "Sign in failed.",
      );
      setPending(false);
    }
  }

  if (signedIn) return null;

  return (
    <div className="min-h-screen bg-card lg:grid lg:grid-cols-2">
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
            <BrandMark size={24} className="text-brand" />
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
              NoteFusion
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
              Admin
            </span>
          </div>

          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            Sign in
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Use your NoteFusion admin account to open the console.
          </p>

          <form onSubmit={onSubmit} className="mt-8">
            <div className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-xs text-muted-foreground">
                  Email
                </Label>
                <div className="relative mt-1.5">
                  <Mail
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@notefusion.app"
                    className="h-11 pl-10 text-[13.5px] placeholder:text-faint"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="text-xs text-muted-foreground">
                  Password
                </Label>
                <div className="relative mt-1.5">
                  <Lock
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="h-11 pl-10 pr-11 text-[13.5px] placeholder:text-faint"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowPassword((shown) => !shown)}
                    // Typing a long password blind is the top cause of a false "wrong
                    // password", so the app offers this and so does the dashboard.
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint"
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked === true)}
                />
                <Label htmlFor="remember" className="text-[13px] font-normal text-muted-foreground">
                  Keep me signed in on this device
                </Label>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-sm bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger-deep"
              >
                <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={pending || !canSubmit}
              className="mt-6 h-11 w-full text-[13.5px] font-semibold"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {pending ? "Signing in" : "Sign in"}
              {!pending && <ArrowRight aria-hidden="true" />}
            </Button>
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
