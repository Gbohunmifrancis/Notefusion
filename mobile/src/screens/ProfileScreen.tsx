import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import * as WebBrowser from "expo-web-browser";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { TextField } from "../components/TextField";
import { Skeleton } from "../components/Skeleton";
import { Mark } from "../components/night/NightUI";
import { MembershipCard } from "../components/profile/MembershipCard";
import { useAuth } from "../lib/auth";
import { showDialog } from "../lib/dialog";
import { outboxPending } from "../lib/outbox";
import { signOutWarning } from "../lib/sendQueue";
import { rating } from "../lib/rating";
import { useSubscription } from "../lib/subscription";
import { meApi, authApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { tokenStore } from "../lib/tokenStore";
import { siteUrls } from "../lib/env";
import { pickProfileImage } from "../lib/imagePicker";
import {
  fonts,
  motion,
  radii,
  spacing,
  type Palette,
} from "../design/theme";
import { useFeedback } from "../lib/feedback";
import { useColors, useTheme, useThemedStyles } from "../lib/theme";
import type { MyProfile } from "../api/types";
import type { RootStackParams } from "../navigation/types";


/**
 * ProfileScreen — "07 · You" on the night board:
 * 1. Header: the avatar in its ring, the name as a big tight title, the email muted under it
 * 2. MembershipCard: Pro sees the membership (songs left as a ring, the date Pro runs to);
 *    a free account sees the same card inviting the plans
 * 3. One grouped list: Account, Appearance, Notifications, Find the key, Rate, Help, Settings,
 *    Admin (admins only), Sign out
 * 4. Footer: the mark and the version, which opens About (version, legal, the piano credit)
 *
 * Premium treatment (gold avatar ring, the membership card) is driven entirely by
 * `useSubscription().isPro` — the billing service's answer. It used to read
 * `profile.role`, which is an authorisation level and not a payment, and the ring was
 * unconditional, so free accounts wore the paid look.
 */
export function ProfileScreen() {
  const { user, setUser, signOut, isAdmin } = useAuth();
  const { isPro, subscription, refresh: refreshSubscription } = useSubscription();
  const { mode, setMode } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { openFeedback } = useFeedback();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Edit modals
  const [accountModal, setAccountModal] = useState(false);
  const [aboutModal, setAboutModal] = useState(false);
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

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        meApi
          .get()
          .then((p) => {
            setProfile(p);
            setName(p.fullName);
          })
          .catch(() => undefined),
        refreshSubscription(true).catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSubscription]);

  // ── Name update ────────────────────────────────────────────────────────────

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.fullName) return;
    try {
      const updated = await meApi.update(trimmed);
      setProfile(updated);
      setUser({ ...user!, fullName: updated.fullName });
      showDialog({
        title: "Saved",
        message: "Your display name has been updated.",
        icon: "checkmark-circle-outline",
      });
    } catch (e) {
      showDialog({
        title: "Could not update",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    }
  }

  // ── Password change ────────────────────────────────────────────────────────

  async function changePassword() {
    setPwBusy(true);
    try {
      // The server revoked every other session, ours included; the pair it returns is the live one.
      const pair = await authApi.changePassword(current, next);
      await tokenStore.save(pair.accessToken, pair.refreshToken);
      setCurrent("");
      setNext("");
      showDialog({
        title: "Password updated",
        message: "Your password has been changed.",
        icon: "checkmark-circle-outline",
      });
    } catch (e) {
      showDialog({
        title: "Could not change password",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
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
      showDialog({
        title: "Could not update photo",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
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
      showDialog({
        title: "Could not remove photo",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  function onAvatarPress() {
    const hasPicture = Boolean(profile?.profilePictureUrl);
    showDialog({
      title: "Profile photo",
      message: hasPicture ? undefined : "Add a photo to personalise your account.",
      icon: "camera-outline",
      actions: [
        {
          label: hasPicture ? "Change photo" : "Choose photo",
          icon: "image-outline",
          onPress: changePicture,
        },
        ...(hasPicture
          ? [
              {
                label: "Remove photo",
                style: "destructive" as const,
                icon: "trash-outline" as const,
                onPress: removePicture,
              },
            ]
          : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  return (
    <Screen
      scroll
      contentStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      {/* ── 1. Who: avatar in its ring, the name, the email ──────────────── */}
      {!user ? (
        <View style={styles.userHeader}>
          <Skeleton width={76} height={76} radius={38} />
          <View style={styles.userText}>
            <Skeleton width={170} height={22} radius={radii.sm} />
            <Skeleton width={190} height={13} radius={radii.sm} style={styles.skeletonLine} />
          </View>
        </View>
      ) : (
        <View style={styles.userHeader}>
          <Avatar
            uri={profile?.profilePictureUrl}
            name={user?.fullName}
            size={76}
            premium={isPro}
            editable
            busy={avatarBusy}
            onPress={onAvatarPress}
          />
          <View style={styles.userText}>
            <Text style={styles.userName} numberOfLines={2}>
              {user?.fullName ?? "Your name"}
            </Text>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user?.email ?? ""}
            </Text>
          </View>
        </View>
      )}

      {/* ── 2. Membership, or the way to it ───────────────────────────────── */}
      {/* Same destination either way: a member goes there to see the dates and add time or
          resubscribe, a free account to see the plans. */}
      <MembershipCard onPress={() => nav.navigate("Upgrade")} />

      {/* ── 3. One grouped list ───────────────────────────────────────────── */}
      <View style={styles.list}>
        <ListRow
          icon="person-outline"
          label="Account"
          onPress={() => setAccountModal(true)}
        />
        {/* The choir plan: a director's invite and singers, a singer's choir, or the code field. */}
        <ListRow
          icon="people-outline"
          label="My choir"
          value={subscription?.choirName ?? "Enter choir code"}
          onPress={() => nav.navigate("Choir")}
        />
        <ListRow
          icon="contrast-outline"
          label="Appearance"
          value={mode === "dark" ? "Night" : "Day"}
          chevron={false}
          onPress={() => setMode(mode === "dark" ? "light" : "dark")}
          accessibilityLabel={`Appearance: ${mode === "dark" ? "Night" : "Day"}. Switch to ${mode === "dark" ? "Day" : "Night"}`}
        />
        {/* The push switch lives in Settings, where it reconciles with the OS permission. */}
        <ListRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => nav.navigate("Settings", { focus: "notifications" })}
        />
        <ListRow
          icon="radio-outline"
          label="Find the key"
          onPress={() => nav.navigate("Listen")}
          accessibilityLabel="Find the key of a song that is playing"
        />
        {/* Android only, like the rating ask: there is no App Store listing to open yet. */}
        {Platform.OS === "android" && (
          <ListRow
            icon="star-outline"
            iconColor={colors.premium}
            label="Rate Notefusion"
            onPress={() => void rating.rate()}
          />
        )}
        <ListRow
          icon="help-circle-outline"
          label="Help & Support"
          onPress={() => nav.navigate("Help")}
        />
        <ListRow
          icon="chatbubble-ellipses-outline"
          label="Send feedback"
          onPress={() => openFeedback("Profile")}
        />
        <ListRow
          icon="settings-outline"
          label="Settings"
          onPress={() => nav.navigate("Settings")}
        />
        {/* Hidden for everyone else, as in the side bar: the routes are behind the server's
            Admin policy, so this is about not showing a customer an operator surface. */}
        {isAdmin && (
          <ListRow
            icon="shield-checkmark-outline"
            iconColor={colors.accent}
            label="Admin"
            onPress={() => nav.navigate("AdminHome")}
          />
        )}
        <ListRow
          icon="log-out-outline"
          iconColor={colors.danger}
          labelColor={colors.danger}
          label="Sign out"
          chevron={false}
          onPress={() => {
            // Unconfirmed as before, unless recordings are still waiting to send: those go with it.
            const pending = outboxPending();
            if (pending === 0) return void signOut();
            showDialog({
              title: "Sign out?",
              message: signOutWarning(pending).trim(),
              icon: "log-out-outline",
              tone: "danger",
              actions: [
                { label: "Sign out", style: "destructive", icon: "log-out-outline", onPress: () => signOut() },
                { label: "Stay signed in", style: "cancel" },
              ],
            });
          }}
          isLast
        />
      </View>

      {/* ── 4. Footer: the mark and the version, which opens About ────────── */}
      <Touchable
        onPress={() => setAboutModal(true)}
        ripple={false}
        style={styles.footer}
        accessibilityLabel="About Notefusion"
      >
        <View style={styles.footerMark}>
          <Mark height={14} color={colors.textFaint} />
        </View>
        <Text style={styles.footerText}>
          Notefusion {Application.nativeApplicationVersion ?? ""}
        </Text>
      </Touchable>

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
              <Touchable
                onPress={() => setAccountModal(false)}
                hitSlop={8}
                ripple="borderless"
                accessibilityLabel="Close account settings"
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Touchable>
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
      {/* ── About Modal ───────────────────────────────────────────────── */}
      <Modal
        visible={aboutModal}
        transparent
        animationType="slide"
        onRequestClose={() => setAboutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>About Notefusion</Text>
              <Touchable
                onPress={() => setAboutModal(false)}
                hitSlop={8}
                ripple="borderless"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Touchable>
            </View>

            <Text style={styles.aboutDescription}>
              Notefusion turns what you hum, sing, or play into Tonic Solfa and
              staff notation — instantly, on your phone.
            </Text>

            <View style={styles.aboutLinkRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.textMuted} />
              <Touchable
                onPress={() =>
                  WebBrowser.openBrowserAsync(siteUrls.privacy)
                }
                ripple={false}
                accessibilityLabel="Privacy Policy"
              >
                <Text style={styles.aboutLink}>Privacy Policy</Text>
              </Touchable>
            </View>

            <View style={styles.aboutLinkRow}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.textMuted} />
              <Touchable
                onPress={() =>
                  WebBrowser.openBrowserAsync(siteUrls.terms)
                }
                ripple={false}
                accessibilityLabel="Terms of Service"
              >
                <Text style={styles.aboutLink}>Terms of Service</Text>
              </Touchable>
            </View>

            <View style={styles.aboutVersionRow}>
              <Text style={styles.aboutVersionLabel}>Version</Text>
              <Text style={styles.aboutVersionValue}>
                {Application.nativeApplicationVersion ?? "—"}
              </Text>
            </View>

            {/* CC BY 3.0 asks for this credit wherever the recording is used. */}
            <Text style={styles.aboutCredit}>
              Piano sound: Salamander Grand Piano V3 by Alexander Holm, licensed under{" "}
              <Text
                style={styles.aboutCreditLink}
                onPress={() => WebBrowser.openBrowserAsync("https://creativecommons.org/licenses/by/3.0/")}
                accessibilityRole="link"
              >
                CC BY 3.0
              </Text>
              . Converted to mono, resampled, trimmed and level-matched for NoteFusion.
            </Text>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function ListRow({
  icon,
  label,
  value,
  onPress,
  iconColor,
  labelColor,
  chevron = true,
  isLast = false,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Trailing value, e.g. the current appearance. */
  value?: string;
  onPress: () => void;
  iconColor?: string;
  labelColor?: string;
  chevron?: boolean;
  isLast?: boolean;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      // Full-bleed row: a deeper press would pull it away from both edges of the
      // list at once. No `radius` needed — `list` carries overflow:hidden, so the
      // ripple clips to its corners.
      scaleTo={motion.scale.row}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <View style={[styles.row, !isLast && styles.rowRule]}>
        <Ionicons name={icon} size={20} color={iconColor ?? colors.textMuted} />
        <Text style={[styles.rowLabel, labelColor ? { color: labelColor } : null]}>
          {label}
        </Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {chevron && (
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        )}
      </View>
    </Touchable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingTop: spacing.md,
      // Clears the floating tab bar.
      paddingBottom: 120,
      paddingHorizontal: spacing.xl,
    },

    // ── Header ────────────────────────────────────────────────────────────────
    userHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      marginBottom: spacing.xl,
    },
    userText: {
      flex: 1,
    },
    skeletonLine: {
      marginTop: spacing.sm,
    },
    userName: {
      fontSize: 26,
      fontFamily: fonts.semibold,
      letterSpacing: -1,
      color: c.text,
    },
    userEmail: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      marginTop: 3,
    },

    // ── Grouped list ──────────────────────────────────────────────────────────
    list: {
      marginTop: 22,
      backgroundColor: c.surface,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginHorizontal: spacing.lg,
      paddingVertical: 15,
    },
    // On the row's inner view, inset by its margin, so the hairline stops short of the edges.
    rowRule: {
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.medium,
      color: c.text,
    },
    rowValue: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },

    // ── Footer ────────────────────────────────────────────────────────────────
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      marginTop: 20,
      paddingVertical: spacing.sm,
      alignSelf: "center",
    },
    footerMark: {
      opacity: 0.7,
    },
    footerText: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textFaint,
    },

    // ── Modal ─────────────────────────────────────────────────────────────────
    modalOverlay: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
    },
    modalCard: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 22,
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
      fontFamily: fonts.semibold,
      letterSpacing: -0.6,
      color: c.text,
    },
    subTitle: {
      fontSize: 15,
      fontFamily: fonts.bold,
      color: c.text,
      marginBottom: spacing.sm,
      marginTop: spacing.md,
    },

    // ── About modal ───────────────────────────────────────────────────────────
    aboutDescription: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      lineHeight: 21,
      marginBottom: spacing.xl,
    },
    aboutLinkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    aboutLink: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: c.accent,
    },
    aboutVersionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: spacing.sm,
      marginTop: spacing.xs,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    aboutVersionLabel: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
    },
    aboutVersionValue: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: c.accent,
    },
    aboutCredit: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textMuted,
      lineHeight: 18,
      marginTop: spacing.md,
    },
    aboutCreditLink: {
      color: c.accent,
    },
  });

