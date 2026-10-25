"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { getRecognisedHymns } from "@/api/endpoints";
import type { RecognisedHymns } from "@/api/types";
import { Section } from "@/components/analytics/Section";
import { MetricRow } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { EmptyView, StateView } from "@/components/StateView";
import { Switch } from "@/components/ui/switch";
import { addDays, formatCount, formatInstantDateTime, formatPercent, reportingToday, UNKNOWN } from "@/lib/format";

/* Hymns recognised: which hymns people's takes matched when their job finished (the worker's hymnMatch), how often and
 * by how many accounts, and how many were kept as the hymnbook version. The team's own accounts are left out, as on every
 * page, unless the switch counts them; the website's "Hum to find a hymn" stores nothing, so it is not here. */

/** The API's reporting day is West Africa Time, as on the console's other pages. */
const OFFSET_MINUTES = 60;

const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);
const KIND_LABELS: Record<string, string> = { score: "Hymnbook version offered", incipit: "Named and linked" };

export function HymnsView() {
  const [range, setRange] = useState<Range | null>(null);
  const [includeInternal, setIncludeInternal] = useState(false);
  const state = useQuery({
    queryKey: ["recognised-hymns", range?.from, range?.to, includeInternal],
    queryFn: ({ signal }) => getRecognisedHymns(range?.from, range?.to, includeInternal, signal),
    placeholderData: keepPreviousData,
  });
  const picker: Range = range ?? { from: addDays(reportingToday(OFFSET_MINUTES), -29), to: reportingToday(OFFSET_MINUTES) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Hymns recognised"
        subtitle="Which hymns people's takes matched, how often, and how many kept the hymnbook version."
        breadcrumb={["Dashboard", "Hymns recognised"]}
      />
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={OFFSET_MINUTES} onChange={setRange} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={includeInternal} onCheckedChange={setIncludeInternal} aria-label="Include our own accounts" />
          Include our own accounts
        </label>
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <StateView state={state} loadingLabel="Loading hymns recognised">
        {(d) =>
          d.recognised === 0 ? (
            <EmptyView
              message="No take matched a hymn in these dates"
              hint={
                d.includesInternal
                  ? "The website's Hum to find a hymn keeps nothing, so its finds are not counted here."
                  : "Admins' and internal accounts are left out: switch on Include our own accounts to see the team's tests."
              }
            />
          ) : (
            <HymnsBody d={d} />
          )
        }
      </StateView>
    </div>
  );
}

function HymnsBody({ d }: { d: RecognisedHymns }) {
  return (
    <div className="space-y-8">
      <MetricRow
        items={[
          {
            label: "Takes recognised",
            value: formatCount(d.recognised),
            share: rate(d.recognised, d.finished),
            info: "Finished transcriptions whose tune matched a hymn in the library, of every finished transcription in these dates.",
          },
          { label: "Hymns", value: formatCount(d.hymns.length), info: "Different hymns matched." },
          { label: "Accounts", value: formatCount(d.accounts), info: "Accounts with at least one take that matched a hymn." },
          {
            label: "Kept the hymnbook version",
            value: formatCount(d.kept),
            share: rate(d.kept, d.recognised),
            info: "Takes whose sheet was saved as the matched hymn's hymnbook version (the person said yes to the offer).",
          },
        ]}
      />
      <Section id="hymns" title="By hymn" description="Most often matched first.">
        <div className="nf-panel overflow-x-auto p-3">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Hymn</th>
                <th className="py-2 font-medium">Match</th>
                <th className="py-2 text-right font-medium">Times</th>
                <th className="py-2 text-right font-medium">Accounts</th>
                <th className="py-2 text-right font-medium">Kept</th>
                <th className="py-2 text-right font-medium">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.hymns.map((h) => (
                <tr key={h.slug}>
                  <td className="py-1.5">
                    {h.url ? (
                      <a href={h.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:text-brand">
                        {h.title}
                      </a>
                    ) : (
                      <span className="font-medium text-foreground">{h.title}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{KIND_LABELS[h.kind] ?? h.kind}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(h.times)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(h.accounts)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(h.kept)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{formatInstantDateTime(h.lastAtUtc, OFFSET_MINUTES)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section id="recent" title="Latest takes" description={`The newest ${formatCount(d.recent.length)} takes that matched a hymn.`}>
        <div className="nf-panel overflow-x-auto p-3">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">When</th>
                <th className="py-2 font-medium">Hymn</th>
                <th className="py-2 font-medium">Account</th>
                <th className="py-2 text-right font-medium">Match</th>
                <th className="py-2 text-right font-medium">Kept</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.recent.map((r, i) => (
                <tr key={`${r.atUtc}-${i}`}>
                  <td className="py-1.5 text-muted-foreground">{formatInstantDateTime(r.atUtc, OFFSET_MINUTES)}</td>
                  <td className="py-1.5 font-medium text-foreground">{r.title}</td>
                  <td className="py-1.5">
                    <Link href={`/users/${r.userId}`} className="text-foreground hover:text-brand">
                      {r.email || r.userId}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatPercent(r.confidence, 0)}</td>
                  <td className="py-1.5 text-right">{r.kept ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
