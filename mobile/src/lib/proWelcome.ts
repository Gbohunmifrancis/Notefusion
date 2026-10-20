/**
 * Where the payment welcome's one button goes once its sheet has gone (it used to only close it). Pure, so it is
 * tested (proWelcome.test.ts); `lib/subscription` reads the root stack's route names, bottom first, and navigates.
 */

export type WelcomeKind = "pro" | "song" | "choir";
export type WelcomeStep = "stay" | "back" | "record" | "choir";

/**
 * - A song bought: nowhere; the paywall has already gone back to the recorder or the link to use it (UpgradeScreen).
 * - A choir: to the choir, where the invite code is, unless it is open already (the paywall opens it on landing).
 * - Pro: back to what the paywall was opened over (a song link, a sheet, the choir), to carry on with it; over a tab
 *   or Profile, to Record. With the paywall gone, a tab switches to Record and anything else is left as it is.
 */
export function welcomeStep(kind: WelcomeKind, stack: readonly string[]): WelcomeStep {
  const top = stack[stack.length - 1];
  if (kind === "song") return "stay";
  if (kind === "choir") return top === "Choir" ? "stay" : "choir";
  if (top === "Tabs") return "record";
  if (top !== "Upgrade") return "stay";
  const below = stack[stack.length - 2];
  return below === undefined || below === "Tabs" || below === "Profile" ? "record" : "back";
}
