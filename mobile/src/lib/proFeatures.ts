import type { Ionicons } from "@expo/vector-icons";

/**
 * What Pro unlocks — the paywall's value proposition, and the welcome pop-up's list once it is
 * bought. One list so the promise and the receipt cannot drift apart.
 */
export const PRO_FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: "musical-notes", text: "Whole songs, up to six minutes, twenty a month" },
  { icon: "people", text: "Alto, tenor and bass written under any tune, when you ask" },
  { icon: "download", text: "PDF, MusicXML and MIDI downloads, no watermark" },
  { icon: "flash", text: "Priority lane and sing-along marking" },
];
