"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellRing,
  BookOpenText,
  Calendar,
  ChevronDown,
  ExternalLink,
  Flag,
  Ghost,
  Globe,
  History,
  Info,
  MicVocal,
  MoonStar,
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

type Item = { icon: LucideIcon; title: string; detail: string };

/** A season's own words (boards d-christmas/05, j-halloween/05): its name, what it turns on, its sticker. */
interface SeasonCopy {
  /** "Halloween", as the dialogs name it. */
  name: string;
  icon: LucideIcon;
  turnsOn: readonly Item[];
  /** The sticker its practice path earns, kept for good. */
  sticker: string;
  /** Why it switches itself off. */
  autoOffHint: string;
}

const SEASONS: Record<string, SeasonCopy> = {
  halloween: {
    name: "Halloween",
    icon: Ghost,
    turnsOn: [
      { icon: Sparkles, title: "A small witch hat on the mark", detail: "Splash, headers, the website logo. The launcher icon stays the same." },
      { icon: MoonStar, title: "A few seconds of bats and a crescent moon", detail: "Splash and the top of Home only; none with reduced motion" },
      { icon: Music, title: "A Grieg chime, once a season", detail: "“In the Hall of the Mountain King”, l, t, d r m d m: the app's own piano, no audio file" },
      { icon: BookOpenText, title: "Songs for Halloween at the top of Hymns", detail: "Ten: seven spooky songs and three for All Saints' Day" },
      { icon: MicVocal, title: "The Midnight path in Practice", detail: "Six drills, Boo, and the Night Singer sticker (kept for good)" },
      { icon: BellRing, title: "Halloween wording in pushes", detail: "Practice reminders and “ready” pushes, same timing and limits" },
    ],
    sticker: "Night Singer",
    autoOffHint: "Off at the midnight (WAT) after the day shown, so it can't be forgotten into November.",
  },
  christmas: {
    name: "Christmas",
    icon: Snowflake,
    turnsOn: [
      { icon: Sparkles, title: "A small Santa cap on the mark", detail: "Splash, headers, the website logo. The launcher icon stays the same." },
      { icon: Snowflake, title: "A few seconds of snow", detail: "Splash and the top of Home only; none with reduced motion" },
      { icon: Music, title: "A carol chime, once a season", detail: "“Joy to the world”, d' t l s: the app's own piano, no audio file" },
      { icon: BookOpenText, title: "Carols at the top of Hymns", detail: "The 18 carols already in the hymnbook" },
      { icon: MicVocal, title: "The carols practice path", detail: "Six drills and the Carol singer sticker (kept for good)" },
      { icon: BellRing, title: "Christmas wording in pushes", detail: "Practice reminders and “ready” pushes, same timing and limits" },
    ],
    sticker: "Carol singer",
    autoOffHint: "So it can't be forgotten into February.",
  },
};

/** A flag this console has no words for: its own name and the switch alone. */
function copyOf(flag: FeatureFlag): SeasonCopy {
  return SEASONS[flag.key] ?? { name: flag.name, icon: Flag, turnsOn: [], sticker: "", autoOffHint: "So it can't be forgotten." };
}
const isSeason = (flag: FeatureFlag) => flag.key in SEASONS;

/** When each surface sees the switch move. */
const WHEN_SEEN: readonly Item[] = [
  { icon: Globe, title: "Website and web app", detail: "On the next page load" },
  {
    icon: Smartphone,
    title: "Phone app",
    detail: "Home and Hymns as soon as it reads the flag. The splash from the next launch, because it plays before the app is online.",
  },
  { icon: Bell, title: "Pushes", detail: "From the next reminder run (every 10 minutes)" },
  { icon: History, title: "Turning it off", detail: "Same timing in reverse. Stickers already earned stay in people's books." },
];

/** The day the date field shows: the one set while it is still ahead, else the server's suggestion. */
function shownDateOf(flag: FeatureFlag): string {
  const ahead = flag.autoOffAt !== null && (flag.autoOffAtUtc === null || new Date(flag.autoOffAtUtc).getTime() > Date.now());
  return ahead && flag.autoOffAt ? flag.autoOffAt : flag.suggestedAutoOffAt;
}

/** What every surface shows for a flag right now. */
function lookOf(flag: FeatureFlag): string {
  const name = copyOf(flag).name;
  return flag.on ? name : flag.adminPreview ? `Normal · ${name} for admins` : "Normal";
}

/**
 * Operations › Feature flags: the switches that change what everyone sees, each off until an admin turns it on. The
 * seasons (board j-halloween/05), Halloween then Christmas, each its own card: what it turns on and when each surface
 * sees it, the switch (confirmed both ways), a preview for admins only, the date it switches itself off after, and the
 * audit line. The one that is on (else the one changed last) is open; the other folds to one line with its switch.
 * One season at a time: turning one on while the other is on asks to switch the other off first, and the server
 * switches it off in the same save. "Right now" says what each surface would show if it opened this minute.
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
      <StateView state={state} isEmpty={(flags) => flags.length === 0} emptyMessage="No flags yet">
        {(flags) => <Flags flags={flags} />}
      </StateView>
    </div>
  );
}

/** The flags' cards, stacked, and the "Right now" side card. */
function Flags({ flags }: { flags: FeatureFlag[] }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  // Open: the one chosen, else the one on, else the one changed last, else the first.
  const changedLast = [...flags]
    .filter((f) => f.updatedAtUtc)
    .sort((a, b) => new Date(b.updatedAtUtc!).getTime() - new Date(a.updatedAtUtc!).getTime())[0];
  const openKey =
    (chosen && flags.some((f) => f.key === chosen) ? chosen : null) ?? flags.find((f) => f.on)?.key ?? changedLast?.key ?? flags[0]?.key;
  const open = flags.find((f) => f.key === openKey) ?? flags[0]!;

  /**
   * Saves part of a flag and puts the answer in the cache; throws the server's refusal for the caller to show. A season
   * turned on switched any other season off in the same save, so every flag is read again as it now stands.
   */
  async function save(flag: FeatureFlag, change: FeatureFlagChange) {
    const next = await setFeatureFlag(flag.key, change);
    queryClient.setQueryData<FeatureFlag[]>(QUERY_KEY, (all) => all?.map((f) => (f.key === next.key ? next : f)) ?? [next]);
    if (change.enabled !== undefined) void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    return next;
  }

  /** A quiet save (the preview, the date): a toast either way, no dialog. */
  async function saveQuietly(flag: FeatureFlag, change: FeatureFlagChange, done: string) {
    setSaving(true);
    try {
      await save(flag, change);
      toast.success(done);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "That didn't save.", {
        ...(caught instanceof ApiError ? { description: caught.code } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  function askToSwitch(flag: FeatureFlag, on: boolean) {
    const copy = copyOf(flag);
    const shownDate = shownDateOf(flag);
    const autoOff = flag.autoOffAt !== null;
    const turnOn = () => save(flag, { enabled: true, autoOff, ...(autoOff ? { autoOffAt: shownDate } : {}) });
    // One season at a time: another season that is on is switched off by the same save.
    const other = on && isSeason(flag) ? flags.find((f) => f.key !== flag.key && isSeason(f) && f.on) : undefined;
    if (other) {
      const was = copyOf(other);
      setConfirm({
        title: `Switch ${was.name} off and turn on ${copy.name}?`,
        body: (
          <p>
            Only one season shows at a time. {was.name}&apos;s look and pushes stop on the same timing as turning it off;{" "}
            {was.sticker} stickers already earned stay.
          </p>
        ),
        confirmLabel: "Switch seasons",
        confirmIdentity: true,
        onConfirm: async () => {
          await turnOn();
          setChosen(flag.key);
          toast.success(`${copy.name} is on for everyone; ${was.name} is off`);
        },
      });
      return;
    }
    setConfirm(
      on
        ? {
            title: `Turn on ${copy.name} for everyone?`,
            body: (
              <>
                <p>
                  The website and web app change on their next page load. The phone app changes when it next reads the flag,
                  and the splash from its next launch. Practice reminders use the {copy.name} wording from the next run.
                </p>
                <p>
                  {autoOff
                    ? `It switches itself off after ${formatDayLong(shownDate)} (midnight WAT). You can turn it off sooner from here.`
                    : "It stays on until you turn it off here."}
                </p>
              </>
            ),
            confirmLabel: "Turn on",
            confirmIdentity: true,
            onConfirm: async () => {
              await turnOn();
              setChosen(flag.key);
              toast.success(`${copy.name} is on for everyone`);
            },
          }
        : {
            title: `Turn off ${copy.name} for everyone?`,
            body: (
              <p>
                The website and web app go back to normal on their next page load, the phone app when it next reads the flag
                (the splash from its next launch), and practice reminders from the next run. Stickers already earned stay in
                people's books.
              </p>
            ),
            confirmLabel: "Turn off",
            confirmIdentity: true,
            onConfirm: async () => {
              await save(flag, { enabled: false });
              toast.success(`${copy.name} is off for everyone`);
            },
          },
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {flags.map((flag) => {
          const otherSeason = isSeason(flag) ? flags.find((f) => f.key !== flag.key && isSeason(f)) : undefined;
          return (
            <FlagCard
              key={flag.key}
              flag={flag}
              open={flag.key === open.key}
              onToggleOpen={() => setChosen(flag.key === open.key ? (otherSeason?.key ?? null) : flag.key)}
              otherSeason={otherSeason ? copyOf(otherSeason).name : null}
              saving={saving}
              onSwitch={(on) => askToSwitch(flag, on)}
              onQuiet={(change, done) => void saveQuietly(flag, change, done)}
            />
          );
        })}
      </div>

      <RightNow flags={flags} open={open} />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** One flag's card: open (everything) or folded (its name, its switch and when it would switch itself off). */
function FlagCard({
  flag,
  open,
  onToggleOpen,
  otherSeason,
  saving,
  onSwitch,
  onQuiet,
}: {
  flag: FeatureFlag;
  open: boolean;
  onToggleOpen: () => void;
  /** The other season's name, for the one-season rule. */
  otherSeason: string | null;
  saving: boolean;
  onSwitch: (on: boolean) => void;
  onQuiet: (change: FeatureFlagChange, done: string) => void;
}) {
  const copy = copyOf(flag);
  const previewId = useId();
  const autoOffId = useId();
  const headingId = useId();
  const bodyId = useId();
  const offset = getReportingOffset();
  const shownDate = shownDateOf(flag);
  const autoOff = flag.autoOffAt !== null;
  const lastDay = flag.autoOffAt ? formatDayLong(flag.autoOffAt) : null;
  const SeasonIcon = copy.icon;

  const description = open
    ? `The ${copy.name} touches in one switch: on the website, the web app and the phone app at once. The phone app doesn't need a store update.${
        flag.switchedItselfOff && lastDay ? ` It switched itself off after ${lastDay}.` : ""
      }`
    : flag.on
      ? `On for everyone.${autoOff ? ` It switches itself off after ${formatDayLong(shownDate)}.` : ""}`
      : `${autoOff ? `Switches itself off after ${formatDayLong(shownDate)} when it's on.` : "Stays on until switched off, when it's on."}${
          flag.adminPreview ? " On for admins as a preview." : ""
        }`;

  return (
    <section className="nf-panel overflow-hidden" aria-labelledby={headingId}>
      <header className={cn("flex items-start justify-between gap-4 px-5 py-4", open && "border-b border-border")}>
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <SeasonIcon size={16} className="text-faint" aria-hidden="true" />
            {flag.name}
            <Badge tone={flag.on ? "success" : "neutral"}>{flag.on ? "On" : "Off"}</Badge>
          </h2>
          <p className="mt-1 max-w-[560px] text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="flex items-center gap-2.5 text-[13px] font-medium text-foreground">
            {/* A phone-width console keeps the name its room: the switch alone says it there. */}
            <span className="hidden sm:inline">{flag.on ? "On for everyone" : "Off"}</span>
            <Switch
              checked={flag.on}
              disabled={saving}
              onCheckedChange={(next) => onSwitch(next)}
              aria-label={`${flag.name}: ${flag.on ? "on for everyone" : "off"}`}
            />
          </label>
          <button
            type="button"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `Fold ${flag.name}` : `Open ${flag.name}`}
            className="-mr-2 inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
      </header>

      {open ? (
        <div id={bodyId}>
          {copy.turnsOn.length > 0 && (
            <div className="grid gap-7 px-5 pb-5 pt-[18px] sm:grid-cols-2">
              <ItemList label="What it turns on" items={copy.turnsOn} />
              <ItemList label="When people see it" items={WHEN_SEEN} />
            </div>
          )}

          <OptionRow>
            <div className="min-w-0 flex-1">
              <label htmlFor={previewId} className="text-[13px] font-medium text-foreground">
                Preview for admins only
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Turn it on for admin accounts first and check it on your own phone and browser. Pushes never use the preview.
              </p>
            </div>
            <Switch
              id={previewId}
              checked={flag.adminPreview}
              disabled={saving}
              onCheckedChange={(next) => onQuiet({ adminPreview: next }, next ? `${copy.name} preview on for admins` : `${copy.name} preview off`)}
            />
          </OptionRow>

          <OptionRow>
            <Checkbox
              id={autoOffId}
              checked={autoOff}
              disabled={saving}
              onCheckedChange={(next) => {
                const on = next === true;
                onQuiet(
                  on ? { autoOff: true, autoOffAt: shownDate } : { autoOff: false },
                  on ? `${copy.name} switches itself off after ${formatDayLong(shownDate)}` : `${copy.name} stays on until switched off`,
                );
              }}
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={autoOffId} className="text-[13px] font-medium text-foreground">
                Switch itself off after
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {copy.autoOffHint} Untick to leave it on until you switch it off.
              </p>
            </div>
            <DateField
              label={`Last day of the ${copy.name} season`}
              value={shownDate}
              disabled={!autoOff || saving}
              onChange={(day) => onQuiet({ autoOff: true, autoOffAt: day }, `${copy.name} switches itself off after ${formatDayLong(day)}`)}
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
        </div>
      ) : (
        otherSeason && (
          <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs leading-normal text-muted-foreground">
            <Info size={14} className="mt-px shrink-0 text-faint" aria-hidden="true" />
            One season at a time: turning {copy.name} on while {otherSeason} is on asks to switch {otherSeason} off first.
          </p>
        )
      )}
    </section>
  );
}

/** "Right now": what each surface would show if it opened this minute. */
function RightNow({ flags, open }: { flags: FeatureFlag[]; open: FeatureFlag }) {
  const offset = getReportingOffset();
  // One season at a time; with none on, the open card's (its preview, if any).
  const shown = flags.find((f) => isSeason(f) && f.on) ?? open;
  const name = copyOf(shown).name;
  // A preview changes what admins see, never the pushes.
  const look = lookOf(shown);
  const rows: [string, string][] = [
    ["Website", look],
    ["Web app", look],
    ["Phone app", look],
    ["Practice reminders", shown.on ? `${name} words` : "Usual words"],
  ];
  if (shown.on) rows.push(["Switches off", shown.autoOffAtUtc ? formatInstantDateTime(shown.autoOffAtUtc, offset) : "When you switch it off"]);

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
        The phone app gets the {name} code in an ordinary OTA update before the switch is turned on. A phone that hasn't
        picked it up yet ignores the switch and stays as it is; nothing breaks.
      </p>
    </section>
  );
}

function ItemList({ label, items }: { label: string; items: readonly Item[] }) {
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
function DateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (day: string) => void;
}) {
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
        aria-label={label}
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
