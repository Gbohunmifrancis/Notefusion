"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  getOfferAudience,
  getOfferProgress,
  getOfferRecipients,
  sendOfferLastCall,
  sendOfferPush,
  updateOffer,
  type AdminOffer,
  type OfferChannelName,
  type OfferRecipientFilter,
  type OfferRound,
  type OfferWords,
} from "@/api/offers";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import type { ConfirmRequest } from "@/components/ConfirmDialog";
import { Segmented } from "@/components/Segmented";
import { StatCard } from "@/components/StatCard";
import { ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCount } from "@/lib/format";
import { formatOfferDay, weekdayOf, zoneWall } from "@/lib/offers";

import { OFFERS_KEY, lookOf, offerError, offerKeys, people, toastOfferError } from "./offerLook";

const LIMITS: Record<keyof OfferWords, number> = { subject: 120, preheader: 200, headline: 120, body: 1200 };

const same = (a: OfferWords, b: OfferWords) =>
  a.subject === b.subject && a.preheader === b.preheader && a.headline === b.headline && a.body === b.body;

/** "Fri 30 Oct, 14:05" in UK time, as the rest of the page says times. */
function when(iso: string | null): string {
  if (!iso) return "—";
  const w = zoneWall(iso);
  return `${formatOfferDay(w.date)}, ${w.time}`;
}

/**
 * The last call: the follow-up before the offer ends, once its email has gone. Its own words (the template's until
 * changed), Send (to the groups the email went to, less those who bought; anyone still waiting for the email gets
 * this instead), then its counts. The email carries a live countdown to each person's own midnight and says Pro goes
 * back to its usual price.
 */
export function OfferLastCallCard({
  offer,
  onConfirm,
  onDirty,
}: {
  offer: AdminOffer;
  onConfirm: (request: ConfirmRequest) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const look = lookOf(offer.template);
  const saved = offer.lastCallWords ?? { subject: "", preheader: "", headline: "", body: "" };
  const [draft, setDraft] = useState<OfferWords>(saved);
  const [saving, setSaving] = useState(false);
  const ids = { subject: useId(), preheader: useId(), headline: useId(), body: useId() };
  const sent = offer.lastCallStartedAtUtc ?? null;
  const dirty = !same(draft, saved);
  const ended = offer.state === "ended";

  useEffect(() => {
    if (!dirty) setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.lastCallWords]);
  useEffect(() => onDirty(dirty && !sent), [dirty, sent, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const send = offer.send;
  const choice = { free: send?.includesFree ?? true, lapsed: send?.includesLapsed ?? true, proNow: send?.includesProNow ?? false };
  const audience = useQuery({
    queryKey: [...offerKeys.audience(offer.id), choice, "lastCall"],
    queryFn: ({ signal }) => getOfferAudience(offer.id, choice, signal),
    enabled: !sent && !ended,
  });
  const progress = useQuery({
    queryKey: offerKeys.progress(offer.id),
    queryFn: ({ signal }) => getOfferProgress(offer.id, signal),
    enabled: !!sent,
    refetchInterval: 60_000,
  });

  async function save() {
    if ((Object.keys(LIMITS) as (keyof OfferWords)[]).some((key) => !draft[key].trim())) {
      toast.error("Every line of the last call needs words: subject, preview line, headline and paragraphs.");
      return;
    }
    setSaving(true);
    try {
      await updateOffer(offer.id, {
        template: offer.template,
        percentOff: offer.percentOff,
        includesMonthly: offer.includesMonthly,
        includesYearly: offer.includesYearly,
        startsAtUtc: offer.startsAtUtc,
        lastDay: offer.lastDay,
        lastCallWords: { ...draft },
      });
      await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
      void queryClient.invalidateQueries({ queryKey: offerKeys.preview(offer.id) });
      toast.success("The last call's words are saved");
    } catch (caught) {
      toastOfferError(caught, "The words didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const a = audience.data;
  const blocked = !offer.postalAddressSet
    ? "Set Email__PostalAddress first."
    : ended
      ? "The offer has ended."
      : !offer.enabled
        ? "Turn the offer on first."
        : dirty
          ? "Save the last call's words first."
          : null;

  function askToSend() {
    const n = a?.total ?? 0;
    const reached = a ? Math.min(n, a.estimate.reachedBeforeEnd) : 0;
    onConfirm({
      title: `Send the ${look.label}'s last call?`,
      body: (
        <>
          <p>
            It goes to the groups the email went to{a ? ` (about ${formatCount(n)} ${people(n)})` : ""}, less anyone who has already
            bought. Anyone still waiting for the email gets this instead, never both.
          </p>
          <p>
            It is optional mail, so the email quota paces it
            {a ? `: about ${formatCount(a.quota.perDay)} a day, so about ${formatCount(reached)} ${people(reached)} before it ends on ${weekdayOf(offer.lastDay)}` : ""}.
            Each goes between 09:00 and 19:00 in the person's own time, last calls first.
          </p>
          <p>The words are locked once it is sent.</p>
        </>
      ),
      confirmLabel: "Send the last call",
      confirmIdentity: true,
      onConfirm: async () => {
        try {
          await sendOfferLastCall(offer.id);
        } catch (caught) {
          throw offerError(caught, "The last call couldn't be sent. Try again.");
        }
        await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
        void queryClient.invalidateQueries({ queryKey: offerKeys.progress(offer.id) });
        void queryClient.invalidateQueries({ queryKey: ["offer-recipients", offer.id] });
        toast.success("Sending the last call", { description: "Last calls go first, from 09:00 in each person's own time." });
      },
    });
  }

  const set = (key: keyof OfferWords) => (value: string) => setDraft((words) => ({ ...words, [key]: value }));
  const field = (key: keyof OfferWords, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={ids[key]} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {key === "body" ? (
        <Textarea
          id={ids[key]}
          value={draft[key]}
          maxLength={LIMITS[key]}
          disabled={!!sent}
          rows={5}
          onChange={(event) => set(key)(event.target.value)}
          className="min-h-0 resize-y text-base leading-relaxed md:text-[13px]"
        />
      ) : (
        <Input
          id={ids[key]}
          value={draft[key]}
          maxLength={LIMITS[key]}
          disabled={!!sent}
          onChange={(event) => set(key)(event.target.value)}
          className="h-8 text-base md:text-[13px]"
        />
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  const lc = progress.data?.lastCall ?? null;

  return (
    <Card
      title="Last call"
      hint={
        sent
          ? `Sent ${when(sent)}: a live countdown to each person's own midnight, then the usual price.`
          : "The follow-up before it ends: a live countdown to each person's own midnight, and Pro back to its usual price after it."
      }
      action={
        sent ? (
          <Badge>Sent</Badge>
        ) : dirty ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(saved)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save words
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3.5">
        {field("subject", "Subject", "Write {pct} for the percent off.")}
        {field("preheader", "Preview line")}
        {field("headline", "Headline")}
        {field("body", "Paragraphs", "A blank line starts a new paragraph. The countdown sits under the headline.")}
      </div>

      {sent ? (
        lc ? (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Sent" value={formatCount(lc.sent)} sub={lc.queued > 0 ? `${formatCount(lc.queued)} waiting` : "None waiting"} tone="neutral" />
            <StatCard label="Opened" value={formatCount(lc.opened)} sub={lc.sent > 0 ? `${Math.round((lc.opened / lc.sent) * 100)}% of sent` : "—"} tone="neutral" />
            <StatCard label="Clicked" value={formatCount(lc.clicked)} sub="Opened the app" tone="neutral" />
            <StatCard label="Bought after" value={formatCount(lc.boughtAfter)} sub="At the offer price" tone="neutral" />
          </div>
        ) : progress.error ? (
          <ErrorView error={offerError(progress.error, "The last call's counts didn't load.")} onRetry={() => void progress.refetch()} retrying={progress.isFetching} />
        ) : (
          <LoadingView label="Counting" />
        )
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={askToSend} disabled={!!blocked || !a}>
            <Megaphone aria-hidden="true" />
            Send the last call
          </Button>
          <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
            {blocked ??
              (a
                ? `About ${formatCount(a.total)} ${people(a.total)} in the email's groups; about ${formatCount(a.quota.perDay)} can go a day. Preview it with "Last call" in the preview.`
                : audience.error
                  ? "Who gets it couldn't be counted."
                  : "Counting who gets it…")}
          </span>
        </div>
      )}
    </Card>
  );
}

/**
 * Each sent email as a notification too: the web app's browsers that turned notifications on, and, ticked, the app's
 * phones. Not mail, so the email quota never holds it; it goes 09:00–19:00 in each person's own time like the email. The
 * offer's price is on the website and Google Play does not let an app send its users to pay outside Play, so phones are
 * off unless ticked, and a phone's notification opens the app's own Upgrade screen.
 */
export function OfferPushCard({ offer, onConfirm }: { offer: AdminOffer; onConfirm: (request: ConfirmRequest) => void }) {
  const queryClient = useQueryClient();
  const [phones, setPhones] = useState(false);
  const phonesId = useId();
  const progress = useQuery({
    queryKey: offerKeys.progress(offer.id),
    queryFn: ({ signal }) => getOfferProgress(offer.id, signal),
    refetchInterval: 60_000,
  });
  const ended = offer.state === "ended";
  const rounds: { round: OfferRound; name: string; sentAt: string | null }[] = [
    { round: "launch", name: "The email", sentAt: offer.send?.startedAtUtc ?? null },
    { round: "lastCall", name: "The last call", sentAt: offer.lastCallStartedAtUtc ?? null },
  ];
  const pushed = progress.data?.notifications ?? [];

  function ask(round: OfferRound, name: string) {
    onConfirm({
      title: `Send ${name.toLowerCase()} as a notification?`,
      body: (
        <>
          <p>
            To everyone in its groups with notifications on{phones ? " (the web app and phones)" : " in the web app"}, less anyone who has bought.
            Its subject is the title and its preview line the text.
          </p>
          <p>It is not mail, so the email limit does not hold it. Each goes between 09:00 and 19:00 in the person's own time.</p>
          {phones && <p>Phones open the app's Upgrade screen, never the website, as Google Play requires.</p>}
        </>
      ),
      confirmLabel: "Send the notification",
      confirmIdentity: true,
      onConfirm: async () => {
        let queued = 0;
        try {
          queued = (await sendOfferPush(offer.id, round, phones)).queued;
        } catch (caught) {
          throw offerError(caught, "The notification couldn't be sent. Try again.");
        }
        void queryClient.invalidateQueries({ queryKey: offerKeys.progress(offer.id) });
        void queryClient.invalidateQueries({ queryKey: ["offer-recipients", offer.id] });
        toast.success(`Notifying ${formatCount(queued)} ${people(queued)}`, { description: "From 09:00 in each person's own time." });
      },
    });
  }

  return (
    <Card
      title="As a notification"
      hint="The same words to the web app's notifications (and phones, ticked). Not mail: the email limit never holds it."
    >
      <div className="space-y-3">
        {rounds.map(({ round, name, sentAt }) => {
          const done = pushed.find((p) => p.round === round);
          return (
            <div key={round} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {done
                    ? `Sent ${formatCount(done.sent)} · tapped ${formatCount(done.tapped)}${done.queued > 0 ? ` · ${formatCount(done.queued)} waiting` : ""}${done.phones ? " · web and phones" : " · web app"}`
                    : sentAt
                      ? "Not sent as a notification yet"
                      : "Send the email first"}
                </p>
              </div>
              {!done && (
                <Button size="sm" variant="outline" disabled={!sentAt || ended || !offer.enabled} onClick={() => ask(round, name)}>
                  <Megaphone aria-hidden="true" />
                  Notify
                </Button>
              )}
            </div>
          );
        })}
        <div className="flex items-start gap-3 pt-1">
          <Checkbox id={phonesId} checked={phones} onCheckedChange={(next) => setPhones(next === true)} />
          <label htmlFor={phonesId} className="cursor-pointer text-xs leading-relaxed text-muted-foreground">
            <span className="block text-[13px] font-medium text-foreground">Phones too</span>
            The price is on the website, and Google Play does not let an app send its users to pay outside Play. Phones open the app's
            Upgrade screen. Leave this off unless the app sells through the website.
          </label>
        </div>
      </div>
    </Card>
  );
}

const FILTERS: { value: OfferRecipientFilter; label: string }[] = [
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "bought", label: "Bought" },
  { value: "all", label: "Everyone" },
];

/**
 * Who opened (or clicked, bought) each email: the people, newest open first, a hundred at a time. An open is the
 * email's image loading, or its button clicked with images blocked; Apple Mail loads every image on delivery, so it
 * reads high there.
 */
export function OfferRecipientsCard({ offer }: { offer: AdminOffer }) {
  const [round, setRound] = useState<OfferRound>(offer.lastCallStartedAtUtc ? "lastCall" : "launch");
  const [filter, setFilter] = useState<OfferRecipientFilter>("opened");
  const [channel, setChannel] = useState<OfferChannelName>("email");
  const [pages, setPages] = useState(1);
  const list = useQuery({
    queryKey: ["offer-recipients", offer.id, round, filter, pages, channel],
    queryFn: async ({ signal }) => {
      const first = await getOfferRecipients(offer.id, round, filter, 0, signal, channel);
      const items = [...first.items];
      for (let page = 1; page < pages && items.length < first.total; page++)
        items.push(...(await getOfferRecipients(offer.id, round, filter, items.length, signal, channel)).items);
      return { ...first, items };
    },
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });

  const data = list.data;
  return (
    <Card
      title="Who opened"
      hint="An open is the email's picture loading, or its button clicked with pictures off. Apple Mail loads every picture on delivery, so it reads high there."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {offer.lastCallStartedAtUtc && (
          <Segmented
            label="Which email"
            value={round}
            onChange={(next) => {
              setRound(next);
              setPages(1);
            }}
            options={[
              { value: "launch", label: "The email" },
              { value: "lastCall", label: "Last call" },
            ]}
          />
        )}
        <Segmented
          label="Channel"
          value={channel}
          onChange={(next) => {
            setChannel(next);
            setPages(1);
          }}
          options={[
            { value: "email", label: "Email" },
            { value: "push", label: "Notification" },
          ]}
        />
        <Segmented
          label="Show"
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setPages(1);
          }}
          options={FILTERS}
        />
        {data && (
          <span className="text-xs text-muted-foreground">
            {formatCount(data.opened)} opened · {formatCount(data.total)} shown
          </span>
        )}
      </div>
      {list.error && !data ? (
        <ErrorView error={offerError(list.error, "The list didn't load. Try again.")} onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : !data ? (
        <LoadingView label="Reading who opened" />
      ) : data.items.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          {filter === "opened" ? "Nobody has opened this email yet." : filter === "clicked" ? "Nobody has clicked yet." : filter === "bought" ? "Nobody has bought yet." : "Nobody was sent this email."}
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium sm:px-2">Person</th>
                <th className="px-2 py-2 font-medium">Group</th>
                <th className="px-2 py-2 font-medium">Sent</th>
                <th className="px-2 py-2 font-medium">Opened</th>
                <th className="px-2 py-2 font-medium">Clicked</th>
                <th className="px-2 py-2 font-medium">Bought</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.userId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 sm:px-2">
                    <Link href={`/users/${r.userId}`} className="font-medium text-foreground hover:underline">
                      {r.name || r.email}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.email}
                      {r.country ? ` · ${r.country}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{r.group === "ProNow" ? "Pro now" : r.group}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{r.status === "Sent" ? when(r.sentAtUtc) : r.status}</td>
                  <td className="px-2 py-2 tabular-nums">{when(r.openedAtUtc)}</td>
                  <td className="px-2 py-2 tabular-nums">{when(r.clickedAtUtc)}</td>
                  <td className="px-2 py-2 tabular-nums">{r.boughtAtUtc ? <span className="font-medium text-success">{when(r.boughtAtUtc)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.items.length < data.total && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => setPages((p) => p + 1)} disabled={list.isFetching}>
            {list.isFetching && <Loader2 className="animate-spin" aria-hidden="true" />}
            Show more
          </Button>
        </div>
      )}
    </Card>
  );
}
