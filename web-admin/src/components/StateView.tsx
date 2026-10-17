import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The three non-success states, in one place so every panel reports them the same way.
 * An empty result and a failed request look identical if you only render `data ?? []`,
 * and on an admin dashboard that difference is the difference between "no signups this
 * week" and "the query broke".
 */

export function LoadingView({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
      {label}…
    </div>
  );
}

/**
 * "Nothing here yet": a quiet icon, the message, and a line on what will fill the space.
 * `compact` drops the padding for a panel that is short to begin with.
 */
export function EmptyView({
  message,
  hint,
  icon: Icon = Inbox,
  compact = false,
}: {
  message: string;
  hint?: string;
  icon?: LucideIcon;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        compact ? "py-6" : "py-12",
      )}
    >
      <Icon size={20} aria-hidden="true" className="mb-1 text-faint" />
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorView({
  error,
  onRetry,
  retrying = false,
}: {
  error: Error;
  onRetry?: () => void;
  /** True while the retry is in flight, so the button can say so instead of looking inert. */
  retrying?: boolean;
}) {
  // Surfacing the server's own code makes a report actionable instead of "it broke".
  const code = error instanceof ApiError ? error.code : null;
  const status = error instanceof ApiError ? error.status : null;

  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-12 text-center"
      role="alert"
    >
      <AlertTriangle size={20} aria-hidden="true" className="mb-1 text-danger" />
      <p className="text-sm font-medium text-foreground">{error.message}</p>
      {code && (
        <p className="font-mono text-xs text-muted-foreground">
          {code}
          {status ? ` · ${status}` : ""}
        </p>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="mt-2 text-xs"
        >
          {retrying && <Loader2 className="animate-spin" aria-hidden="true" />}
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  );
}

/**
 * The slice of a TanStack Query result this needs. Narrow on purpose: `UseQueryResult` is
 * assignable to it, so a page passes its query straight through, but the panels stay testable
 * without a QueryClient and the props say exactly which four fields drive the rendering.
 */
export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  /** No data yet — first load, or a reload after the cache was dropped. */
  isPending: boolean;
  /** A request is in flight, including a background refresh over data already on screen. */
  isFetching: boolean;
  refetch: () => void;
}

interface StateViewProps<T> {
  state: QueryState<T>;
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
  if (state.error) {
    return <ErrorView error={state.error} onRetry={state.refetch} retrying={state.isFetching} />;
  }
  // Keeps the previous data visible while a reload is in flight, so the page does not
  // flash a spinner every time the range changes. `placeholderData: keepPreviousData` on the
  // query does the same thing across a key change; this covers the plain refetch.
  if (state.data === undefined) {
    return state.isPending ? (
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
