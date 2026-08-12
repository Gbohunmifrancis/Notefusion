import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/api/client";

/**
 * The three non-success states, in one place so every panel reports them the same way.
 * An empty result and a failed request look identical if you only render `data ?? []`,
 * and on an admin dashboard that difference is the difference between "no signups this
 * week" and "the query broke".
 */

export function LoadingView({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-12 text-sm text-muted"
      role="status"
    >
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function EmptyView({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox size={26} className="text-faint" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">{message}</p>
      {hint && <p className="max-w-sm text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  // Surfacing the server's own code makes a report actionable instead of "it broke".
  const code = error instanceof ApiError ? error.code : null;
  const status = error instanceof ApiError ? error.status : null;

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-12 text-center"
      role="alert"
    >
      <AlertTriangle size={26} className="text-danger" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">{error.message}</p>
      {code && (
        <p className="font-mono text-xs text-muted">
          {code}
          {status ? ` · ${status}` : ""}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-pill border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-alt"
        >
          Try again
        </button>
      )}
    </div>
  );
}

interface StateViewProps<T> {
  state: { data: T | null; error: Error | null; loading: boolean; reload: () => void };
  /** Called with the loaded data. Return the panel's real content. */
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  emptyHint?: string;
  loadingLabel?: string;
}

/** Renders `children(data)` only once there is data, and reports the other states. */
export function StateView<T>({
  state,
  children,
  isEmpty,
  emptyMessage = "Nothing to show yet",
  emptyHint,
  loadingLabel,
}: StateViewProps<T>) {
  if (state.error) return <ErrorView error={state.error} onRetry={state.reload} />;
  // Keeps the previous data visible while a reload is in flight, so the page does not
  // flash a spinner every time the range changes.
  if (!state.data) {
    return state.loading ? (
      <LoadingView {...(loadingLabel ? { label: loadingLabel } : {})} />
    ) : (
      <EmptyView message={emptyMessage} {...(emptyHint ? { hint: emptyHint } : {})} />
    );
  }
  if (isEmpty?.(state.data)) {
    return <EmptyView message={emptyMessage} {...(emptyHint ? { hint: emptyHint } : {})} />;
  }

  return <>{children(state.data)}</>;
}
