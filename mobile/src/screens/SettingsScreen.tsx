import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { meApi } from "../api/endpoints";
import type { MyProfile } from "../api/types";
import { toApiError } from "../api/client";
import { fonts, radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Settings">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SettingsScreen — the two account-level controls that need a surface of their own.
 *
 *   • Appearance — light/dark switch. The choice is written to AsyncStorage by
 *     the ThemeProvider, so it survives a relaunch and applies on the first frame.
 *   • Danger zone — permanent account deletion. Guarded twice: identity is
 *     re-proven server-side (DELETE /api/me carries the proof in the body) and a
 *     destructive confirm dialog stands in front of the request, because the
 *     server deletes the user's transcriptions along with the account. The proof
 *     is a password for password accounts, and a fresh Google ID token for
 *     Google-only accounts, which never set one — the profile's hasPassword flag
 *     decides which control we render.
 */
export function SettingsScreen({ navigation }: Props) {
  const { mode, setMode } = useTheme();
  const { signOut, reauthWithGoogle } = useAuth();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isDark = mode === "dark";

  const [pushEnabled, setPushEnabled] = useState(true);
  const [soundAlerts, setSoundAlerts] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("@notefusion_push").then((v) => {
      if (v !== null) setPushEnabled(v === "true");
    });
    AsyncStorage.getItem("@notefusion_sound").then((v) => {
      if (v !== null) setSoundAlerts(v === "true");
    });
  }, []);

  const togglePush = (val: boolean) => {
    setPushEnabled(val);
    AsyncStorage.setItem("@notefusion_push", String(val));
  };

  const toggleSound = (val: boolean) => {
    setSoundAlerts(val);
    AsyncStorage.setItem("@notefusion_sound", String(val));
  };

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
    Alert.alert(
      "Delete account?",
      "This permanently removes your account and every transcription in your library. It cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: deleteAccount },
      ],
    );
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
      Alert.alert("Could not delete account", toApiError(e).message);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen scroll>
      {/* ── Header row ───────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Account</Text>
          <Text style={styles.titleMain}>Settings</Text>
        </View>
      </View>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="color-palette-outline" size={14} color={colors.purple} />
        <Text style={styles.sectionTitle}>Appearance</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View
            style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}
          >
            <Ionicons
              name={isDark ? "moon" : "sunny"}
              size={16}
              color={colors.purple}
            />
          </View>

          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Dark mode</Text>
            <Text style={styles.rowHint}>
              {isDark
                ? "Dimmed navy surfaces, easier at night."
                : "Bright mist surfaces, the default."}
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
      </Card>

      {/* ── Notifications ────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="notifications-outline" size={14} color={colors.accent} />
        <Text style={styles.sectionTitle}>Notifications</Text>
      </View>

      <Card style={styles.card}>
        <View style={styles.switchRow}>
          <View
            style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}
          >
            <Ionicons name="notifications" size={16} color={colors.accent} />
          </View>

          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Push Notifications</Text>
            <Text style={styles.rowHint}>
              Notify when transcriptions complete.
            </Text>
          </View>

          <Switch
            value={pushEnabled}
            onValueChange={togglePush}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={pushEnabled ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>

        <View style={styles.rowDivider} />

        <View style={styles.switchRow}>
          <View
            style={[styles.iconCircle, { backgroundColor: colors.accentSoft }]}
          >
            <Ionicons name="volume-high" size={16} color={colors.accent} />
          </View>

          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>Sound Alerts</Text>
            <Text style={styles.rowHint}>
              Play audio preview tone on playback.
            </Text>
          </View>

          <Switch
            value={soundAlerts}
            onValueChange={toggleSound}
            trackColor={{ false: colors.border, true: colors.accentGlow }}
            thumbColor={soundAlerts ? colors.accent : colors.surface}
            ios_backgroundColor={colors.border}
          />
        </View>
      </Card>

      {/* ── Legal & App Info ─────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="information-circle-outline" size={14} color={colors.gold} />
        <Text style={styles.sectionTitle}>About & Legal</Text>
      </View>

      <Card style={styles.card}>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => WebBrowser.openBrowserAsync("https://notefusion-admin.vercel.app/privacy")}
          activeOpacity={0.7}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.textMuted} />
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="open-outline" size={14} color={colors.textFaint} />
        </TouchableOpacity>

        <View style={styles.rowDivider} />

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => WebBrowser.openBrowserAsync("https://notefusion-admin.vercel.app/terms")}
          activeOpacity={0.7}
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} />
          <Text style={styles.linkText}>Terms of Service</Text>
          <Ionicons name="open-outline" size={14} color={colors.textFaint} />
        </TouchableOpacity>

        <View style={styles.rowDivider} />

        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>Application Version</Text>
          <Text style={styles.versionValue}>1.0.0 (Build 2)</Text>
        </View>
      </Card>

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
