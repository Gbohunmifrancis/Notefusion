/**
 * The rule for Home's one-time "what you can do now" sheet (`components/WhatsNew`, Android): transcribing from any app
 * with the Listen tile or the floating button, and Find the key. Shown once per install, never in the very first
 * session (the intro says enough then), never over another sheet, and never on a store build older than Listen from
 * anywhere (an update reaches build 43, which has no tile or button: the sheet waits for the build that has them).
 * Pure, so it runs in the tests.
 */

/** Where "already shown" is kept on the phone. */
export const WHATS_NEW_KEY = "nf.whatsNew.listen1";

export function shouldShowWhatsNew(input: {
  platform: string;
  seen: boolean;
  firstLaunch: boolean;
  dialogOpen: boolean;
  /** This build has Listen from anywhere (`Listen.getAnywhere()` answers). */
  anywhere: boolean;
}): boolean {
  return input.platform === "android" && input.anywhere && !input.seen && !input.firstLaunch && !input.dialogOpen;
}
