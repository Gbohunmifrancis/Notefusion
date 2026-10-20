import React, { useCallback, useState } from "react";
import { Platform, RefreshControl, StyleSheet, Text, View } from "react-native";
import * as Application from "expo-application";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Avatar } from "../components/Avatar";
import { Touchable } from "../components/Touchable";
import { Skeleton } from "../components/Skeleton";
import { MembershipCard } from "../components/profile/MembershipCard";
import { BackButton, Group, Row } from "../components/settings/Rows";
import { AboutSheet } from "../components/settings/AccountSheets";
import { useAuth } from "../lib/auth";
import { showDialog } from "../lib/dialog";
import { rating } from "../lib/rating";
import { useSubscription } from "../lib/subscription";
import { meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { pickProfileImage } from "../lib/imagePicker";
import { refreshProfilePicture, setProfilePicture, useProfilePicture } from "../lib/profilePicture";
import { holdWithUndo } from "../lib/heldChangeRuntime";
import { PHOTO_REMOVED_LINE } from "../lib/undoWords";
import { getPushPermission, loadNotificationPrefs, pushEnabled } from "../lib/push";
import { notificationsValue } from "../lib/pushStatus";
import { useFeedback } from "../lib/feedback";
import { useAdminLock } from "../lib/adminLockRuntime";
import { Icon } from "../components/Icon";
import { fonts, radii, spacing, type Palette } from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { RootStackParams } from "../navigation/types";

/**
 * Profile — the account, and only the account (board a-core/04), pushed from the avatar at the top right of
 * every tab, so back returns to the tab you were on:
 * 1. The avatar (tap to change the photo), the name and the email
 * 2. MembershipCard: Pro sees the membership (songs left, the date Pro runs to); a free account the free week
 *    and the way to the plans
 * 3. My choir
 * 4. Notifications (On/Off) and Settings (its own pages), Help & support, Send feedback, Rate (Android), and
 *    Admin for admins
 * 5. The version, which opens About
 *
 * Name, email, password, appearance, data, sign out and delete live in Settings; Library, Practice and Hymns are
 * tabs, so none of them repeats here.
 */
export function ProfileScreen() {
  const { user, isAdmin } = useAuth();
  const { isPro, subscription, refresh: refreshSubscription } = useSubscription();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { openFeedback } = useFeedback();
  const picture = useProfilePicture(user?.id);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState<"On" | "Off" | null>(null);
  const [about, setAbout] = useState(false);

  // Re-read on focus: the push switch and the phone's permission change on Notifications and in the phone's settings.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      if (user?.id) void refreshProfilePicture(user.id);
      void Promise.all([loadNotificationPrefs(), getPushPermission()]).then(([, perm]) => {
        if (live) setNotifications(notificationsValue(perm, pushEnabled()));
      });
      return () => {
        live = false;
      };
    }, [user?.id]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        user ? refreshProfilePicture(user.id, true) : undefined,
        refreshSubscription(true).catch(() => undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSubscription, user]);

  // ── Profile picture ────────────────────────────────────────────────────────

  /** Picks an image and uploads it. The API proxies to R2, so no credentials ship in the binary. */
  async function changePicture() {
    const picked = await pickProfileImage();
    if (!picked || !user) return; // cancelled, or permission refused (the picker explains)

    setAvatarBusy(true);
    try {
      const updated = await meApi.uploadPicture(picked.uri, picked.fileName, picked.mimeType);
      setProfilePicture(user.id, updated.profilePictureUrl);
    } catch (e) {
      showDialog({
        title: "Could not update photo",
        message: toApiError(e).message,
        icon: "problem",
        tone: "danger",
      });
    } finally {
      setAvatarBusy(false);
    }
  }

  /**
   * Remove photo, held behind "Photo removed · Undo" (board m-ux-medium's held changes): the photo goes at once and the
   * server is told when the toast leaves, so a slip is one tap back. A refusal puts the photo back and says so.
   */
  function removePicture() {
    if (!user || !picture) return;
    const userId = user.id;
    const before = picture;
    setProfilePicture(userId, null);
    holdWithUndo(
      PHOTO_REMOVED_LINE,
      {
        commit: async () => {
          try {
            const updated = await meApi.removePicture();
            setProfilePicture(userId, updated.profilePictureUrl);
          } catch (e) {
            setProfilePicture(userId, before);
            showDialog({
              title: "Could not remove photo",
              message: toApiError(e).message,
              icon: "problem",
              tone: "danger",
            });
          }
        },
        undo: () => setProfilePicture(userId, before),
      },
      "delete",
    );
  }

  function onAvatarPress() {
    const hasPicture = Boolean(picture);
    showDialog({
      kind: "options",
      title: "Profile photo",
      message: hasPicture ? undefined : "Add a photo to personalise your account.",
      actions: [
        {
          label: hasPicture ? "Change photo" : "Choose photo",
          icon: "image",
          onPress: changePicture,
        },
        ...(hasPicture
          ? [
              {
                label: "Remove photo",
                style: "destructive" as const,
                icon: "delete" as const,
                onPress: removePicture,
              },
            ]
          : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  const version = Application.nativeApplicationVersion ?? "";

  return (
    <Screen
      scroll
      contentStyle={styles.screen}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
      }
    >
      <View style={styles.topbar}>
        <BackButton />
        <Text style={styles.topTitle} accessibilityRole="header">
          Profile
        </Text>
        <View style={styles.topSpacer} />
      </View>

      {/* ── 1. Who ─────────────────────────────────────────────────────────── */}
      {!user ? (
        <View style={styles.who}>
          <Skeleton width={64} height={64} radius={32} />
          <View style={styles.whoText}>
            <Skeleton width={170} height={20} radius={radii.sm} />
            <Skeleton width={190} height={13} radius={radii.sm} style={styles.skeletonLine} />
          </View>
        </View>
      ) : (
        <View style={styles.who}>
          <Avatar
            uri={picture}
            name={user.fullName}
            size={64}
            premium={isPro}
            editable
            busy={avatarBusy}
            onPress={onAvatarPress}
          />
          <View style={styles.whoText}>
            <Text style={styles.name} numberOfLines={2}>
              {user.fullName}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>
      )}

      {/* ── 2. Membership, or the way to it ─────────────────────────────────── */}
      <MembershipCard onPress={() => nav.navigate("Upgrade")} />

      {/* ── 3. The choir ────────────────────────────────────────────────────── */}
      <Group style={styles.gap}>
        <Row
          icon="choir"
          choir
          label="My choir"
          value={subscription?.choirName ?? "Enter code"}
          chevron
          onPress={() => nav.navigate("Choir")}
        />
      </Group>

      {/* ── 4. The rest of the account ──────────────────────────────────────── */}
      <Group style={styles.gap}>
        <Row
          icon="bell"
          label="Notifications"
          value={notifications ?? undefined}
          chevron
          onPress={() => nav.navigate("Notifications")}
        />
        <Row
          icon="settings"
          label="Settings"
          hint="Account, appearance, data saver, sign out"
          chevron
          onPress={() => nav.navigate("Settings")}
        />
        <Row icon="help" label="Help & support" chevron onPress={() => nav.navigate("Help")} />
        <Row
          icon="feedback"
          label="Send feedback"
          chevron
          onPress={() => openFeedback("Profile")}
        />
        {/* Android only, like the rating ask: there is no App Store listing to open yet. */}
        {Platform.OS === "android" ? (
          <Row icon="rate" label="Rate Notefusion" chevron onPress={() => void rating.rate()} />
        ) : null}
      </Group>

      {/* Admin in a group of its own (board f-admin/10), only for an admin: a customer's Profile has no row, no
          space and no "request access". It opens behind the admin lock, so it says "Locked" until it is open. */}
      {isAdmin ? (
        <Group style={styles.gap}>
          <Row
            icon="overview"
            label="Admin"
            hint="Payments, users, health"
            trailing={<AdminLockState />}
            chevron
            onPress={() => nav.navigate("Admin")}
          />
        </Group>
      ) : null}

      {/* ── 5. The version, which opens About ───────────────────────────────── */}
      <Touchable
        onPress={() => setAbout(true)}
        ripple={false}
        style={styles.footer}
        accessibilityLabel="About Notefusion"
      >
        <Text style={styles.footerText}>{`${["Notefusion", version].filter(Boolean).join(" ")} · About`}</Text>
      </Touchable>

      <AboutSheet visible={about} onClose={() => setAbout(false)} />
    </Screen>
  );
}

/** "Locked", with the padlock, until the admin lock opens; then "Open". */
function AdminLockState() {
  const { unlocked } = useAdminLock();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.lockState}>
      {unlocked ? null : <Icon name="lock" size={14} color={colors.textMuted} />}
      <Text style={styles.lockText}>{unlocked ? "Open" : "Locked"}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {
      paddingTop: spacing.xs,
      paddingBottom: spacing.xxxl,
    },
    topbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: 50,
    },
    topTitle: {
      fontFamily: fonts.semibold,
      fontSize: 17,
      color: c.text,
    },
    topSpacer: {
      width: 40,
    },
    who: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      paddingVertical: 14,
      paddingHorizontal: 4,
      marginBottom: 4,
    },
    whoText: {
      flex: 1,
    },
    skeletonLine: {
      marginTop: spacing.sm,
    },
    name: {
      fontFamily: fonts.semibold,
      fontSize: 21,
      letterSpacing: -0.3,
      color: c.text,
    },
    email: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: c.textMuted,
      marginTop: 3,
    },
    gap: {
      marginTop: spacing.lg,
    },
    lockState: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    lockText: {
      fontFamily: fonts.regular,
      fontSize: 14,
      color: c.textMuted,
    },
    footer: {
      alignSelf: "center",
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      marginTop: spacing.md,
    },
    footerText: {
      fontFamily: fonts.regular,
      fontSize: 12,
      color: c.textFaint,
    },
  });
