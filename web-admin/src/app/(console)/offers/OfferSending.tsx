"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  getOfferAudience,
  sendOffer,
  type AdminOffer,
  type OfferAudience,
  type OfferAudienceChoice,
} from "@/api/offers";
import { Card } from "@/components/Card";
import type { ConfirmRequest } from "@/components/ConfirmDialog";
import { StatCard } from "@/components/StatCard";
import { ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCount } from "@/lib/format";
import {
  formatOfferDay,
  sendingDays,
  ukToday,
  weekdayOf,
  type SendingDay,
} from "@/lib/offers";
import { cn } from "@/lib/utils";

import { OFFERS_KEY, lookOf, offerError, offerKeys, people, setPrices, startOf } from "./offerLook";


const GROUPS: { key: keyof OfferAudienceChoice; name: string; detail: string }[] = [
  { key: "free", name: "Free accounts", detail: "Have never paid" },
  { key: "lapsed", name: "Lapsed Pro", detail: "Had Pro; it has ended" },
  { key: "proNow", name: "Pro now", detail: "Paid on the web; they could add time at the offer price" },
];

const NEVER: { key: keyof OfferAudience["excluded"]; label: string }[] = [
  { key: "naira", label: "Priced in naira (Nigeria)" },
  { key: "noCountry", label: "No country on the account" },
  { key: "emailOff", label: "Turned email off" },
  { key: "storeOrChoir", label: "Pro through Google Play or a choir" },
  { key: "recentNote", label: "A note from the founder in the last 7 days" },
];

/**
 * Who gets it and Sending (board P6b), before the email is sent: the groups to tick (re-counted as they change),
 * who is never sent it, the email quota as it stands and what it means for this many people, and Send.
 */
export function OfferSendCards({
  offer,
  wordsDirty,
  onConfirm,
}: {
  offer: AdminOffer;
  wordsDirty: boolean;
  onConfirm: (request: ConfirmRequest) => void;
}) {
  const [choice, setChoice] = useState<OfferAudienceChoice>({ free: true, lapsed: true, proNow: false });
  const audience = useQuery({
    queryKey: [...offerKeys.audience(offer.id), choice],
    queryFn: ({ signal }) => getOfferAudience(offer.id, choice, signal),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === offer.id ? previous : undefined),
  });

  return (
    <>
      <Card title="Who gets it" hint="Accounts with an email address, email from us switched on, on dollar prices.">
        {audience.error && !audience.data ? (
          <ErrorView error={offerError(audience.error, "Who gets it couldn't be counted. Try again.")} onRetry={() => void audience.refetch()} retrying={audience.isFetching} />
        ) : !audience.data ? (
          <LoadingView label="Counting" />
        ) : (
          <Audience offer={offer} audience={audience.data} choice={choice} onChoice={setChoice} counting={audience.isPlaceholderData} />
        )}
      </Card>
      <Card
        title="Sending"
        hint="The offer is optional mail: it waits whenever a window reaches its optional line, so codes, resets and receipts always go."
      >
        {audience.data ? (
          <Sending offer={offer} audience={audience.data} choice={choice} wordsDirty={wordsDirty} counting={audience.isFetching} onConfirm={onConfirm} />
        ) : audience.error ? (
          <p className="text-[13px] text-muted-foreground">The quota shows once who gets it has been counted.</p>
        ) : (
          <LoadingView label="Reading the email quota" />
        )}
      </Card>
    </>
  );
}

function Audience({
  offer,
  audience,
  choice,
  onChoice,
  counting,
}: {
  offer: AdminOffer;
  audience: OfferAudience;
  choice: OfferAudienceChoice;
  onChoice: (choice: OfferAudienceChoice) => void;
  counting: boolean;
}) {
  const id = useId();
  const standard = setPrices(offer, "standard");
  const regional = setPrices(offer, "regional");
  const order = ["lapsed Pro first", "then free accounts by how recently they used NoteFusion", ...(choice.proNow ? ["then Pro now"] : [])];

  return (
    <>
      <div className={cn("overflow-hidden rounded-[8px] border border-border transition-opacity", counting && "opacity-70")} aria-busy={counting}>
        {GROUPS.map(({ key, name, detail }, index) => {
          const on = choice[key];
          return (
            <div key={key} className={cn("flex items-center gap-3.5 px-3.5 py-3", index > 0 && "border-t border-border")}>
              <Checkbox id={`${id}-${key}`} checked={on} onCheckedChange={(next) => onChoice({ ...choice, [key]: next === true })} />
              <label htmlFor={`${id}-${key}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-[13px] font-medium text-foreground">{name}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </label>
              <span className={cn("text-[15px] font-semibold tabular-nums", on ? "text-foreground" : "text-faint")}>
                {formatCount(audience.groups[key])}
              </span>
            </div>
          );
        })}
        <div className="border-t border-border bg-muted/50 px-3.5 py-3" aria-live="polite">
          <p className="text-[13px] font-semibold text-foreground">
            {formatCount(audience.total)} {people(audience.total)}
          </p>
          {audience.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {formatCount(audience.bySet.standard)} see standard prices{standard ? ` (${standard})` : ""} and{" "}
              {formatCount(audience.bySet.regional)} regional{regional ? ` (${regional})` : ""}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        While the quota is tight they go in this order: {order.join(", ")}.
      </p>
      <div className="mt-4">
        <p className="mb-2.5 text-xs font-medium text-faint">Never sent it</p>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          {NEVER.map(({ key, label }) => (
            <div key={key} className="flex justify-between gap-4 border-t border-border py-[7px] text-[12.5px]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums text-muted-foreground">{formatCount(audience.excluded[key])}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Nor unverified addresses, or suspended and deleted accounts.</p>
      </div>
    </>
  );
}

function Note({ tone = "muted", icon, children }: { tone?: "muted" | "warning"; icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[8px] px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground",
        tone === "warning" ? "border border-warning/30 bg-warning/[0.07]" : "bg-muted",
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Sending({
  offer,
  audience,
  choice,
  wordsDirty,
  counting,
  onConfirm,
}: {
  offer: AdminOffer;
  audience: OfferAudience;
  choice: OfferAudienceChoice;
  wordsDirty: boolean;
  counting: boolean;
  onConfirm: (request: ConfirmRequest) => void;
}) {
  const queryClient = useQueryClient();
  const { quota, estimate, total } = audience;
  const look = lookOf(offer.template);
  const today = ukToday();
  const startDay = startOf(offer).date;
  const { days, waiting } = sendingDays({
    today,
    startDay,
    lastDay: offer.lastDay,
    total,
    reached: estimate.reachedBeforeEnd,
    roomToday: quota.roomToday,
    perDay: quota.perDay,
  });
  const reached = Math.min(total, estimate.reachedBeforeEnd);
  const allInTime = reached >= total;
  const firstDay = days[0]?.date ?? today;
  const lastSendingDay = [...days].reverse().find((day) => day.count > 0)?.date ?? null;
  const dailyLimit = quota.dailyLimit ?? null;
  const dailyLine = quota.dailyOptionalLine ?? null;
  const monthlyLimit = quota.monthlyLimit ?? null;
  const monthlyLine = quota.monthlyOptionalLine ?? null;
  const ended = offer.state === "ended";

  const blocked = !offer.postalAddressSet
    ? "Set Email__PostalAddress first."
    : ended
      ? "The offer has ended."
      : !offer.enabled
        ? "Turn the offer on first: the email only goes for an offer that's on."
        : total === 0
          ? "Nobody is ticked."
          : wordsDirty
            ? "Save the email's words first."
            : null;

  function askToSend() {
    const n = total;
    onConfirm({
      title: `Send the ${look.label} to ${formatCount(n)} ${people(n)}?`,
      body: (
        <>
          <p>
            {allInTime
              ? `At today's limits about ${formatCount(quota.perDay)} go out a day, between 09:00 and 19:00 in each person's own time: everyone${
                  lastSendingDay ? ` by ${formatOfferDay(lastSendingDay)}` : ""
                }, before the offer ends.`
              : `At today's limits about ${formatCount(quota.perDay)} go out a day, between 09:00 and 19:00 in each person's own time: about ${formatCount(
                  reached,
                )} ${people(reached)} before the offer ends on ${weekdayOf(offer.lastDay)}.`}{" "}
            Nobody is sent it once it has ended for them.
          </p>
          <p>
            Anyone who buys, turns email off or becomes Pro before their turn is skipped. You can pause sending here. The words
            are locked once it is sent.
          </p>
        </>
      ),
      confirmLabel: `Send to ${formatCount(n)} ${people(n)}`,
      confirmIdentity: true,
      onConfirm: async () => {
        try {
          await sendOffer(offer.id, choice);
        } catch (caught) {
          throw offerError(caught, "The email couldn't be sent. Try again.");
        }
        await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
        void queryClient.invalidateQueries({ queryKey: offerKeys.progress(offer.id) });
        toast.success(`Sending the ${look.label} to ${formatCount(n)} ${people(n)}`, {
          description: "Each goes out from 09:00 in the person's own time. You can pause it here.",
        });
      },
    });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {dailyLimit !== null && dailyLine !== null ? (
          <QuotaTile label="Last 24 hours" used={quota.dailyUsed} limit={dailyLimit} line={dailyLine} />
        ) : (
          <StatCard label="Last 24 hours" value={formatCount(quota.dailyUsed)} sub="No daily limit" tone="neutral" />
        )}
        {monthlyLimit !== null && monthlyLine !== null ? (
          <QuotaTile label="Last 31 days" used={quota.monthlyUsed} limit={monthlyLimit} line={monthlyLine} />
        ) : (
          <StatCard label="Last 31 days" value={formatCount(quota.monthlyUsed)} sub="No 31-day limit" tone="neutral" />
        )}
      </div>

      {total > 0 && (
        <div
          className={cn(
            "mt-4 rounded-[8px] border px-4 py-3.5 transition-opacity",
            allInTime ? "border-border bg-muted/40" : "border-warning/30 bg-warning/[0.07]",
            counting && "opacity-70",
          )}
        >
          <p className="flex items-start gap-2 text-[14px] font-semibold text-foreground">
            {!allInTime && <TriangleAlert size={15} className="mt-[3px] shrink-0 text-warning" aria-hidden="true" />}
            {formatCount(total)} {people(total)} →{" "}
            {estimate.days === null
              ? "none can go at today's limits"
              : `about ${formatCount(estimate.days)} ${estimate.days === 1 ? "day" : "days"} at today's limits`}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {quota.roomToday === quota.perDay
              ? `About ${formatCount(quota.perDay)} can go a day${dailyLine !== null ? `: the optional line of ${formatCount(dailyLine)}, less what the app has already sent in the last 24 hours` : ""}.`
              : `About ${formatCount(quota.roomToday)} can still go today${dailyLine !== null ? ` (the optional line of ${formatCount(dailyLine)}, less what the app has sent in the last 24 hours)` : ""}, then about ${formatCount(quota.perDay)} a day.`}{" "}
            {allInTime
              ? `Everyone should have it${lastSendingDay ? ` by ${formatOfferDay(lastSendingDay)}` : ""}, before the offer ends.`
              : `The offer runs ${days.length}${firstDay === startDay ? "" : " more"} ${days.length === 1 ? "day" : "days"}, so about ${formatCount(reached)} ${people(
                  reached,
                )} would get it in time; the other ${formatCount(total - reached)} would never be sent it.`}
          </p>
          {days.length > 0 && <DayBars days={days} waiting={waiting} today={today} />}
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Each email goes between 09:00 and 19:00 in the person&apos;s own time (UK time when unknown), so London and Los Angeles
        each get it in their morning.
      </p>

      {!offer.postalAddressSet && (
        <div className="mt-3">
          <Note tone="warning" icon={<TriangleAlert size={15} className="mt-[2px] shrink-0 text-warning" aria-hidden="true" />}>
            <p className="font-medium text-foreground">The footer needs the company&apos;s postal address.</p>
            <p className="mt-1">
              Offer emails end with the company&apos;s name and postal address, as US law (CAN-SPAM) asks of commercial email. Set{" "}
              <code className="text-[12px] text-foreground">Email__PostalAddress</code> on the server, on one line. Until then the
              preview and the test show &ldquo;[the company&apos;s postal address]&rdquo;, and Send stays off.
            </p>
          </Note>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={askToSend} disabled={blocked !== null || counting}>
          <Send aria-hidden="true" />
          Send to {formatCount(total)} {people(total)}
        </Button>
        <span className="text-xs text-muted-foreground">{blocked ?? "You'll confirm it's you first, as with a flag."}</span>
      </div>
    </>
  );
}

/** One quota window, as System Health's Email quota draws it. */
function QuotaTile({ label, used, limit, line }: { label: string; used: number; limit: number; line: number }) {
  const held = used >= line;
  return (
    <StatCard
      label={label}
      value={`${formatCount(used)} / ${formatCount(limit)}`}
      sub={held ? `Optional mail waiting (line at ${formatCount(line)})` : `Optional mail until ${formatCount(line)}`}
      tone={used >= limit ? "danger" : held ? "warning" : "success"}
      share={limit > 0 ? used / limit : null}
    />
  );
}

/** The per-day bar: how many go each sending day, and the people still waiting when it ends. */
function DayBars({ days, waiting, today }: { days: SendingDay[]; waiting: number; today: string }) {
  const many = days.length > 7;
  return (
    <div className="mt-3 flex items-end gap-1 sm:gap-1.5" role="img" aria-label={barsLabel(days, waiting)}>
      {days.map((day) => {
        const [weekday = "", date = ""] = formatOfferDay(day.date).split(" ");
        return (
          <div key={day.date} className="flex min-w-0 max-w-[54px] flex-1 flex-col items-center gap-1">
            <span className={cn("text-[11px] tabular-nums text-muted-foreground", many && "hidden sm:inline")}>
              {day.count > 0 ? formatCount(day.count) : "0"}
            </span>
            <span
              className={cn(
                "block h-[22px] w-full rounded-[4px]",
                day.count > 0 ? "bg-brand/70" : "border border-dashed border-faint/50",
              )}
            />
            <span className="whitespace-nowrap text-[10px] text-faint sm:text-[11px]">
              <span className={cn(many ? "hidden lg:inline" : "hidden sm:inline")}>{weekday} </span>
              {date}
              {day.date === today && <span className="sr-only"> (today)</span>}
            </span>
          </div>
        );
      })}
      {waiting > 0 && (
        <div className="ml-1 flex min-w-[72px] flex-[2] flex-col gap-1">
          <span className="truncate text-[11px] text-muted-foreground" title={`About ${formatCount(waiting)} still waiting when it ends`}>
            <span className={cn(many ? "hidden" : "hidden sm:inline")}>about </span>
            {formatCount(waiting)} <span className={cn(many ? "hidden" : "hidden sm:inline")}>still </span>waiting
            <span className={cn(many ? "hidden" : "hidden sm:inline")}> when it ends</span>
          </span>
          <span className="block h-[22px] w-full rounded-[4px] border border-dashed border-faint/50" />
          <span className="text-[10px] text-faint sm:text-[11px]">never sent</span>
        </div>
      )}
    </div>
  );
}

function barsLabel(days: SendingDay[], waiting: number): string {
  const sent = days.map((day) => `${formatOfferDay(day.date)}: ${day.count}`).join(", ");
  return waiting > 0 ? `${sent}; about ${waiting} still waiting when it ends.` : `${sent}.`;
}
