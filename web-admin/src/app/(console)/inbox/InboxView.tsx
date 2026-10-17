"use client";

import {
  AlertCircle,
  Download,
  Loader2,
  Mail,
  Paperclip,
  Reply,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getInbox,
  getInboxAttachments,
  getInboxEmail,
  replyToEmail,
} from "@/api/endpoints";
import type {
  InboxAttachment,
  InboxEmailDetail,
  InboxEmailSummary,
  InboxPage,
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
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
        <Mail size={26} className="text-slate-400" aria-hidden="true" />
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
    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
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
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
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
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Reply size={15} />
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
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
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
            <Loader2 className="animate-spin text-blue-500" size={24} />
          </div>
        )}
        {error && <ErrorBanner message={error} />}

        {detail && !loading && (
          <>
            {sentBanner && (
              <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-400">
                ✓ Reply sent successfully.
              </div>
            )}

            {/* HTML body in a fully sandboxed iframe: no scripts, no same-origin, no remote loads */}
            {detail.htmlBody ? (
              <iframe
                srcDoc={EMAIL_CSP + detail.htmlBody}
                sandbox=""
                title="Email body"
                className="h-[480px] w-full rounded-xl border border-slate-200 bg-white dark:border-white/10"
                style={{ colorScheme: "light" }}
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-700 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
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
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
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
      className={`w-full rounded-xl px-4 py-3 text-left transition ${
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
          size={12}
          className={`mt-1 ${selected ? "text-blue-200" : "text-slate-400"}`}
          aria-label="Has attachments"
        />
      )}
    </button>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function InboxView() {
  const [page, setPage] = useState(1);
  const [inboxData, setInboxData] = useState<InboxPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxEmailSummary | null>(null);

  const PAGE_SIZE = 50;
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (p: number) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      getInbox(p, PAGE_SIZE, ctrl.signal)
        .then((data) => {
          setInboxData(data);
          setPage(p);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name !== "AbortError") {
            const msg = err instanceof Error ? err.message : "Could not load inbox.";
            setError(msg);
          }
        })
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    load(1);
    return () => abortRef.current?.abort();
  }, [load]);

  const emails = inboxData?.items ?? [];
  const totalPages = inboxData?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      {/* page title */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Inbox</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Received emails from your Resend inbound route
          {inboxData ? ` · ${inboxData.total} total` : ""}
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex min-h-[600px] overflow-hidden nf-panel">
        {/* left panel — list */}
        <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 dark:border-white/10">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-white/10">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Messages
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-blue-500" size={22} />
              </div>
            )}
            {!loading && emails.length === 0 && <EmptyState />}
            {!loading && emails.map((email) => (
              <EmailListItem
                key={email.id}
                email={email}
                selected={selected?.id === email.id}
                onClick={() => setSelected(email)}
              />
            ))}
          </div>

          {/* pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-white/10">
              <button
                disabled={page === 1}
                onClick={() => load(page - 1)}
                className="text-xs font-medium text-blue-600 disabled:opacity-40 hover:underline"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-400">
                {page} / {totalPages}
              </span>
              <button
                disabled={page === totalPages}
                onClick={() => load(page + 1)}
                className="text-xs font-medium text-blue-600 disabled:opacity-40 hover:underline"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        {/* right panel — detail */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <EmailDetailPanel
              key={selected.id}
              summary={selected}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Mail size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  Select an email to read it
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
