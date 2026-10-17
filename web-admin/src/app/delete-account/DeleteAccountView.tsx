"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { request, ApiError } from "@/api/client";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteAccountView() {
  const searchParams = useSearchParams();

  const tokenParam = searchParams.get("token") ?? "";
  const emailParam = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailParam);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [confirmedCheck, setConfirmedCheck] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [emailSentMessage, setEmailSentMessage] = useState<string | null>(null);

  const isTokenMode = Boolean(tokenParam && emailParam);

  async function onTokenConfirm() {
    setError(null);
    setPending(true);
    try {
      const res = await request<{ success: boolean; confirmed: boolean; message: string }>(
        "/api/account/delete/confirm",
        {
          method: "POST",
          body: {
            email: emailParam.trim(),
            token: tokenParam.trim(),
            reason: "Confirmed via web email link",
          },
          anonymous: true,
        }
      );
      setSuccessMessage(
        res.message || "Your NoteFusion account and data have been permanently deleted."
      );
      if (typeof window !== "undefined" && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to confirm account deletion. The link may have expired or is invalid.");
      }
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !confirmedCheck) {
      setError("Please enter your account email and confirm your choice.");
      return;
    }

    setError(null);
    setEmailSentMessage(null);
    setSuccessMessage(null);
    setPending(true);

    try {
      const res = await request<{ success: boolean; confirmed: boolean; message: string }>(
        "/api/account/delete",
        {
          method: "POST",
          body: {
            email: email.trim(),
            password: password ? password : null,
            reason: reason.trim() ? reason.trim() : null,
          },
          anonymous: true,
        }
      );

      if (res.confirmed) {
        setSuccessMessage(
          res.message || "Your NoteFusion account and data have been permanently deleted."
        );
      } else {
        setEmailSentMessage(
          res.message ||
            "A verification link has been sent to your email. Click it within 24 hours to finalize deletion."
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to process deletion request. Please check your connection and try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="https://notefusion.studio" className="flex items-center gap-2 font-bold text-blue-600 text-lg">
            <BrandMark className="h-7 w-7 text-blue-600" />
            <span>NoteFusion</span>
          </Link>
          <a
            href="https://notefusion.studio"
            className="flex items-center gap-1 text-slate-500 hover:text-slate-900 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to NoteFusion</span>
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="font-bold text-2xl sm:text-3xl text-slate-900 tracking-tight">
            Delete Your Account &amp; Data
          </h1>
          <p className="mt-2 text-slate-600">
            Request permanent deletion of your NoteFusion account, profile information, and musical transcriptions.
          </p>
        </div>

        {/* Data Safety & Policy Disclosures */}
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-lg text-slate-900">Data Safety &amp; Retention Disclosures</h2>
          <p className="mt-2 text-slate-600 text-sm leading-relaxed">
            In accordance with Google Play Data Safety requirements and global privacy standards (GDPR / NDPR),
            you have full control over your data.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4">
              <h3 className="font-semibold text-rose-800 text-sm flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-rose-600" />
                Permanently Deleted
              </h3>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600 text-xs leading-relaxed">
                <li>Account credentials, full name, and email</li>
                <li>Saved Tonic Solfa music transcriptions</li>
                <li>Audio recordings and pitch analysis data</li>
                <li>Staff notation sheets and chord progressions</li>
                <li>Active login sessions and push notifications</li>
              </ul>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                Retention Exceptions &amp; Timeline
              </h3>
              <p className="mt-2 text-slate-600 text-xs leading-relaxed">
                <strong>Timeline:</strong> Deletions confirmed with a password or email link are executed immediately.
              </p>
              <p className="mt-2 text-slate-600 text-xs leading-relaxed">
                <strong>Exceptions:</strong> Pseudonymized billing/invoice logs are kept strictly where required by
                statutory commercial tax and accounting laws.
              </p>
            </div>
          </div>
        </section>

        {/* Token Confirmation Flow */}
        {isTokenMode && (
          <section className="mb-6 rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <ShieldAlert className="size-5 text-rose-600" />
              <h2 className="font-semibold text-lg text-slate-900">Confirm Account Deletion</h2>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {successMessage ? (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-medium">Account Successfully Deleted</p>
                  <p className="mt-1 text-xs">{successMessage}</p>
                </div>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-slate-600 text-sm">
                  You are about to permanently delete the NoteFusion account for{" "}
                  <strong className="text-slate-900">{emailParam}</strong>. All transcriptions, solfa data, and recordings
                  will be removed immediately.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={onTokenConfirm}
                    disabled={pending}
                    className="bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    {pending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Deleting Account...
                      </>
                    ) : (
                      "Confirm Permanent Deletion"
                    )}
                  </Button>
                  <Link
                    href="https://notefusion.studio"
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Standard Web Submission Form */}
        {!isTokenMode && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-lg text-slate-900">Web Deletion Request</h2>
            <p className="mt-1 text-slate-600 text-sm">
              Submit your account details below to initiate account and data deletion.
            </p>

            {error && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {emailSentMessage && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <div>
                  <p className="font-semibold">Confirmation Link Sent</p>
                  <p className="mt-1 text-xs leading-relaxed">{emailSentMessage}</p>
                </div>
              </div>
            )}

            {successMessage && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold">Account Deleted</p>
                  <p className="mt-1 text-xs leading-relaxed">{successMessage}</p>
                </div>
              </div>
            )}

            {!successMessage && !emailSentMessage && (
              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="email" className="text-slate-700 text-xs font-semibold">
                    Account Email Address *
                  </Label>
                  <div className="relative mt-1">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      required
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="password" className="text-slate-700 text-xs font-semibold">
                    Account Password (Optional)
                  </Label>
                  <div className="relative mt-1">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password for instant deletion"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <p className="mt-1 text-slate-500 text-xs">
                    Leave blank if you signed up with Google Sign-In; a secure 24-hour confirmation link will be emailed to you instead.
                  </p>
                </div>

                <div>
                  <Label htmlFor="reason" className="text-slate-700 text-xs font-semibold">
                    Reason for deletion (Optional)
                  </Label>
                  <textarea
                    id="reason"
                    rows={3}
                    placeholder="Tell us why you are deleting your account..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-start gap-2 pt-1">
                  <input
                    id="confirmCheck"
                    type="checkbox"
                    checked={confirmedCheck}
                    onChange={(e) => setConfirmedCheck(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <Label htmlFor="confirmCheck" className="text-slate-600 text-xs font-normal leading-snug cursor-pointer">
                    I understand that this action is permanent. All saved transcriptions, scores, and recordings will be erased.
                  </Label>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={pending || !email.trim() || !confirmedCheck}
                    className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5"
                  >
                    {pending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing Request...
                      </>
                    ) : password ? (
                      "Delete Account Immediately"
                    ) : (
                      "Request Deletion via Email"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* In-app Instructions Card */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-lg text-slate-900">In-App Deletion Steps</h2>
          <p className="mt-1 text-slate-600 text-sm">
            You can also delete your account directly inside the NoteFusion mobile application:
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-slate-600 text-sm leading-relaxed">
            <li>Launch the <strong>NoteFusion</strong> app on your Android or iOS device.</li>
            <li>Tap on <strong>Settings</strong> in the navigation bar.</li>
            <li>Select <strong>Account &amp; Security</strong>.</li>
            <li>Scroll to the bottom and select <strong>Delete Account</strong>.</li>
            <li>Confirm your request to complete instant account and data removal.</li>
          </ol>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-8 text-center text-slate-500 text-xs">
        <p className="space-x-3">
          <Link href="https://notefusion.studio" className="hover:text-slate-900">NoteFusion Home</Link>
          <span>&middot;</span>
          <Link href="https://notefusion.studio/privacy" className="hover:text-slate-900">Privacy Policy</Link>
          <span>&middot;</span>
          <Link href="https://notefusion.studio/terms" className="hover:text-slate-900">Terms of Service</Link>
          <span>&middot;</span>
          <a href="mailto:support@notefusion.studio" className="hover:text-slate-900">Contact Support</a>
        </p>
        <p className="mt-2">&copy; 2026 NoteFusion. All rights reserved.</p>
      </footer>
    </div>
  );
}
