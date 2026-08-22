"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MailCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { request, ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { StaffRibbon } from "@/components/StaffRibbon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The page the reset email links to.
 *
 * Same shell as the sign-in view: a navy brand panel from `lg` up, the form in one narrow column
 * beside it, and 44 px fields rather than the console's 36 px. The two pages are the only things a
 * signed-out visitor sees, so they are deliberately the same object.
 *
 * Unlike sign-in this one is not admin-only — any account can land here from its email — so the
 * panel explains the mechanics instead of selling the console.
 */

/** What the reset actually does. Every line is a fact from the server, not reassurance. */
const POINTS = [
  {
    icon: KeyRound,
    text: "The link works once. Setting a password here spends it.",
  },
  {
    icon: Clock,
    text: "It expires an hour after the email that carried it was sent.",
  },
  {
    icon: MailCheck,
    text: "We email the account to confirm as soon as the change lands.",
  },
] as const;

const LABEL_CLASS = "text-xs text-muted-foreground";
/** 44 px, and room on the right for the reveal toggle where there is one. */
const FIELD_CLASS = "h-11 pl-10 text-[13.5px] placeholder:text-faint";

export function ResetPasswordView() {
  const searchParams = useSearchParams();

  const tokenParam = searchParams.get("token") ?? "";
  const emailParam = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailParam);
  const [token, setToken] = useState(tokenParam);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    email.trim().length > 3 &&
    token.trim().length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await request("/api/auth/reset-password", {
        method: "POST",
        body: {
          email: email.trim(),
          token: token.trim(),
          newPassword,
        },
        anonymous: true,
      });
      setSuccess(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "Invalid or expired reset token.",
      );
    } finally {
      setPending(false);
    }
  }

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
        </div>

        <div className="relative max-w-[27rem]">
          <h2 className="text-[30px] font-semibold leading-[1.18] tracking-[-0.02em] text-white">
            Set a new password for your account.
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
          Didn&apos;t ask for this? Ignore the email and nothing changes.
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
          </div>

          {success ? (
            <>
              <span className="grid h-11 w-11 place-items-center rounded-full bg-success/10 text-success-deep">
                <CheckCircle2 size={22} aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
                Password changed
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Your new password is active. Sign in with it on the app, or open the console if
                this is an admin account.
              </p>
              <Button asChild className="mt-6 h-11 w-full text-[13.5px] font-semibold">
                <Link href="/login">
                  Go to sign in
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
                Reset password
              </h1>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {/* The link normally carries both, and then this form is two fields. It says
                    which case the reader is in rather than silently showing more inputs. */}
                {emailParam && tokenParam
                  ? "Choose a new password for this account."
                  : "Enter the details from your reset email, then choose a new password."}
              </p>

              <form onSubmit={onSubmit} className="mt-8">
                <div className="space-y-4">
                  {!emailParam && (
                    <div>
                      <Label htmlFor="email" className={LABEL_CLASS}>
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
                          placeholder="you@example.com"
                          className={FIELD_CLASS}
                        />
                      </div>
                    </div>
                  )}

                  {!tokenParam && (
                    <div>
                      <Label htmlFor="token" className={LABEL_CLASS}>
                        Reset token
                      </Label>
                      <div className="relative mt-1.5">
                        <KeyRound
                          size={15}
                          aria-hidden="true"
                          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                        />
                        <Input
                          id="token"
                          type="text"
                          required
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                          placeholder="From the reset email"
                          className={FIELD_CLASS}
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <Label htmlFor="new-password" className={LABEL_CLASS}>
                      New password
                    </Label>
                    <div className="relative mt-1.5">
                      <Lock
                        size={15}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                      />
                      <Input
                        id="new-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="At least 8 characters"
                        className={`${FIELD_CLASS} pr-11`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setShowPassword((shown) => !shown)}
                        // One toggle for both fields: they have to match, so hiding one and
                        // showing the other would make the comparison harder, not safer.
                        aria-label={showPassword ? "Hide passwords" : "Show passwords"}
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

                  <div>
                    <Label htmlFor="confirm-password" className={LABEL_CLASS}>
                      Confirm new password
                    </Label>
                    <div className="relative mt-1.5">
                      <Lock
                        size={15}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                      />
                      <Input
                        id="confirm-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Type it again"
                        className={FIELD_CLASS}
                        aria-invalid={mismatch}
                        {...(mismatch ? { "aria-describedby": "confirm-error" } : {})}
                      />
                    </div>
                    {mismatch && (
                      <p id="confirm-error" className="mt-1.5 text-[11px] text-danger-deep">
                        The two passwords do not match yet.
                      </p>
                    )}
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
                  {pending ? "Saving" : "Set new password"}
                  {!pending && <ArrowRight aria-hidden="true" />}
                </Button>
              </form>

              <p className="mt-8 text-[11px] leading-relaxed text-faint">
                Reset links expire an hour after they are sent. If this one has, ask for another
                from the app&apos;s sign-in screen.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
