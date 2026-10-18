import React, { useCallback } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Avatar } from "./Avatar";
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import { refreshProfilePicture, useProfilePicture } from "../lib/profilePicture";
import type { RootStackParams } from "../navigation/types";

/** The avatar's size in every tab header. */
export const HEADER_AVATAR = 38;

/**
 * The account, at the top right of every tab: the picture (or initials), with Pro's gold ring from the same
 * `isPro` every Pro check reads, and a tap that pushes Profile — so back returns to the tab you were on.
 */
export function HeaderAvatar() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { user } = useAuth();
  const { isPro } = useSubscription();
  const picture = useProfilePicture(user?.id);

  // Re-read on focus (at most every 30 s): a photo changed on another device appears without a relaunch.
  useFocusEffect(
    useCallback(() => {
      if (user?.id) void refreshProfilePicture(user.id);
    }, [user?.id]),
  );

  return (
    <Avatar
      uri={picture}
      name={user?.fullName}
      size={HEADER_AVATAR}
      premium={isPro}
      onPress={() => nav.navigate("Profile")}
      accessibilityLabel="Profile and settings"
    />
  );
}
