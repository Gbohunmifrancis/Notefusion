/**
 * What Song link's pinned bar says and offers (boards l-ux-high 02b, 02c). Pure, so it is tested
 * (`linkEntitlement.test.ts`). The server still has the final say (`SubmitLinkTranscriptionCommand`);
 * this only stops an account with nothing left for a song from tapping an enabled Transcribe that can
 * only end in a refusal card.
 *
 * - `send`: Transcribe, under the line saying what it uses.
 * - `buy`: a free account whose one preview is used and that holds no bought song: buy this song, or Pro.
 * - `full`: Pro with this month's songs used. No single song is sold to Pro (BILLING_SINGLE_NOT_NEEDED),
 *   so the bar says why and offers the membership, nothing to buy.
 */
export type LinkEntitlement =
  | { kind: "send"; line: string }
  | { kind: "buy"; reason: string }
  | { kind: "full"; reason: string };

export function linkEntitlement(account: {
  isPro: boolean;
  /** `songCreditsRemaining`: Pro's songs left this month (choir pool included), or the free previews left. */
  credits: number | null | undefined;
  creditsTotal: number | null | undefined;
  /** One-song purchases not yet used; on a free account each is a whole linked song. */
  boughtRemaining: number;
}): LinkEntitlement {
  const { isPro, credits, creditsTotal, boughtRemaining } = account;
  const total = creditsTotal ?? 20;
  if (isPro) {
    if (credits == null) return { kind: "send", line: `Pro: ${total} songs a month, in the fast lane.` };
    if (credits > 0) return { kind: "send", line: `Uses 1 of your ${credits} songs left this month` };
    return { kind: "full", reason: `All ${total} of this month's songs are used.` };
  }
  if (boughtRemaining > 0) return { kind: "send", line: "Uses the song you bought: the whole song, up to six minutes." };
  if (credits === 0) return { kind: "buy", reason: "Your free preview is used." };
  return { kind: "send", line: "Free preview: the first 60 seconds of one song. Buy the whole song, or go Pro." };
}
