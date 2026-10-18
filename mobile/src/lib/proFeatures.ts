import type { IconName } from "../components/Icon";

/**
 * What Pro unlocks — the paywall's value proposition, and the welcome pop-up's list once it is
 * bought. One list so the promise and the receipt cannot drift apart.
 */
export const PRO_FEATURES: { icon: IconName; text: string }[] = [
  { icon: "song", text: "Whole songs, up to six minutes, twenty a month" },
  { icon: "parts", text: "Alto, tenor and bass written under any tune, when you ask" },
  { icon: "export", text: "PDF, MusicXML and MIDI downloads, no watermark" },
  { icon: "quick", text: "Priority lane and sing-along marking" },
];
