"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { getOfferAudience, getOfferProgress, setOfferSending, type AdminOffer, type OfferProgress } from "@/api/offers";
import { Card } from "@/components/Card";
import type { ConfirmRequest } from "@/components/ConfirmDialog";
import { ErrorView, LoadingView } from "@/components/StateView";
import { Button } from "@/components/ui/button";
import { formatCount, formatPercent } from "@/lib/format";
import { formatOfferDay, formatPrice, formatRevenue, ukToday, zoneWall } from "@/lib/offers";
import { cn } from "@/lib/utils";

import { OFFERS_KEY, lookOf, offerError, offerKeys, people } from "./offerLook";

/**
 * How it's going (board P6c), once the email is sent: queued, sent, opened (the email's 1×1 image, or a click),
 * clicked, bought and the revenue, then by day and by plan, and Pause/Resume. Read again every minute while it sends.
 */
export function OfferProgressCard({ offer, onConfirm }: { offer: AdminOffer; onConfirm: (request: ConfirmRequest) => void }) {
  const queryClient = useQueryClient();
  const send = offer.send!;
  const live = offer.state !== "ended";
  const progress = useQuery({
    queryKey: offerKeys.progress(offer.id),
    queryFn: ({ signal }) => getOfferProgress(offer.id, signal),
    refetchInterval: live && !send.paused ? 60_000 : false,
  });
  // The quota, for "sending up to 600 a day": the same read as before the send, for the groups it went to.
  const choice = { free: send.includesFree, lapsed: send.includesLapsed, proNow: send.includesProNow };
  const audience = useQuery({
    queryKey: [...offerKeys.audience(offer.id), choice],
    queryFn: ({ signal }) => getOfferAudience(offer.id, choice, signal),
    enabled: live && !send.paused && (progress.data?.queued ?? 0) > 0,
    staleTime: 60_000,
  });
  const look = lookOf(offer.template);
  const p = progress.data;
  const now = zoneWall(Date.now());

  let hint = `${formatOfferDay(now.date)}, ${now.time} UK time.`;
  if (!live) hint += " The offer has ended.";
  else if (send.paused) hint += " Paused: nothing more goes out until you resume.";
  else if (p && p.queued === 0) hint += " Every email has gone out or been skipped.";
  else if (audience.data) {
    const limit = audience.data.quota.dailyLimit;
    hint += ` Sending up to ${formatCount(audience.data.quota.perDay)} a day${limit !== null ? ` (daily limit ${formatCount(limit)})` : ""}.`;
  }

  function askToPause(paused: boolean) {
    const queued = p?.queued ?? 0;
    onConfirm(
      paused
        ? {
            title: `Pause sending the ${look.label}?`,
            body: (
              <p>
                The {formatCount(queued)} {people(queued)} still queued wait until you resume. Nobody is sent it after the offer
                ends for them, so a long pause means some never get it. The offer itself stays on.
              </p>
            ),
            confirmLabel: "Pause sending",
            onConfirm: async () => {
              try {
                await setOfferSending(offer.id, true);
              } catch (caught) {
                throw offerError(caught, "Sending couldn't be paused. Try again.");
              }
              await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
              toast.success("Sending is paused");
            },
          }
        : {
            title: `Resume sending the ${look.label}?`,
            body: (
              <p>
                The {formatCount(queued)} {people(queued)} still queued go out from 09:00 in their own time, as the email quota
                allows, until the offer ends for them.
              </p>
            ),
            confirmLabel: "Resume sending",
            onConfirm: async () => {
              try {
                await setOfferSending(offer.id, false);
              } catch (caught) {
                throw offerError(caught, "Sending couldn't be resumed. Try again.");
              }
              await queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
              void queryClient.invalidateQueries({ queryKey: offerKeys.progress(offer.id) });
              toast.success("Sending again");
            },
          },
    );
  }

  const canPause = live && p !== undefined && (send.paused || p.queued > 0);

  return (
    <Card
      title="How it's going"
      hint={hint}
      action={
        canPause ? (
          <Button variant="outline" size="sm" onClick={() => askToPause(!send.paused)}>
            {send.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {send.paused ? "Resume sending" : "Pause sending"}
          </Button>
        ) : undefined
      }
    >
      {progress.error && !p ? (
        <ErrorView
          error={offerError(progress.error, "How it's going couldn't be read. Try again.")}
          onRetry={() => void progress.refetch()}
          retrying={progress.isFetching}
        />
      ) : !p ? (
        <LoadingView label="Reading how it's going" />
      ) : (
        <Figures offer={offer} progress={p} paused={send.paused} />
      )}
    </Card>
  );
}

function Tile({ label, value, sub, dot }: { label: string; value: string; sub: string; dot: string }) {
  return (
    <div className="nf-panel min-w-0 p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        {label}
      </p>
      <p className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">{value}</p>
      <p className="mt-2 text-xs leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}

function Figures({ offer, progress: p, paused }: { offer: AdminOffer; progress: OfferProgress; paused: boolean }) {
  const skipped = p.skipped.optedOut + p.skipped.bought + p.skipped.becamePro + p.skipped.ended + p.skipped.noLongerEligible;
  const total = p.queued + p.sent + p.failed + skipped;
  const share = (n: number) => (p.sent > 0 ? formatPercent(n / p.sent) : "—");
  const others = Math.max(0, p.bought - p.boughtFromEmail);
  const today = ukToday();

  const skippedParts = [
    [p.skipped.bought, "bought first"],
    [p.skipped.becamePro, "became Pro"],
    [p.skipped.optedOut, "turned email off"],
    [p.skipped.ended, "the offer had ended for them"],
    [p.skipped.noLongerEligible, "no longer eligible"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, why]) => `${formatCount(n as number)} ${why}`);

  const unitPrice = (code: string, count: number, revenueMinor: number) => {
    const plan = offer.plans.find((row) => row.code === code);
    if (plan) return formatPrice(plan.offerAmountMinor);
    return count > 0 ? formatPrice(Math.round(revenueMinor / count)) : "—";
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label="Queued"
          value={formatCount(p.queued)}
          sub={paused ? "Held while sending is paused" : "Go out as each person's 09:00 comes round"}
          dot="bg-faint"
        />
        <Tile
          label="Sent"
          value={formatCount(p.sent)}
          sub={`of ${formatCount(total)}${p.failed > 0 ? ` · ${formatCount(p.failed)} failed` : ""}`}
          dot="bg-brand"
        />
        <Tile label="Opened" value={formatCount(p.opened)} sub={`${share(p.opened)} of sent`} dot="bg-brand" />
        <Tile label="Clicked" value={formatCount(p.clicked)} sub={`${share(p.clicked)} of sent`} dot="bg-brand" />
        <Tile
          label="Bought"
          value={formatCount(p.bought)}
          sub={`${formatCount(p.boughtFromEmail)} were emailed (${share(p.boughtFromEmail)} of sent)`}
          dot="bg-success"
        />
        <Tile label="Revenue" value={formatRevenue(p.revenueMinor)} sub="US dollars, through Bachs" dot="bg-success" />
      </div>

      {(skipped > 0 || p.failed > 0) && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {skipped > 0 && `Skipped before their turn: ${skippedParts.join(", ")}.`}
          {skipped > 0 && p.failed > 0 && " "}
          {p.failed > 0 && `${formatCount(p.failed)} failed after two tries.`}
        </p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2.5 text-xs font-medium text-faint">By day</p>
          {p.byDay.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing sent yet: the first go at 09:00 in each person&apos;s own time.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="pb-1.5 font-medium">Day</th>
                  <th className="pb-1.5 text-right font-medium">Sent</th>
                  <th className="pb-1.5 text-right font-medium">Opened</th>
                  <th className="pb-1.5 text-right font-medium">Clicked</th>
                  <th className="pb-1.5 text-right font-medium">Bought</th>
                </tr>
              </thead>
              <tbody>
                {p.byDay.map((day) => (
                  <tr key={day.date} className="border-t border-border">
                    <td className="py-2 text-foreground">
                      {formatOfferDay(day.date)}
                      {day.date === today && ", so far"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCount(day.sent)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCount(day.opened)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCount(day.clicked)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{formatCount(day.bought)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-2.5 text-xs font-medium text-faint">By plan, at the offer price</p>
          {p.byPlan.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nobody has bought at the offer price yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {p.byPlan.map((row, index) => (
                  <tr key={row.code} className={cn(index > 0 && "border-t border-border")}>
                    <td className="py-2 text-foreground">
                      {row.name}
                      {row.set === "regional" && ", regional"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {unitPrice(row.code, row.count, row.revenueMinor)} × {formatCount(row.count)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-foreground">{formatRevenue(row.revenueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-[6px] bg-muted px-3.5 py-2.5 text-[12.5px] leading-normal text-muted-foreground">
        <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
        <span>
          Opened: the email&apos;s image loaded, or its button was clicked; Apple Mail loads every image on delivery, so
          read it as a rough count. Clicked: opened the web app from this email&apos;s button. Bought: paid the offer price, whether emailed or not
          {others > 0 ? ` (${formatCount(others)} came by the banner or the pricing page)` : ""}. All of it is ordinary Pro revenue
          in Growth and the Ledger.
        </span>
      </p>
    </>
  );
}
