import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { showDialog } from "../lib/dialog";
import { siteUrls } from "../lib/env";
import * as haptics from "../lib/haptics";
import {
  disablePush,
  enablePush,
  getPushPermission,
  loadNotificationPrefs,
  pushEnabled,
  setSoundEnabled,
  soundEnabled,
  type PushPermission,
} from "../lib/push";
import {
  loadReminderPrefs,
  refreshReminderPrefs,
  reminderEnabled,
  reminderHour,
  reminderTime,
  setReminderEnabled,
  setReminderTime,
  syncReminderSound,
  REMINDER_TIMES,
  type ReminderTime,
} from "../lib/practiceReminder";
import { describeReminder, hourFor } from "../lib/reminderPrefs";
import { meApi } from "../api/endpoints";
import { setDataSaver, useDataSaver } from "../lib/dataSaver";
import { clearAutomaticCopies, setKeepAllOffline, useOfflineLibrary } from "../lib/offlineLibrary";
import { removePack, usePackState } from "../lib/hymnPackStore";
import { formatBytes } from "../lib/hymnPack";
import { logAnalyticsEvent } from "../lib/analytics";
import type { MyProfile } from "../api/types";
import { toApiError } from "../api/client";
import { fonts, motion, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Settings">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SettingsScreen — the account-level controls that need a surface of their own.
 *
 *   • Appearance — light/dark switch. The choice is written to AsyncStorage by
 *     the ThemeProvider, so it survives a relaunch and applies on the first frame.
 *   • Notifications — the push switch owns two separate pieces of state: the OS
 *     permission (which the app can request but not grant) and the user's own
 *     preference. Both are shown, because a switch that is off because iOS said no
 *     needs different wording from one the user turned off. See ../lib/push.
 *   • Danger zone — permanent account deletion. Guarded twice: identity is
 *     re-proven server-side (DELETE /api/me carries the proof in the body) and a
 *     destructive confirm dialog stands in front of the request, because the
 *     server deletes the user's transcriptions along with the account. The proof
 *     is a password for password accounts, and a fresh Google ID token for
 *     Google-only accounts, which never set one — the profile's hasPassword flag
 *     decides which control we render.
 *
 * Arriving with `route.params.focus` scrolls to that section: the Profile menu's
 * "Notifications" and "About Notefusion" rows point here.
 */
export function SettingsScreen({ navigation, route }: Props) {
  const { mode, setMode } = useTheme();
  const { signOut, reauthWithGoogle } = useAuth();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isDark = mode === "dark";

  const [pushOn, setPushOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(haptics.hapticsEnabled());
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderAt, setReminderAt] = useState<ReminderTime>(reminderTime());
  const [reminderAtHour, setReminderAtHour] = useState(reminderHour());

  // ── Offline & data ─────────────────────────────────────────────────────────
  const dataSaver = useDataSaver();
  const offline = useOfflineLibrary();
  const hymnPack = usePackState();

  function toggleDataSaver(on: boolean) {
    void setDataSaver(on);
    void logAnalyticsEvent("data_saver", { on });
  }

  function confirmClearOffline() {
    showDialog({
      title: "Clear offline copies?",
      message:
        "Sheets kept on this phone are removed, except the ones you chose to keep offline. Your library itself is untouched — anything you open again is kept again.",
      icon: "trash-outline",
      tone: "danger",
      actions: [
        { label: "Clear", style: "destructive", onPress: () => void clearAutomaticCopies() },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  function confirmRemoveHymns() {
    showDialog({
      title: "Remove the hymns?",
      message: `Frees ${formatBytes(hymnPack.bytes)}. You can download them again from Hymns at any time.`,
      icon: "book-outline",
      actions: [
        { label: "Remove", style: "destructive", onPress: () => void removePack() },
        { label: "Keep them", style: "cancel" },
      ],
    });
  }

  // ── Section anchors ────────────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView | null>(null);
  const anchors = useRef<Partial<Record<"notifications" | "about", number>>>({});
  const focus = route.params?.focus;

  const scrollToFocus = useCallback(() => {
    if (!focus) return;
    const y = anchors.current[focus];
    if (y == null) return; // not laid out yet; onLayout calls back
    // A little headroom so the section header isn't flush with the status bar.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  }, [focus]);

  // ── Notification preferences ───────────────────────────────────────────────

  const syncPermission = useCallback(async () => {
    const [, perm] = await Promise.all([
      loadNotificationPrefs(),
      getPushPermission(),
      // Already in flight from the module's own load, so this resolves
      // immediately — awaiting it just guarantees the switch never paints "on"
      // for a frame when the stored value is off.
      haptics.loadHapticPref(),
      loadReminderPrefs(),
    ]);
    setPermission(perm);
    setPushOn(pushEnabled());
    setSoundOn(soundEnabled());
    setHapticsOn(haptics.hapticsEnabled());
    setReminderOn(reminderEnabled());
    setReminderAt(reminderTime());
    setReminderAtHour(reminderHour());
    // The reminders are the server's: the cached answer paints at once, the fresh one replaces it.
    if (await refreshReminderPrefs()) {
      setReminderOn(reminderEnabled());
      setReminderAt(reminderTime());
      setReminderAtHour(reminderHour());
    }
  }, []);

  useEffect(() => {
    syncPermission();
  }, [syncPermission]);

  // The user can revoke permission in system settings while we're backgrounded, so
  // re-read it whenever this screen comes back into focus rather than trusting the
  // value we captured on mount.
  useEffect(
    () => navigation.addListener("focus", () => void syncPermission()),
    [navigation, syncPermission],
  );

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) {
        const result = await enablePush();
        setPermission(result);
        // Only the granted path actually enables anything — otherwise the switch
        // stays off and the row explains why.
        setPushOn(result === "granted" && pushEnabled());
      } else {
        await disablePush();
        setPushOn(false);
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleSound(on: boolean) {
    setSoundOn(on);
    await setSoundEnabled(on);
    // Practice reminders are pushed by the server, so it is told too: off sends them silently.
    void syncReminderSound(on);
  }

  async function toggleHaptics(on: boolean) {
    setHapticsOn(on);
    // Persist before the demo buzz below: `play` reads the module cache, which
    // this sets.
    await haptics.setHapticsEnabled(on);
    // Turning it on demonstrates itself. Turning it off obviously can't.
    if (on) haptics.play("medium");
  }

  /** The server keeps the reminders, so a choice it did not take is put back and said plainly. */
  function reminderNotSaved() {
    showDialog({
      title: "Couldn't save that",
      message: "Check your connection and try again.",
      icon: "cloud-offline-outline",
    });
  }

  async function toggleReminder(on: boolean) {
    setReminderOn(on);
    if (!(await setReminderEnabled(on))) {
      setReminderOn(!on);
      reminderNotSaved();
    }
  }

  async function pickReminderTime(next: ReminderTime) {
    const before = { at: reminderAt, hour: reminderAtHour };
    setReminderAt(next);
    setReminderAtHour(hourFor(next));
    haptics.play("light");
    if (!(await setReminderTime(next))) {
      setReminderAt(before.at);
      setReminderAtHour(before.hour);
      reminderNotSaved();
    }
  }

  /** Push state, as one thing the row can render. */
  const push = describePush(permission, pushOn);

  /** The push row's contents, so the row can be wrapped in a press target or not. */
  const pushRow = (
    <>
      <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name={push.icon} size={16} color={colors.accent} />
      </View>

      <View style={styles.switchText}>
        <Text style={styles.rowLabel}>Push Notifications</Text>
        <Text style={[styles.rowHint, push.warn && styles.rowHintWarn]}>
          {push.hint}
        </Text>
      </View>

      {pushBusy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Switch
          value={pushOn}
          onValueChange={togglePush}
          disabled={push.disabled}
          trackColor={{ false: colors.border, true: colors.accentGlow }}
          thumbColor={pushOn ? colors.accent : colors.surface}
          ios_backgroundColor={colors.border}
        />
      )}
    </>
  );

  // The delete control depends on whether the account has a password to re-verify.
  // Until the profile loads we can't tell, so the danger zone shows a spinner
  // rather than guessing and rendering the wrong proof control.
  useEffect(() => {
    meApi
      .get()
      .then(setProfile)
      .catch(() => undefined);
  }, []);

  // ── Account deletion ───────────────────────────────────────────────────────

  function confirmDelete() {
    showDialog({
      title: "Delete account?",
      message:
        "This permanently removes your account and every transcription in your library. It cannot be undone.",
      icon: "warning-outline",
      tone: "danger",
      actions: [
        { label: "Delete", style: "destructive", onPress: deleteAccount },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      if (profile?.hasPassword) {
        await meApi.remove({ password });
      } else {
        // Google-only account: re-prove identity through a fresh consent prompt.
        // A cancelled prompt returns null — abort quietly, the account stands.
        const googleIdToken = await reauthWithGoogle();
        if (!googleIdToken) {
          setDeleting(false);
          return;
        }
        await meApi.remove({ googleIdToken });
      }
      // The session is dead server-side; signOut clears the local tokens, which
      // swaps the root navigator back to the auth flow and unmounts this screen.
      await signOut();
    } catch (e) {
      // Only reset on failure — the success path has already unmounted.
      setDeleting(false);
      showDialog({
        title: "Could not delete account",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen scroll scrollRef={scrollRef}>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <Touchable
          onPress={() =>
            navigation.canGoBack()
              ? navigation.goBack()
              : navigation.navigate("Tabs", { screen: "Home" })
          }
          accessibilityLabel="Go back"
          hitSlop={8}
          // Borderless so the ripple radiates from the circle rather than boxing
          // it; a `radius` clip here would be the same shape but square-cornered
          // at the hit-slop edges.
          ripple="borderless"
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </Touchable>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Account</Text>
          <Text style={styles.titleMain}>Settings</Text>
        </View>
      </View>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="color-palette-outline" size={14} color={colors.accent} />
        <Text style={styles.sectionTitle}>Appearance & feel</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View
            style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}
          >
            <Ionicons
              name={isDark ? "moon" : "sunny"}
              size={16}
              color={colors.accent}
            />
          </View>

          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Night</Text>
            <Text style={styles.rowHint}>
              {isDark
                ? "The dark canvas, the default. Easier on the eyes in a dim church."
                : "Day: white surfaces for bright rooms and print-like reading."}
            </Text>
          </View>

          <Switch
            value={isDark}
            onValueChange={(on) => setMode(on ? "dark" : "light")}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={isDark ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

        <View style={styles.rowDivider} />

        {/* Every button, row and chip buzzes on press, so this has to be
            switchable — an unstoppable vibration is an accessibility problem, not
            a flourish. The flag is read from a module cache on each press, which
            is why turning it off silences everything at once. */}
        <View style={styles.switchRow}>
          <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
            <Ionicons
              name={hapticsOn ? "pulse" : "pulse-outline"}
              size={16}
              color={colors.accent}
            />
          </View>

          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Haptic feedback</Text>
            <Text style={styles.rowHint}>
              {hapticsOn
                ? "A short tap when you press a control."
                : "Controls respond silently."}
            </Text>
          </View>

          <Switch
            value={hapticsOn}
            onValueChange={toggleHaptics}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={hapticsOn ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>
      </Card>

      {/* ── Offline & data ───────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="cloud-offline-outline" size={14} color={colors.accent} />
        <Text style={styles.sectionTitle}>Offline & data</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name={dataSaver ? "leaf" : "leaf-outline"} size={16} color={colors.accent} />
          </View>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Data saver</Text>
            <Text style={styles.rowHint}>
              {dataSaver
                ? "Smaller recordings (same notes), no pictures, and hymns update only when you ask."
                : "Full-size recordings and pictures; the hymns update by themselves each week."}
            </Text>
          </View>
          <Switch
            value={dataSaver}
            onValueChange={toggleDataSaver}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={dataSaver ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

        <View style={styles.rowDivider} />

        <View style={styles.switchRow}>
          <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name={offline.keepAll ? "cloud-done" : "cloud-done-outline"} size={16} color={colors.accent} />
          </View>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Keep all saved sheets offline</Text>
            <Text style={styles.rowHint}>
              {offline.usage.sheets === 0
                ? "Sheets you open are kept on this phone, so they open without a connection."
                : `${offline.usage.sheets} ${offline.usage.sheets === 1 ? "sheet" : "sheets"} on this phone · ${formatBytes(offline.usage.bytes)}`}
            </Text>
          </View>
          <Switch
            value={offline.keepAll}
            onValueChange={(on) => void setKeepAllOffline(on)}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={offline.keepAll ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

        {offline.usage.sheets > 0 ? (
          <Touchable onPress={confirmClearOffline} style={styles.inlineAction} ripple={false} hitSlop={6} accessibilityLabel="Clear offline copies">
            <Text style={styles.inlineActionText}>Clear offline copies</Text>
          </Touchable>
        ) : null}

        <View style={styles.rowDivider} />

        <Touchable
          style={styles.switchRow}
          onPress={() => navigation.navigate("Hymns")}
          scaleTo={motion.scale.row}
          accessibilityLabel="Hymns for offline use"
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
            <Ionicons name="book-outline" size={16} color={colors.accent} />
          </View>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Hymns for offline use</Text>
            <Text style={styles.rowHint}>
              {hymnPack.version
                ? `${hymnPack.count} hymns and tunes on this phone · ${formatBytes(hymnPack.bytes)}`
                : "Not downloaded yet — tap to get them."}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Touchable>

        {hymnPack.version ? (
          <Touchable onPress={confirmRemoveHymns} style={styles.inlineAction} ripple={false} hitSlop={6} accessibilityLabel="Remove the hymns from this phone">
            <Text style={styles.inlineActionText}>Remove hymns</Text>
          </Touchable>
        ) : null}
      </Card>

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <View
        onLayout={(e) => {
          anchors.current.notifications = e.nativeEvent.layout.y;
          scrollToFocus();
        }}
      >
        <View style={styles.sectionHeader}>
          <Ionicons name="notifications-outline" size={14} color={colors.accent} />
          <Text style={styles.sectionTitle}>Notifications</Text>
        </View>

        <Card style={styles.card}>
          {/* Only a *press target* when pressing it does something — that is,
              when permission was denied and the row's job is to open system
              settings. Wrapping it unconditionally would fade the whole row to
              the disabled 0.4 in the ordinary case, Switch included. */}
          {push.actionable ? (
            <Touchable
              style={styles.switchRow}
              onPress={() => Linking.openSettings()}
              scaleTo={motion.scale.row}
              accessibilityLabel="Open system notification settings"
            >
              {pushRow}
            </Touchable>
          ) : (
            <View style={styles.switchRow}>{pushRow}</View>
          )}

          <View style={styles.rowDivider} />

          <View style={styles.switchRow}>
            <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
              <Ionicons
                name={soundOn ? "volume-high" : "volume-mute"}
                size={16}
                color={colors.accent}
              />
            </View>

            <View style={styles.switchText}>
              <Text style={styles.rowLabel}>Notification sounds</Text>
              <Text style={styles.rowHint}>
                {soundOn
                  ? "Play a sound when a notification arrives."
                  : "Notifications arrive silently."}
              </Text>
            </View>

            <Switch
              value={soundOn}
              onValueChange={toggleSound}
              disabled={!pushOn}
              trackColor={{ false: colors.border, true: colors.accentGlow }}
              thumbColor={soundOn ? colors.accent : colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.switchRow}>
            <View style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}>
              <Ionicons
                name={reminderOn ? "alarm" : "alarm-outline"}
                size={16}
                color={colors.accent}
              />
            </View>

            <View style={styles.switchText}>
              <Text style={styles.rowLabel}>Daily practice reminder</Text>
              <Text style={styles.rowHint}>{describeReminder(reminderOn, reminderAtHour, pushOn)}</Text>
            </View>

            <Switch
              value={reminderOn}
              onValueChange={toggleReminder}
              // Same gate as the sounds row: reminders are pushes, and turning
              // notifications off unregisters this phone, so there would be
              // nowhere to send them.
              disabled={!pushOn}
              trackColor={{ false: colors.border, true: colors.accentGlow }}
              thumbColor={reminderOn ? colors.accent : colors.surface}
              ios_backgroundColor={colors.border}
            />
          </View>

          {/* Chips rather than a time picker: a real one means a new native
              dependency (`@react-native-community/datetimepicker`) and therefore
              a new build, and three presets are the shape of the choice anyway. */}
          <View style={styles.chipRow}>
            {REMINDER_TIMES.map((slot) => {
              const active = reminderAt === slot.key;
              return (
                <Touchable
                  key={slot.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => void pickReminderTime(slot.key)}
                  disabled={!pushOn || !reminderOn}
                  scaleTo={motion.scale.row}
                  accessibilityLabel={`Remind me in the ${slot.label.toLowerCase()}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {slot.label}
                  </Text>
                  <Text style={[styles.chipTime, active && styles.chipTextActive]}>
                    {`${slot.hour}:00`}
                  </Text>
                </Touchable>
              );
            })}
          </View>
        </Card>
      </View>

      {/* ── Legal & App Info ─────────────────────────────────────────────── */}
      <View
        onLayout={(e) => {
          anchors.current.about = e.nativeEvent.layout.y;
          scrollToFocus();
        }}
      >
        <View style={styles.sectionHeader}>
          <Ionicons name="information-circle-outline" size={14} color={colors.accent} />
          <Text style={styles.sectionTitle}>About & Legal</Text>
        </View>

        <Card style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutTitle}>Notefusion</Text>
            <Text style={styles.aboutBody}>
              Turns what you hum, sing, or play into Tonic Solfa and staff notation.
            </Text>
          </View>

          <View style={styles.rowDivider} />

          <Touchable
            style={styles.linkRow}
            onPress={() => WebBrowser.openBrowserAsync(siteUrls.privacy)}
            scaleTo={motion.scale.row}
            accessibilityLabel="Privacy Policy"
          >
            <Ionicons name="document-text-outline" size={18} color={colors.textMuted} />
            <Text style={styles.linkText}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={14} color={colors.textFaint} />
          </Touchable>

          <View style={styles.rowDivider} />

          <Touchable
            style={styles.linkRow}
            onPress={() => WebBrowser.openBrowserAsync(siteUrls.terms)}
            scaleTo={motion.scale.row}
            accessibilityLabel="Terms of Service"
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} />
            <Text style={styles.linkText}>Terms of Service</Text>
            <Ionicons name="open-outline" size={14} color={colors.textFaint} />
          </Touchable>

          <View style={styles.rowDivider} />

          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Application Version</Text>
            {/* Read from the native manifest, not typed in. The hardcoded string that
                used to be here was two releases stale, and a lying version number next
                to an update prompt is worse than either problem alone. */}
            <Text style={styles.versionValue}>
              {`${Application.nativeApplicationVersion ?? "—"} (Build ${
                Application.nativeBuildVersion ?? "—"
              })`}
            </Text>
          </View>
        </Card>
      </View>

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="warning-outline" size={14} color={colors.danger} />
        <Text style={[styles.sectionTitle, styles.sectionTitleDanger]}>
          Danger zone
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={styles.dangerTitle}>Delete account</Text>

        {profile === null ? (
          // Proof control depends on hasPassword — wait for it rather than guess.
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.textFaint} />
          </View>
        ) : profile.hasPassword ? (
          <>
            <Text style={styles.dangerBody}>
              Permanently removes your account and every saved transcription.
              Enter your password to confirm — this cannot be undone.
            </Text>

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secure
              placeholder="••••••••"
            />

            <Button
              label="Delete my account"
              variant="danger"
              icon="trash-outline"
              onPress={confirmDelete}
              loading={deleting}
              disabled={password.length === 0}
            />
          </>
        ) : (
          <>
            <Text style={styles.dangerBody}>
              Permanently removes your account and every saved transcription.
              You'll confirm with Google to prove it's you — this cannot be
              undone.
            </Text>

            <Button
              label="Confirm with Google & delete"
              variant="danger"
              icon="logo-google"
              onPress={confirmDelete}
              loading={deleting}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}

// ─── Push row state ──────────────────────────────────────────────────────────

/**
 * Turns the two independent pieces of push state — what the OS allows and what the
 * user chose — into the one thing the row renders.
 *
 * The distinction is the point: a switch that is off because permission was revoked
 * cannot be fixed by tapping it, so it says where to go instead of pretending.
 */
function describePush(
  permission: PushPermission | null,
  on: boolean,
): {
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  /** Whether pressing the row does something (opens system settings). */
  actionable: boolean;
  warn: boolean;
} {
  if (permission === null) {
    return { hint: "Checking…", icon: "notifications-outline", disabled: true, actionable: false, warn: false };
  }
  if (permission === "unsupported") {
    return {
      hint: "Not available in Expo Go or on a simulator. Use a dev or release build.",
      icon: "notifications-off-outline",
      disabled: true,
      actionable: false,
      warn: true,
    };
  }
  if (permission === "denied") {
    return {
      hint: "Blocked in system settings. Tap to open Settings ›",
      icon: "notifications-off",
      disabled: true,
      actionable: true,
      warn: true,
    };
  }
  return {
    hint: on
      ? "Notify when transcriptions complete."
      : "Turned off — you won't be told when a transcription finishes.",
    icon: on ? "notifications" : "notifications-off-outline",
    disabled: false,
    actionable: false,
    warn: false,
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ── Header ──────────────────────────────────────────────────────────────

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
    },

    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },

    titleBlock: {
      flex: 1,
      marginHorizontal: spacing.md,
    },

    titleLabel: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
    },

    titleMain: {
      ...typography.title,
      color: c.text,
      fontSize: 22,
      letterSpacing: -0.4,
      marginTop: 1,
    },

    // ── Section header ──────────────────────────────────────────────────────

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.sm,
      marginTop: spacing.xs,
    },

    sectionTitle: {
      ...typography.label,
      color: c.textMuted,
      fontSize: 12,
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1,
    },

    sectionTitleDanger: {
      color: c.danger,
    },

    card: {
      marginBottom: spacing.xl,
    },

    // ── Appearance row ──────────────────────────────────────────────────────

    switchRow: {
      flexDirection: "row",
      alignItems: "center",
    },

    iconCircle: {
      width: 32,
      height: 32,
      borderRadius: radii.sm,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },

    switchText: {
      flex: 1,
      marginRight: spacing.md,
    },

    rowLabel: {
      ...typography.body,
      color: c.text,
      fontSize: 15,
    },

    rowHint: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 12,
      marginTop: 2,
    },

    rowHintWarn: {
      color: c.warning,
    },

    /** A small text action under a row, set in from the icon column like the reminder chips. */
    inlineAction: {
      alignSelf: "flex-start",
      marginTop: spacing.sm,
      marginLeft: 32 + spacing.md,
    },

    inlineActionText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: c.accent,
    },

    // ── Reminder time chips ─────────────────────────────────────────────────

    /** Indented to the switch rows' text column, so the chips read as belonging to
     *  the toggle above rather than as a row of their own. */
    chipRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.md,
      marginLeft: 32 + spacing.md,
    },

    chip: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },

    chipActive: {
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
    },

    chipText: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 13,
    },

    /** The time under the label, so the chip says what "Morning" actually means. */
    chipTime: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 11,
      marginTop: 1,
    },

    chipTextActive: {
      color: c.accent,
      fontFamily: fonts.bold,
    },

    aboutRow: {
      paddingBottom: spacing.xs,
    },

    aboutTitle: {
      ...typography.heading,
      color: c.text,
      fontSize: 16,
    },

    aboutBody: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 2,
    },

    rowDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.md,
    },

    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.xs,
    },

    linkText: {
      ...typography.body,
      flex: 1,
      color: c.text,
      fontSize: 15,
      marginLeft: spacing.md,
    },

    versionRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.xs,
    },

    versionLabel: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 14,
    },

    versionValue: {
      ...typography.caption,
      color: c.accent,
      fontFamily: fonts.bold,
      fontSize: 14,
    },

    // ── Danger zone ─────────────────────────────────────────────────────────

    dangerTitle: {
      ...typography.heading,
      color: c.text,
      fontSize: 16,
      marginBottom: spacing.xs,
    },

    dangerBody: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: spacing.lg,
    },

    loadingRow: {
      paddingVertical: spacing.lg,
      alignItems: "center",
    },
  });
