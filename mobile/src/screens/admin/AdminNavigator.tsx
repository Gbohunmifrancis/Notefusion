import React, { useCallback, useEffect } from "react";
import { AppState, View } from "react-native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { AdminExitContext, AdminStackBar, AdminTabBar } from "../../components/admin/AdminChrome";
import { AwayCover, LockedView } from "../../components/admin/LockedView";
import { adminApi } from "../../api/endpoints";
import { writeAdminData } from "../../lib/adminCache";
import { noteAdminActivity, useAdminLock, useAdminPresence } from "../../lib/adminLockRuntime";
import { syncPaymentAlerts } from "../../lib/paymentAlertsRuntime";
import { useAdminColors } from "../../lib/theme";
import type { AdminStackParams, AdminTabParams, RootStackParams } from "../../navigation/types";
import type { AdminTabName } from "../../lib/navTargets";
import { AdminOverviewScreen } from "./AdminOverviewScreen";
import { AdminPaymentsScreen } from "./AdminPaymentsScreen";
import { AdminUsersScreen } from "./AdminUsersScreen";
import { AdminHealthScreen } from "./AdminHealthScreen";
import { AdminMoreScreen } from "./AdminMoreScreen";
import { AdminUserScreen } from "./AdminUserScreen";
import { AdminGrowthScreen } from "./AdminGrowthScreen";
import { AdminFlagsScreen } from "./AdminFlagsScreen";
import { AdminAlertsScreen } from "./AdminAlertsScreen";

const Stack = createNativeStackNavigator<AdminStackParams>();
const Tabs = createBottomTabNavigator<AdminTabParams>();

/** How often the top bar's "online" count and the Payments pip are read while Admin is open and in front. */
const LIVE_EVERY_MS = 60_000;

function AdminTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <AdminTabBar {...props} />} backBehavior="firstRoute">
      <Tabs.Screen name="Overview" component={AdminOverviewScreen} />
      <Tabs.Screen name="Payments" component={AdminPaymentsScreen} />
      <Tabs.Screen name="Users" component={AdminUsersScreen} />
      <Tabs.Screen name="Health" component={AdminHealthScreen} />
      <Tabs.Screen name="More" component={AdminMoreScreen} />
    </Tabs.Navigator>
  );
}

/** A page pushed over the tabs keeps the bottom bar, its tab lit (boards f-admin/03, 05, 07). */
function WithBar({ tab, children }: { tab: AdminTabName; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      {children}
      <AdminStackBar tab={tab} />
    </View>
  );
}

const UserPage = () => (
  <WithBar tab="Users">
    <AdminUserScreen />
  </WithBar>
);
const GrowthPage = () => (
  <WithBar tab="More">
    <AdminGrowthScreen />
  </WithBar>
);
const FlagsPage = () => (
  <WithBar tab="More">
    <AdminFlagsScreen />
  </WithBar>
);
const AlertsPage = () => (
  <WithBar tab="More">
    <AdminAlertsScreen />
  </WithBar>
);

/** Admin once the lock is open: who is online and the Payments pip kept fresh, and this phone's alerts sent once. */
function AdminOpen() {
  const a = useAdminColors();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const read = () => {
      void adminApi.live().then((v) => live && writeAdminData("live", v)).catch(() => undefined);
      void adminApi.paymentsSummary().then((v) => live && writeAdminData("payments-summary", v)).catch(() => undefined);
    };
    // Only while the app is in front: behind, nobody is looking, and coming forward reads them once at once.
    const run = () => {
      if (timer) return;
      read();
      timer = setInterval(read, LIVE_EVERY_MS);
    };
    const halt = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") run();
    const sub = AppState.addEventListener("change", (next) => (next === "active" ? run() : halt()));
    // This phone's payment alerts: on by default the first time Admin opens here, and kept in step after.
    void syncPaymentAlerts();
    return () => {
      live = false;
      halt();
      sub.remove();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: a.bg }}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: a.bg } }}>
        <Stack.Screen name="AdminTabs" component={AdminTabs} />
        <Stack.Screen name="AdminUser" component={UserPage} options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="AdminGrowth" component={GrowthPage} options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="AdminFlags" component={FlagsPage} options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="AdminAlerts" component={AlertsPage} options={{ animation: "slide_from_right" }} />
      </Stack.Navigator>
    </View>
  );
}

/**
 * The Admin route (registered for admins only): the lock first, then the admin's own stack. While it is on screen,
 * nothing of it can be screenshotted or seen in Recents, a cover hides it whenever the app is not in front, and 5
 * minutes away (from the app, or out of Admin) or 5 minutes without a tap locks it again and drops what it read.
 */
export function AdminRoot({ navigation }: NativeStackScreenProps<RootStackParams, "Admin">) {
  const { unlocked, method } = useAdminLock();
  const away = useAdminPresence();

  const exit = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Tabs", { screen: "Home" });
  }, [navigation]);

  return (
    <AdminExitContext.Provider value={exit}>
      {/* Every touch restarts the 5 minutes without a tap; it watches and never takes the touch. */}
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          noteAdminActivity();
          return false;
        }}
      >
        {unlocked ? <AdminOpen /> : <LockedView method={method} onBack={exit} />}
      </View>
      {away ? <AwayCover /> : null}
    </AdminExitContext.Provider>
  );
}
