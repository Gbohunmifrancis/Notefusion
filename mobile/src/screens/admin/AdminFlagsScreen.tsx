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

const TURNS_ON: { icon: IconName; title: string; detail: string }[] = [
  { icon: "reward", title: "A small Santa cap on the mark", detail: "Splash, headers, the website logo" },
  { icon: "snow", title: "A few seconds of snow", detail: "Splash and the top of Home" },
  { icon: "music", title: "A carol chime, once a season", detail: "" },
  { icon: "hymns", title: "Carols at the top of Hymns", detail: "" },
  { icon: "practice", title: "The carols practice path", detail: "" },
  { icon: "bell", title: "Christmas wording in pushes", detail: "" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-01-06" → "6 Jan 2027". */
function dayLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The last days on offer: the end of the year, New Year's Day, Epiphany (the server's default) and a week after. */
function lastDays(suggested: string): string[] {
  const y = Number(suggested.slice(0, 4));
  return [`${y - 1}-12-31`, `${y}-01-01`, `${y}-01-06`, `${y}-01-13`];
}

/**
 * More › Feature flags (board f-admin/07): the web's Christmas card, stacked. Same name, same Off pill, what it turns
 * on, the admins-only preview and the switch-off date; every control saves at once. Turning it on or off asks in the
 * web's own words, then the phone's lock; the preview and the date ask the lock alone, because every change to a
 * flag changes what customers see.
 */
export function AdminFlagsScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation();
  const { method } = useAdminLock();
  const q = useAdminQuery<FeatureFlag[]>("features", adminApi.features);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const flag = q.data?.find((f) => f.key === "christmas") ?? q.data?.[0];
  const now = new Date();

  async function save(change: FeatureFlagChange): Promise<FeatureFlag> {
    if (!flag) throw new Error("No flag");
    const next = await adminApi.setFeature(flag.key, change);
    writeAdminData("features", (q.data ?? []).map((f) => (f.key === next.key ? next : f)));
    return next;
  }

  /** A quiet change (the preview, the date): the phone's lock, then the save; a sheet only when the phone has none. */
  async function guarded(reason: string, change: FeatureFlagChange, done: string) {
    if (method === "code") {
      setConfirm({
        title: reason,
        message: "Every change to a flag changes what someone sees, so it is confirmed first.",
        confirmLabel: "Save",
        secondAsk: true,
        onConfirm: async () => {
          await save(change);
          showToast(done);
        },
      });
      return;
    }
    if (!(await askPhoneLock(reason))) return;
    setSaving(true);
    try {
      await save(change);
      showToast(done);
    } catch (e) {
      showDialog({ title: "That didn't save", message: toApiError(e).message, icon: "problem", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  if (!flag)
    return (
      <AdminPage header={<AdminBackBar label="More" onBack={() => nav.goBack()} />}>
        <LoadState loading={q.loading} error={q.error} onRetry={q.refresh} />
      </AdminPage>
    );

  const dateAhead = flag.autoOffAt !== null && (flag.autoOffAtUtc === null || parseUtc(flag.autoOffAtUtc) > now);
  const shownDate = dateAhead && flag.autoOffAt ? flag.autoOffAt : flag.suggestedAutoOffAt;
  const autoOff = flag.autoOffAt !== null;
  const look = flag.on ? "Christmas" : flag.adminPreview ? "Normal · Christmas for admins" : "Normal";

  const askToSwitch = (on: boolean) =>
    setConfirm(
      on
        ? {
            title: "Turn on Christmas for everyone?",
            message: `The website and web app change on their next page load. The phone app changes when it next reads the flag, and the splash from its next launch. Practice reminders use the Christmas wording from the next run.\n\n${
              autoOff ? `It switches itself off after ${dayLong(shownDate)}. You can turn it off sooner from here.` : "It stays on until you turn it off here."
            }`,
            confirmLabel: "Turn on",
            secondAsk: true,
            extra: <RightNowLine look={look} />,
            onConfirm: async () => {
              await save({ enabled: true, autoOff, ...(autoOff ? { autoOffAt: shownDate } : {}) });
              showToast("Christmas is on for everyone");
            },
          }
        : {
            title: "Turn off Christmas for everyone?",
            message:
              "The website and web app go back to normal on their next page load, the phone app when it next reads the flag (the splash from its next launch), and practice reminders from the next run. Stickers already earned stay in people's books.",
            confirmLabel: "Turn off",
            secondAsk: true,
            extra: <RightNowLine look={look} />,
            onConfirm: async () => {
              await save({ enabled: false });
              showToast("Christmas is off for everyone");
            },
          },
    );

  const pickDate = () =>
    showDialog({
      title: "Switch itself off after",
      actions: lastDays(flag.suggestedAutoOffAt).map((d) => ({
        label: dayLong(d),
        icon: "calendar" as IconName,
        selected: d === shownDate,
        onPress: () => void guarded("Change the switch-off date", { autoOff: true, autoOffAt: d }, `Switches itself off after ${dayLong(d)}`),
      })),
    });

  const since = flag.updatedAtUtc ? parseUtc(flag.updatedAtUtc) : null;

  return (
    <AdminPage header={<AdminBackBar label="More" onBack={() => nav.goBack()} />} onRefresh={q.refresh} refreshing={q.refreshing}>
      <PageTitle title="Feature flags" sub="Switches that change what everyone sees. Each stays off until you turn it on." />

      <Panel style={s.gap14} bodyStyle={s.noPad}>
        <View style={s.head}>
          <View style={s.flex}>
            <View style={s.nameRow}>
              <Icon name="snow" size={17} color={a.faint} />
              <Text style={s.name}>{flag.name}</Text>
              <Badge label={flag.on ? "On" : "Off"} tone={flag.on ? "ok" : "neutral"} />
            </View>
            <Text style={s.desc}>
              {flag.on
                ? `On for everyone${since ? ` since ${clock(since)}` : ""}.${autoOff ? ` It switches itself off after ${dayLong(shownDate)}.` : ""}`
                : `The Christmas touches in one switch: website, web app and phone app at once. No store update needed.${
                    flag.switchedItselfOff && flag.autoOffAt ? ` It switched itself off after ${dayLong(flag.autoOffAt)}.` : ""
                  }`}
            </Text>
          </View>
          <View style={s.switchCol}>
            <AdminSwitch value={flag.on} onChange={askToSwitch} disabled={saving} label={`${flag.name}: ${flag.on ? "on for everyone" : "off"}`} />
            <Text style={s.switchText}>{flag.on ? "On" : "Off"}</Text>
          </View>
        </View>

        {flag.on ? (
          <View style={s.block}>
            <View style={s.rightNow}>
              {[
                ["Website", look],
                ["Web app", look],
                ["Phone app", look],
                ["Practice reminders", "Christmas words"],
              ].map(([surface, shows], i) => (
                <View key={surface} style={[s.rnRow, i > 0 && s.rule]}>
                  <Text style={s.rnTerm}>{surface}</Text>
                  <Text style={s.rnValue}>{shows}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.block}>
            <Text style={s.label}>What it turns on</Text>
            {TURNS_ON.map((t) => (
              <View key={t.title} style={s.item}>
                <Icon name={t.icon} size={17} color={a.faint} />
                <View style={s.flex}>
                  <Text style={s.itemTitle}>{t.title}</Text>
                  {t.detail ? <Text style={s.itemDetail}>{t.detail}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

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
              void guarded(next ? "Turn the admin preview on" : "Turn the admin preview off", { adminPreview: next }, next ? "Preview on for admins" : "Preview off")
            }
          />
        </View>

        <View style={[s.option, s.ruleTop]}>
          <Touchable
            onPress={() =>
              void guarded(
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
            <Text style={s.optionHint}>So it can't be forgotten into February</Text>
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
      </Panel>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </AdminPage>
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
