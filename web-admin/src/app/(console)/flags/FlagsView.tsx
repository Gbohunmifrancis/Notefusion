"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  BookOpenText,
  Calendar,
  ExternalLink,
  Globe,
  History,
  Info,
  MicVocal,
  Music,
  ScrollText,
  Smartphone,
  Snowflake,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { ApiError } from "@/api/client";
import { getFeatureFlags, setFeatureFlag } from "@/api/endpoints";
import type { FeatureFlag, FeatureFlagChange } from "@/api/types";
import { Badge } from "@/components/Badge";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { StateView } from "@/components/StateView";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { formatDayLong, formatInstantDateTime } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";
import { cn } from "@/lib/utils";

const QUERY_KEY = ["feature-flags"] as const;

/** What the Christmas switch turns on, as the board lists it. */
const TURNS_ON: readonly { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: Sparkles, title: "A small Santa cap on the mark", detail: "Splash, headers, the website logo. The launcher icon stays the same." },
  { icon: Snowflake, title: "A few seconds of snow", detail: "Splash and the top of Home only; none with reduced motion" },
  { icon: Music, title: "A carol chime, once a season", detail: "“Joy to the world”, d' t l s: the app's own piano, no audio file" },
  { icon: BookOpenText, title: "Carols at the top of Hymns", detail: "The 18 carols already in the hymnbook" },
  { icon: MicVocal, title: "The carols practice path", detail: "Six drills and the Carol singer sticker (kept for good)" },
  { icon: BellRing, title: "Christmas wording in pushes", detail: "Practice reminders and “ready” pushes, same timing and limits" },
];

/** When each surface sees the switch move. */
const WHEN_SEEN: readonly { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: Globe, title: "Website and web app", detail: "On the next page load" },
  {
    icon: Smartphone,
    title: "Phone app",
    detail: "Home and Hymns as soon as it reads the flag. The splash from the next launch, because it plays before the app is online.",
  },
  { icon: Bell, title: "Pushes", detail: "From the next reminder run (every 10 minutes)" },
  { icon: History, title: "Turning it off", detail: "Same timing in reverse. Stickers already earned stay in people's books." },
];

/**
 * Operations › Feature flags: the switches that change what everyone sees, each off until an admin turns it on. One
 * card for now, the Christmas season: what it turns on and when each surface sees it, the switch (confirmed both
 * ways), a preview for admins only, the date it switches itself off after, and the audit line. "Right now" says what
 * each surface would show if it opened this minute.
 *
 * Every control saves at once (there is no Save button); the server writes each change to the audit log.
 */
export function FlagsView() {
  const state = useQuery({ queryKey: QUERY_KEY, queryFn: ({ signal }) => getFeatureFlags(signal) });

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Feature flags"
        subtitle="Switches that change what everyone sees. Each one stays off until you turn it on."
        breadcrumb={["Dashboard", "Operations", "Feature flags"]}
      />
      <StateView state={state} isEmpty={(flags) => !flags.some((f) => f.key === "christmas")} emptyMessage="No flags yet">
        {(flags) => <ChristmasFlag flag={flags.find((f) => f.key === "christmas")!} />}
      </StateView>
    </div>
  );
}

/** The Christmas season's card and the "Right now" side card. */
function ChristmasFlag({ flag }: { flag: FeatureFlag }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const previewId = useId();
  const autoOffId = useId();
  const offset = getReportingOffset();

  // The date the field shows: the one set while it is still ahead, else the next 6 January.
  const dateAhead = flag.autoOffAt !== null && (flag.autoOffAtUtc === null || new Date(flag.autoOffAtUtc).getTime() > Date.now());
  const shownDate = dateAhead && flag.autoOffAt ? flag.autoOffAt : flag.suggestedAutoOffAt;
  const autoOff = flag.autoOffAt !== null;

  /** Saves part of the flag and puts the answer in the cache; throws the server's refusal for the caller to show. */
  async function save(change: FeatureFlagChange) {
    const next = await setFeatureFlag(flag.key, change);
    queryClient.setQueryData<FeatureFlag[]>(QUERY_KEY, (flags) => flags?.map((f) => (f.key === next.key ? next : f)) ?? [next]);
    return next;
  }

  /** A quiet save (the preview, the date): a toast either way, no dialog. */
  async function saveQuietly(change: FeatureFlagChange, done: string) {
    setSaving(true);
    try {
      await save(change);
      toast.success(done);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "That didn't save.", {
        ...(caught instanceof ApiError ? { description: caught.code } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  function askToSwitch(on: boolean) {
    setConfirm(
      on
        ? {
            title: "Turn on Christmas for everyone?",
            body: (
              <>
                <p>
                  The website and web app change on their next page load. The phone app changes when it next reads the flag,
                  and the splash from its next launch. Practice reminders use the Christmas wording from the next run.
                </p>
                <p>
                  {autoOff
                    ? `It switches itself off after ${formatDayLong(shownDate)}. You can turn it off sooner from here.`
                    : "It stays on until you turn it off here."}
                </p>
              </>
            ),
            confirmLabel: "Turn on",
            onConfirm: async () => {
              await save({ enabled: true, autoOff, ...(autoOff ? { autoOffAt: shownDate } : {}) });
              toast.success("Christmas is on for everyone");
            },
          }
        : {
            title: "Turn off Christmas for everyone?",
            body: (
              <p>
                The website and web app go back to normal on their next page load, the phone app when it next reads the flag
                (the splash from its next launch), and practice reminders from the next run. Stickers already earned stay in
                people's books.
              </p>
            ),
            confirmLabel: "Turn off",
            onConfirm: async () => {
              await save({ enabled: false });
              toast.success("Christmas is off for everyone");
            },
          },
    );
  }

  const lastDay = flag.autoOffAt ? formatDayLong(flag.autoOffAt) : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="nf-panel overflow-hidden" aria-labelledby="flag-christmas">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="flag-christmas" className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Snowflake size={16} className="text-faint" aria-hidden="true" />
              {flag.name}
              <Badge tone={flag.on ? "success" : "neutral"}>{flag.on ? "On" : "Off"}</Badge>
            </h2>
            <p className="mt-1 max-w-[560px] text-xs leading-relaxed text-muted-foreground">
              The Christmas touches in one switch: on the website, the web app and the phone app at once. The phone app
              doesn't need a store update.
              {flag.switchedItselfOff && lastDay && ` It switched itself off after ${lastDay}.`}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2.5 text-[13px] font-medium text-foreground">
            <span>{flag.on ? "On" : "Off"}</span>
            <Switch
              checked={flag.on}
              onCheckedChange={(next) => askToSwitch(next)}
              aria-label={`${flag.name}: ${flag.on ? "on for everyone" : "off"}`}
            />
          </label>
        </header>

        <div className="grid gap-7 px-5 pb-5 pt-[18px] sm:grid-cols-2">
          <ItemList label="What it turns on" items={TURNS_ON} />
          <ItemList label="When people see it" items={WHEN_SEEN} />
        </div>

        <OptionRow>
          <div className="min-w-0 flex-1">
            <label htmlFor={previewId} className="text-[13px] font-medium text-foreground">
              Preview for admins only
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Turn it on for admin accounts first and check it on your own phone and browser.
            </p>
          </div>
          <Switch
            id={previewId}
            checked={flag.adminPreview}
            disabled={saving}
            onCheckedChange={(next) =>
              void saveQuietly({ adminPreview: next }, next ? "Preview on for admins" : "Preview off")
            }
          />
        </OptionRow>

        <OptionRow>
          <Checkbox
            id={autoOffId}
            checked={autoOff}
            disabled={saving}
            onCheckedChange={(next) => {
              const on = next === true;
              void saveQuietly(
                on ? { autoOff: true, autoOffAt: shownDate } : { autoOff: false },
                on ? `Switches itself off after ${formatDayLong(shownDate)}` : "Stays on until switched off",
              );
            }}
          />
          <div className="min-w-0 flex-1">
            <label htmlFor={autoOffId} className="text-[13px] font-medium text-foreground">
              Switch itself off after
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              So it can't be forgotten into February. Untick to leave it on until you switch it off.
            </p>
          </div>
          <DateField
            value={shownDate}
            disabled={!autoOff || saving}
            onChange={(day) => void saveQuietly({ autoOff: true, autoOffAt: day }, `Switches itself off after ${formatDayLong(day)}`)}
          />
        </OptionRow>

        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <ScrollText size={14} className="shrink-0 text-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {flag.updatedAtUtc
              ? `Last changed by ${flag.updatedByEmail ?? "an admin"}, ${formatInstantDateTime(flag.updatedAtUtc, offset)}.`
              : "Never changed."}{" "}
            Every change is written to the Audit Log with who made it.
          </span>
          <Link
            href="/audit-log?action=SetFeatureFlag"
            className="ml-auto inline-flex items-center gap-1 text-brand hover:underline"
          >
            Audit Log
            <ExternalLink size={12} aria-hidden="true" />
          </Link>
        </footer>
      </section>

      <RightNow flag={flag} />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** "Right now": what each surface would show if it opened this minute. */
function RightNow({ flag }: { flag: FeatureFlag }) {
  // A preview changes what admins see, never the pushes.
  const look = flag.on ? "Christmas" : flag.adminPreview ? "Normal · Christmas for admins" : "Normal";
  const rows: readonly [string, string][] = [
    ["Website", look],
    ["Web app", look],
    ["Phone app", look],
    ["Practice reminders", flag.on ? "Christmas words" : "Usual words"],
  ];

  return (
    <section className="nf-panel overflow-hidden" aria-labelledby="flag-right-now">
      <header className="px-5 pb-2 pt-4">
        <h2 id="flag-right-now" className="text-sm font-semibold text-foreground">
          Right now
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">What each surface would show if it opened now.</p>
      </header>
      <dl className="px-5 pb-3">
        {rows.map(([surface, shows], index) => (
          <div
            key={surface}
            className={cn("flex justify-between gap-4 py-[9px] text-[13px]", index > 0 && "border-t border-border")}
          >
            <dt className="text-foreground">{surface}</dt>
            <dd className="text-right text-muted-foreground">{shows}</dd>
          </div>
        ))}
      </dl>
      <p className="mx-5 mb-[18px] flex items-start gap-2 rounded-[6px] bg-muted px-3.5 py-2.5 text-[12.5px] leading-normal text-muted-foreground">
        <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
        The phone app gets the Christmas code in an ordinary OTA update before December. A phone that hasn't picked it up
        yet ignores the switch and stays as it is; nothing breaks.
      </p>
    </section>
  );
}

function ItemList({ label, items }: { label: string; items: readonly { icon: LucideIcon; title: string; detail: string }[] }) {
  return (
    <div>
      <p className="mb-2.5 text-xs font-medium text-faint">{label}</p>
      <ul>
        {items.map(({ icon: Icon, title, detail }) => (
          <li key={title} className="flex items-start gap-2.5 py-[7px] text-[13px] leading-[1.45] text-foreground">
            <Icon size={16} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <span>
              {title}
              <span className="block text-xs text-muted-foreground">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionRow({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3.5 border-t border-border px-5 py-3.5">{children}</div>;
}

/**
 * The last day, as the console writes dates ("6 Jan 2027"), over the browser's own date picker: the native input
 * covers the pill invisibly and opens its picker on a click.
 */
function DateField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (day: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span
      className={cn(
        "relative inline-flex h-8 shrink-0 items-center gap-2 rounded-[8px] border border-border bg-input/40 px-2.5 text-[13px] text-foreground focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-50",
      )}
    >
      <Calendar size={14} className="text-faint" aria-hidden="true" />
      {formatDayLong(value)}
      <input
        ref={input}
        type="date"
        aria-label="Last day of the season"
        value={value}
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
