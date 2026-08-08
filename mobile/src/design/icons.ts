import type { ImageSourcePropType } from "react-native";

/**
 * Icons8 illustrated icons, recoloured to the blue theme ramp.
 *
 * These are 64 px raster illustrations, not font glyphs — they carry far more
 * detail than an Ionicon and are only used where they render large enough to
 * show it (hero discs, empty states, the record button). Everything smaller —
 * chevrons, chips, meters — stays on Ionicons, which is vector and stays sharp
 * at any size.
 *
 * `microphoneOnBlue` is the same artwork drawn in white ink, for the one place
 * an icon sits on a filled blue disc where the blue version would disappear.
 */
export const appIcons = {
  music: require("../../assets/icons/music.png") as ImageSourcePropType,
  microphone: require("../../assets/icons/microphone.png") as ImageSourcePropType,
  microphoneOnBlue:
    require("../../assets/icons/microphone-onblue.png") as ImageSourcePropType,
  songbook: require("../../assets/icons/songbook.png") as ImageSourcePropType,
  singing: require("../../assets/icons/singing.png") as ImageSourcePropType,
  key: require("../../assets/icons/key.png") as ImageSourcePropType,
} as const;

export type AppIconName = keyof typeof appIcons;
