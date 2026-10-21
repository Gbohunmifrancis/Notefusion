import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { AdminBackBar, AdminPage, PageTitle } from "../../components/admin/AdminChrome";
import { AdminSwitch, Badge, LoadState, Panel } from "../../components/admin/AdminUI";
import { ConfirmSheet, type ConfirmRequest } from "../../components/admin/ConfirmSheet";
import { Icon, type IconName } from "../../components/Icon";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import type { FeatureFlag, FeatureFlagChange } from "../../api/types";
import { toApiError } from "../../api/client";
import { useAdminQuery, writeAdminData } from "../../lib/adminCache";
import { askPhoneLock, useAdminLock } from "../../lib/adminLockRuntime";
import { showDialog } from "../../lib/dialog";
import { showToast } from "../../lib/toast";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { clock, dayLabel, parseUtc } from "../../lib/adminFormat";

/** What each season turns on, in the console's own words (boards d-christmas/05, j-halloween/05). */
interface SeasonCopy {
  /** "Christmas", as the sheets name it. */
  name: string;
  icon: IconName;
  turnsOn: { icon: IconName; title: string; detail: string }[];
  /** The sticker its path earns, kept for good. */
  sticker: string;
  /** Why it switches itself off. */
  autoOffHint: string;
  /** The last days on offer, from the server's suggested one (yyyy-mm-dd). */
  lastDays: (suggested: string) => string[];
}

const SEASONS: Record<string, SeasonCopy> = {
  halloween: {
    name: "Halloween",
    icon: "ghost",
    turnsOn: [
      { icon: "reward", title: "A small witch hat on the mark", detail: "Splash, headers, the website logo. The launcher icon stays the same." },
      { icon: "night", title: "A few seconds of bats and a crescent moon", detail: "Splash and the top of Home only; none with reduced motion" },
      { icon: "music", title: "A Grieg chime, once a season", detail: "“In the Hall of the Mountain King”, l, t, d r m d m: the app's own piano, no audio file" },
      { icon: "hymns", title: "Songs for Halloween at the top of Hymns", detail: "Ten: seven spooky songs and three for All Saints' Day" },
      { icon: "practice", title: "The Midnight path in Practice", detail: "Six drills, Boo, and the Night Singer sticker (kept for good)" },
      { icon: "bell", title: "Halloween wording in pushes", detail: "Practice reminders and “ready” pushes, same timing and limits" },
    ],
    sticker: "Night Singer",
    autoOffHint: "So it can't be forgotten into November",
    // Halloween, All Saints' Day (the server's default), All Souls' Day and a week after.
    lastDays: (suggested) => {
      const y = Number(suggested.slice(0, 4));
      return [`${y}-10-31`, `${y}-11-01`, `${y}-11-02`, `${y}-11-08`];
    },
  },
  christmas: {
    name: "Christmas",
    icon: "snow",
    turnsOn: [
      { icon: "reward", title: "A small Santa cap on the mark", detail: "Splash, headers, the website logo" },
      { icon: "snow", title: "A few seconds of snow", detail: "Splash and the top of Home" },
      { icon: "music", title: "A carol chime, once a season", detail: "" },
      { icon: "hymns", title: "Carols at the top of Hymns", detail: "" },
      { icon: "practice", title: "The carols practice path", detail: "" },
      { icon: "bell", title: "Christmas wording in pushes", detail: "" },
    ],
    sticker: "Carol singer",
    autoOffHint: "So it can't be forgotten into February",
    // The end of the year, New Year's Day, Epiphany (the server's default) and a week after.
    lastDays: (suggested) => {
      const y = Number(suggested.slice(0, 4));
      return [`${y - 1}-12-31`, `${y}-01-01`, `${y}-01-06`, `${y}-01-13`];
    },
  },
};

/** A flag this build has no words for: its own name, and only the switch-off date the server suggests. */
function copyOf(flag: FeatureFlag): SeasonCopy {
  return (
    SEASONS[flag.key] ?? {
      name: flag.name,
      icon: "flag",
      turnsOn: [],
      sticker: "",
      autoOffHint: "So it can't be forgotten",
      lastDays: (suggested) => [suggested],
    }
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-01-06" → "6 Jan 2027". */
function dayLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The day a flag would switch itself off: the one set while it is still ahead, else the server's suggestion. */
function lastDayOf(flag: FeatureFlag, now: Date): string {
  const ahead = flag.autoOffAt !== null && (flag.autoOffAtUtc === null || parseUtc(flag.autoOffAtUtc) > now);
  return ahead && flag.autoOffAt ? flag.autoOffAt : flag.suggestedAutoOffAt;
}

/** What every surface shows for a flag right now. */
function lookOf(flag: FeatureFlag): string {
  const name = copyOf(flag).name;
  return flag.on ? name : flag.adminPreview ? `Normal · ${name} for admins` : "Normal";
}

/**
 * More › Feature flags (boards f-admin/07, j-halloween/05): the web's season cards, stacked — Halloween, then
 * Christmas. The one that is on (else the one changed last) is open; the other folds to one line with its switch.
 * Same name, same Off pill, what it turns on, the admins-only preview and the switch-off date; every control saves
 * at once. Turning a season on or off asks in the web's own words, then the phone's lock; the preview and the date ask
 * the lock alone, because every change to a flag changes what customers see. One season at a time: turning one on
 * while the other is on asks to switch the other off first, and the server switches it off in the same save.
 */
export function AdminFlagsScreen() {
  const nav = useNavigation();
  const { method } = useAdminLock();
  const q = useAdminQuery<FeatureFlag[]>("features", adminApi.features);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const flags = q.data ?? [];
  const now = new Date();

  // Open: the one chosen, else the one on, else the one changed last, else the first.
  const changedLast = [...flags]
    .filter((f) => f.updatedAtUtc)
    .sort((a, b) => parseUtc(b.updatedAtUtc!).getTime() - parseUtc(a.updatedAtUtc!).getTime())[0];
  const openKey = chosen ?? flags.find((f) => f.on)?.key ?? changedLast?.key ?? flags[0]?.key ?? null;

  async function save(flag: FeatureFlag, change: FeatureFlagChange): Promise<FeatureFlag> {
    const next = await adminApi.setFeature(flag.key, change);
    const turnedOn = next.on && !flag.on && flag.key in SEASONS;
    writeAdminData(
      "features",
      (q.data ?? []).map((f) =>
        f.key === next.key ? next : turnedOn && f.key in SEASONS && f.enabled ? { ...f, on: false, enabled: false } : f,
      ),
    );
    // The server switched any other season off in the same save: read every flag as it now stands.
    if (turnedOn) void q.refresh();
    return next;
  }

  /** A quiet change (the preview, the date): the phone's lock, then the save; a sheet only when the phone has none. */
  async function guarded(flag: FeatureFlag, reason: string, change: FeatureFlagChange, done: string) {
    if (method === "code") {
      setConfirm({
        title: reason,
        message: "Every change to a flag changes what someone sees, so it is confirmed first.",
        confirmLabel: "Save",
        secondAsk: true,
        onConfirm: async () => {
          await save(flag, change);
          showToast(done);
        },
      });
      return;
    }
    if (!(await askPhoneLock(reason))) return;
    setSaving(true);
    try {
      await save(flag, change);
      showToast(done);
    } catch (e) {
      showDialog({ title: "That didn't save", message: toApiError(e).message, icon: "problem", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  const askToSwitch = (flag: FeatureFlag, on: boolean) => {
    const copy = copyOf(flag);
    const lastDay = lastDayOf(flag, now);
    const autoOff = flag.autoOffAt !== null;
    const turnOn = () => save(flag, { enabled: true, autoOff, ...(autoOff ? { autoOffAt: lastDay } : {}) });
    // One season at a time: another season that is on is switched off by the same save.
    const other = on && flag.key in SEASONS ? flags.find((f) => f.key !== flag.key && f.key in SEASONS && f.on) : undefined;
    if (other) {
      const was = copyOf(other);
      setConfirm({
        title: `Switch ${was.name} off and turn on ${copy.name}?`,
        message: `Only one season shows at a time. ${was.name}'s look and pushes stop on the same timing as turning it off; ${was.sticker} stickers already earned stay.`,
        confirmLabel: "Switch seasons",
        secondAsk: true,
        extra: <RightNowLine look={lookOf(other)} />,
        onConfirm: async () => {
          await turnOn();
          setChosen(flag.key);
          showToast(`${copy.name} is on for everyone; ${was.name} is off`);
        },
      });
      return;
    }
    setConfirm(
      on
        ? {
            title: `Turn on ${copy.name} for everyone?`,
            message: `The website and web app change on their next page load. The phone app changes when it next reads the flag, and the splash from its next launch. Practice reminders use the ${copy.name} wording from the next run.\n\n${
              autoOff ? `It switches itself off after ${dayLong(lastDay)} (midnight WAT). You can turn it off sooner from here.` : "It stays on until you turn it off here."
            }`,
            confirmLabel: "Turn on",
            secondAsk: true,
            extra: <RightNowLine look={lookOf(flag)} />,
            onConfirm: async () => {
              await turnOn();
              setChosen(flag.key);
              showToast(`${copy.name} is on for everyone`);
            },
          }
        : {
            title: `Turn off ${copy.name} for everyone?`,
            message:
              "The website and web app go back to normal on their next page load, the phone app when it next reads the flag (the splash from its next launch), and practice reminders from the next run. Stickers already earned stay in people's books.",
            confirmLabel: "Turn off",
            secondAsk: true,
            extra: <RightNowLine look={lookOf(flag)} />,
            onConfirm: async () => {
              await save(flag, { enabled: false });
              showToast(`${copy.name} is off for everyone`);
            },
          },
    );
  };

  if (flags.length === 0)
    return (
      <AdminPage header={<AdminBackBar label="More" onBack={() => nav.goBack()} />}>
        <LoadState loading={q.loading} error={q.error} onRetry={q.refresh} />
      </AdminPage>
    );

  return (
    <AdminPage header={<AdminBackBar label="More" onBack={() => nav.goBack()} />} onRefresh={q.refresh} refreshing={q.refreshing}>
      <PageTitle title="Feature flags" sub="Switches that change what everyone sees. Each stays off until you turn it on." />

      {flags.map((flag) => {
        const otherSeason = flag.key in SEASONS ? flags.find((f) => f.key !== flag.key && f.key in SEASONS) : undefined;
        return (
          <FlagCard
            key={flag.key}
            flag={flag}
            open={flag.key === openKey}
            onToggleOpen={() => setChosen(flag.key === openKey ? (otherSeason?.key ?? null) : flag.key)}
            otherSeason={otherSeason ? copyOf(otherSeason).name : null}
            saving={saving}
            now={now}
            onSwitch={(on) => askToSwitch(flag, on)}
            onGuarded={(reason, change, done) => void guarded(flag, reason, change, done)}
          />
        );
      })}

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </AdminPage>
  );
}

/** One flag's card: open (everything) or folded (its name, its switch and when it would switch itself off). */
function FlagCard({
  flag,
  open,
  onToggleOpen,
  otherSeason,
  saving,
  now,
  onSwitch,
  onGuarded,
}: {
  flag: FeatureFlag;
  open: boolean;
  onToggleOpen: () => void;
  /** The other season's name, for the one-season rule. */
  otherSeason: string | null;
  saving: boolean;
  now: Date;
  onSwitch: (on: boolean) => void;
  onGuarded: (reason: string, change: FeatureFlagChange, done: string) => void;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const copy = copyOf(flag);
  const shownDate = lastDayOf(flag, now);
  const autoOff = flag.autoOffAt !== null;
  const look = lookOf(flag);
  const since = flag.updatedAtUtc ? parseUtc(flag.updatedAtUtc) : null;

  const pickDate = () =>
    showDialog({
      title: "Switch itself off after",
      actions: copy.lastDays(flag.suggestedAutoOffAt).map((d) => ({
        label: dayLong(d),
        icon: "calendar" as IconName,
        selected: d === shownDate,
        onPress: () => onGuarded("Change the switch-off date", { autoOff: true, autoOffAt: d }, `Switches itself off after ${dayLong(d)}`),
      })),
    });

  const description = flag.on
    ? `On for everyone${since ? ` since ${clock(since)}` : ""}.${autoOff ? ` It switches itself off after ${dayLong(shownDate)}.` : ""}`
    : !open
      ? `${autoOff ? `Switches itself off after ${dayLong(shownDate)} when it's on.` : "Stays on until switched off, when it's on."}${
          flag.adminPreview ? " On for admins as a preview." : ""
        }`
      : `The ${copy.name} touches in one switch: website, web app and phone app at once. No store update needed.${
          flag.switchedItselfOff && flag.autoOffAt ? ` It switched itself off after ${dayLong(flag.autoOffAt)}.` : ""
        }`;

  return (
    <Panel style={s.gap14} bodyStyle={s.noPad}>
      <View style={s.head}>
        <View style={s.flex}>
          <View style={s.nameRow}>
            <Icon name={copy.icon} size={17} color={a.faint} />
            <Text style={s.name}>{flag.name}</Text>
            <Badge label={flag.on ? "On" : "Off"} tone={flag.on ? "ok" : "neutral"} />
          </View>
          <Text style={s.desc}>{description}</Text>
        </View>
        <View style={s.switchCol}>
          <AdminSwitch value={flag.on} onChange={onSwitch} disabled={saving} label={`${flag.name}: ${flag.on ? "on for everyone" : "off"}`} />
          <Text style={s.switchText}>{flag.on ? "On" : "Off"}</Text>
        </View>
        <Touchable
          onPress={onToggleOpen}
          style={s.fold}
          radius={22}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? `Fold ${flag.name}` : `Open ${flag.name}`}
        >
          <Icon name={open ? "up" : "down"} size={18} color={a.muted} />
        </Touchable>
      </View>

      {open ? (
        <>
          {flag.on ? (
            <View style={s.block}>
              <View style={s.rightNow}>
                {[
                  ["Website", look],
                  ["Web app", look],
                  ["Phone app", look],
                  ["Practice reminders", `${copy.name} words`],
                ].map(([surface, shows], i) => (
                  <View key={surface} style={[s.rnRow, i > 0 && s.rule]}>
                    <Text style={s.rnTerm}>{surface}</Text>
                    <Text style={s.rnValue}>{shows}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : copy.turnsOn.length > 0 ? (
            <View style={s.block}>
              <Text style={s.label}>What it turns on</Text>
              {copy.turnsOn.map((t) => (
                <View key={t.title} style={s.item}>
                  <Icon name={t.icon} size={17} color={a.faint} />
                  <View style={s.flex}>
                    <Text style={s.itemTitle}>{t.title}</Text>
                    {t.detail ? <Text style={s.itemDetail}>{t.detail}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[s.option, s.ruleTop]}>
            <View style={s.flex}>
              <Text style={s.optionTitle}>Preview for admins only</Text>
              <Text style={s.optionHint}>Check it on your own phone first</Text>
            </View>
            <AdminSwitch
              value={flag.adminPreview}
              disabled={saving}
              label="Preview for admins only"
              onChange={(next) =>
                onGuarded(next ? "Turn the admin preview on" : "Turn the admin preview off", { adminPreview: next }, next ? "Preview on for admins" : "Preview off")
              }
            />
          </View>

          <View style={[s.option, s.ruleTop]}>
            <Touchable
              onPress={() =>
                onGuarded(
                  autoOff ? "Leave it on until switched off" : "Switch itself off",
                  autoOff ? { autoOff: false } : { autoOff: true, autoOffAt: shownDate },
                  autoOff ? "Stays on until switched off" : `Switches itself off after ${dayLong(shownDate)}`,
                )
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: autoOff }}
              accessibilityLabel="Switch itself off after"
              ripple={false}
            >
              <View style={[s.check, autoOff && { backgroundColor: a.fill, borderColor: a.fill }]}>
                {autoOff ? <Icon name="check" size={15} color="#FFFFFF" strokeWidth={2.5} /> : null}
              </View>
            </Touchable>
            <View style={s.flex}>
              <Text style={s.optionTitle}>Switch itself off after</Text>
              <Text style={s.optionHint}>{copy.autoOffHint}</Text>
            </View>
            <Touchable onPress={pickDate} disabled={!autoOff || saving} accessibilityLabel={`Last day ${dayLong(shownDate)}`}>
              <View style={[s.date, !autoOff && s.dim]}>
                <Icon name="calendar" size={15} color={a.muted} />
                <Text style={s.dateText}>{dayLong(shownDate)}</Text>
              </View>
            </Touchable>
          </View>

          <View style={[s.footer, s.ruleTop]}>
            <Icon name="audit" size={15} color={a.faint} />
            <Text style={s.footText}>
              {since
                ? `Last changed by ${flag.updatedByEmail ?? "an admin"}, ${dayLabel(since, now).toLowerCase()} ${clock(since)}. In the Audit Log as SetFeatureFlag.`
                : "Never changed. Every change goes in the Audit Log with who made it."}
            </Text>
          </View>
        </>
      ) : null}

      {otherSeason && !open ? (
        <View style={[s.footer, s.ruleTop]}>
          <Icon name="about" size={15} color={a.faint} />
          <Text style={s.footText}>
            One season at a time: turning {copy.name} on while {otherSeason} is on asks to switch {otherSeason} off first.
          </Text>
        </View>
      ) : null}
    </Panel>
  );
}

/** "Right now" (the web's side card), folded into the sheet as one line. */
function RightNowLine({ look }: { look: string }) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.rnLine}>
      <Text style={s.rnTerm}>Right now</Text>
      <Text style={s.rnValue}>{look}</Text>
    </View>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    dim: { opacity: 0.45 },
    gap14: { marginTop: 14 },
    noPad: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
    head: { flexDirection: "row", gap: 12, padding: 14 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    name: { fontFamily: fonts.semibold, fontSize: 16, color: a.text },
    desc: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted, marginTop: 6 },
    switchCol: { alignItems: "center", gap: 4 },
    fold: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10, marginTop: -6 },
    switchText: { fontFamily: fonts.medium, fontSize: 12.5, color: a.muted },
    block: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: a.line, paddingTop: 12 },
    label: { fontFamily: fonts.medium, fontSize: 13, color: a.muted, marginBottom: 6 },
    item: { flexDirection: "row", gap: 10, paddingVertical: 6 },
    itemTitle: { fontFamily: fonts.medium, fontSize: 14, color: a.text },
    itemDetail: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 1 },
    rightNow: { borderWidth: 1, borderColor: a.line, borderRadius: 10, paddingHorizontal: 12 },
    rnRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
    rule: { borderTopWidth: 1, borderTopColor: a.line2 },
    rnTerm: { fontFamily: fonts.regular, fontSize: 14, color: a.muted },
    rnValue: { fontFamily: fonts.medium, fontSize: 14, color: a.text },
    rnLine: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: a.line,
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    ruleTop: { borderTopWidth: 1, borderTopColor: a.line },
    optionTitle: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    optionHint: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2 },
    check: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: a.dim, alignItems: "center", justifyContent: "center" },
    date: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: a.line },
    dateText: { fontFamily: fonts.medium, fontSize: 13.5, color: a.text },
    footer: { flexDirection: "row", gap: 8, padding: 14 },
    footText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: a.muted },
  });
