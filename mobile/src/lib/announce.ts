import { useEffect } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/**
 * Says `text` to VoiceOver each time it changes to something. A live region (`accessibilityLiveRegion`) is Android's
 * alone: on iOS a line that changes by itself (a job's step, a nudge that fades in) was never read. Android keeps its
 * live region, so nothing is said twice there. Null says nothing.
 */
export function useIosAnnouncement(text: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS === "ios" && text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}
