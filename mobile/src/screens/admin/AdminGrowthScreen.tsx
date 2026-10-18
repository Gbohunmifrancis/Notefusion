import React, { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AdminBackBar } from "../../components/admin/AdminChrome";
import { Badge, FilterChips, Initials, List, ListRow, LoadState, Panel, Segmented, StatTile, TileGrid } from "../../components/admin/AdminUI";
import { StackBar } from "../../components/admin/Charts";
import { Icon } from "../../components/Icon";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import type { Growth } from "../../api/types";
import { useAdminQuery } from "../../lib/adminCache";
import { showDialog } from "../../lib/dialog";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { count, dayShort, initials, parseUtc, rangeFor, type RangePreset } from "../../lib/adminFormat";
import type { AdminStackParams } from "../../navigation/types";

type Section = "renewals" | "free" | "health" | "versions";

const SECTIONS: { value: Section; label: string }[] = [
  { value: "renewals", label: "Renewals" },
  { value: "free", label: "Free to paid" },
  { value: "health", label: "Transcription health" },
  { value: "versions", label: "App versions" },
];

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

/**
 * More › Growth (board f-admin/03): the web page's sections as sticky chips (Renewals, Free to paid, Transcription
 * health, App versions), each with the web's figures as tiles, its chart with the Chart / Table switch, and its list
 * as rows that open the account. The same endpoint the web reads, so the numbers always agree.
 */
export function AdminGrowthScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParams>>();
  const [days, setDays] = useState<RangePreset>(30);
  const [section, setSection] = useState<Section>("renewals");
  const [view, setView] = useState<"chart" | "table">("chart");
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<Section, number>>>({});
  const now = new Date();
  const { from, to } = rangeFor(days, now);
  const q = useAdminQuery<Growth>(`growth:${days}:${from.toDateString()}`, () => adminApi.growth(from.toISOString(), to.toISOString()));
  const g = q.data;

  const at = (key: Section) => (e: LayoutChangeEvent) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };
  const jump = (key: Section) => {
    setSection(key);
    const y = offsets.current[key];
    if (y !== undefined) scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const pickDays = () =>
    showDialog({
      title: "Show",
      actions: ([7, 30, 90] as const).map((d) => ({ label: `${d} days`, icon: "calendar" as const, selected: d === days, onPress: () => setDays(d) })),
    });

  const r = g?.renewals;

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <AdminBackBar
        label="More"
        onBack={() => nav.goBack()}
        right={
          <Touchable onPress={pickDays} accessibilityLabel={`${days} days`}>
            <View style={s.dateBtn}>
              <Icon name="calendar" size={15} color={a.muted} />
              <Text style={s.dateText}>{`${days} days`}</Text>
            </View>
          </Touchable>
        }
      />
      <View style={s.chips}>
        <FilterChips options={SECTIONS} value={section} onChange={jump} />
      </View>
      <ScrollView ref={scroller} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {!g || !r ? (
          <LoadState loading={q.loading} error={q.error} onRetry={q.refresh} />
        ) : (
          <>
            <View onLayout={at("renewals")}>
              <Text style={s.h1}>Renewals</Text>
              <Text style={s.sub}>Nothing renews by itself: a member buys again to add a period.</Text>
              <View style={s.gap14}>
                <TileGrid>
                  <StatTile label="Ending in 7 days" value={count(r.endingIn7Days)} sub="Pro and choirs" />
                  <StatTile
                    label="Ending in 30 days"
                    value={count(r.endingIn30Days)}
                    sub={r.endingIn30DaysByKind.map((k) => `${k.count} ${k.label.toLowerCase()}`).join(" · ") || "None"}
                  />
                  <StatTile label="Renewal rate" value={pct(r.renewalRate)} sub={`${r.renewedEarly + r.renewedLate} of ${r.dueInWindow - r.deciding} decided`} />
                  <StatTile label="Still deciding" value={count(r.deciding)} sub={`Ended under ${r.graceDays} days ago`} />
                </TileGrid>
              </View>
              <Panel
                style={s.gap12}
                title="What happened at each due end"
                action={
                  <Segmented
                    options={[
                      { value: "chart", label: "Chart" },
                      { value: "table", label: "Table" },
                    ]}
                    value={view}
                    onChange={setView}
                  />
                }
              >
                {view === "chart" ? (
                  <StackBar
                    parts={[
                      { label: "Renewed before the end", value: r.renewedEarly, color: a.series },
                      { label: `Renewed within ${r.graceDays} days after`, value: r.renewedLate, color: a.teal },
                      { label: "Lapsed", value: r.lapsed, color: a.orange },
                      { label: "Still deciding", value: r.deciding, color: a.grey },
                    ]}
                  />
                ) : (
                  <View>
                    {[
                      ["Due in the window", r.dueInWindow],
                      ["Renewed before the end", r.renewedEarly],
                      [`Renewed within ${r.graceDays} days after`, r.renewedLate],
                      ["Lapsed", r.lapsed],
                      ["Still deciding", r.deciding],
                    ].map(([label, value]) => (
                      <View key={String(label)} style={s.tableRow}>
                        <Text style={s.tableLabel}>{label}</Text>
                        <Text style={s.tableValue}>{count(Number(value))}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Panel>
              {r.endingSoon.length ? (
                <>
                  <Text style={s.group}>Ending soon</Text>
                  <List>
                    {r.endingSoon.slice(0, 12).map((m) => (
                      <ListRow
                        key={`${m.userId}-${m.endsAtUtc}`}
                        leading={<Initials text={initials(m.fullName || m.email)} />}
                        title={m.fullName || m.email}
                        titleExtra={<Badge label={m.kind === "Choir" ? "Choir" : "Pro"} tone={m.kind === "Choir" ? "choir" : "prem"} />}
                        line={`${m.plan} · ends ${dayShort(parseUtc(m.endsAtUtc))}${m.paid ? "" : " · gift"}`}
                        onPress={() => nav.navigate("AdminUser", { userId: m.userId })}
                      />
                    ))}
                  </List>
                </>
              ) : null}
            </View>

            <View onLayout={at("free")} style={s.section}>
              <Text style={s.h1}>Free to paid</Text>
              <Text style={s.sub}>By price set: who signed up in the window and how far each got.</Text>
              {g.freeToPaid.map((f) => (
                <Panel key={f.set} style={s.gap12} title={f.set} action={<Text style={s.note}>{`${pct(f.paidRate)} paid`}</Text>}>
                  {[
                    ["Signed up", f.signedUp],
                    ["Transcribed", f.transcribed],
                    ["Reached the free limit", f.reachedFreeLimit],
                    ["Started a checkout", f.startedCheckout],
                    ["Paid", f.paid],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={s.tableRow}>
                      <Text style={s.tableLabel}>{label}</Text>
                      <Text style={s.tableValue}>{count(Number(value))}</Text>
                    </View>
                  ))}
                  {f.medianDaysToPay !== null ? <Text style={s.note}>{`Median ${f.medianDaysToPay} days from sign-up to paying`}</Text> : null}
                </Panel>
              ))}
            </View>

            <View onLayout={at("health")} style={s.section}>
              <Text style={s.h1}>Transcription health</Text>
              <Text style={s.sub}>Failures by kind, and song links refused or failed.</Text>
              <Panel style={s.gap12}>
                {g.transcriptions.byKind.map((k) => (
                  <View key={k.kind} style={s.tableRow}>
                    <Text style={s.tableLabel}>{k.kind}</Text>
                    <Text style={s.tableValue}>{`${count(k.started)} · ${pct(k.failureRate)} failed`}</Text>
                  </View>
                ))}
                <View style={s.tableRow}>
                  <Text style={s.tableLabel}>Song links</Text>
                  <Text style={s.tableValue}>{`${count(g.transcriptions.linkAttempts)} · ${count(g.transcriptions.linkRefused)} refused · ${count(g.transcriptions.linkFailed)} failed`}</Text>
                </View>
              </Panel>
            </View>

            <View onLayout={at("versions")} style={s.section}>
              <Text style={s.h1}>App versions</Text>
              <Text style={s.sub}>{`${count(g.appVersions.onLatestBuild)} of ${count(g.appVersions.phones)} phones on build ${g.appVersions.latestBuild}.`}</Text>
              <Panel style={s.gap12}>
                {g.appVersions.builds.slice(0, 10).map((b) => (
                  <View key={b.build} style={s.tableRow}>
                    <Text style={s.tableLabel}>{`Build ${b.build}`}</Text>
                    <Text style={s.tableValue}>{`${count(b.phones)} · ${count(b.android)} Android · ${count(b.ios)} iOS`}</Text>
                  </View>
                ))}
              </Panel>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: a.bg },
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40 },
    chips: { paddingLeft: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: a.line, backgroundColor: a.bg },
    dateBtn: { flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: a.line, marginRight: 8 },
    dateText: { fontFamily: fonts.medium, fontSize: 13.5, color: a.text },
    h1: { fontFamily: fonts.semibold, fontSize: 21, letterSpacing: -0.3, color: a.text },
    sub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted, marginTop: 4 },
    gap12: { marginTop: 12 },
    gap14: { marginTop: 14 },
    section: { marginTop: 26, paddingTop: 20, borderTopWidth: 1, borderTopColor: a.line },
    group: { fontFamily: fonts.medium, fontSize: 13, color: a.faint, marginTop: 18, marginBottom: 8, marginHorizontal: 4 },
    tableRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: a.line2 },
    tableLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: a.text },
    tableValue: { fontFamily: fonts.medium, fontSize: 13.5, color: a.muted, fontVariant: ["tabular-nums"], textAlign: "right" },
    note: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 6 },
  });
