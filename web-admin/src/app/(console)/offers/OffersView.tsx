"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Moon,
  Plus,
  ScrollText,
  Smartphone,
  TicketPercent,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  createOffer,
  getOfferProgress,
  getOffers,
  getOfferTemplates,
  setOfferEnabled,
  updateOffer,
  type AdminOffer,
  type OfferChange,
  type OfferInterval,
  type OfferPriceSet,
  type OfferTemplate,
  type OfferTemplateDefaults,
  type OfferWords,
} from "@/api/offers";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatInstantDateTime } from "@/lib/format";
import {
  endsAcrossTheWorld,
  fillPercent,
  formatOfferDay,
  formatOfferDayWords,
  formatOfferDayYear,
  formatPrice,
  wallToUtc,
  weekdayOf,
  zoneWall,
} from "@/lib/offers";
import { getReportingOffset } from "@/lib/reporting";
import { cn } from "@/lib/utils";

import { OfferPreviewPanel } from "./OfferPreview";
import { OfferProgressCard } from "./OfferProgress";
import { OfferSendCards } from "./OfferSending";
import {
  OFFERS_KEY,
  TEMPLATE_ORDER,
  lookOf,
  offerError,
  offerKeys,
  planWords,
  priceOf,
  startOf,
  stateBadge,
  STATE_PILL,
  toastOfferError,
} from "./offerLook";

/**
 * Money › Offers (board p-halloween-offer, P6a–P6c): a lower Pro price for a few days on the web app, and the
 * one email that tells people. One offer runs at a time.
 *
 * The list on top; the chosen offer opens below as the Feature flags' cards do: its switch (confirmed both ways with
 * the admin's passkey or password), template, price, dates and where it shows; the email's words (locked once sent);
 * who gets it and the email quota's reality; Send (confirmed the same way). Once sent, how it's going sits on top.
 * Beside it, the email as the server renders it. Price, plans, dates and template save as they change (the flags'
 * way); the words have their own Save, as the blog editor's do, since a half-typed subject is not worth an audit row.
 */
export function OffersView() {
  const offers = useQuery({ queryKey: OFFERS_KEY, queryFn: ({ signal }) => getOffers(signal) });
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Offers"
        subtitle="A lower Pro price for a few days on the web app, and the email that tells people. One offer runs at a time."
        breadcrumb={["Dashboard", "Operations", "Offers"]}
        actions={
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New offer
          </Button>
        }
      />

      <StateView
        state={offers}
        isEmpty={(list) => list.length === 0}
        emptyMessage="No offers yet"
        emptyHint="New offer starts one from the Halloween or Christmas template. It stays off until you turn it on."
      >
        {(list) => <Offers offers={list} chosen={chosen} onChoose={setChosen} />}
      </StateView>

      <NewOfferDialog open={creating} onClose={() => setCreating(false)} onCreated={setChosen} />
    </div>
  );
}

/** The one open: the one chosen, else the one running, else the next scheduled, else the newest. */
function openOffer(offers: AdminOffer[], chosen: string | null): AdminOffer {
  return (
    offers.find((o) => o.id === chosen) ??
    offers.find((o) => o.state === "running") ??
    [...offers].filter((o) => o.state === "scheduled").sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc))[0] ??
    offers[0]!
  );
}

function Offers({ offers, chosen, onChoose }: { offers: AdminOffer[]; chosen: string | null; onChoose: (id: string) => void }) {
  const offer = openOffer(offers, chosen);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [priceSet, setPriceSet] = useState<OfferPriceSet>("standard");
  const [wordsDirty, setWordsDirty] = useState(false);

  return (
    <>
      <OfferList offers={offers} open={offer.id} onChoose={onChoose} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          {offer.send && <OfferProgressCard key={`p-${offer.id}`} offer={offer} onConfirm={setConfirm} />}
          <OfferCard key={`o-${offer.id}`} offer={offer} onConfirm={setConfirm} />
          <EmailCard key={`e-${offer.id}`} offer={offer} onDirty={setWordsDirty} />
          {!offer.send && (
            <OfferSendCards key={`s-${offer.id}`} offer={offer} wordsDirty={wordsDirty} onConfirm={setConfirm} />
          )}
        </div>
        <OfferPreviewPanel offer={offer} priceSet={priceSet} onPriceSet={setPriceSet} wordsDirty={wordsDirty} />
      </div>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

/* ── The list ─────────────────────────────────────────────────────────────── */

function OfferList({ offers, open, onChoose }: { offers: AdminOffer[]; open: string; onChoose: (id: string) => void }) {
  return (
    <section className="nf-panel overflow-hidden" aria-label="Offers">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-xs text-faint">
            <th className="px-4 py-2.5 font-medium sm:px-5">Offer</th>
            <th className="hidden px-3 py-2.5 font-medium md:table-cell">Price</th>
            <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Runs</th>
            <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Email</th>
            <th className="px-4 py-2.5 text-right font-medium sm:px-5">State</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer, index) => (
            <OfferRow key={offer.id} offer={offer} first={index === 0} open={offer.id === open} onChoose={() => onChoose(offer.id)} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function OfferRow({ offer, first, open, onChoose }: { offer: AdminOffer; first: boolean; open: boolean; onChoose: () => void }) {
  // The same query as the card's, so a sending offer's count is read once.
  const progress = useQuery({
    queryKey: offerKeys.progress(offer.id),
    queryFn: ({ signal }) => getOfferProgress(offer.id, signal),
    enabled: offer.send !== null,
  });
  const look = lookOf(offer.template);
  const Icon = look.icon;
  const start = startOf(offer);
  const badge = stateBadge(offer);

  let email = "Not sent";
  if (offer.send) {
    const p = progress.data;
    const total = p ? p.queued + p.sent + p.failed + Object.values(p.skipped).reduce((a, b) => a + b, 0) : null;
    if (offer.send.paused) email = p && total !== null ? `Paused · ${formatCount(p.sent)} of ${formatCount(total)}` : "Paused";
    else if (!p || total === null) email = "Sending";
    else if (p.queued > 0) email = `Sending · ${formatCount(p.sent)} of ${formatCount(total)}`;
    else email = `Sent to ${formatCount(p.sent)}`;
  }

  return (
    <tr
      onClick={onChoose}
      className={cn("cursor-pointer", !first && "border-t border-border", open ? "bg-muted/60" : "hover:bg-muted/40")}
    >
      <td className="px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onChoose}
          aria-current={open ? "true" : undefined}
          className="flex items-center gap-2 rounded-[4px] text-left font-medium text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Icon size={16} className="shrink-0 text-faint" aria-hidden="true" />
          {offer.name}
        </button>
      </td>
      <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
        {offer.percentOff}% off {planWords(offer)}
      </td>
      <td className="hidden px-3 py-3 text-muted-foreground xl:table-cell">
        {formatOfferDay(start.date)} {start.time} → {formatOfferDay(offer.lastDay)}, each person&apos;s midnight
      </td>
      <td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">{email}</td>
      <td className="px-4 py-3 text-right sm:px-5">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </td>
    </tr>
  );
}

/* ── Saving ───────────────────────────────────────────────────────────────── */

/**
 * Saves part of an offer. The route takes the whole offer, so what is not changing goes as it is; the words go too
 * until they are locked (the server keeps them as sent after that). Throws the server's refusal for the caller.
 */
function useSaveOffer() {
  const queryClient = useQueryClient();
  return useCallback(
    async (offer: AdminOffer, change: Partial<OfferChange>) => {
      const body: OfferChange = {
        template: offer.template,
        name: offer.name,
        percentOff: offer.percentOff,
        includesMonthly: offer.includesMonthly,
        includesYearly: offer.includesYearly,
        startsAtUtc: offer.startsAtUtc,
        lastDay: offer.lastDay,
        ...(offer.wordsLocked ? {} : { words: offer.words }),
        ...change,
      };
      const next = await updateOffer(offer.id, body);
      if (next && typeof next === "object" && "id" in next) {
        queryClient.setQueryData<AdminOffer[]>(OFFERS_KEY, (all) => all?.map((o) => (o.id === next.id ? next : o)));
      }
      void queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
      // The email's prices and words, and the estimate's days, all follow the offer.
      void queryClient.invalidateQueries({ queryKey: offerKeys.preview(offer.id) });
      void queryClient.invalidateQueries({ queryKey: offerKeys.audience(offer.id) });
    },
    [queryClient],
  );
}

/* ── The offer: template, price, when, where ──────────────────────────────── */

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 text-xs font-medium text-faint">{children}</p>;
}

function Section({ children }: { children: ReactNode }) {
  return <div className="border-t border-border px-4 py-4 sm:px-5">{children}</div>;
}

/** A note under a section: why a control can't move. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2.5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Lock size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
      {children}
    </p>
  );
}

/** The email's header as a template tile: the art over the dark header, the wordmark and the offer's line. */
function TemplateTile({
  template,
  on,
  disabled,
  onPick,
  under,
}: {
  template: OfferTemplate;
  on: boolean;
  disabled?: boolean;
  onPick: () => void;
  /** A second line under the name (the new-offer dialog's dates). */
  under?: string;
}) {
  const look = lookOf(template);
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "w-full rounded-[10px] border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-[214px]",
        on ? "border-brand ring-1 ring-brand" : "border-border hover:border-faint",
        disabled && !on && "opacity-60 hover:border-border",
        disabled && "cursor-default",
      )}
    >
      <span
        className="flex h-[104px] flex-col items-center justify-center rounded-[7px]"
        style={{
          backgroundColor: "#0E121A",
          backgroundImage: `radial-gradient(120% 90% at 50% 112%, ${look.tint} 0%, transparent 60%), linear-gradient(180deg,#07090E 0%,#151A24 100%)`,
        }}
      >
        {look.art ? (
          <img src={look.art} alt="" width={140} height={60} className="h-[60px] w-[140px]" />
        ) : (
          <TicketPercent size={28} className="mb-2 text-white/70" aria-hidden="true" />
        )}
        <span className="mt-0.5 text-[13px] font-bold leading-none tracking-[-0.3px] text-white">NoteFusion</span>
        <span className="mt-1 text-[9.5px] font-medium" style={{ color: look.lineColor }}>
          {look.label.charAt(0).toUpperCase() + look.label.slice(1)}
        </span>
      </span>
      <span className="flex items-center justify-between px-1.5 pb-0.5 pt-2 text-[13px] font-medium text-foreground">
        <span className="min-w-0">
          {look.name}
          {under && <span className="block text-xs font-normal text-muted-foreground">{under}</span>}
        </span>
        {on && <Check size={15} className="shrink-0 text-brand" aria-hidden="true" />}
      </span>
    </button>
  );
}

/**
 * A date or a time as the console writes it, over the browser's own picker: the native input covers the pill
 * invisibly and opens its picker on a click (Feature flags' date field, with a time beside it).
 */
function PickerPill({
  type,
  label,
  value,
  shown,
  icon: Icon,
  min,
  disabled,
  onChange,
}: {
  type: "date" | "time";
  label: string;
  value: string;
  shown: string;
  icon: LucideIcon;
  min?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] border border-border bg-input/40 px-2.5 text-[13px] text-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-60",
      )}
    >
      <Icon size={14} className="text-faint" aria-hidden="true" />
      {shown}
      <input
        ref={input}
        type={type}
        aria-label={label}
        value={value}
        min={min}
        step={type === "time" ? 60 : undefined}
        disabled={disabled}
        onClick={() => input.current?.showPicker?.()}
        onChange={(event) => {
          if (event.target.value && event.target.value !== value) onChange(event.target.value);
        }}
        className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}

const WHERE: { icon: LucideIcon; title: string; detail: string }[] = [
  {
    icon: Monitor,
    title: "Web app",
    detail: "A banner on Home with the countdown, and the offer prices in the plans. The banner is for free and lapsed accounts on dollar prices; never for a Pro member.",
  },
  { icon: Globe, title: "Website pricing", detail: "The Pro cards show the offer price and the countdown to visitors on dollar prices." },
  { icon: Mail, title: "The email", detail: "Sent once, to the people below, when you press Send." },
  { icon: Smartphone, title: "Not the phone app", detail: "Its prices come from Google Play. The email's link opens the web app." },
];

const INTERVALS: { interval: OfferInterval; name: string; field: "includesMonthly" | "includesYearly" }[] = [
  { interval: "Monthly", name: "Pro Monthly", field: "includesMonthly" },
  { interval: "Yearly", name: "Pro Yearly", field: "includesYearly" },
];

function OfferCard({ offer, onConfirm }: { offer: AdminOffer; onConfirm: (request: ConfirmRequest) => void }) {
  const queryClient = useQueryClient();
  const save = useSaveOffer();
  const templates = useQuery({ queryKey: ["offer-templates"], queryFn: ({ signal }) => getOfferTemplates(signal), staleTime: 300_000 });
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(String(offer.percentOff));
  const headingId = useId();
  const percentId = useId();

  useEffect(() => setPercent(String(offer.percentOff)), [offer.percentOff]);

  const look = lookOf(offer.template);
  const Icon = look.icon;
  const start = startOf(offer);
  const started = offer.state === "running" || offer.state === "ended";
  const ended = offer.state === "ended";
  const pill = STATE_PILL[offer.state];
  const ends = endsAcrossTheWorld(offer.lastDay);
  const offset = getReportingOffset();

  async function quiet(change: Partial<OfferChange>, done: string) {
    setBusy(true);
    try {
      await save(offer, change);
      toast.success(done);
    } catch (caught) {
      toastOfferError(caught, "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function commitPercent() {
    const n = Number(percent.trim());
    if (!Number.isInteger(n) || n < 5 || n > 70) {
      toast.error("Percent off is a whole number from 5 to 70.");
      setPercent(String(offer.percentOff));
      return;
    }
    if (n !== offer.percentOff) void quiet({ percentOff: n }, `${n}% off saved`);
  }

  function pickTemplate(template: OfferTemplate) {
    if (template === offer.template) return;
    // Words still as the old template wrote them follow the new one; words of the admin's own stay.
    const was = templates.data?.find((t) => t.template === offer.template);
    const next = templates.data?.find((t) => t.template === template);
    const untouched = was !== undefined && sameWords(was.words, offer.words);
    const swap = !offer.wordsLocked && untouched && next !== undefined;
    void quiet(
      { template, ...(swap ? { words: next.words } : {}) },
      swap ? `${lookOf(template).name}: its header and words` : `${lookOf(template).name}: its header; your words are kept`,
    );
  }

  function askToSwitch(on: boolean) {
    const plans = planWords(offer);
    const startsLater = new Date(offer.startsAtUtc).getTime() > Date.now();
    onConfirm(
      on
        ? {
            title: `Turn on the ${look.label}?`,
            body: (
              <>
                <p>
                  {startsLater ? `From ${formatOfferDay(start.date)}, ${start.time} UK time,` : "From now,"} people on dollar prices
                  see {offer.percentOff}% off {plans} on the web app and the website&apos;s pricing, until midnight at the end of{" "}
                  {formatOfferDayWords(offer.lastDay)} in their own time.
                </p>
                <p>The email goes only when you press Send. Naira prices and the phone app are never in an offer.</p>
              </>
            ),
            confirmLabel: "Turn on",
            confirmIdentity: true,
            onConfirm: async () => {
              try {
                await setOfferEnabled(offer.id, true);
              } catch (caught) {
                throw offerError(caught, "The offer couldn't be turned on. Try again.");
              }
              await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
              toast.success(startsLater ? `The ${look.label} starts ${formatOfferDay(start.date)}, ${start.time} UK time` : `The ${look.label} is on`);
            },
          }
        : {
            title: `Turn off the ${look.label}?`,
            body: (
              <>
                <p>
                  The banner and the offer prices leave the web app and the website on their next load. A checkout already
                  opened keeps its price for an hour.
                </p>
                {offer.send && !offer.send.paused && <p>If its email is still going out, pause sending as well.</p>}
              </>
            ),
            confirmLabel: "Turn off",
            confirmIdentity: true,
            onConfirm: async () => {
              try {
                await setOfferEnabled(offer.id, false);
              } catch (caught) {
                throw offerError(caught, "The offer couldn't be turned off. Try again.");
              }
              await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
              toast.success(`The ${look.label} is off`);
            },
          },
    );
  }

  const switchText = !offer.enabled
    ? "Off"
    : offer.state === "running"
      ? "On"
      : offer.state === "ended"
        ? "Ended"
        : `On from ${formatOfferDay(start.date)}`;

  return (
    <section className="nf-panel overflow-hidden" aria-labelledby={headingId}>
      <header className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <Icon size={16} className="text-faint" aria-hidden="true" />
            {offer.name}
            <Badge tone={pill.tone}>{pill.label}</Badge>
          </h2>
          <p className="mt-1 max-w-[560px] text-xs leading-relaxed text-muted-foreground">
            {offer.percentOff}% off Pro on the web app from {formatOfferDay(start.date)} until midnight on{" "}
            {formatOfferDay(offer.lastDay)}, in each person&apos;s own time.
          </p>
          {offer.enabled && !offer.seasonOn && offer.state !== "ended" ? (
            <p className="mt-2 flex max-w-[560px] items-start gap-1.5 text-xs leading-relaxed text-warning">
              <Info size={13} className="mt-[2px] shrink-0" aria-hidden="true" />
              <span>
                Hidden while the {lookOf(offer.template).name} season is off: no banner, no offer prices, and its email
                waits.{" "}
                <Link href="/flags" className="text-brand hover:underline">
                  Feature flags
                </Link>
              </span>
            </p>
          ) : null}
        </div>
        <label className="flex shrink-0 items-center gap-2.5 text-[13px] font-medium text-foreground">
          {/* A phone-width console keeps the name its room: the switch alone says it there. */}
          <span className="hidden sm:inline">{switchText}</span>
          <Switch
            checked={offer.enabled}
            disabled={busy || (ended && !offer.enabled)}
            onCheckedChange={(next) => askToSwitch(next)}
            aria-label={`${offer.name}: ${switchText.toLowerCase()}`}
          />
        </label>
      </header>

      <Section>
        <SectionLabel>Template</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          {TEMPLATE_ORDER.map((template) => (
            <TemplateTile
              key={template}
              template={template}
              on={offer.template === template}
              disabled={busy || started}
              onPick={() => pickTemplate(template)}
            />
          ))}
        </div>
        <p className="mt-2.5 max-w-[620px] text-xs leading-relaxed text-muted-foreground">
          The template is the email&apos;s header and words, and the tint of the banner and the price tags. The price, the dates
          and who gets it belong to the offer.
        </p>
      </Section>

      <Section>
        <SectionLabel>Price</SectionLabel>
        <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-foreground">
          <label htmlFor={percentId} className="w-[92px]">
            Percent off
          </label>
          <span className="relative">
            <Input
              id={percentId}
              inputMode="numeric"
              value={percent}
              disabled={busy || started}
              onChange={(event) => setPercent(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              onBlur={commitPercent}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-8 w-[76px] pr-7 text-base tabular-nums md:text-[13px]"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-faint">%</span>
          </span>
          <span className="text-xs text-muted-foreground">Rounded down to each plan&apos;s own ending, so every price is at least this much off.</span>
        </div>

        <div className="overflow-hidden rounded-[8px] border border-border">
          <div className="hidden grid-cols-[28px_minmax(0,1fr)_140px_140px] items-center gap-2 bg-muted/50 px-3 py-2 text-[11.5px] font-medium text-faint sm:grid">
            <span />
            <span>Plan</span>
            <span>Standard dollars</span>
            <span>Regional dollars</span>
          </div>
          {INTERVALS.map(({ interval, name, field }, index) => {
            const included = offer[field];
            const std = priceOf(offer, interval, "standard");
            const reg = priceOf(offer, interval, "regional");
            const cell = (plan: typeof std) => (plan ? `${formatPrice(plan.amountMinor)} → ${formatPrice(plan.offerAmountMinor)}` : "—");
            const priced = std !== null || reg !== null;
            const checkboxId = `${percentId}-${interval}`;
            return (
              <div
                key={interval}
                className={cn(
                  "grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 px-3 py-2.5 text-[13px] sm:grid-cols-[28px_minmax(0,1fr)_140px_140px]",
                  index > 0 && "border-t border-border",
                  "sm:border-t sm:border-border",
                )}
              >
                <Checkbox
                  id={checkboxId}
                  checked={included}
                  disabled={busy || started}
                  onCheckedChange={(next) => {
                    const on = next === true;
                    const other = field === "includesMonthly" ? offer.includesYearly : offer.includesMonthly;
                    if (!on && !other) {
                      toast.error("An offer needs Pro Monthly, Pro Yearly or both.");
                      return;
                    }
                    void quiet(field === "includesMonthly" ? { includesMonthly: on } : { includesYearly: on }, on ? `${name} is in the offer` : `${name} is out of the offer`);
                  }}
                />
                <label htmlFor={checkboxId} className={cn("font-medium", included ? "text-foreground" : "text-muted-foreground")}>
                  {name}
                </label>
                {included || priced ? (
                  <>
                    <span className={cn("hidden tabular-nums sm:block", included ? "text-foreground" : "text-faint")}>{cell(std)}</span>
                    <span className={cn("hidden tabular-nums sm:block", included ? "text-muted-foreground" : "text-faint")}>{cell(reg)}</span>
                    <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:hidden">
                      {cell(std)} · regional {cell(reg)}
                    </span>
                  </>
                ) : (
                  <span className="col-start-2 text-xs text-faint sm:col-span-2 sm:col-start-3">Not in this offer</span>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 border-t border-border px-3 py-2.5 text-[13px] sm:grid-cols-[28px_minmax(0,1fr)_280px]">
            <Checkbox checked={false} disabled aria-label="Choir plans and one song: never in an offer" />
            <span className="text-muted-foreground">Choir plans and one song</span>
            <span className="col-start-2 text-xs text-faint sm:col-start-3">Never in an offer</span>
          </div>
        </div>
        <p className="mt-2.5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info size={14} className="mt-px shrink-0 text-faint" aria-hidden="true" />
          Naira prices (Nigeria, paid through Paystack) are never part of an offer. Each person sees their own set; checkout is
          Bachs&apos; page, in dollars, one payment for one period as always.
        </p>
        {started && <Locked>The price and the plans are fixed once the offer has started.</Locked>}
      </Section>

      <Section>
        <SectionLabel>When</SectionLabel>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-8">
          <div className="flex items-start gap-2.5 text-[13px] text-foreground">
            <span className="w-[60px] shrink-0 leading-8">Starts</span>
            <div className="flex flex-wrap gap-2.5">
              <PickerPill
                type="date"
                label="The day it starts (UK)"
                value={start.date}
                shown={formatOfferDayYear(start.date)}
                icon={Calendar}
                disabled={busy || started}
                onChange={(day) => {
                  if (day > offer.lastDay) {
                    toast.error("It can't start after its last day. Move the last day first.");
                    return;
                  }
                  void quiet({ startsAtUtc: wallToUtc(day, start.time) }, `Starts ${formatOfferDay(day)}, ${start.time} UK time`);
                }}
              />
              <PickerPill
                type="time"
                label="The time it starts, UK time"
                value={start.time}
                shown={`${start.time} UK time`}
                icon={Clock}
                disabled={busy || started}
                onChange={(time) =>
                  void quiet({ startsAtUtc: wallToUtc(start.date, time) }, `Starts ${formatOfferDay(start.date)}, ${time} UK time`)
                }
              />
            </div>
          </div>
          <div className="flex items-start gap-2.5 text-[13px] text-foreground">
            <span className="w-[60px] shrink-0 leading-8">Last day</span>
            <div className="flex flex-wrap gap-2.5">
              <PickerPill
                type="date"
                label="Its last day"
                value={offer.lastDay}
                shown={formatOfferDayYear(offer.lastDay)}
                icon={Calendar}
                min={started ? offer.lastDay : start.date}
                disabled={busy || ended}
                onChange={(day) => {
                  if (day < (started ? offer.lastDay : start.date)) {
                    toast.error(started ? "Once it has started, the last day can only move later." : "The last day can't be before it starts.");
                    return;
                  }
                  void quiet({ lastDay: day }, `Its last day is ${formatOfferDay(day)}`);
                }}
              />
              <span className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[8px] border border-dashed border-border px-2.5 text-[13px] text-muted-foreground">
                <Moon size={14} className="text-faint" aria-hidden="true" />
                to midnight, their time
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 max-w-[640px] text-xs leading-relaxed text-muted-foreground">
          It ends at midnight at the end of {formatOfferDayWords(offer.lastDay)} wherever each person is, UK time when the account
          has no time zone: New Zealand first ({ends.first.time} UK time on {weekdayOf(ends.first.date)}), Hawaii last (
          {ends.last.time} on {weekdayOf(ends.last.date)}). A checkout opened before someone&apos;s end keeps the offer price for
          an hour.
        </p>
        {started && !ended && <Locked>Once it has started, only the last day can move, and only later.</Locked>}
      </Section>

      <Section>
        <SectionLabel>Where it shows</SectionLabel>
        <ul className="grid gap-x-7 sm:grid-cols-2">
          {WHERE.map(({ icon: ItemIcon, title, detail }) => (
            <li key={title} className="flex items-start gap-2.5 py-[7px] text-[13px] leading-[1.45] text-foreground">
              <ItemIcon size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
              <span>
                {title}
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <ScrollText size={14} className="shrink-0 text-faint" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          Created by {offer.createdBy ?? "an admin"}, {formatInstantDateTime(offer.createdAtUtc, offset)}. Every change, the send
          included, goes in the Audit Log.
        </span>
        <Link href="/audit-log" className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">
          Audit Log
          <ExternalLink size={12} aria-hidden="true" />
        </Link>
      </footer>
    </section>
  );
}

const sameWords = (a: OfferWords, b: OfferWords) =>
  a.subject === b.subject && a.preheader === b.preheader && a.headline === b.headline && a.body === b.body;

/* ── The email's words ────────────────────────────────────────────────────── */

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 py-1.5 sm:grid-cols-[110px_minmax(0,1fr)] sm:items-start sm:gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[13px] text-foreground sm:pt-1.5">
          {label}
        </label>
      ) : (
        <span className="text-[13px] text-foreground sm:pt-1.5">{label}</span>
      )}
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

const LIMITS: Record<keyof OfferWords, number> = { subject: 120, preheader: 200, headline: 120, body: 1200 };

function EmailCard({ offer, onDirty }: { offer: AdminOffer; onDirty: (dirty: boolean) => void }) {
  const save = useSaveOffer();
  const [draft, setDraft] = useState<OfferWords>(offer.words);
  const [saving, setSaving] = useState(false);
  const ids = { subject: useId(), preheader: useId(), headline: useId(), body: useId() };
  const dirty = !sameWords(draft, offer.words);
  const locked = offer.wordsLocked;

  // The saved words change under a clean form (a save, another tab): follow them.
  useEffect(() => {
    if (!dirty) setDraft(offer.words);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.words]);
  useEffect(() => onDirty(dirty && !locked), [dirty, locked, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const set = (key: keyof OfferWords) => (value: string) => setDraft((words) => ({ ...words, [key]: value }));

  async function onSave() {
    const empty = (Object.keys(LIMITS) as (keyof OfferWords)[]).find((key) => !draft[key].trim());
    if (empty) {
      toast.error("Every line of the email needs words: subject, preview line, headline and paragraphs.");
      return;
    }
    setSaving(true);
    try {
      await save(offer, { words: { ...draft } });
      toast.success("The email's words are saved");
    } catch (caught) {
      toastOfferError(caught, "The words didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const sentOn = offer.send ? formatOfferDay(zoneWall(offer.send.startedAtUtc).date) : null;
  const button = `Get ${offer.percentOff}% off Pro`;

  return (
    <Card
      title="The email"
      hint={
        locked
          ? `Sent${sentOn ? ` from ${sentOn}` : ""}: the words are kept as they went out.`
          : "From NoteFusion <hello@notefusion.studio>; replies come to hello@. The template's words, each one yours to change."
      }
      action={
        locked ? (
          <Badge>Locked</Badge>
        ) : dirty ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(offer.words)} disabled={saving}>
              Discard
            </Button>
            <Button size="sm" onClick={() => void onSave()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save words
            </Button>
          </div>
        ) : undefined
      }
    >
      <Field label="Subject" htmlFor={ids.subject} hint={`Write {pct} for the percent off; it follows the price (${fillPercent("{pct}%", offer.percentOff)} now).`}>
        <Input
          id={ids.subject}
          value={draft.subject}
          maxLength={LIMITS.subject}
          disabled={locked}
          onChange={(event) => set("subject")(event.target.value)}
          className="h-8 text-base md:text-[13px]"
        />
      </Field>
      <Field label="Preview line" htmlFor={ids.preheader} hint="What the inbox shows beside the subject.">
        <Input
          id={ids.preheader}
          value={draft.preheader}
          maxLength={LIMITS.preheader}
          disabled={locked}
          onChange={(event) => set("preheader")(event.target.value)}
          className="h-8 text-base md:text-[13px]"
        />
      </Field>
      <Field label="Headline" htmlFor={ids.headline}>
        <Input
          id={ids.headline}
          value={draft.headline}
          maxLength={LIMITS.headline}
          disabled={locked}
          onChange={(event) => set("headline")(event.target.value)}
          className="h-8 text-base md:text-[13px]"
        />
      </Field>
      <Field
        label="Paragraphs"
        htmlFor={ids.body}
        hint={'A blank line starts a new paragraph. "Hello Grace," goes above them, with each person\'s first name ("Hello," when we have none).'}
      >
        <Textarea
          id={ids.body}
          value={draft.body}
          maxLength={LIMITS.body}
          disabled={locked}
          rows={5}
          onChange={(event) => set("body")(event.target.value)}
          className="min-h-0 resize-y text-base leading-relaxed md:text-[13px]"
        />
      </Field>
      <Field label="Button">
        <div className="flex flex-wrap items-center gap-2 text-[13px] sm:pt-0.5">
          <span className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground">
            {button}
          </span>
          <ArrowRight size={14} className="text-faint" aria-hidden="true" />
          <span className="break-all text-muted-foreground">notefusion.studio/app?offer={offer.key}</span>
        </div>
      </Field>
      <Field
        label="Also in it"
        hint="The offer's prices in each person's set, four things Pro gives, the end in their own time, why they got it and one-click unsubscribe."
      >
        <span className="block text-[13px] text-muted-foreground sm:pt-1.5">Fixed by the template</span>
      </Field>
    </Card>
  );
}

/* ── New offer ────────────────────────────────────────────────────────────── */

function NewOfferDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["offer-templates"],
    queryFn: ({ signal }) => getOfferTemplates(signal),
    enabled: open,
    staleTime: 300_000,
  });
  const [template, setTemplate] = useState<OfferTemplate | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const nameId = useId();

  useEffect(() => {
    if (open) {
      setTemplate(null);
      setName("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  const list = templates.data ?? [];
  const chosen: OfferTemplateDefaults | undefined = list.find((t) => t.template === template) ?? list[0];

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || pending) return;
    setPending(true);
    setError(null);
    const title = name.trim() || chosen.name;
    try {
      const created = await createOffer({
        template: chosen.template,
        name: title,
        percentOff: chosen.percentOff,
        includesMonthly: true,
        includesYearly: true,
        startsAtUtc: chosen.startsAtUtc,
        lastDay: chosen.lastDay,
      });
      await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
      if (created && typeof created === "object" && "id" in created) onCreated(created.id);
      toast.success(`${title} is drafted`, { description: "It stays off until you turn it on." });
      onClose();
    } catch (caught) {
      setError(offerError(caught, "The offer couldn't be created. Try again."));
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent className="bg-popover sm:max-w-[520px]">
        <AlertDialogTitle>New offer</AlertDialogTitle>
        <AlertDialogDescription className="text-[13px] leading-relaxed">
          Start from a template: its header, its words and its usual dates, at 30% off Pro Monthly and Yearly. Everything can
          change before it starts, and it stays off until you turn it on.
        </AlertDialogDescription>
        <form onSubmit={create} className="space-y-4">
          {templates.isPending ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Reading the templates…
            </p>
          ) : templates.error ? (
            <p className="text-[13px] text-danger-deep" role="alert">
              {offerError(templates.error, "The templates couldn't be read. Try again.").message}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Template">
              {list.map((t) => (
                <TemplateTile
                  key={t.template}
                  template={t.template}
                  on={chosen?.template === t.template}
                  onPick={() => {
                    setTemplate(t.template);
                    setName("");
                  }}
                  under={`${formatOfferDay(zoneWall(t.startsAtUtc).date)} → ${formatOfferDayYear(t.lastDay)}`}
                />
              ))}
            </div>
          )}

          {chosen && (
            <div>
              <Label htmlFor={nameId} className="text-xs text-muted-foreground">
                Name (yours; people see &ldquo;{lookOf(chosen.template).label}&rdquo;)
              </Label>
              <Input
                id={nameId}
                value={name}
                placeholder={chosen.name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 text-base md:text-[13px]"
              />
            </div>
          )}

          {error && (
            <p className="rounded-sm bg-danger/10 px-3 py-2 text-[12.5px] text-danger-deep" role="alert">
              {error.message}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={!chosen || pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Create draft
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
