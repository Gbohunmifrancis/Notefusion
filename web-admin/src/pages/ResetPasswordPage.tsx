import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { request, ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { StaffRibbon } from "@/components/StaffRibbon";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  
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

  const canSubmit = email.trim().length > 3 && token.trim().length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;

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
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #1e40af 0%, #1d4ed8 40%, #2563eb 100%)" }}
    >
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

      <div
        className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 shadow-2xl p-10 animate-fade-in"
        style={{ backdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-col items-center">
          <BrandMark size={88} color="#2563eb" waveColor="#3b82f6" showWaves />
          <h1
            className="mt-3 text-[36px] font-bold leading-none text-ink"
            style={{ fontFamily: "Poppins, sans-serif", letterSpacing: "-1px" }}
          >
            Notefusion
          </h1>
          <p className="mt-1.5 text-sm font-medium text-muted tracking-wide uppercase">
            Reset Password
          </p>
        </div>

        {success ? (
          <div className="mt-8 flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-4">
              <CheckCircle2 size={36} />
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Password Reset Successful!</h2>
            <p className="text-sm text-muted mb-6">
              Your password has been securely updated. You can now log into your NoteFusion account with your new credentials.
            </p>
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 shadow-md"
            >
              Sign in to Account <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs font-medium text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                <p>{error}</p>
              </div>
            )}

            {!emailParam && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-border bg-slate-50 pl-11 pr-4 py-3 text-sm text-ink placeholder:text-muted/60 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            )}

            {!tokenParam && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Reset Token
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" />
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    placeholder="Enter reset token from email"
                    className="w-full rounded-xl border border-border bg-slate-50 pl-11 pr-4 py-3 text-sm text-ink placeholder:text-muted/60 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                  className="w-full rounded-xl border border-border bg-slate-50 pl-11 pr-11 py-3 text-sm text-ink placeholder:text-muted/60 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Confirm new password"
                  className="w-full rounded-xl border border-border bg-slate-50 pl-11 pr-4 py-3 text-sm text-ink placeholder:text-muted/60 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                <p className="mt-1 text-xs text-red-500 font-medium">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit || pending}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-md"
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                <>
                  Reset Password <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      <StaffRibbon opacity={0.2} className="absolute bottom-0 left-0 right-0 w-full text-white/20 pointer-events-none" />
    </div>
  );
}
