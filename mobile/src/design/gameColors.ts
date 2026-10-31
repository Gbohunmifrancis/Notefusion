/**
 * The game-coloured Practice's fills (Duolingo-like): a bright fill on a darker lip under it, pressed down when tapped,
 * and the ink that reads on each fill. The web's `--gg-*` (web-site/assets/practice-view.css), same values: green,
 * blue, orange, cyan and pink — never Pro's gold, the choir's violet or a red (a wrong answer stays grey). Practice
 * only; the rest of the app keeps its one accent.
 */

import type { ThemeMode } from "./theme";
import type { GameTone } from "../lib/practiceArcade";

export interface GameFill {
  fill: string;
  lip: string;
  ink: string;
}

export interface GameColors {
  tones: Record<GameTone, GameFill>;
  /** A stop not reached yet. */
  locked: GameFill;
  /** The XP's gem. */
  gem: string;
}

const day: GameColors = {
  tones: {
    green: { fill: "#1FB874", lip: "#138A54", ink: "#04261A" },
    blue: { fill: "#2F6FED", lip: "#1E4FB5", ink: "#FFFFFF" },
    orange: { fill: "#FF9640", lip: "#CC6A16", ink: "#2A1300" },
    cyan: { fill: "#1FB6D6", lip: "#12819A", ink: "#032A33" },
    pink: { fill: "#FF6FAE", lip: "#CF4886", ink: "#3A0A20" },
  },
  locked: { fill: "#E6EAF2", lip: "#C9D1DF", ink: "#7A869E" },
  gem: "#0EA5C9",
};

const night: GameColors = {
  tones: {
    green: { fill: "#3DDC97", lip: "#22A06E", ink: "#04261A" },
    blue: { fill: "#4C8DFF", lip: "#2B5FD0", ink: "#FFFFFF" },
    orange: { fill: "#FF9F43", lip: "#D9771E", ink: "#2A1300" },
    cyan: { fill: "#2EC5E6", lip: "#1B95B3", ink: "#032A33" },
    pink: { fill: "#FF6FAE", lip: "#D44A86", ink: "#3A0A20" },
  },
  locked: { fill: "#232C44", lip: "#161D30", ink: "#6E7A96" },
  gem: "#2EC5E6",
};

export function gameColorsFor(mode: ThemeMode): GameColors {
  return mode === "dark" ? night : day;
}

/**
 * A word in a tone's colour on the page's own surface (the streak's days, the XP): the fill on Night, the darker lip
 * on Day, where the bright fill is too light to read on white.
 */
export function toneText(mode: ThemeMode, tone: GameTone): string {
  const t = gameColorsFor(mode).tones[tone];
  return mode === "dark" ? t.fill : t.lip;
}
