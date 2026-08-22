"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
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
import { Textarea } from "@/components/ui/textarea";

/**
 * The confirmation step for an operator action. One component rather than a per-action modal,
 * because the parts that matter are identical every time and the parts that differ are all copy:
 * what will happen, what it is called, and how hard it should be to do by accident.
 *
 * Three deliberate properties:
 *
 * - `body` is where the honest description goes, and it is required. "Are you sure?" is not a
 *   confirmation — an operator can only consent to something they have been told.
 * - `typeToConfirm` gates the irreversible actions behind retyping the account's email. A second
 *   click is not friction; it is the same click twice.
 * - A failure keeps the dialog open and shows the server's own message, because the guards on the
 *   other side ("you cannot do that to your own account", "that is the last administrator") are
 *   written for this reader and are the whole answer.
 *
 * Built on Radix's `AlertDialog`, which brings the focus trap, the scroll lock and the inert
 * background this used to hand-roll. Two consequences of the primitive worth naming: an alert
 * dialog does not dismiss on an outside click (Radix prevents it), and it carries no ✕ — a
 * decision is the point, and Cancel is still one click or one Escape away.
 *
 * The confirm button is a plain submit rather than `AlertDialogAction`, because Action closes the
 * dialog on click and a failed action has to stay open to show why.
 */
export interface ConfirmRequest {
  title: string;
  /** What will actually happen. Rendered above the controls. */
  body: ReactNode;
  confirmLabel: string;
  /** Destructive actions get the danger button. Default is the ordinary filled blue. */
  tone?: "danger" | "default";
  /** When set, the confirm button unlocks only on an exact match. Pass the account's email. */
  typeToConfirm?: string;
  /** Prompt for the operator's reason. Omit for actions where a note adds nothing. */
  noteLabel?: string;
  /** Resolve to close. Throw to stay open with the error shown. */
  onConfirm: (note: string | undefined) => Promise<void>;
}

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const gateId = useId();
  const noteId = useId();

  // Each opening starts clean. Without this, a note typed for the last action would ride along
  // into the audit row of the next one.
  useEffect(() => {
    if (request) {
      setTyped("");
      setNote("");
      setError(null);
      setPending(false);
    }
  }, [request]);

  if (!request) return null;

  const gated = request.typeToConfirm !== undefined;
  const unlocked = !gated || typed.trim().toLowerCase() === request.typeToConfirm?.toLowerCase();
  const danger = request.tone === "danger";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!unlocked || pending) return;

    setPending(true);
    setError(null);
    try {
      await request.onConfirm(note.trim() || undefined);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("The action failed."));
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        // Escape is the only route left to `false`, and it must not abandon an action already
        // in flight — the request would still land, with nothing on screen saying so.
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        className="bg-popover sm:max-w-md"
        onOpenAutoFocus={(event) => {
          // Radix focuses Cancel on open, which is right when the dialog is a bare yes/no. Where
          // there is a field to fill in, that field is where the operator has to go. Radix composes
          // this handler ahead of its own and skips its own once the default is prevented.
          const field = firstFieldRef.current;
          if (!field) return;
          event.preventDefault();
          field.focus();
        }}
      >
        <AlertDialogTitle>{request.title}</AlertDialogTitle>

        {/* `asChild`: the body is prose with its own paragraphs, and Radix's Description is a
            `<p>`. It still carries the id that describes the dialog. */}
        <AlertDialogDescription asChild className="space-y-2 text-[13px] leading-relaxed">
          <div>{request.body}</div>
        </AlertDialogDescription>

        <form onSubmit={submit} className="space-y-4">
          {gated && (
            <div>
              <Label htmlFor={gateId} className="text-xs text-muted-foreground">
                Type{" "}
                <span className="font-mono text-foreground">{request.typeToConfirm}</span> to
                confirm
              </Label>
              <Input
                id={gateId}
                ref={(node) => {
                  firstFieldRef.current = node;
                }}
                type="text"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 font-mono text-[13px]"
              />
            </div>
          )}

          {request.noteLabel && (
            <div>
              <Label htmlFor={noteId} className="text-xs text-muted-foreground">
                {request.noteLabel}
              </Label>
              <Textarea
                id={noteId}
                ref={(node) => {
                  if (!gated) firstFieldRef.current = node;
                }}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Optional — it goes in the audit trail"
                className="mt-1.5 min-h-0 resize-none text-[13px]"
              />
            </div>
          )}

          {error && (
            <p
              className="flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger-deep"
              role="alert"
            >
              <AlertTriangle size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
              <span>
                {error.message}
                {error instanceof ApiError && (
                  <span className="ml-1 font-mono text-[11px] opacity-70">{error.code}</span>
                )}
              </span>
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            {/* The destructive variant keeps white ink and dims the fill in dark mode
                (`dark:bg-destructive/60`, ~5.7:1), so the label needs no flip of its own. */}
            <Button
              type="submit"
              variant={danger ? "destructive" : "default"}
              disabled={!unlocked || pending}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {request.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
