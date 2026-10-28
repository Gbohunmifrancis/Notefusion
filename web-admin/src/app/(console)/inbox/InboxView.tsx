"use client";

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
  Mail,
  Paperclip,
  Reply,
  Send,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { followLiveFeed, type LiveEvent } from "@/lib/liveFeed";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  getInbox,
  getInboxAttachments,
  getInboxEmail,
  getSentEmail,
  getSentMail,
  replyToEmail,
} from "@/api/endpoints";
import type {
  InboxAttachment,
  InboxEmailDetail,
  InboxEmailSummary,
  SentEmailDetail,
  SentEmailSummary,
} from "@/api/types";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Put ahead of an inbound email's HTML: nothing in it may load from the network (no tracking
 * pixels, remote fonts or stylesheets); inline styles and embedded data: images still show.
 */
const EMAIL_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`;

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function extractDisplay(addr: string): { name: string; email: string } {
  const match = addr.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  if (match) return { name: (match[1] ?? addr).trim(), email: (match[2] ?? addr).trim() };
  return { name: addr, email: addr };
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── sub-components ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[10px] bg-slate-100 dark:bg-slate-800">
        <Mail size={20} className="text-slate-400" aria-hidden="true" />
      </div>
      <p className="font-medium text-slate-700 dark:text-slate-200">No emails yet</p>
      <p className="max-w-xs text-sm text-slate-400 dark:text-slate-500">
        Received emails from your Resend inbound route will appear here.
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
      <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
      {message}
    </div>
  );
}

// ── Reply form ────────────────────────────────────────────────────────────────

function ReplyForm({
  emailId,
  originalSubject,
  onClose,
  onSent,
}: {
  emailId: string;
  originalSubject: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const subjectDefault = originalSubject.startsWith("Re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const [subject, setSubject] = useState(subjectDefault);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      // Wrap plain text in <p> tags so the branded template renders it cleanly.
      const bodyHtml = body
        .split(/\n\n+/)
        .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
        .join("");
      await replyToEmail(emailId, subject, bodyHtml);
      onSent();
    } catch {
      setError("Failed to send reply. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 rounded-[10px] border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Reply</span>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5"
          aria-label="Discard reply"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder="Write your reply…"
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
        />

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end">
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="flex items-center gap-2 rounded-[8px] bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Reply size={16} />
            )}
            {sending ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Email detail panel ────────────────────────────────────────────────────────

function EmailDetailPanel({
  summary,
  onClose,
}: {
  summary: InboxEmailSummary;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<InboxEmailDetail | null>(null);
  const [attachments, setAttachments] = useState<InboxAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [sentBanner, setSentBanner] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDetail(null);
    setReplying(false);
    setSentBanner(false);

    const controller = new AbortController();

    Promise.all([
      getInboxEmail(summary.id, controller.signal),
      summary.hasAttachments
        ? getInboxAttachments(summary.id, controller.signal)
        : Promise.resolve([] as InboxAttachment[]),
    ])
      .then(([d, a]) => {
        setDetail(d);
        setAttachments(a);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") {
          setError("Failed to load email. Please try again.");
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [summary.id, summary.hasAttachments]);

  const from = extractDisplay(detail?.from ?? summary.from);

  return (
    <div className="flex min-h-0 flex-col">
      {/* header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/10">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {summary.subject}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            From&nbsp;
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {from.name !== from.email ? `${from.name} ` : ""}
            </span>
            <span className="text-slate-500">&lt;{from.email}&gt;</span>
            &nbsp;·&nbsp;{formatRelative(summary.receivedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!replying && !sentBanner && (
            <button
              onClick={() => setReplying(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              <Reply size={14} />
              Reply
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label="Close email"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-500" size={20} />
          </div>
        )}
        {error && <ErrorBanner message={error} />}

        {detail && !loading && (
          <>
            {sentBanner && (
              <div className="mb-4 flex items-center gap-2 rounded-[8px] border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-400">
                <Check size={16} aria-hidden="true" />
                Reply sent successfully.
              </div>
            )}

            {/* HTML body in a fully sandboxed iframe: no scripts, no same-origin, no remote loads */}
            {detail.htmlBody ? (
              <iframe
                srcDoc={EMAIL_CSP + detail.htmlBody}
                sandbox=""
                title="Email body"
                className="h-[480px] w-full rounded-[8px] border border-slate-200 bg-white dark:border-white/10"
                style={{ colorScheme: "light" }}
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-[8px] border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
                {detail.textBody ?? "(No body)"}
              </pre>
            )}

            {/* attachments */}
            {attachments.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Attachments
                </p>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      <Download size={14} className="shrink-0 text-slate-400" />
                      <span className="max-w-[160px] truncate">{att.filename}</span>
                      <span className="shrink-0 text-xs text-slate-400">
                        {fileSizeLabel(att.sizeBytes)}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* reply form */}
            {replying && (
              <ReplyForm
                emailId={summary.id}
                originalSubject={summary.subject}
                onClose={() => setReplying(false)}
                onSent={() => {
                  setReplying(false);
                  setSentBanner(true);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Email list item ───────────────────────────────────────────────────────────

function EmailListItem({
  email,
  selected,
  onClick,
}: {
  email: InboxEmailSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const from = extractDisplay(email.from);
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[8px] px-4 py-3 text-left transition ${
        selected
          ? "bg-blue-600 text-white shadow-md shadow-blue-900/20"
          : "hover:bg-slate-100 dark:hover:bg-white/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`truncate text-sm font-semibold ${
            selected ? "text-white" : "text-slate-800 dark:text-slate-100"
          }`}
        >
          {from.name !== from.email ? from.name : from.email}
        </span>
        <span
          className={`shrink-0 text-xs ${
            selected ? "text-blue-200" : "text-slate-400"
          }`}
        >
          {formatRelative(email.receivedAt)}
        </span>
      </div>
      <p
        className={`mt-0.5 truncate text-sm ${
          selected ? "text-blue-100" : "text-slate-600 dark:text-slate-400"
        }`}
      >
        {email.subject}
      </p>
      {email.hasAttachments && (
        <Paperclip
          size={14}
          className={`mt-1 ${selected ? "text-blue-200" : "text-slate-400"}`}
          aria-label="Has attachments"
        />
      )}
    </button>
  );
}

// ── Sent mail ─────────────────────────────────────────────────────────────────

/** Resend's latest event, as a word and a tone: delivered and read green, trouble amber, waiting grey. */
const SENT_STATUS: Record<string, { label: string; tone: "good" | "bad" | "wait" }> = {
  delivered: { label: "Delivered", tone: "good" },
  opened: { label: "Opened", tone: "good" },
  clicked: { label: "Clicked", tone: "good" },
  sent: { label: "Sent", tone: "wait" },
  queued: { label: "Queued", tone: "wait" },
  scheduled: { label: "Scheduled", tone: "wait" },
  delivery_delayed: { label: "Delayed", tone: "bad" },
  bounced: { label: "Bounced", tone: "bad" },
  complained: { label: "Marked spam", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
  suppressed: { label: "Suppressed", tone: "bad" },
  canceled: { label: "Cancelled", tone: "wait" },
};

function StatusPill({ status, selected = false }: { status: string | null; selected?: boolean }) {
  if (!status) return null;
  const known = SENT_STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "wait" as const };
  const tone = selected
    ? "bg-white/20 text-white"
    : known.tone === "good"
      ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400"
      : known.tone === "bad"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
        : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {known.label}
    </span>
  );
}

function SentListItem({
  email,
  selected,
  onClick,
}: {
  email: SentEmailSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-[8px] px-4 py-3 text-left transition ${
        selected ? "bg-blue-600 text-white shadow-md shadow-blue-900/20" : "hover:bg-slate-100 dark:hover:bg-white/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate text-sm font-semibold ${selected ? "text-white" : "text-slate-800 dark:text-slate-100"}`}>
          To {email.to || "(no recipient)"}
        </span>
        <span className={`shrink-0 text-xs ${selected ? "text-blue-200" : "text-slate-400"}`}>
          {formatRelative(email.sentAt)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className={`truncate text-sm ${selected ? "text-blue-100" : "text-slate-600 dark:text-slate-400"}`}>
          {email.subject}
        </p>
        <StatusPill status={email.status} selected={selected} />
      </div>
    </button>
  );
}

function SentDetailPanel({ summary, onClose }: { summary: SentEmailSummary; onClose: () => void }) {
  const [detail, setDetail] = useState<SentEmailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getSentEmail(summary.id, controller.signal)
      .then(setDetail)
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setError("Failed to load email. Please try again.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [summary.id]);

  const from = extractDisplay(detail?.from ?? summary.from);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-white/10">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">{summary.subject}</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            To&nbsp;<span className="font-medium text-slate-700 dark:text-slate-300">{summary.to}</span>
            &nbsp;·&nbsp;from {from.name !== from.email ? from.name : from.email}
            &nbsp;·&nbsp;{new Date(summary.sentAt).toLocaleString()}
          </p>
          <div className="mt-1.5">
            <StatusPill status={detail?.status ?? summary.status} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
          aria-label="Close email"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-blue-500" size={20} />
          </div>
        )}
        {error && <ErrorBanner message={error} />}
        {detail && !loading && (
          detail.bodyWithheld ? (
            <div className="flex items-start gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
              <Lock size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
              This email holds a sign-in code or a one-time link, so its body is not shown here.
            </div>
          ) : detail.htmlBody ? (
            <iframe
              srcDoc={EMAIL_CSP + detail.htmlBody}
              sandbox=""
              title="Email body"
              className="h-[480px] w-full rounded-[8px] border border-slate-200 bg-white dark:border-white/10"
              style={{ colorScheme: "light" }}
            />
          ) : (
            <pre className="whitespace-pre-wrap rounded-[8px] border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
              {detail.textBody ?? "(No body)"}
            </pre>
          )
        )}
      </div>
    </div>
  );
}

// ── One mailbox: a paged list on the left, the open email on the right ─────────

interface Paged<T> {
  items: T[];
  total: number;
  totalPages: number;
}

function Mailbox<T extends { id: string }>({
  load,
  noun,
  empty,
  renderItem,
  renderDetail,
  follow,
}: {
  /** A live notice that means new items (the Inbox's `inbox`): the first page is read again, quietly. */
  follow?: LiveEvent;
  load: (page: number, pageSize: number, signal: AbortSignal) => Promise<Paged<T>>;
  noun: string;
  empty: ReactNode;
  renderItem: (item: T, selected: boolean, onClick: () => void) => ReactNode;
  renderDetail: (item: T, onClose: () => void) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<T | null>(null);

  const PAGE_SIZE = 50;
  const abortRef = useRef<AbortController | null>(null);

  const go = useCallback(
    (p: number) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      load(p, PAGE_SIZE, ctrl.signal)
        .then((d) => {
          setData(d);
          setPage(p);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name !== "AbortError") {
            setError(err instanceof Error ? err.message : `Could not load ${noun}.`);
          }
        })
        .finally(() => setLoading(false));
    },
    [load, noun],
  );

  useEffect(() => {
    go(1);
    return () => abortRef.current?.abort();
  }, [go]);

  // New mail: the first page is read again without the spinner; a later page is left as it is.
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!follow) return;
    return followLiveFeed(() => {
      if (pageRef.current !== 1) return;
      load(1, PAGE_SIZE, new AbortController().signal).then(setData).catch(() => undefined);
    }, follow);
  }, [follow, load]);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <>
      {error && <ErrorBanner message={error} />}

      <div className="flex min-h-[600px] overflow-hidden nf-panel">
        {/* left panel — list */}
        <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 dark:border-white/10">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Messages</p>
            {data && <span className="text-xs text-slate-400">{data.total} total</span>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-blue-500" size={20} />
              </div>
            )}
            {!loading && !error && items.length === 0 && empty}
            {!loading &&
              items.map((item) => (
                <div key={item.id}>
                  {renderItem(item, selected?.id === item.id, () => setSelected(item))}
                </div>
              ))}
          </div>

          {/* pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-white/10">
              <button
                disabled={page === 1}
                onClick={() => go(page - 1)}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand disabled:opacity-40 hover:underline"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                Prev
              </button>
              <span className="text-xs text-slate-400">
                {page} / {totalPages}
              </span>
              <button
                disabled={page === totalPages}
                onClick={() => go(page + 1)}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand disabled:opacity-40 hover:underline"
              >
                Next
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* right panel — detail */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <div key={selected.id} className="h-full">
              {renderDetail(selected, () => setSelected(null))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Mail size={20} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-400 dark:text-slate-500">Select an email to read it</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

type Box = "inbox" | "sent";

const BOXES: { key: Box; label: string; icon: typeof Mail; note: string }[] = [
  { key: "inbox", label: "Inbox", icon: Mail, note: "Received through the Resend inbound route" },
  { key: "sent", label: "Sent", icon: Send, note: "Everything the app sent: codes, receipts, replies, notes and offers" },
];

export function InboxView() {
  const params = useSearchParams();
  const router = useRouter();
  const box: Box = params.get("box") === "sent" ? "sent" : "inbox";
  const current = BOXES.find((b) => b.key === box) ?? BOXES[0]!;

  const loadInbox = useCallback((p: number, size: number, signal: AbortSignal) => getInbox(p, size, signal), []);
  const loadSent = useCallback((p: number, size: number, signal: AbortSignal) => getSentMail(p, size, signal), []);

  return (
    <div className="space-y-4">
      {/* page title */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Mail</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{current.note}</p>
        </div>
        <div role="tablist" aria-label="Mailbox" className="inline-flex rounded-[10px] border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-white/5">
          {BOXES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={box === key}
              onClick={() => router.replace(key === "inbox" ? "/inbox" : "/inbox?box=sent", { scroll: false })}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium transition ${
                box === key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {box === "inbox" ? (
        <Mailbox<InboxEmailSummary>
          key="inbox"
          follow="inbox"
          load={loadInbox}
          noun="inbox"
          empty={<EmptyState />}
          renderItem={(email, selected, onClick) => <EmailListItem email={email} selected={selected} onClick={onClick} />}
          renderDetail={(email, onClose) => <EmailDetailPanel summary={email} onClose={onClose} />}
        />
      ) : (
        <Mailbox<SentEmailSummary>
          key="sent"
          load={loadSent}
          noun="sent mail"
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
              <Send size={20} className="text-slate-400" aria-hidden="true" />
              <p className="font-medium text-slate-700 dark:text-slate-200">Nothing sent yet</p>
            </div>
          }
          renderItem={(email, selected, onClick) => <SentListItem email={email} selected={selected} onClick={onClick} />}
          renderDetail={(email, onClose) => <SentDetailPanel summary={email} onClose={onClose} />}
        />
      )}
    </div>
  );
}
