"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ExternalLink, Globe, Loader2, MessageCircle, RotateCcw, Send, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getSupportInbox, getSupportThread, replySupport, setSupportClosed } from "@/api/endpoints";
import type { SupportRow, SupportThread } from "@/api/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyView, ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { formatInstantDateTime, formatRelative } from "@/lib/format";
import { followLiveFeed } from "@/lib/liveFeed";
import { getReportingOffset } from "@/lib/reporting";
import { cn } from "@/lib/utils";

const SOURCES: Record<string, string> = { site: "Website", web: "Web app", app: "Phone" };

/**
 * Live support: every customer thread (the website's chat, the web app's and the phone's), unread first, and the open
 * thread with a reply box. Both follow the live feed's `support` event, so a customer's message shows the moment it is
 * sent; an answer reaches their open chat at once, or their phone and web app by push.
 */
export function SupportView() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selected = params.get("c");

  const inbox = useQuery({ queryKey: ["support-inbox"], queryFn: ({ signal }) => getSupportInbox(signal) });
  const thread = useQuery({
    queryKey: ["support-thread", selected],
    queryFn: ({ signal }) => getSupportThread(selected!, signal),
    enabled: selected !== null,
  });

  useEffect(
    () =>
      followLiveFeed(() => {
        void queryClient.invalidateQueries({ queryKey: ["support-inbox"] });
        void queryClient.invalidateQueries({ queryKey: ["support-thread"] });
        void queryClient.invalidateQueries({ queryKey: ["support-unread"] });
      }, "support"),
    [queryClient],
  );

  const open = (id: string | null) => router.replace(id ? `/support?c=${id}` : "/support", { scroll: false });

  return (
    <>
      <PageHeader title="Support" subtitle="Customers’ messages from the website, the web app and the phone, live." breadcrumb={["Dashboard", "Support"]} />
      <div className="grid min-h-[60dvh] gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <section className={cn("nf-panel overflow-hidden", selected && "hidden lg:block")} aria-label="Conversations">
          {inbox.isPending ? (
            <LoadingView label="Loading conversations" />
          ) : inbox.isError ? (
            <ErrorView error={inbox.error} onRetry={() => void inbox.refetch()} />
          ) : inbox.data.length === 0 ? (
            <EmptyView message="No conversations yet" hint="Messages from the chat button on the website, the web app and the phone land here." icon={MessageCircle} />
          ) : (
            <ul className="divide-y divide-border">
              {inbox.data.map((row) => (
                <ConversationRow key={row.id} row={row} active={row.id === selected} onOpen={() => open(row.id)} />
              ))}
            </ul>
          )}
        </section>

        <section className={cn("nf-panel flex min-h-[60dvh] flex-col", !selected && "hidden lg:flex")} aria-label="Conversation">
          {!selected ? (
            <EmptyView message="Pick a conversation" hint="New messages show here as they are sent." icon={MessageCircle} />
          ) : thread.isPending ? (
            <LoadingView label="Loading the conversation" />
          ) : thread.isError ? (
            <ErrorView error={thread.error} onRetry={() => void thread.refetch()} />
          ) : (
            <Thread thread={thread.data} onBack={() => open(null)} />
          )}
        </section>
      </div>
    </>
  );
}

function ConversationRow({ row, active, onOpen }: { row: SupportRow; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-sidebar-accent",
          active && "bg-sidebar-accent",
          row.closed && "opacity-60",
        )}
      >
        <span className="flex items-center gap-2">
          {row.unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
          <span className={cn("truncate text-[13.5px] text-foreground", row.unread ? "font-semibold" : "font-medium")}>{row.name}</span>
          <span className="ml-auto shrink-0 text-[11.5px] text-faint">{formatRelative(row.lastMessageAtUtc, Date.now())}</span>
        </span>
        <span className="truncate text-[12.5px] text-muted-foreground">
          {row.lastFromAdmin && "You: "}
          {row.lastMessage ?? ""}
        </span>
        <span className="text-[11px] text-faint">
          {SOURCES[row.source] ?? row.source}
          {row.closed && " · Closed"}
        </span>
      </button>
    </li>
  );
}

function Thread({ thread, onBack }: { thread: SupportThread; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["support-thread", thread.id] });
    void queryClient.invalidateQueries({ queryKey: ["support-inbox"] });
  };

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await replySupport(thread.id, body);
      setDraft("");
      refresh();
    } catch {
      toast.error("Couldn’t send that. Try again.");
    } finally {
      setSending(false);
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function toggleClosed() {
    try {
      await setSupportClosed(thread.id, !thread.closed);
      refresh();
    } catch {
      toast.error("Couldn’t change that. Try again.");
    }
  }

  const offset = getReportingOffset();
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">
            {thread.name}
            {thread.isPro && <span className="ml-2 rounded-[5px] bg-brand/10 px-1.5 py-px text-[10.5px] font-medium text-brand-deep">Pro</span>}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            {thread.source === "app" ? <Smartphone className="size-3.5" aria-hidden /> : <Globe className="size-3.5" aria-hidden />}
            {SOURCES[thread.source] ?? thread.source}
            {thread.path && <span className="truncate">· {thread.path}</span>}
            {thread.country && <span>· {thread.country}</span>}
            {thread.email && <a className="underline" href={`mailto:${thread.email}`}>{thread.email}</a>}
          </p>
        </div>
        {thread.userId && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/users/${thread.userId}`}>
              Account <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void toggleClosed()}>
          {thread.closed ? <RotateCcw className="size-4" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
          {thread.closed ? "Reopen" : "Close"}
        </Button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {thread.messages.map((m) => (
          <div key={m.id} className={cn("flex", m.fromAdmin ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-[12px] px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap",
                m.fromAdmin ? "bg-brand text-white" : "bg-sidebar-accent text-foreground",
              )}
            >
              {m.body}
              <p className={cn("mt-1 text-[11px]", m.fromAdmin ? "text-white/75" : "text-faint")}>
                {m.fromAdmin && m.adminName ? `${m.adminName} · ` : ""}
                {formatInstantDateTime(m.createdAtUtc, offset)}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 border-t border-border p-3">
        <label htmlFor="support-reply" className="sr-only">Reply</label>
        <textarea
          id="support-reply"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          maxLength={2000}
          placeholder={thread.userId ? "Reply (they get a notification if the chat is closed)" : "Reply"}
          className="min-h-11 flex-1 resize-none rounded-[8px] border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus:border-brand"
        />
        <Button type="submit" disabled={sending || draft.trim() === ""} aria-label="Send reply">
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
          Send
        </Button>
      </form>
    </>
  );
}
