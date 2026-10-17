import type { GradeResult } from '../api/types';
import { logAnalyticsEvent } from './analytics';
import * as haptics from './haptics';
import { markPractisedToday, rememberStreak } from './practiceReminder';
import { dayKey, rewardEvents, rewardMoment, snapshotAfterTake, type RewardMoment } from './practiceProgress';

/**
 * What every marked take does on the phone, wherever it was sung (the daily drill, Sing it, Learn my part):
 * a tap that matches the moment, the analytics for a level-up or badge, today marked as practised (so the
 * reminder stands down) and the streak remembered for tomorrow's. Returns the line worth showing, if any.
 */
export function acknowledgeGrade(grade: GradeResult): RewardMoment | null {
  const reward = grade.reward ?? null;
  const moment = rewardMoment(reward);
  haptics.play(moment?.big || grade.score >= 80 ? 'success' : 'medium');
  for (const e of rewardEvents(reward)) void logAnalyticsEvent(e.name, e.params);
  if (reward) {
    void markPractisedToday();
    void rememberStreak(snapshotAfterTake(reward.streak, dayKey(new Date())));
  }
  return moment;
}
