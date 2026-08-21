import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";

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
  const titleId = useId();

  // Each opening starts clean. Without this, a note typed for the last action would ride along
  // into the audit row of the next one.
  useEffect(() => {
    if (request) {
      setTyped("");
      setNote("");
      setError(null);
      setPending(false);
      firstFieldRef.current?.focus();
    }
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, pending, onClose]);

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
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-4 sm:items-center">
      <button
        type="button"
        onClick={() => !pending && onClose()}
        className="fixed inset-0 bg-navy-deep/60"
        aria-label="Cancel"
        tabIndex={-1}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-fade-in relative w-full max-w-md rounded-md border border-border bg-surface shadow-lift"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-heading font-semibold text-ink">
            {request.title}
          </h2>
          <button
            type="button"
            onClick={() => !pending && onClose()}
            className="-mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-sm text-faint transition hover:bg-surface-alt hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div className="space-y-2 text-[13px] leading-relaxed text-muted">{request.body}</div>

          {gated && (
            <label className="block">
              <span className="block text-xs font-medium text-muted">
                Type <span className="font-mono text-ink">{request.typeToConfirm}</span> to confirm
              </span>
              <input
                ref={(node) => {
                  firstFieldRef.current = node;
                }}
                type="text"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1.5 h-10 w-full rounded-sm border border-border bg-bg px-3 font-mono text-[13px] text-ink outline-none transition focus:border-accent"
              />
            </label>
          )}

          {request.noteLabel && (
            <label className="block">
              <span className="block text-xs font-medium text-muted">{request.noteLabel}</span>
              <textarea
                ref={(node) => {
                  if (!gated) firstFieldRef.current = node;
                }}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Optional — it goes in the audit trail"
                className="mt-1.5 w-full resize-none rounded-sm border border-border bg-bg px-3 py-2 text-[13px] text-ink outline-none transition focus:border-accent placeholder:text-faint"
              />
            </label>
          )}

          {error && (
            <p
              className="flex items-start gap-2 rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
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

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 rounded-sm border border-border px-4 text-[13px] font-semibold text-ink transition hover:bg-surface-alt disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!unlocked || pending}
              // The label flips with the fill on the danger button. `danger` brightens in dark mode
              // (#dc2626 → #f87171) because it also has to read as text there, and white on that
              // brighter red measures 2.77:1 — so the ink goes dark instead, which is 7:1. `blue`
              // needs no such treatment: it is a fill only, and deliberately does not flip.
              className={`flex h-9 items-center gap-2 rounded-sm px-4 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                danger
                  ? "bg-danger text-white hover:opacity-90 dark:text-navy-deep"
                  : "bg-blue text-white hover:bg-blue-deep"
              }`}
            >
              {pending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {request.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
