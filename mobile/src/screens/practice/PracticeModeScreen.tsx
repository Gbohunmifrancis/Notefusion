/**
 * One of "More ways to practise" (boards c-practice/6a–6d), pushed from the Practice tab's list: the warm-up and range
 * finder, pitch match, scales, riffs & runs, intervals, sing the harmony, or rhythm. Every marked mode opens on its path. The hub lists only the modes the server
 * says are live (`PracticeProgress.modes`), so a mode is switched on or off without an app update.
 */

import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParams } from "../../navigation/types";
import { WarmUpScreen } from "./WarmUpScreen";
import { PitchMatchScreen } from "./PitchMatchScreen";
import { RunsScreen } from "./RunsScreen";
import { SingNotesScreen } from "./SingNotesScreen";
import { RhythmScreen } from "./RhythmScreen";

export function PracticeModeScreen({ route }: NativeStackScreenProps<RootStackParams, "PracticeMode">) {
  const { mode, track = null } = route.params;
  switch (mode) {
    case "warm-up":
      return <WarmUpScreen track={track} />;
    case "pitch-match":
      return <PitchMatchScreen track={track} />;
    case "runs":
      return <RunsScreen track={track} />;
    case "scales":
    case "intervals":
    case "harmony":
      return <SingNotesScreen mode={mode} track={track} />;
    default:
      return <RhythmScreen track={track} />;
  }
}
