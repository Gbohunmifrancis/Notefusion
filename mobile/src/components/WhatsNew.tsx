/**
 * The one-time sheet on Home that tells an Android user what NoteFusion can do outside the app (`lib/whatsNew` for the
 * rule): transcribe a song playing in any other app with the Listen tile or the floating button, the sheet arriving as a
 * notification, and Find the key, which names a playing song's doh and key in the background. Each row opens where it is
 * set up; "Later" or any choice spends it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback } from "react";
import { Platform } from "react-native";

import { logAnalyticsEvent } from "../lib/analytics";
import { isFirstSession } from "../lib/appReady";
import { isDialogShowing, showDialog } from "../lib/dialog";
import { WHATS_NEW_KEY, shouldShowWhatsNew } from "../lib/whatsNew";
import type { RootStackParams } from "../navigation/types";

async function whatsNewSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WHATS_NEW_KEY)) !== null;
  } catch {
    return true; // storage refused: never risk showing it on every open
  }
}

async function markWhatsNewSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(WHATS_NEW_KEY, "1");
  } catch {
    // Shown again next time at worst.
  }
}

/** Waits this long after Home comes into view, so it never lands on top of the screen arriving. */
const DELAY_MS = 1500;

export function useWhatsNew(): void {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();

  useFocusEffect(
    useCallback(() => {
      let live = true;
      const timer = setTimeout(() => {
        void (async () => {
          const seen = await whatsNewSeen();
          if (!live || !shouldShowWhatsNew({ platform: Platform.OS, seen, firstLaunch: isFirstSession(), dialogOpen: isDialogShowing() }))
            return;
          await markWhatsNewSeen();
          logAnalyticsEvent("whats_new_shown", { topic: "listen" });
          showDialog({
            title: "NoteFusion works outside the app too",
            message: "Two things you can do while another app is playing music.",
            icon: "overlay",
            choices: [
              {
                label: "Transcribe from any app",
                detail: "Play a song in YouTube, WhatsApp or anywhere, tap the Listen tile or the floating button, and your sheet arrives as a notification.",
                icon: "qs-tile",
                tone: "accent",
                onPress: () => {
                  logAnalyticsEvent("whats_new_open", { topic: "listen_anywhere" });
                  navigation.navigate("Settings");
                },
              },
              {
                label: "Find the key of a song",
                detail: "Play a song out loud and see its doh and key, even with NoteFusion in the background. Nothing is uploaded.",
                icon: "find-key",
                tone: "accent",
                onPress: () => {
                  logAnalyticsEvent("whats_new_open", { topic: "find_key" });
                  navigation.navigate("Listen");
                },
              },
            ],
            actions: [{ label: "Later", style: "cancel" }],
          });
        })();
      }, DELAY_MS);
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }, [navigation]),
  );
}
