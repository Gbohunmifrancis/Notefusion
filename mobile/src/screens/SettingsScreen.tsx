import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Button } from "../components/Button";
import { GoogleG } from "../components/night/GoogleG";
import { BackButton, Group, GroupNote, PageTitle, Row, Segmented } from "../components/settings/Rows";
import { AboutSheet, DeleteAccountSheet, NameSheet, PasswordSheet } from "../components/settings/AccountSheets";
import { useAuth } from "../lib/auth";
import { showDialog } from "../lib/dialog";
import { siteUrls } from "../lib/env";
import * as haptics from "../lib/haptics";
import { meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { setDataSaver, useDataSaver } from "../lib/dataSaver";
import { setDohSuggestions, useDohSuggestions } from "../lib/dohPrefs";
import { clearAutomaticCopies, setKeepAllOffline, useOfflineLibrary } from "../lib/offlineLibrary";
import { usePackState } from "../lib/hymnPackStore";
import { formatBytes } from "../lib/hymnPack";
import { outboxPending } from "../lib/outbox";
import * as Listen from "../../modules/notefusion-listen";
import { ListenAnywhereSheet } from "../components/settings/ListenAnywhereSheet";
import { useSubscription } from "../lib/subscription";
import { showToast } from "../lib/toast";
import {
  SETUP_WORDS,
  SOURCE_CHOICES,
  SOURCE_NOTE,
  PRO_ONLY_HINT,
  groupNote,
  listenAllowance,
  nextSetupStep,
  setupDone,
  sourceLabel,
  type SetupState,
} from "../lib/listenAnywhere";
import { signOutWarning } from "../lib/sendQueue";
import { logAnalyticsEvent } from "../lib/analytics";
import { logAppEvent } from "../lib/appEvents";
import type { MyProfile } from "../api/types";
import { fonts, spacing, type Palette, type ThemeMode } from "../design/theme";
import { useTheme, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Settings">;

type Sheet = "name" | "password" | "about" | "delete" | null;

/**
 * Settings (board b-system/12a): the account and this phone, in five quiet groups.
 *
 *   • Account — Name and Password open one-field sheets; Email is read only (no route changes it) and wears
 *     Google's G for an account that signs in with Google, which has no Password row.
 *   • Look & feel — Theme as a Night | Day switch you can see, haptic feedback, and Doh's suggestions (Home's card):
 *     not all of it is how the app looks, so the group is not called Appearance.
 *   • Data & offline — data saver, keeping every saved sheet offline, the offline hymns (the Hymns tab), and
 *     "Clear offline copies".
 *   • About — the legal pages and About Notefusion. Help & support and Send feedback are Profile's alone (board
 *     n-ux-low Q5i).
 *   • Sign out (it asks first only when recordings are still waiting to send: they go with it), then Delete
 *     account last: the one red word, opening a sheet where the password (or Google) is the confirmation.
 *
 * Notifications are their own screen (Profile › Notifications).
 */
export function SettingsScreen({ navigation }: Props) {
  const { mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const styles = useThemedStyles(makeStyles);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [hapticsOn, setHapticsOn] = useState(haptics.hapticsEnabled());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [signingOut, setSigningOut] = useState(false);

  const dataSaver = useDataSaver();
  const dohSuggestions = useDohSuggestions();
  const offline = useOfflineLibrary();
  const hymnPack = usePackState();

  // ── Listen from anywhere (Android; boards r-listen R3) ──────────────────────
  // The switches live on the phone, in the native module's own store, so the floating button, the notification and
  // the Listen tile read them with no JS running. Read again whenever the app comes forward: the button can be
  // hidden by dragging it onto the ×, and "Display over other apps" is granted on Android's own page.
  const subscription = useSubscription();
  const [anywhere, setAnywhere] = useState(() => Listen.getAnywhere());
  const [setup, setSetup] = useState<{ open: boolean; state: SetupState; busy: boolean }>({
    open: false,
    state: { mic: false, notifications: false, overlay: false },
    busy: false,
  });
  const setupOpen = useRef(false);
  setupOpen.current = setup.open;
  useEffect(() => {
    if (!Listen.available) return;
    const refresh = () => {
      setAnywhere(Listen.getAnywhere());
      if (setupOpen.current) void readSetup().then((state) => setSetup((s) => (s.open ? { ...s, state } : s)));
    };
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    const unfocus = navigation.addListener("focus", refresh);
    return () => {
      sub.remove();
      unfocus();
    };
  }, [navigation]);

  async function readSetup(): Promise<SetupState> {
    const mic = (await getRecordingPermissionsAsync()).granted;
    const notifications = (await Notifications.getPermissionsAsync()).status === "granted";
    return { mic, notifications, overlay: Listen.hasOverlayPermission() };
  }

  async function toggleFloatingButton(on: boolean) {
    if (!on) {
      setAnywhere(Listen.setAnywhere({ button: false }));
      void logAnalyticsEvent("listen_anywhere_setting", { setting: "button", on: false });
      logAppEvent("listen_setting", { setting: "button", on: false });
      return;
    }
    const state = await readSetup();
    if (setupDone(state)) {
      setAnywhere(Listen.setAnywhere({ button: true }));
      void logAnalyticsEvent("listen_anywhere_setting", { setting: "button", on: true });
      logAppEvent("listen_setting", { setting: "button", on: true });
      return;
    }
    setSetup({ open: true, state, busy: false });
  }

  /** The sheet's one button: the next permission, Android's overlay page, or Done. */
  async function setupStep() {
    const step = nextSetupStep(setup.state);
    if (step === null) {
      setSetup((s) => ({ ...s, open: false }));
      setAnywhere(Listen.setAnywhere({ button: true }));
      void logAnalyticsEvent("listen_anywhere_setting", { setting: "button", on: true });
      logAppEvent("listen_setting", { setting: "button", on: true });
      return;
    }
    setSetup((s) => ({ ...s, busy: true }));
    try {
      if (step === "mic") {
        const r = await requestRecordingPermissionsAsync();
        if (!r.granted && !r.canAskAgain) {
          showDialog({ title: "Microphone", message: SETUP_WORDS.micRefused, icon: "problem", tone: "danger" });
        }
      } else if (step === "notifications") {
        await Notifications.requestPermissionsAsync();
      } else {
        Listen.openOverlaySettings(); // read again when the app comes back (the AppState listener above)
      }
    } finally {
      const state = await readSetup();
      setSetup((s) => ({ ...s, state, busy: false }));
    }
  }

  async function toggleListenNotification(on: boolean) {
    if (on && (await Notifications.getPermissionsAsync()).status !== "granted") {
      if ((await Notifications.requestPermissionsAsync()).status !== "granted") return;
    }
    setAnywhere(Listen.setAnywhere({ notification: on }));
    void logAnalyticsEvent("listen_anywhere_setting", { setting: "notification", on });
    logAppEvent("listen_setting", { setting: "notification", on });
  }

  async function addListenTile() {
    const result = await Listen.requestAddTakeTile();
    if (result === "added" || result === "already_added") {
      Listen.setTakeTileAdded(true);
      setAnywhere(Listen.getAnywhere());
      showToast(SETUP_WORDS.tileAdded);
      void logAnalyticsEvent("listen_anywhere_setting", { setting: "tile", on: true });
      logAppEvent("listen_setting", { setting: "tile", on: true });
    } else if (result === "unsupported") {
      // Android 12 and older have no prompt: the shade's own editor does it.
      showDialog({ title: "Add the Listen tile", message: SETUP_WORDS.tileByHand });
    }
  }

  function chooseListenSource() {
    const phone = anywhere?.phoneSoundAvailable ?? false;
    showDialog({
      title: "Listen to",
      message: phone ? SOURCE_NOTE : undefined,
      choices: SOURCE_CHOICES.filter((ch) => phone || ch.source === "room").map((ch) => ({
        label: ch.label,
        detail: ch.detail,
        icon: ch.source === "phone" ? "sound" : "mic",
        onPress: () => {
          setAnywhere(Listen.setAnywhere({ source: ch.source }));
          void logAnalyticsEvent("listen_anywhere_setting", { setting: "source", value: ch.source });
          logAppEvent("listen_setting", { setting: "source", value: ch.source });
        },
      })),
    });
  }

  const allowance = listenAllowance(subscription);
  // The floating button and the notification are Pro's: what the server last said, or the phone's own copy of it
  // before the subscription has been read this launch. The tile is everyone's.
  const listenPro = allowance.known ? allowance.isPro : (anywhere?.pro ?? false);

  function openListenUpgrade(setting: "button" | "notification") {
    logAppEvent("listen_pro_lock", { setting });
    navigation.navigate("Upgrade");
  }

  // Which proof deletes the account, and whether there is a password to change, come from the profile.
  useEffect(() => {
    meApi
      .get()
      .then(setProfile)
      .catch(() => undefined);
    // Already in flight from the module's own load; awaiting it keeps the switch from painting "on" for a frame.
    void haptics.loadHapticPref().then(() => setHapticsOn(haptics.hapticsEnabled()));
  }, []);

  /** Set while the profile is fetched again for Delete account. */
  const fetchingProfile = useRef(false);

  /** Delete account needs the profile (password or Google): read again on the tap when the first read failed. */
  async function openDelete() {
    if (profile) {
      setSheet("delete");
      return;
    }
    if (fetchingProfile.current) return;
    fetchingProfile.current = true;
    try {
      setProfile(await meApi.get());
      setSheet("delete");
    } catch (e) {
      showDialog({ title: "Couldn't open this", message: toApiError(e).message, icon: "problem", tone: "danger" });
    } finally {
      fetchingProfile.current = false;
    }
  }

  async function toggleHaptics(on: boolean) {
    setHapticsOn(on);
    // Persist before the demo buzz below: `play` reads the module cache, which this sets.
    await haptics.setHapticsEnabled(on);
    // Turning it on demonstrates itself. Turning it off obviously can't.
    if (on) haptics.play("medium");
  }

  function toggleDataSaver(on: boolean) {
    void setDataSaver(on);
    void logAnalyticsEvent("data_saver", { on });
  }

  function confirmClearOffline() {
    showDialog({
      title: "Clear offline copies?",
      message:
        "Sheets kept on this phone are removed, except the ones you chose to keep offline. Your library itself is untouched, and anything you open again is kept again.",
      // Reversible, so an ordinary confirm, not a red word.
      actions: [
        { label: "Clear", onPress: () => void clearAutomaticCopies() },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  /**
   * Signing out tells the server (the push token, the session) before it lets go, which takes a moment on a slow
   * connection: the row says "Signing out…" meanwhile, and a second tap does nothing.
   */
  async function doSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    if (signingOut) return;
    // Unconfirmed, unless recordings are still waiting to send: those go with it.
    const pending = outboxPending();
    if (pending === 0) return void doSignOut();
    showDialog({
      title: "Sign out?",
      message: signOutWarning(pending).trim(),
      actions: [
        { label: "Sign out", style: "destructive", onPress: () => void doSignOut() },
        { label: "Stay signed in", style: "cancel" },
      ],
    });
  }

  // Until the profile is read the account kind is unknown: no Password row and a plain envelope, rather than a
  // guess that changes under the finger.
  const google = profile !== null && !profile.hasPassword;
  const usage = offline.usage;
  const hymns = hymnPack.version ? `${hymnPack.count} · ${formatBytes(hymnPack.bytes)}` : "Not downloaded";

  return (
    <Screen scroll contentStyle={styles.screen}>
      <BackButton />
      <PageTitle>Settings</PageTitle>

      <Group title="Account">
        <Row
          icon="user"
          label="Name"
          value={user?.fullName}
          chevron
          onPress={() => setSheet("name")}
        />
        <Row
          icon={google ? undefined : "mail"}
          iconNode={google ? <GoogleG size={16} /> : undefined}
          label="Email"
          value={user?.email}
          accessibilityLabel={google ? `Email, ${user?.email}, signs in with Google` : undefined}
        />
        {profile?.hasPassword ? (
          <Row icon="password" label="Password" value="Change" chevron onPress={() => setSheet("password")} />
        ) : null}
      </Group>

      <Group title="Look & feel">
        <Row
          icon="theme"
          label="Theme"
          trailing={
            <Segmented<ThemeMode>
              label="Theme"
              value={mode}
              onChange={setMode}
              options={[
                { value: "dark", label: "Night", icon: "night" },
                { value: "light", label: "Day", icon: "day" },
              ]}
            />
          }
        />
        {/* Every button, row and chip buzzes on press, so this has to be switchable: an unstoppable vibration
            is an accessibility problem, not a flourish. */}
        <Row
          icon="haptics"
          label="Haptic feedback"
          toggle={{ value: hapticsOn, onChange: (on) => void toggleHaptics(on) }}
        />
        {/* Doh's one card on Home (a sheet to practise, the streak, hello); off, Home is plain. On this phone. */}
        <Row
          icon="doh"
          label="Doh's suggestions"
          hint="A card on Home now and then"
          toggle={{ value: dohSuggestions, onChange: (on) => void setDohSuggestions(on) }}
        />
      </Group>

      {/* Android only (the native module is null elsewhere): the floating button over other apps, the quiet notification
          with Listen, the Listen tile beside Find the key, and what a take hears. Each take is a Record-screen take. */}
      {anywhere ? (
        <>
          <Group title="Listen from anywhere">
            {listenPro ? (
              <>
                <Row
                  icon="float"
                  label="Floating button"
                  hint={
                    anywhere.button && !anywhere.overlayPermitted
                      ? "Needs “Display over other apps” — tap to set it up"
                      : "Over other apps — tap it to listen"
                  }
                  toggle={{ value: anywhere.button && anywhere.overlayPermitted, onChange: (on) => void toggleFloatingButton(on) }}
                  onPress={anywhere.button && !anywhere.overlayPermitted ? () => void toggleFloatingButton(true) : undefined}
                />
                <Row
                  icon="bell"
                  label="Listen in notifications"
                  hint="Swipe it away any time — it’s back when you open NoteFusion"
                  toggle={{ value: anywhere.notification, onChange: (on) => void toggleListenNotification(on) }}
                />
              </>
            ) : (
              <>
                <Row
                  icon="float"
                  label="Floating button"
                  hint="Over other apps — tap it to listen"
                  pro
                  value={PRO_ONLY_HINT}
                  chevron
                  onPress={() => openListenUpgrade("button")}
                />
                <Row
                  icon="bell"
                  label="Listen in notifications"
                  hint="A notification with Listen"
                  pro
                  value={PRO_ONLY_HINT}
                  chevron
                  onPress={() => openListenUpgrade("notification")}
                />
              </>
            )}
            <Row
              icon="qs-tile"
              label="Quick Settings tile"
              value={anywhere.tileAdded ? "Added" : "Add"}
              onPress={anywhere.tileAdded ? undefined : () => void addListenTile()}
            />
            <Row icon="hear" label="Listen to" value={sourceLabel(anywhere.source)} chevron onPress={chooseListenSource} />
          </Group>
          <GroupNote>{groupNote(allowance)}</GroupNote>
        </>
      ) : null}

      <Group title="Data & offline">
        <Row
          icon="data-saver"
          label="Data saver"
          hint="Smaller uploads, no pictures"
          toggle={{ value: dataSaver, onChange: toggleDataSaver }}
        />
        <Row
          icon="kept"
          label="Keep saved sheets offline"
          hint={
            usage.sheets === 0
              ? "Sheets you open are kept on this phone"
              : `${usage.sheets} ${usage.sheets === 1 ? "sheet" : "sheets"} on this phone · ${formatBytes(usage.bytes)}`
          }
          toggle={{ value: offline.keepAll, onChange: (on) => void setKeepAllOffline(on) }}
        />
        <Row
          icon="hymns"
          label="Offline hymns"
          value={hymns}
          chevron
          onPress={() => navigation.navigate("Tabs", { screen: "Hymns" })}
        />
      </Group>
      {usage.sheets > 0 ? (
        <View style={styles.textAction}>
          <Button label="Clear offline copies" variant="text" size="sm" onPress={confirmClearOffline} />
          {/* Kept sheets stay, so the space it frees is only certain when none are kept. */}
          {usage.pinned === 0 && !offline.keepAll ? (
            <Text style={styles.small}>{`frees ${formatBytes(usage.bytes)}`}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Help & support and Send feedback are Profile's, in one place (board n-ux-low Q5i); About stays here too, as
          the version is what support asks for. */}
      <Group title="About">
        <Row
          icon="privacy"
          label="Privacy policy"
          external
          onPress={() => void WebBrowser.openBrowserAsync(siteUrls.privacy)}
        />
        <Row
          icon="terms"
          label="Terms of service"
          external
          onPress={() => void WebBrowser.openBrowserAsync(siteUrls.terms)}
        />
        <Row
          icon="about"
          label="About Notefusion"
          value={Application.nativeApplicationVersion ?? undefined}
          chevron
          onPress={() => setSheet("about")}
        />
      </Group>

      <Group style={styles.apart}>
        <Row icon="leave" label={signingOut ? "Signing out…" : "Sign out"} dim={signingOut} onPress={confirmSignOut} />
      </Group>

      <Group style={styles.apart}>
        <Row
          label="Delete account"
          destructive
          // The proof depends on the account kind: read it rather than guess.
          onPress={() => void openDelete()}
        />
      </Group>
      <GroupNote>Removes your account and every saved sheet.</GroupNote>

      <NameSheet visible={sheet === "name"} onClose={() => setSheet(null)} />
      <PasswordSheet visible={sheet === "password"} onClose={() => setSheet(null)} />
      <AboutSheet visible={sheet === "about"} onClose={() => setSheet(null)} />
      <ListenAnywhereSheet
        visible={setup.open}
        state={setup.state}
        busy={setup.busy}
        onNotNow={() => setSetup((s) => ({ ...s, open: false }))}
        onStep={() => void setupStep()}
      />
      <DeleteAccountSheet
        visible={sheet === "delete"}
        onClose={() => setSheet(null)}
        hasPassword={profile?.hasPassword ?? true}
      />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xxxl,
    },
    textAction: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
      marginHorizontal: 4,
    },
    small: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: c.textFaint,
      marginRight: 12,
    },
    apart: {
      marginTop: 28,
    },
  });
