/**
 * Welcome's ways in (boards l-ux-high/04a and 07): never more than two block buttons, the rest as links in the line
 * under them. Google is first when it is set up; the second button is the likeliest next move — signing in by email
 * when that is how this phone signed in last, else trying the app first with a hummed tune — and with no Google both
 * are buttons. Pure (`welcomeChoices.test.ts`).
 */

/** A block button: Google, the email one (sign in when email was used last, else create an account), or try it. */
export type WelcomeBlock = "google" | "email" | "try";

/** A link in the line under the buttons. */
export type WelcomeLink = "create" | "signIn" | "try";

export interface WelcomeChoices {
  blocks: WelcomeBlock[];
  /** The words before the links: "Use email:", "New here?", "Already have one?". */
  lead: string;
  links: WelcomeLink[];
}

/**
 * Login's order (board n-ux-low Q3e): Google first, as the screen's one primary, when it is set up and was this
 * phone's last way in; else the email form first with Google under "or", as before — also while the last way in is
 * not known yet (`undefined`) or never was (`null`).
 */
export function loginGoogleFirst(googleConfigured: boolean, lastAuthMethod: "google" | "email" | null | undefined): boolean {
  return googleConfigured && lastAuthMethod === "google";
}

export function welcomeChoices(googleConfigured: boolean, emailLast: boolean): WelcomeChoices {
  if (!googleConfigured) {
    return emailLast
      ? { blocks: ["email", "try"], lead: "New here?", links: ["create"] }
      : { blocks: ["email", "try"], lead: "Already have one?", links: ["signIn"] };
  }
  return emailLast
    ? { blocks: ["google", "email"], lead: "New here?", links: ["create", "try"] }
    : { blocks: ["google", "try"], lead: "Use email:", links: ["create", "signIn"] };
}
