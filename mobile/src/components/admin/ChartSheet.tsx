import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Sheet, SheetActions } from "../Sheet";
import { Button } from "../Button";
import { AreaChart, ChartTip } from "./Charts";
import { Change, LinkText, Segmented } from "./AdminUI";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminStyles } from "../../lib/theme";
import { bucketSeries, count, dayShort, seriesFacts, type Bucket, type DayCount } from "../../lib/adminFormat";

export interface ChartRequest {
  title: string;
  /** "19 Sep – 18 Oct · results produced, previews included". */
  hint: string;
  value: string;
  pct: number | null;
  /** "on the 30 days before". */
  pctSuffix: string;
  series: readonly DayCount[];
  /** "transcriptions", "sign-ups": what one point counts. */
  noun: string;
  /** A third figure beside the busiest day and the average ("69% · Kept as sheets"). */
  third?: { value: string; label: string };
  /** The web console page with the rest ("Open Transcriptions"). */
  link?: { label: string; onPress: () => void };
}

/**
 * A tile tapped (board f-admin/02): the figure and its change, the web's Day / Week / Month and its Chart / Table,
 * and a scrub: press and drag on the line and a guide and the web's tooltip follow the finger, a light tick a point.
 */
export function ChartSheet({ request, onClose }: { request: ChartRequest | null; onClose: () => void }) {
  const s = useAdminStyles(makeStyles);
  const [bucket, setBucket] = useState<Bucket>("day");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [scrub, setScrub] = useState<number | null>(null);

  const series = useMemo(() => (request ? bucketSeries(request.series, bucket) : []), [request, bucket]);
  const facts = useMemo(() => (request ? seriesFacts(request.series) : null), [request]);
  const label = (d: DayCount) => {
    const date = new Date(d.date + "T00:00:00");
    return bucket === "day" ? dayShort(date) : bucket === "week" ? `Week of ${date.getDate()} ${dayShort(date).slice(-3)}` : dayShort(date).slice(-3);
  };
  const short = (d: DayCount | undefined) => (d ? dayShort(new Date(d.date + "T00:00:00")).slice(4) : "");

  return (
    <Sheet visible={request !== null} onClose={onClose} onClosed={() => setScrub(null)}>
      {request ? (
        <ScrollView bounces={false} scrollEnabled={scrub === null}>
          <View style={s.head}>
            <View style={s.flex}>
              <Text style={s.title}>{request.title}</Text>
              <Text style={s.hint}>{request.hint}</Text>
            </View>
            <Segmented
              options={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ]}
              value={view}
              onChange={setView}
            />
          </View>
          <View style={s.figure}>
            <Text style={s.value}>{request.value}</Text>
            <Change pct={request.pct} suffix={request.pctSuffix} />
          </View>
          <Segmented
            wide
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
            value={bucket}
            onChange={(b) => {
              setBucket(b);
              setScrub(null);
            }}
          />
          {view === "chart" ? (
            <View style={s.chart}>
              <AreaChart
                values={series.map((p) => p.count)}
                labels={[short(series[0]), short(series[Math.floor(series.length / 2)]), short(series[series.length - 1])]}
                height={190}
                scrub={scrub}
                onScrub={setScrub}
              />
              {scrub !== null && series[scrub] ? (
                <View style={s.tipWrap} pointerEvents="none">
                  <ChartTip title={label(series[scrub]!)} line={`${count(series[scrub]!.count)} ${request.noun}`} />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={s.table}>
              {[...series].reverse().map((p) => (
                <View key={p.date} style={s.tableRow}>
                  <Text style={s.tableDay}>{label(p)}</Text>
                  <Text style={s.tableValue}>{count(p.count)}</Text>
                </View>
              ))}
            </View>
          )}
          {facts ? (
            <View style={s.facts}>
              <View style={s.fact}>
                <Text style={s.factValue}>{facts.busiest ? count(facts.busiest.count) : "0"}</Text>
                <Text style={s.factLabel}>{`Busiest day${facts.busiest ? `\n${dayShort(new Date(facts.busiest.date + "T00:00:00"))}` : ""}`}</Text>
              </View>
              <View style={s.fact}>
                <Text style={s.factValue}>{count(facts.average)}</Text>
                <Text style={s.factLabel}>{"A day on\naverage"}</Text>
              </View>
              {request.third ? (
                <View style={s.fact}>
                  <Text style={s.factValue}>{request.third.value}</Text>
                  <Text style={s.factLabel}>{request.third.label}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <SheetActions style={s.actions}>
            {request.link ? <LinkText label={request.link.label} onPress={request.link.onPress} style={s.openLink} /> : null}
            <View style={s.flex} />
            <Button label="Done" variant="secondary" onPress={onClose} />
          </SheetActions>
        </ScrollView>
      ) : null}
    </Sheet>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    title: { fontFamily: fonts.semibold, fontSize: 19, color: a.text, letterSpacing: -0.2 },
    hint: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted, marginTop: 4 },
    figure: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 14, marginBottom: 14 },
    value: { fontFamily: fonts.semibold, fontSize: 34, letterSpacing: -0.8, color: a.text, fontVariant: ["tabular-nums"] },
    chart: { marginTop: 16 },
    tipWrap: { position: "absolute", left: 0, right: 0, top: 0, alignItems: "center" },
    table: { marginTop: 12, maxHeight: 260 },
    tableRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: a.line2 },
    tableDay: { fontFamily: fonts.regular, fontSize: 14, color: a.muted },
    tableValue: { fontFamily: fonts.medium, fontSize: 14, color: a.text, fontVariant: ["tabular-nums"] },
    facts: { flexDirection: "row", gap: 10, marginTop: 16 },
    fact: { flex: 1, backgroundColor: a.sub, borderRadius: 10, padding: 12 },
    factValue: { fontFamily: fonts.semibold, fontSize: 18, color: a.text, fontVariant: ["tabular-nums"] },
    factLabel: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: a.muted, marginTop: 4 },
    actions: { marginTop: 18, alignItems: "center" },
    openLink: { fontSize: 15.5 },
  });
