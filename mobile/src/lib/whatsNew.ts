/**
 * The rule for Home's one-time "what you can do now" sheet (`components/WhatsNew`, Android): transcribing from any app
 * with the Listen tile or the floating button, and Find the key. Shown once per install, never in the very first
 * session (the intro says enough then) and never over another sheet. Pure, so it runs in the tests.
 */

/** Where "already shown" is kept on the phone. */
export const WHATS_NEW_KEY = "nf.whatsNew.listen1";

export function shouldShowWhatsNew(input: {
  platform: string;
  seen: boolean;
  firstLaunch: boolean;
  dialogOpen: boolean;
}): boolean {
  return input.platform === "android" && !input.seen && !input.firstLaunch && !input.dialogOpen;
}
