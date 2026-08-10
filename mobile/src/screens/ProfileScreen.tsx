import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { meApi, authApi, libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { MyProfile } from "../api/types";
import type { RootStackParams } from "../navigation/types";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ProfileScreen — light blue account overview.
 *
 * Layout (top → bottom):
 *   • Ambient blue glow orb behind the avatar area.
 *   • Gradient ring avatar — initials on a white disc, framed by
 *     "The Fusion" gradient ring.
 *   • Name, email, and role pill below the avatar.
 *   • Stat row: transcription count + member since date (from profile).
 *   • "Profile" glass card: inline name field + secondary save button.
 *   • "Security" glass card: current + new password fields + secondary button.
 *   • Quick-settings rows (Settings, FAQ) — push their own screens.
 *   • "Sign out" danger ghost button at the bottom.
 */
export function ProfileScreen() {
  const { user, setUser, signOut } = useAuth();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [name, setName] = useState(user?.fullName ?? "");
  // Dash until the count loads — the library list is the only source for it.
  const [savedCount, setSavedCount] = useState("—");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    meApi
      .get()
      .then(setProfile)
      .catch(() => undefined);
    libraryApi
      .list()
      .then((items) => setSavedCount(String(items.length)))
      .catch(() => undefined);
  }, []);

  // ── Name update ────────────────────────────────────────────────────────────

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.fullName) return;
    try {
      const updated = await meApi.update(trimmed);
      setProfile(updated);
      setUser({ ...user!, fullName: updated.fullName });
      Alert.alert("Saved ✓", "Your display name has been updated.");
    } catch (e) {
      Alert.alert("Could not update", toApiError(e).message);
    }
  }

  // ── Password change ────────────────────────────────────────────────────────

  async function changePassword() {
    setPwBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      Alert.alert("Password updated ✓", "Your password has been changed.");
    } catch (e) {
      Alert.alert("Could not change password", toApiError(e).message);
    } finally {
      setPwBusy(false);
    }
  }

  // ── Avatar initials ────────────────────────────────────────────────────────

  const initials = (user?.fullName ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleLabel =
    (profile?.role ?? user?.role ?? "User").charAt(0).toUpperCase() +
    (profile?.role ?? user?.role ?? "User").slice(1).toLowerCase();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen scroll contentStyle={styles.screen}>
      {/* ── Hero area ──────────────────────────────────────────────────────── */}
      <View style={styles.heroArea}>
        {/* Layered ambient glow orbs */}
        <View style={styles.orbPurple} />
        <View style={styles.orbGold} />

        {/* ── Avatar: gradient ring + white disc + initials ───────────────── */}
        <View style={styles.avatarWrap}>
          {/* Outer gradient ring */}
          <LinearGradient
            colors={gradients.brand} // #2563EB → #3B82F6
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            {/* Inner glass disc */}
            <View style={styles.avatarDisc}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          </LinearGradient>

          {/* Online indicator dot — bottom-right of the ring */}
          <View style={styles.onlineDot} />
        </View>

        {/* ── Name + email + role ────────────────────────────────────────── */}
        <Text style={styles.displayName}>{user?.fullName ?? "—"}</Text>
        <Text style={styles.email}>{user?.email ?? ""}</Text>

        {/* Role pill — gradient-tinted glass */}
        <View style={styles.rolePill}>
          <Ionicons
            name="shield-checkmark-outline"
            size={11}
            color={colors.purple}
            style={{ marginRight: 4 }}
          />
          <Text style={styles.roleText}>{roleLabel}</Text>
        </View>
      </View>

      {/* ── Quick stats row ────────────────────────────────────────────────── */}
      <View style={styles.statsRow}>
        <StatChip
          icon="musical-notes-outline"
          value={savedCount}
          label="Transcriptions"
          accent={colors.purple}
        />
        <View style={styles.statDivider} />
        <StatChip
          icon="calendar-outline"
          value={
            profile?.createdAt
              ? new Date(profile.createdAt).toLocaleDateString("en", {
                  month: "short",
                  year: "numeric",
                })
              : "—"
          }
          label="Member since"
          accent={colors.gold}
        />
        <View style={styles.statDivider} />
        <StatChip
          icon="person-outline"
          value={roleLabel}
          label="Role"
          accent={colors.success}
        />
      </View>

      {/* ── Profile card ───────────────────────────────────────────────────── */}
      <SectionHeader icon="person-circle-outline" title="Profile" />
      <Card style={styles.card}>
        <TextField
          label="Full name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Your display name"
        />
        <Button
          label="Save name"
          variant="secondary"
          onPress={saveName}
          disabled={!name.trim() || name.trim() === user?.fullName}
        />
      </Card>

      {/* ── Security card ──────────────────────────────────────────────────── */}
      <SectionHeader icon="lock-closed-outline" title="Security" />
      <Card style={styles.card}>
        <TextField
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          secure
          placeholder="••••••••"
        />
        <TextField
          label="New password"
          value={next}
          onChangeText={setNext}
          secure
          placeholder="Minimum 8 characters"
          error={
            next.length > 0 && next.length < 8
              ? "Minimum 8 characters required"
              : undefined
          }
        />
        <Button
          label="Change password"
          variant="secondary"
          onPress={changePassword}
          loading={pwBusy}
          disabled={!current || next.length < 8}
        />
      </Card>

      {/* ── Quick settings rows ────────────────────────────────────────────── */}
      <SectionHeader icon="settings-outline" title="App Settings" />
      <View style={styles.settingsCard}>
        <SettingsRow
          icon="settings-outline"
          label="Settings"
          accent={colors.purple}
          onPress={() => nav.navigate("Settings")}
        />
        <View style={styles.settingsRowDivider} />
        <SettingsRow
          icon="help-circle-outline"
          label="FAQ & Help"
          accent={colors.success}
          onPress={() => nav.navigate("Help")}
          isLast
        />
      </View>

      {/* ── Sign out ────────────────────────────────────────────────────────── */}
      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={() => signOut()}
        style={styles.signOut}
      />

      {/* App version watermark */}
      <Text style={styles.version}>NoteFusion v1.0</Text>
    </Screen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={14} color={colors.purple} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function StatChip({
  icon,
  value,
  label,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  accent: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statChip}>
      <View style={[styles.statIconCircle, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={13} color={accent} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  accent,
  onPress,
  isLast = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.settingsRow, isLast && styles.settingsRowLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Tinted icon circle */}
      <View
        style={[styles.settingsIconCircle, { backgroundColor: `${accent}14` }]}
      >
        <Ionicons name={icon} size={15} color={accent} />
      </View>

      <Text style={styles.settingsLabel}>{label}</Text>

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  screen: {
    paddingBottom: 120,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────

  heroArea: {
    alignItems: "center",
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    position: "relative",
  },

  /** Soft blue glow — upper-left of hero area. */
  orbPurple: {
    position: "absolute",
    top: -30,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
  },

  /** Soft light-blue glow — upper-right of hero area. */
  orbGold: {
    position: "absolute",
    top: -10,
    right: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },

  // ── Avatar ────────────────────────────────────────────────────────────────

  /** Container that stacks the gradient ring, disc, and online dot. */
  avatarWrap: {
    width: 112,
    height: 112,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    // Blue glow behind the ring
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 12,
  },

  /** "The Fusion" gradient ring — provides the coloured border. */
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
  },

  /** Disc inside the gradient ring — surface-coloured so it reads as a raised
   *  face rather than punching a white hole in the dark canvas. */
  avatarDisc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarInitials: {
    ...typography.title,
    color: c.accent,
    fontSize: 30,
    letterSpacing: -0.5,
  },

  /** Green presence dot — bottom-right corner of the avatar ring. The border
   *  fakes a cut-out of the canvas, so it has to track the canvas colour. */
  onlineDot: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.success,
    borderWidth: 2.5,
    borderColor: c.bg,
    // Green glow
    shadowColor: c.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },

  // ── Name / email / role ────────────────────────────────────────────────────

  displayName: {
    ...typography.title,
    color: c.text,
    fontSize: 24,
    letterSpacing: -0.4,
    textAlign: "center",
    marginBottom: spacing.xs,
  },

  email: {
    ...typography.body,
    color: c.textMuted,
    textAlign: "center",
    fontSize: 14,
    marginBottom: spacing.md,
  },

  /** Role pill — blue-tinted border + fill. */
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accentGlow,
    borderRadius: radii.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    // Blue glow
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 3,
  },

  roleText: {
    ...typography.caption,
    color: c.purple,
    fontSize: 12,
    fontFamily: fonts.bold,
  },

  // ── Stats row ─────────────────────────────────────────────────────────────

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xxl,
  },

  statChip: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.xs,
  },

  statIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  statValue: {
    ...typography.label,
    color: c.text,
    fontSize: 13,
    fontFamily: fonts.bold,
    textAlign: "center",
  },

  statLabel: {
    ...typography.caption,
    color: c.textFaint,
    fontSize: 10,
    textAlign: "center",
  },

  /** Vertical divider between stat chips. */
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: c.surface,
  },

  // ── Section header ─────────────────────────────────────────────────────────

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

  // ── Glass card ─────────────────────────────────────────────────────────────

  card: {
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },

  // ── Settings card ──────────────────────────────────────────────────────────

  /** Custom settings card — uses individual rows instead of Card component
   *  so dividers can be placed between rows without outer padding issues. */
  settingsCard: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    marginBottom: spacing.xl,
    overflow: "hidden",
    // Blue shadow
    shadowColor: c.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
  },

  settingsRowLast: {
    // No extra style needed — divider is placed between rows, not after last
  },

  /** Hairline between settings rows. */
  settingsRowDivider: {
    height: 1,
    marginHorizontal: spacing.lg,
    backgroundColor: c.surface,
  },

  settingsIconCircle: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },

  settingsLabel: {
    ...typography.body,
    color: c.text,
    flex: 1,
    fontSize: 15,
  },

  // ── Sign out ───────────────────────────────────────────────────────────────

  signOut: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },

  // ── Version watermark ──────────────────────────────────────────────────────

  version: {
    ...typography.caption,
    color: c.textFaint,
    textAlign: "center",
    fontSize: 11,
    marginBottom: spacing.md,
    opacity: 0.6,
  },
});
