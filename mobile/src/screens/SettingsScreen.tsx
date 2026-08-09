import React, { useState } from "react";
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { radii, spacing, typography, type Palette } from "../design/theme";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "Settings">;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SettingsScreen — the two account-level controls that need a surface of their own.
 *
 *   • Appearance — light/dark switch. The choice is written to AsyncStorage by
 *     the ThemeProvider, so it survives a relaunch and applies on the first frame.
 *   • Danger zone — permanent account deletion. Guarded twice: the password is
 *     re-verified server-side (DELETE /api/me carries it in the body) and a
 *     destructive confirm dialog stands in front of the request, because the
 *     server deletes the user's transcriptions along with the account.
 */
export function SettingsScreen({ navigation }: Props) {
  const { mode, setMode } = useTheme();
  const { signOut } = useAuth();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isDark = mode === "dark";

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
      await meApi.remove({ password });
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
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
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

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="warning-outline" size={14} color={colors.danger} />
        <Text style={[styles.sectionTitle, styles.sectionTitleDanger]}>
          Danger zone
        </Text>
      </View>

      <Card style={styles.card}>
        <Text style={styles.dangerTitle}>Delete account</Text>
        <Text style={styles.dangerBody}>
          Permanently removes your account and every saved transcription. Enter
          your password to confirm — this cannot be undone.
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
      fontWeight: "700",
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
      fontWeight: "700",
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
  });
