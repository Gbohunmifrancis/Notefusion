"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Info, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import {
  deletePasskey,
  getPasskeyRegistrationOptions,
  getPasskeys,
  registerPasskey,
  renamePasskey,
} from "@/api/endpoints";
import type { Passkey } from "@/api/types";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { StateView } from "@/components/StateView";
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
import { formatInstantDateTime } from "@/lib/format";
import { isFresh } from "@/lib/adminLock";
import { offersPasskey, unlockErrorMessage, unlockWithPasskey, unlockWithPassword } from "@/lib/consoleUnlock";
import { getReportingOffset } from "@/lib/reporting";
import {
  defaultPasskeyName,
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeysSupported,
  registrationToJson,
  toCreationOptions,
} from "@/lib/webauthn";

/** Mirrors `Passkey.NameMaxLength` on the server. */
const NAME_MAX = 60;

const QUERY_KEY = ["passkeys"] as const;

/**
 * The signed-in admin's passkeys: list (name, added, last used), add, rename, remove. Passkeys sit
 * beside the password rather than replacing it, which the panel says once the first one is added.
 */
export function PasskeysPanel() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getPasskeys(signal),
  });

  const [supported, setSupported] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addedFirst, setAddedFirst] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  useEffect(() => setSupported(passkeysSupported()), []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  function askRemove(passkey: Passkey) {
    setConfirm({
      title: "Remove this passkey?",
      body: (
        <p>
          <span className="font-medium text-foreground">{passkey.name}</span> will no longer sign
          in to the console. Your password and any other passkeys keep working. The passkey may
          still be listed on the device until you delete it there too.
        </p>
      ),
      confirmLabel: "Remove passkey",
      tone: "danger",
      confirmIdentity: true,
      onConfirm: async () => {
        await deletePasskey(passkey.id);
        await refresh();
        toast.success(`Removed "${passkey.name}"`);
      },
    });
  }

  const count = state.data?.length ?? 0;

  return (
    <Card
      title="Passkeys"
      hint="Sign in with your fingerprint, face or device PIN instead of typing your password."
      action={
        supported ? (
          <Button size="sm" onClick={() => setAdding(true)} disabled={state.isPending}>
            <Plus aria-hidden="true" />
            Add a passkey
          </Button>
        ) : undefined
      }
    >
      {!supported && (
        <p className="mb-4 flex items-start gap-2 rounded-sm bg-muted px-3.5 py-2.5 text-[13px] text-muted-foreground">
          <Info size={16} className="mt-px shrink-0" aria-hidden="true" />
          This browser can&apos;t create passkeys. Open the console in a current version of Chrome,
          Safari, Edge or Firefox to add one.
        </p>
      )}

      {addedFirst && (
        <p
          role="status"
          className="mb-4 flex items-start gap-2 rounded-sm border border-border bg-muted/50 px-3.5 py-2.5 text-[13px] text-muted-foreground"
        >
          <Check size={16} className="mt-px shrink-0 text-success" aria-hidden="true" />
          <span>
            Your passkey is ready. Next time, choose &ldquo;Sign in with a passkey&rdquo;.
            Your password still works too, so nothing changes if you&apos;re on another device.
          </span>
        </p>
      )}

      <StateView
        state={state}
        loadingLabel="Loading passkeys"
        isEmpty={(rows) => rows.length === 0}
        emptyMessage="No passkeys yet"
        emptyHint="Add one to sign in without your password. Your password keeps working either way."
      >
        {(rows) => (
          <ul className="divide-y divide-border rounded-[8px] border border-border">
            {rows.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                onRenamed={refresh}
                onRemove={() => askRemove(passkey)}
              />
            ))}
          </ul>
        )}
      </StateView>

      <AddPasskeyDialog
        open={adding}
        passkeys={state.data}
        onClose={() => setAdding(false)}
        onAdded={async (passkey) => {
          setAdding(false);
          if (count === 0) setAddedFirst(true);
          await refresh();
          toast.success(`Added "${passkey.name}"`);
        }}
      />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}

function PasskeyRow({
  passkey,
  onRenamed,
  onRemove,
}: {
  passkey: Passkey;
  onRenamed: () => Promise<unknown>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passkey.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const offset = getReportingOffset();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    if (trimmed === passkey.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await renamePasskey(passkey.id, trimmed);
      await onRenamed();
      setEditing(false);
      requestAnimationFrame(() => editButton.current?.focus());
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code !== "UNKNOWN"
          ? cause.message
          : "We couldn't rename that passkey. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setName(passkey.name);
    setError(null);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-muted text-brand">
        <KeyRound size={16} aria-hidden="true" />
      </span>

      {editing ? (
        <form onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Label htmlFor={inputId} className="sr-only">
            Passkey name
          </Label>
          <Input
            id={inputId}
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
            }}
            className="h-8 min-w-0 flex-1 basis-48 text-[13px]"
          />
          <Button type="submit" size="sm" disabled={saving || !name.trim()}>
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          {error && (
            <p role="alert" className="basis-full text-[12.5px] text-danger-deep">
              {error}
            </p>
          )}
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-foreground" title={passkey.name}>
              {passkey.name}
            </p>
            <p className="text-xs text-muted-foreground">
              Added {formatInstantDateTime(passkey.createdAtUtc, offset)}
              <span aria-hidden="true"> · </span>
              {passkey.lastUsedAtUtc
                ? `Last used ${formatInstantDateTime(passkey.lastUsedAtUtc, offset)}`
                : "Not used yet"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              ref={editButton}
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${passkey.name}`}
              title="Rename"
              className="text-muted-foreground"
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label={`Remove ${passkey.name}`}
              title="Remove"
              className="text-muted-foreground hover:text-danger"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Two steps (board i-console-lock, frame 4). First the admin confirms it is them — an existing
 * passkey or the password — because a passkey signs in without one; the server refuses to add or
 * remove a passkey without that fresh confirmation. Then the passkey is named and the ceremony runs:
 * options from the API, `navigator.credentials.create`, and the attestation back to the API. Stays
 * open on failure to say why.
 */
function AddPasskeyDialog({
  open,
  passkeys,
  onClose,
  onAdded,
}: {
  open: boolean;
  passkeys: readonly Passkey[] | undefined;
  onClose: () => void;
  onAdded: (passkey: Passkey) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) {
      // Confirmed in the last minute (the lock, another dialog): straight to naming.
      setStep(isFresh() ? 2 : 1);
      setPassword("");
      setName(defaultPasskeyName());
      setError(null);
      setPending(false);
    }
  }, [open]);

  const byPasskey = offersPasskey(passkeys);
  const only = passkeys?.length === 1 ? passkeys[0] : undefined;

  async function confirm(unlock: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await unlock();
      setStep(2);
    } catch (cause) {
      if (!isPasskeyCancel(cause)) setError(unlockErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function confirmWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password) void confirm(() => unlockWithPassword(password));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const options = await getPasskeyRegistrationOptions();
      const credential = (await navigator.credentials.create({
        publicKey: toCreationOptions(options),
      })) as PublicKeyCredential | null;
      if (!credential) throw new DOMException("No passkey was created.", "NotAllowedError");
      const passkey = await registerPasskey(registrationToJson(credential), name.trim());
      await onAdded(passkey);
    } catch (cause) {
      if (!isPasskeyCancel(cause)) setError(passkeyErrorMessage(cause, "add"));
      setPending(false);
    }
  }

  const errorNote = error && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger-deep"
    >
      <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </p>
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent className="bg-popover sm:max-w-md">
        <div>
          <div className="flex gap-1.5" aria-hidden="true">
            <i className="h-1 w-[22px] rounded-[2px] bg-brand" />
            <i className={`h-1 w-[22px] rounded-[2px] ${step === 2 ? "bg-brand" : "bg-border"}`} />
          </div>
          <AlertDialogTitle className="mt-3">
            Add a passkey<span className="sr-only">, step {step} of 2</span>
          </AlertDialogTitle>
        </div>

        {step === 1 ? (
          <>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              First, confirm it&rsquo;s you. A passkey signs in without a password, so only you
              should be able to add one.
            </AlertDialogDescription>

            <form onSubmit={confirmWithPassword} className="space-y-4">
              {byPasskey && (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void confirm(unlockWithPasskey)}
                  disabled={pending}
                >
                  <KeyRound aria-hidden="true" />
                  <span className="truncate">
                    {only
                      ? `Confirm with my passkey “${only.name}”`
                      : "Confirm with my passkey"}
                  </span>
                </Button>
              )}

              <div>
                <Label htmlFor={passwordId} className="text-xs text-muted-foreground">
                  {byPasskey ? "Or your password" : "Your password"}
                </Label>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={pending}
                  className="mt-1.5 text-[13px]"
                />
              </div>

              <p className="rounded-[8px] bg-muted px-3 py-2.5 dark:bg-background text-[12.5px] leading-[1.45] text-muted-foreground">
                We email you whenever a passkey is added, so you would know if it ever wasn&rsquo;t
                you.
              </p>

              {errorNote}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <Button type="submit" disabled={pending || !password}>
                  {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Continue
                </Button>
              </AlertDialogFooter>
            </form>
          </>
        ) : (
          <>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              Your browser will ask you to confirm with your fingerprint, face, device PIN or a
              security key. Give it a name you&apos;ll recognise later.
            </AlertDialogDescription>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                  Name
                </Label>
                <Input
                  id={inputId}
                  autoFocus
                  value={name}
                  maxLength={NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="MacBook Touch ID"
                  className="mt-1.5 text-[13px]"
                />
              </div>

              {errorNote}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound aria-hidden="true" />
                  )}
                  {pending ? "Waiting for your device" : "Continue"}
                </Button>
              </AlertDialogFooter>
            </form>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
