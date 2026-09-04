/**
 * RegisterScreen — the one beat of the walkthrough that is a form.
 *
 * Shown filled rather than empty. An empty form is four grey boxes; a filled one
 * shows what each box wants, which is the only thing the frame has to teach. The
 * name matches the account every other screen is signed in as, so the video runs
 * as one session.
 *
 * This is also the only app screen that reaches for Poppins — the wordmark under
 * the mark. Everything else here is Inter.
 */

import { C, ic, paletteFor } from "./tokens.mjs";
import { USER } from "./sample.mjs";
import { shell, textField, orDivider, googleButton } from "./screens.mjs";
import { brandMark } from "./brand.mjs";

const AUTH_CSS = `
.authScroll { flex: 1 1 0; padding: 0 24px 32px; }
.topHeader { padding-top: 4px; margin-bottom: 12px; }
.backTap { align-self: flex-start; }
.brandContainer { align-items: center; margin-bottom: 16px; }
.authWordmark { font-size: 26px; font-weight: 700; color: ${C.accent}; letter-spacing: -0.5px; margin-top: 4px; }
.titleContainer { align-items: center; margin-bottom: 24px; }
.authTitle { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
.authSubtitle { font-size: 14px; font-weight: 400; color: ${C.textMuted}; }
.form { margin-bottom: 12px; }
.submitBtn { margin-bottom: 12px; }
.footerRow { flex-direction: row; align-items: center; justify-content: center; margin-top: 32px; }
.footerPrompt { font-size: 14px; font-weight: 400; color: ${C.textMuted}; }
.footerLink { font-size: 14px; font-weight: 700; color: ${C.accent}; }
`;

export function register({ mode = "light" } = {}) {
  /** BrandMark draws SVG bars, so it needs a hex rather than a `var()`. */
  const P = paletteFor(mode);

  const body = `
<div class="authScroll f">
  <div class="topHeader f">
    <div class="backTap">${ic("chevron-back", 24, C.text)}</div>
  </div>

  <div class="brandContainer f">
    ${brandMark({ size: 72, color: P.accent, waveColor: P.accentGlow, showWaves: false })}
    <div class="authWordmark display">Notefusion</div>
  </div>

  <div class="titleContainer f">
    <div class="authTitle">Create your account</div>
    <div class="authSubtitle">Start your musical journey</div>
  </div>

  <div class="form f">
    ${textField(USER.fullName)}
    ${textField("francis@example.com")}
    ${textField("••••••••••", { secure: true })}
    ${textField("••••••••••", { secure: true })}
  </div>

  <div class="btn btnPrimary submitBtn">
    <div class="btnLabel" style="color:#FFFFFF">Sign up</div>
  </div>

  ${orDivider()}
  ${googleButton("Sign up with Google")}

  <div class="footerRow">
    <div class="footerPrompt">Already have an account?&nbsp;</div>
    <div class="footerLink">Sign in</div>
  </div>
</div>`;

  return shell(body, AUTH_CSS, { mode });
}
