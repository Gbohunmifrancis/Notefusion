import { CheckCircle2, X } from "lucide-react";

/**
 * The line that appears after an operator action lands. It exists because the mutations return 204
 * and then the page reloads — without it the only evidence anything happened is that the data
 * changed, which is indistinguishable from "the click missed".
 *
 * Success only. Failures are shown inside the dialog that caused them, where the operator still has
 * the context and can retry without reopening anything.
 */
export function ResultBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success"
      role="status"
    >
      <CheckCircle2 size={16} className="mt-[1px] shrink-0" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-sm transition hover:bg-success/10"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
