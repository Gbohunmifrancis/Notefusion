import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { meApi, authApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { pickProfileImage } from "../lib/imagePicker";
import {
  fonts,
  radii,
  spacing,
  type Palette,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { MyProfile } from "../api/types";
import type { RootStackParams } from "../navigation/types";

/**
 * ProfileScreen — matching Image 4 design sheet:
 * 1. Top bar: Settings gear icon on top right
 * 2. Header: Avatar disc, Name, Email, plan pill badge
 * 3. Settings List: Account, Subscription, Notifications, Help & Support, About Notefusion
 * 4. Sign Out: Red link centered at bottom
 *
 * Premium treatment (gold avatar ring, Pro badge, no Subscription row) is driven
 * entirely by `useSubscription().isPro` — the billing service's answer. It used to
 * read `profile.role`, which is an authorisation level and not a payment, and the
 * ring was unconditional, so free accounts wore the paid look.
 */
export function ProfileScreen() {
  const { user, setUser, signOut } = useAuth();
  const { isPro } = useSubscription();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Edit modals
  const [accountModal, setAccountModal] = useState(false);
  const [name, setName] = useState(user?.fullName ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    meApi
      .get()
      .then((p) => {
        setProfile(p);
        setName(p.fullName);
      })
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

  // ── Profile picture ────────────────────────────────────────────────────────

  /** Picks an image and uploads it. The API proxies to R2 so no
   *  credentials ship in the binary. */
  async function changePicture() {
    const picked = await pickProfileImage();
    if (!picked) return; // cancelled, or permission refused (the picker explains)

    setAvatarBusy(true);
    try {
      const updated = await meApi.uploadPicture(
        picked.uri,
        picked.fileName,
        picked.mimeType,
      );
      setProfile(updated);
    } catch (e) {
      Alert.alert("Could not update photo", toApiError(e).message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removePicture() {
    setAvatarBusy(true);
    try {
      const updated = await meApi.removePicture();
      setProfile(updated);
    } catch (e) {
      Alert.alert("Could not remove photo", toApiError(e).message);
    } finally {
      setAvatarBusy(false);
    }
  }

  function onAvatarPress() {
    const hasPicture = Boolean(profile?.profilePictureUrl);
    Alert.alert(
      "Profile photo",
      hasPicture ? undefined : "Add a photo to personalise your account.",
      [
        { text: hasPicture ? "Change photo" : "Choose photo", onPress: changePicture },
        ...(hasPicture
          ? [
              {
                text: "Remove photo",
                style: "destructive" as const,
                onPress: removePicture,
              },
            ]
          : []),
        { text: "Cancel", style: "cancel" as const },
      ],
    );
  }

  return (
    <Screen scroll contentStyle={styles.screen}>
      {/* ── 1. Top Bar: Title ───────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <Text style={styles.pageTitle}>Profile</Text>
      </View>

      {/* ── 2. Avatar & User Information ─────────────────────────────────── */}
      <View style={styles.userHeader}>
        <Avatar
          uri={profile?.profilePictureUrl}
          name={user?.fullName}
          size={104}
          premium={isPro}
          editable
          busy={avatarBusy}
          onPress={onAvatarPress}
          style={styles.avatar}
        />

        <Text style={styles.userName}>{user?.fullName ?? "Your name"}</Text>
        <Text style={styles.userEmail}>{user?.email ?? ""}</Text>

        {/* Plan Pill Badge — reflects billing state, not role. */}
        <View style={[styles.planBadge, isPro && styles.planBadgePro]}>
          <Text style={[styles.planBadgeText, isPro && styles.planBadgeTextPro]}>
            {isPro ? "Pro Member ✨" : "Free Plan"}
          </Text>
        </View>
      </View>

      {/* ── 3. Settings List Options ─────────────────────────────────────── */}
      <View style={styles.menuCard}>
        <MenuItem
          icon="person-outline"
          label="Account"
          onPress={() => setAccountModal(true)}
        />
        <View style={styles.divider} />

        {/* Nothing left to sell an active subscriber — same rule hides the tab. */}
        {!isPro ? (
          <>
            <MenuItem
              icon="card-outline"
              label="Subscription"
              onPress={() => nav.navigate("Upgrade")}
            />
            <View style={styles.divider} />
          </>
        ) : null}

        <MenuItem
          icon="settings-outline"
          label="Settings"
          onPress={() => nav.navigate("Settings")}
        />
        <View style={styles.divider} />

        <MenuItem
          icon="notifications-outline"
          label="Notifications"
          onPress={() => nav.navigate("Settings", { focus: "notifications" })}
        />
        <View style={styles.divider} />

        <MenuItem
          icon="help-circle-outline"
          label="Help & Support"
          onPress={() => nav.navigate("Help")}
        />
        <View style={styles.divider} />

        <MenuItem
          icon="information-circle-outline"
          label="About Notefusion"
          onPress={() => nav.navigate("Settings", { focus: "about" })}
          isLast
        />
      </View>

      {/* ── 4. Sign Out Button ───────────────────────────────────────────── */}
      <Button
        label="Sign out"
        variant="danger"
        icon="log-out-outline"
        onPress={() => signOut()}
        style={styles.signOutBtn}
      />

      {/* ── Account Edit Modal ───────────────────────────────────────────── */}
      <Modal
        visible={accountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Account Settings</Text>
              <TouchableOpacity onPress={() => setAccountModal(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.subTitle}>Display Name</Text>
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
                style={{ marginBottom: spacing.xl }}
              />

              <Text style={styles.subTitle}>Change Password</Text>
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
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ─── Menu Item Component ──────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  meta,
  onPress,
  isLast = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  meta?: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <TouchableOpacity
      style={[styles.menuRow, isLast && styles.menuRowLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={20} color={colors.text} style={styles.menuIcon} />
      <Text style={styles.menuLabel}>{label}</Text>
      {meta ? <Text style={styles.menuMeta}>{meta}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingBottom: 120,
      paddingHorizontal: spacing.xl,
    },

    // ── Top Bar ───────────────────────────────────────────────────────────────
    topBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    pageTitle: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: c.text,
    },

    // ── User Header ───────────────────────────────────────────────────────────
    userHeader: {
      alignItems: "center",
      marginBottom: spacing.xxl,
    },
    avatar: {
      marginBottom: spacing.md,
    },
    userName: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: 2,
    },
    userEmail: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginBottom: spacing.md,
    },
    planBadge: {
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentGlow,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 5,
    },
    planBadgePro: {
      backgroundColor: c.premiumSoft,
      borderColor: c.premiumBorder,
    },
    planBadgeText: {
      fontSize: 13,
      fontFamily: fonts.bold,
      color: c.accent,
    },
    planBadgeTextPro: {
      color: c.premiumDeep,
    },

    // ── Menu Card List ────────────────────────────────────────────────────────
    menuCard: {
      backgroundColor: c.surface,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.xxl,
      overflow: "hidden",
    },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg - 2,
    },
    menuRowLast: {
      borderBottomWidth: 0,
    },
    menuIcon: {
      marginRight: spacing.md,
    },
    menuLabel: {
      flex: 1,
      fontSize: 16,
      fontFamily: fonts.medium,
      color: c.text,
    },
    menuMeta: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginRight: spacing.sm,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
      marginHorizontal: spacing.lg,
    },

    // ── Sign Out ──────────────────────────────────────────────────────────────
    signOutBtn: {
      marginTop: spacing.md,
      marginBottom: spacing.xxl,
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    modalCard: {
      backgroundColor: c.bg,
      borderRadius: radii.xl,
      padding: spacing.xl,
      width: "100%",
      maxHeight: "80%",
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: c.text,
    },
    subTitle: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: spacing.sm,
      marginTop: spacing.md,
    },
  });
