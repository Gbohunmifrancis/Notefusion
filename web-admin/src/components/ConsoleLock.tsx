"use client";

import { AlertTriangle, KeyRound, Loader2, Lock } from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";

import { lockConsoleSession } from "@/api/endpoints";
import { IdentityFields, useIdentityCheck } from "@/components/IdentityCheck";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getLockState,
  idleExpired,
  lockConsole,
  registerPromptHost,
  settleConfirmation,
  subscribe,
  type LockReason,
} from "@/lib/adminLock";
import { useAuth } from "@/lib/auth";
import { unlockErrorMessage } from "@/lib/consoleUnlock";
import { cn } from "@/lib/utils";
import { isPasskeyCancel } from "@/lib/webauthn";

/** What counts as the admin still at the desk. */
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;

/** How often the idle clock is read; a hidden tab is also read the moment it is shown again. */
const IDLE_CHECK_MS = 10_000;

/**
 * The console lock (board i-console-lock): the lock itself over a blurred page (frames 1 and 2), the
 * prompt for a call the server wants freshly confirmed, and the 5-minute idle clock. Mounted once,
 * in the console's frame.
 */
export function ConsoleLock() {
  const lock = useSyncExternalStore(subscribe, getLockState, getLockState);
  useIdleLock();

  return (
    <>
      <LockScreen open={lock.locked} reason={lock.reason} />
      <ConfirmPrompt open={lock.confirming && !lock.locked} />
    </>
  );
}

/** Locks the console after 5 minutes without a key, click, scroll or touch, and ends its pass. */
function useIdleLock() {
  useEffect(() => {
    let last = Date.now();
    const seen = () => {
      last = Date.now();
    };
    const check = () => {
      if (getLockState().locked) {
        last = Date.now();
        return;
      }
      if (!idleExpired(last, Date.now())) return;
      const ended = lockConsole("away");
      if (ended) void lockConsoleSession(ended).catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    for (const name of ACTIVITY) window.addEventListener(name, seen, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    return () => {
      for (const name of ACTIVITY) window.removeEventListener(name, seen, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);
}

/**
 * Frames 1 and 2. Everything behind is blurred and nothing loads until the admin confirms it is them:
 * a passkey when the account has one, the password otherwise. The card fades in over 200 ms as the
 * page blurs, and out as it sharpens.
 */
function LockScreen({ open, reason }: { open: boolean; reason: LockReason }) {
  const { user, signOut } = useAuth();
  const check = useIdentityCheck(open);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const passwordId = useId();

  useEffect(() => {
    if (!open) return;
    check.reset();
    setError(null);
    setPending(false);
    // Only on opening: a fresh lock starts on the passkey again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function unlock(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending || !check.ready) return;
    setPending(true);
    setError(null);
    try {
      await check.confirm();
    } catch (cause) {
      if (!isPasskeyCancel(cause)) setError(unlockErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function choose(method: "passkey" | "password") {
    check.choose(method);
    setError(null);
  }

  const byPasskey = check.method === "passkey";
  const intro =
    reason === "away"
      ? "You were away for 5 minutes. Confirm it’s you to carry on where you left off."
      : "Confirm it’s you to carry on where you left off.";

  return (
    <AlertDialogPrimitive.Root open={open}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[5px] duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            // No Cancel here for Radix to focus: the way in is the first thing to reach.
            event.preventDefault();
            firstRef.current?.focus();
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-border bg-popover px-[30px] pt-[30px] pb-6 text-popover-foreground shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            byPasskey ? "text-center" : "text-left",
          )}
        >
          <div
            className={cn(
              "mb-3.5 flex size-[52px] items-center justify-center rounded-[14px] bg-muted text-foreground dark:bg-background",
              byPasskey && "mx-auto",
            )}
          >
            <Lock size={24} strokeWidth={1.75} aria-hidden="true" />
          </div>

          <AlertDialogPrimitive.Title className="text-[17px] font-semibold text-foreground">
            Admin is locked
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-[13px] leading-[1.55] text-muted-foreground">
            {byPasskey ? intro : "Enter your password to carry on."}
          </AlertDialogPrimitive.Description>

          {byPasskey ? (
            <div className="mt-[18px] flex flex-col items-center gap-2.5">
              <Button
                ref={(node) => {
                  firstRef.current = node;
                }}
                type="button"
                onClick={() => void unlock()}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <KeyRound aria-hidden="true" />
                )}
                Unlock with passkey
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => choose("password")}
                disabled={pending}
                className="h-auto px-1.5 py-1"
              >
                Use your password
              </Button>
            </div>
          ) : (
            <form onSubmit={unlock}>
              <Label htmlFor={passwordId} className="mt-3.5 block text-xs text-muted-foreground">
                Password
              </Label>
              <Input
                id={passwordId}
                ref={(node) => {
                  firstRef.current = node;
                }}
                type="password"
                autoComplete="current-password"
                autoFocus={check.chosen}
                value={check.password}
                onChange={(event) => check.setPassword(event.target.value)}
                disabled={pending}
                className="mt-1.5 text-[14px]"
              />
              <div className="mt-[18px] flex items-center justify-between gap-2">
                {check.canPasskey ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => choose("passkey")}
                    disabled={pending}
                    className="h-auto px-0 py-1"
                  >
                    Use a passkey instead
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={pending || !check.ready}>
                  {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Unlock
                </Button>
              </div>
            </form>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-left text-[12.5px] text-danger-deep"
            >
              <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <p className="mt-4 text-xs text-faint">
            {user?.email && (
              <>
                {user.email}
                <span aria-hidden="true"> · </span>
              </>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Sign out
            </button>
          </p>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/**
 * For a call the server refused as needing a fresh confirmation that no confirm dialog asked for
 * first (a flag's date, a passkey kept waiting past the minute): confirm, and the call goes again.
 */
function ConfirmPrompt({ open }: { open: boolean }) {
  const check = useIdentityCheck(open);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => registerPromptHost(), []);

  useEffect(() => {
    if (!open) return;
    check.reset();
    setError(null);
    setPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !check.ready) return;
    setPending(true);
    setError(null);
    try {
      // The new pass answers the waiting call (adminLock.setAdminPass).
      await check.confirm();
    } catch (cause) {
      if (!isPasskeyCancel(cause)) setError(unlockErrorMessage(cause));
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) settleConfirmation(false);
      }}
    >
      <AlertDialogContent className="bg-popover sm:max-w-md">
        <AlertDialogTitle>Confirm it’s you</AlertDialogTitle>
        <AlertDialogDescription className="text-[13px] leading-relaxed">
          This change goes through once you have.
        </AlertDialogDescription>

        <form onSubmit={submit} className="space-y-4">
          <IdentityFields check={check} disabled={pending} />

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger-deep"
            >
              <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={pending || !check.ready}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Confirm
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
