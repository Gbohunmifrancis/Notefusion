/**
 * The marking moment (board s-practice-fun/s2): a marked take's notes come in one at a time, 120 ms apart — a note
 * sung in tune pops a touch past full size with a light buzz, and the notes sung in tune play back as a quick run while
 * they land (only with the app's sound on); close, off and missed notes just appear, with no sound. Then the score
 * counts up from 0 over half a second. Reduce Motion, or a mark that is not fresh: everything at once, still.
 */

import { useEffect, useMemo, useState } from "react";
import { Animated, Easing } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import type { GradeResult, NoteEvent } from "../../api/types";
import { play as buzz } from "../../lib/haptics";
import { prepareTune } from "../../lib/seasonChime";

/** Between one mark landing and the next. */
export const MARK_STEP_MS = 120;
const POP_MS = 260;
const COUNT_MS = 500;
/** The run of in-tune notes is played at this tempo, one step a mark. */
const RUN_BPM = 120;
const TUNE_LATE_MS = 300;

export function useMarkReveal(grade: GradeResult, notes: readonly NoteEvent[], fresh: boolean) {
  const reduceMotion = useReducedMotion();
  const animate = fresh && !reduceMotion;
  // One value per mark, rebuilt for each new mark: 0 unseen, 1 landed.
  const values = useMemo(() => grade.notes.map(() => new Animated.Value(animate ? 0 : 1)), [grade, animate]);
  const [score, setScore] = useState(animate ? 0 : grade.score);
  const [done, setDone] = useState(!animate);

  useEffect(() => {
    if (!animate) {
      setScore(grade.score);
      setDone(true);
      return;
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const beat = 60_000 / RUN_BPM;
    const run = grade.notes
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.status === "hit" && notes[g.index])
      .map(({ g, i }) => ({ ...notes[g.index]!, startBeat: (i * MARK_STEP_MS) / beat, durBeats: 0.35 }));
    // Played only if it is ready while the first marks land; late, it would sound after them.
    const asked = Date.now();
    void prepareTune(run, RUN_BPM).then((playRun) => {
      if (!cancelled && Date.now() - asked < TUNE_LATE_MS) playRun?.();
    });

    grade.notes.forEach((g, i) => {
      timers.push(
        setTimeout(() => {
          Animated.timing(values[i]!, {
            toValue: 1,
            duration: POP_MS,
            // In tune overshoots (a pop, about ×1.14); the rest settle.
            easing: g.status === "hit" ? Easing.out(Easing.back(3)) : Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
          if (g.status === "hit") buzz("light");
        }, i * MARK_STEP_MS),
      );
    });

    const countFrom = grade.notes.length * MARK_STEP_MS + 200;
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
      timers.push(setTimeout(() => setScore(Math.round((grade.score * k) / steps)), countFrom + (COUNT_MS * k) / steps));
    }
    timers.push(setTimeout(() => setDone(true), countFrom + COUNT_MS));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // A new mark (or the moment it stops being fresh) starts it again; `notes` belong to the mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, animate]);

  /** A mark's style while it lands: faded in from 60% size. */
  const markStyle = (i: number) => {
    const v = values[i];
    if (!v) return undefined;
    return { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] };
  };

  return { score, done, markStyle };
}
