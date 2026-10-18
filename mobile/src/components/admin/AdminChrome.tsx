import React, { createContext, useContext } from "react";
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AdminStackParams } from "../../navigation/types";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { Mark, Wordmark } from "../night/NightUI";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles, useTheme } from "../../lib/theme";
import { ADMIN_TAB_ORDER, type AdminTabName } from "../../lib/navTargets";
import { useAdminData } from "../../lib/adminCache";
import type { LiveActivity, PaymentOpsSummary } from "../../api/types";

/**
 * The phone admin's chrome (boards f-admin/01–03): the top bar (the lock-up with its "Admin" chip, who is online
 * and the × that leaves Admin, or a back bar on a pushed page), the admin's own bottom bar, and the page that
 * scrolls between them with pull to refresh.
 */

/** Leaves Admin for the app (the × and Android back from a tab's root): set by the Admin root. */
export const AdminExitContext = createContext<() => void>(() => undefined);

/** "9 online", read from the live feed the Admin root keeps fresh. */
function OnlinePill() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const live = useAdminData<LiveActivity>("live");
  if (!live) return null;
  return (
    <View style={[s.online, { backgroundColor: a.onlineBg }]} accessibilityLabel={`${live.online.length} online`}>
      <View style={[s.onlineDot, { backgroundColor: a.ok, borderColor: a.okTint[1] }]} />
      <Text style={[s.onlineText, { color: a.onlineText }]}>{`${live.online.length} online`}</Text>
    </View>
  );
}

/** The lock-up: our mark on its blue tile, the wordmark and the "Admin" chip. */
export function AdminLockup() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.lockup}>
      <View style={s.markTile}>
        <Mark height={17} />
      </View>
      <Wordmark size={18} style={{ color: a.text }} />
      <View style={s.chip}>
        <Text style={s.chipText}>Admin</Text>
      </View>
    </View>
  );
}

export function AdminTopBar({ online = true, flat = false }: { online?: boolean; flat?: boolean }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const exit = useContext(AdminExitContext);
  return (
    <View style={[s.top, flat && s.topFlat]}>
      <AdminLockup />
      <View style={s.topRight}>
        {online ? <OnlinePill /> : null}
        <Touchable onPress={exit} ripple="borderless" accessibilityLabel="Leave Admin" hitSlop={6}>
          <View style={s.iconHit}>
            <Icon name="close" size={20} color={a.muted} />
          </View>
        </Touchable>
      </View>
    </View>
  );
}

/** A pushed page's bar: ‹ and where back goes ("Users", "More"), then the page's own buttons. */
export function AdminBackBar({ label, onBack, right }: { label: string; onBack: () => void; right?: React.ReactNode }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.top}>
      <Touchable onPress={onBack} accessibilityLabel={`Back to ${label}`} ripple={false}>
        <View style={s.back}>
          <Icon name="back" size={20} color={a.text} />
          <Text style={s.backText}>{label}</Text>
        </View>
      </Touchable>
      <View style={s.topRight}>{right}</View>
    </View>
  );
}

/** An icon button for a bar (mail, ⋯). */
export function BarButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <Touchable onPress={onPress} ripple="borderless" accessibilityLabel={label}>
      <View style={s.iconHit}>
        <Icon name={icon} size={20} color={a.muted} />
      </View>
    </Touchable>
  );
}

/** A page's title and the line under it ("Payments", "Every checkout, newest first"), with an optional control. */
export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.titleRow}>
      <View style={s.flex}>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/**
 * The page between the bars: safe area at the top, the canvas, 16 px gutters, pull to refresh. `header` is the bar
 * (it does not scroll); `sticky` sits under it once the page scrolls (the range presets, Growth's chips).
 */
export function AdminPage({
  header,
  children,
  onRefresh,
  refreshing = false,
  scroll = true,
  contentStyle,
  stickyIndex,
  onScroll,
  overlay,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** The index of a child that sticks under the bar once scrolled. */
  stickyIndex?: number;
  /** The scroll position, for a page that pins its own row under the bar once its title has gone. */
  onScroll?: (y: number) => void;
  /** Drawn over the top of the page, under the bar (that pinned row). */
  overlay?: React.ReactNode;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const { mode } = useTheme();
  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} backgroundColor="transparent" translucent />
      {header}
      {scroll ? (
        <View style={s.flex}>
        <ScrollView
          onScroll={onScroll ? (e) => onScroll(e.nativeEvent.contentOffset.y) : undefined}
          scrollEventThrottle={onScroll ? 32 : undefined}
          contentContainerStyle={[s.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          stickyHeaderIndices={stickyIndex === undefined ? undefined : [stickyIndex]}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={a.muted} colors={[a.brand]} progressBackgroundColor={a.card} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
        {overlay ? <View style={s.overlay}>{overlay}</View> : null}
        </View>
      ) : (
        <View style={[s.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const CELLS: Record<AdminTabName, { label: string; icon: IconName }> = {
  Overview: { label: "Overview", icon: "overview" },
  Payments: { label: "Payments", icon: "card" },
  Users: { label: "Users", icon: "users" },
  Health: { label: "Health", icon: "health" },
  More: { label: "More", icon: "more" },
};

/** How many payments need a look (paid with no Pro, stuck), from the summary Payments and the Overview read. */
export function needsLookCount(summary: PaymentOpsSummary | undefined): number {
  return summary ? summary.verifiedCount + summary.stuckCount : 0;
}

/** The admin's own bottom bar: five labelled cells, blue for the one you are on, an amber count on Payments. */
export function AdminTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <AdminBar
      current={state.routes[state.index]?.name}
      onSelect={(name, on) => {
        const route = state.routes.find((r) => r.name === name);
        const event = navigation.emit({ type: "tabPress", target: route?.key ?? name, canPreventDefault: true });
        if (!on && !event.defaultPrevented) navigation.navigate(name);
      }}
    />
  );
}

/**
 * The same bar under a page pushed over the tabs (an account under Users; Growth, Feature flags and Payment alerts
 * under More), as on the boards: its tab stays lit, and a tap goes back to the tabs on the one tapped.
 */
export function AdminStackBar({ tab }: { tab: AdminTabName }) {
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParams>>();
  return <AdminBar current={tab} onSelect={(name) => navigation.navigate("AdminTabs", { screen: name })} />;
}

function AdminBar({ current, onSelect }: { current: string | undefined; onSelect: (name: AdminTabName, on: boolean) => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const pip = needsLookCount(useAdminData<PaymentOpsSummary>("payments-summary"));

  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {ADMIN_TAB_ORDER.map((name) => {
        const on = current === name;
        return (
          <Touchable
            key={name}
            style={s.flex}
            ripple={false}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={name === "Payments" && pip ? `${CELLS[name].label}, ${pip} need a look` : CELLS[name].label}
            onPress={() => onSelect(name, on)}
          >
            <View style={s.cell}>
              <View>
                <Icon name={CELLS[name].icon} size={23} color={on ? a.brand : a.muted} filled={on} />
                {name === "Payments" && pip > 0 ? (
                  <View style={[s.pip, { backgroundColor: a.warn, borderColor: a.bg }]}>
                    <Text style={s.pipText}>{pip > 9 ? "9+" : pip}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[s.cellText, { color: on ? a.text : a.muted }]}>{CELLS[name].label}</Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    safe: { flex: 1, backgroundColor: a.bg },
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
    overlay: { position: "absolute", left: 0, right: 0, top: 0 },

    top: {
      height: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: 16,
      paddingRight: 8,
      borderBottomWidth: 1,
      borderBottomColor: a.line,
      backgroundColor: a.bg,
    },
    topFlat: { borderBottomColor: "transparent" },
    topRight: { flexDirection: "row", alignItems: "center", gap: 4 },
    lockup: { flexDirection: "row", alignItems: "center", gap: 8 },
    markTile: { width: 28, height: 28, borderRadius: 8, backgroundColor: a.fill, alignItems: "center", justifyContent: "center" },
    chip: { borderWidth: 1, borderColor: a.line, borderRadius: 5, paddingHorizontal: 6, height: 20, justifyContent: "center" },
    chipText: { fontFamily: fonts.medium, fontSize: 11.5, color: a.muted },
    online: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 999 },
    onlineDot: { width: 7, height: 7, borderRadius: 4, borderWidth: 0 },
    onlineText: { fontFamily: fonts.medium, fontSize: 12.5 },
    iconHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    back: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingRight: 12 },
    backText: { fontFamily: fonts.medium, fontSize: 16.5, color: a.text },

    titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    title: { fontFamily: fonts.semibold, fontSize: 23, letterSpacing: -0.4, color: a.text },
    sub: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, marginTop: 3, lineHeight: 19 },

    bar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: a.line, backgroundColor: a.bg, paddingTop: 8 },
    cell: { alignItems: "center", gap: 3, minHeight: 50, justifyContent: "center" },
    cellText: { fontFamily: fonts.medium, fontSize: 11.5 },
    pip: {
      position: "absolute",
      top: -6,
      right: -10,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    pipText: { fontFamily: fonts.bold, fontSize: 10, color: "#1A1205" },
  });
