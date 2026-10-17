"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Music4,
  ShieldCheck,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";
import {
  conditionalMediationAvailable,
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeysSupported,
} from "@/lib/webauthn";

/** How many times the autofill offer is renewed after it lapses (a timeout, an expired challenge). */
const CONDITIONAL_RENEWALS = 5;

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
  const { user, signIn, signInWithPasskey } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Read after mount: there is no `PublicKeyCredential` in the server render.
  const [canUsePasskey, setCanUsePasskey] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);

  /*
   * Passkeys in the email field's autofill (conditional mediation): a `navigator.credentials.get`
   * left pending for as long as the page is open, answered when the admin picks a passkey from the
   * field's suggestions. The button below withdraws it (one request at a time) and asks outright.
   */
  const rememberRef = useRef(remember);
  useEffect(() => {
    rememberRef.current = remember;
  }, [remember]);
  const conditional = useRef<AbortController | null>(null);
  const renewals = useRef(0);
  const renewal = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const offerInAutofill = useCallback(async () => {
    conditional.current?.abort();
    if (!(await conditionalMediationAvailable())) return;

    const controller = new AbortController();
    conditional.current = controller;
    try {
      await signInWithPasskey({
        conditional: true,
        signal: controller.signal,
        remember: () => rememberRef.current,
      });
    } catch (cause) {
      if (controller.signal.aborted || isPasskeyCancel(cause)) return;
      // Only what happens after the admin picked a passkey is theirs to read: a refusal from the
      // server (not an admin passkey, an unknown one). Fetching the offer failing, or the offer
      // lapsing in the browser, happened without them doing anything, so it stays quiet.
      const afterChoice =
        cause instanceof ApiError
          ? cause.code.startsWith("PASSKEY_") || cause.code.startsWith("AUTH_")
          : !(cause instanceof DOMException) && !(cause instanceof TypeError);
      if (afterChoice) setError(passkeyErrorMessage(cause, "sign-in"));
      // Renewed after a refusal or a lapse in the browser, so the autofill keeps offering passkeys;
      // not after the API was unreachable or busy, where asking again only adds to the load. The
      // button still works either way.
      const lapsed = cause instanceof DOMException;
      if ((afterChoice || lapsed) && renewals.current++ < CONDITIONAL_RENEWALS) {
        renewal.current = setTimeout(() => void offerInAutofill(), afterChoice ? 0 : 1000);
      }
    }
  }, [signInWithPasskey]);

  useEffect(() => {
    setCanUsePasskey(passkeysSupported());
    void offerInAutofill();
    return () => {
      conditional.current?.abort();
      clearTimeout(renewal.current);
    };
  }, [offerInAutofill]);

  async function onPasskey() {
    conditional.current?.abort();
    clearTimeout(renewal.current);
    setError(null);
    setPasskeyPending(true);
    try {
      await signInWithPasskey({ remember });
      // As with the password: the effect above navigates away, so the button stays busy.
    } catch (cause) {
      if (!isPasskeyCancel(cause)) setError(passkeyErrorMessage(cause, "sign-in"));
      setPasskeyPending(false);
      void offerInAutofill();
    }
  }

  /*
   * Where the guard sent them from, if anywhere. It arrives in the query string because a client
   * navigation carries no state of its own under Next, which means it is reader-supplied and gets
   * checked: it must resolve to this origin, so `?next=https://elsewhere` (or `/\\elsewhere`, which
   * browsers read as `//elsewhere`) cannot turn sign-in into an open redirect.
   */
  const requested = params.get("next");
  const from = requested && isSameOriginPath(requested) ? requested : "/";

  // Already signed in: leaving them on the form would be a dead end. This also carries a
  // successful sign-in through, since it is the same condition a moment later.
  const signedIn = isAdmin(user);
  useEffect(() => {
    if (signedIn) router.replace(from);
  }, [signedIn, from, router]);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passkeyPending) return;
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
                <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-white/70" />
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
                    size={16}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <Input
                    id="email"
                    type="email"
                    // "webauthn" lets the browser list passkeys in this field's suggestions.
                    autoComplete="username webauthn"
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
                    size={16}
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
                <AlertTriangle size={16} className="mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={pending || passkeyPending || !canSubmit}
              className="mt-6 h-11 w-full text-[13.5px] font-semibold"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {pending ? "Signing in" : "Sign in"}
              {!pending && <ArrowRight aria-hidden="true" />}
            </Button>
          </form>

          {canUsePasskey && (
            <>
              <div className="my-5 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.08em] text-faint">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void onPasskey()}
                disabled={pending || passkeyPending}
                className="h-11 w-full text-[13.5px] font-medium"
              >
                {passkeyPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound aria-hidden="true" className="text-brand" />
                )}
                {passkeyPending ? "Waiting for your passkey" : "Sign in with a passkey"}
              </Button>
            </>
          )}

          <p className="mt-8 text-[11px] leading-relaxed text-faint">
            Internal analytics. Admin accounts only — access is enforced by the server on every
            request.
          </p>
        </div>
      </main>
    </div>
  );
}

/** A `next` value is followed only when it stays on this origin: no backslashes, no control characters. */
function isSameOriginPath(next: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return false;
  if (typeof window === "undefined") return false;
  try {
    return new URL(next, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}
