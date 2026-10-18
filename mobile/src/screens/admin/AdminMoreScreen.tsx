import React from "react";
import { StyleSheet, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AdminPage, AdminTopBar, PageTitle } from "../../components/admin/AdminChrome";
import { ActionGroup, ActionRow, GroupLabel } from "../../components/admin/AdminUI";
import type { IconName } from "../../components/Icon";
import { openConsole } from "../../lib/adminConsole";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminStyles } from "../../lib/theme";
import type { AdminStackParams } from "../../navigation/types";

type Item = { label: string; icon: IconName } & ({ screen: "AdminGrowth" | "AdminFlags" | "AdminAlerts" } | { web: string });

/** The web sidebar's order (board f-admin/03). Growth and Feature flags are phone screens; the rest open the console. */
const CONSOLE: Item[] = [
  { label: "Insights", icon: "insights", web: "/insights" },
  { label: "Growth", icon: "growth", screen: "AdminGrowth" },
  { label: "Practice", icon: "practice", web: "/practice" },
  { label: "Blog analytics", icon: "blog-analytics", web: "/blog-analytics" },
  { label: "Transcriptions", icon: "music", web: "/transcriptions" },
  { label: "Activity", icon: "activity", web: "/activity" },
  { label: "Feedback", icon: "feedback", web: "/feedback" },
];

const OPERATIONS: Item[] = [
  { label: "Waitlist", icon: "reward", web: "/waitlist" },
  { label: "Inbox", icon: "inbox", web: "/inbox" },
  { label: "Audit Log", icon: "audit", web: "/audit-log" },
  { label: "Feature flags", icon: "flag", screen: "AdminFlags" },
];

/** Writing posts and the console's own settings (a passkey belongs to a browser) stay on the web. */
const WEB_ONLY: Item[] = [
  { label: "Blog posts", icon: "blog-posts", web: "/blog" },
  { label: "Settings and passkeys", icon: "settings", web: "/settings" },
];

/**
 * More (board f-admin/03): the rest of the console in the web sidebar's order, Operations included. Growth, Feature
 * flags and this phone's Payment alerts are screens here; every other row opens that console page in the browser.
 */
export function AdminMoreScreen() {
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParams>>();

  const row = (i: Item) => (
    <ActionRow
      key={i.label}
      icon={i.icon}
      label={i.label}
      external={"web" in i}
      onPress={() => ("web" in i ? openConsole(i.web) : nav.navigate(i.screen))}
    />
  );

  return (
    <AdminPage header={<AdminTopBar />}>
      <PageTitle title="More" sub="The rest of the console, in the web sidebar's order" />
      <ActionGroup style={s.gap14}>{CONSOLE.map(row)}</ActionGroup>
      <GroupLabel>Operations</GroupLabel>
      <ActionGroup>{OPERATIONS.map(row)}</ActionGroup>
      <GroupLabel>On the web console</GroupLabel>
      <ActionGroup>{WEB_ONLY.map(row)}</ActionGroup>
      <GroupLabel>This phone</GroupLabel>
      <ActionGroup>
        <ActionRow icon="bell" label="Payment alerts" hint="The sound when someone pays, quiet hours, names" onPress={() => nav.navigate("AdminAlerts")} />
      </ActionGroup>
      <Text style={s.foot}>Pages marked with an arrow open in the browser, where the console asks you to sign in.</Text>
    </AdminPage>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    gap14: { marginTop: 14 },
    foot: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: a.faint, textAlign: "center", marginTop: 16, paddingHorizontal: 12 },
  });
