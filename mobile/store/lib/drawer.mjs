/**
 * The side bar, open over Home.
 *
 * This frame carries the one piece of navigation a viewer cannot guess. The tab
 * bar used to have five items; Profile and Subscription now live here, behind the
 * avatar in Home's top-left corner. Anyone hunting for their plan in the tab bar
 * will not find it, so the video has to show the tap.
 *
 * `homeBody(mode)` is rendered underneath rather than a still of Home, so the two
 * frames cannot drift apart — and the panel's 320px really does leave the strip
 * of Home visible that it leaves on a device.
 */

import { C, ic } from "./tokens.mjs";
import { USER } from "./sample.mjs";
import { shell, avatar, homeBody, HOME_CSS, S_CARD } from "./screens.mjs";

/** `Math.min(320, width * 0.82)`; at 412dp the cap wins. */
const PANEL_W = 320;

/** `insets.top + 16` and `insets.bottom + 16` on the gesture-nav device. */
const PAD_TOP = 26 + 16;
const PAD_BOTTOM = 20 + 16;

const DRAWER_CSS = `
${HOME_CSS}

.scrim { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: ${C.scrim}; }
/* The Modal is statusBarTranslucent, so the scrim really does dim behind the OS
   glyphs — and the app does not switch barStyle when the drawer opens. Hence the
   clock stays dark-on-dim here: that is what a device shows, not a mistake. */
.statusbar { position: relative; z-index: 10; }
/* A Modal, not @react-navigation/drawer: the panel is a plain absolute View that
   slides in from -panelWidth, so at rest it sits flush against the left edge. */
.panel { position: absolute; left: 0; top: 0; bottom: 0; width: ${PANEL_W}px; background: ${C.bgElevated}; border-top-right-radius: 20px; border-bottom-right-radius: 20px; padding: ${PAD_TOP}px 16px ${PAD_BOTTOM}px; box-shadow: ${S_CARD}; }

.identity { flex-direction: row; align-items: center; padding: 8px 0; }
.identityText { flex: 1 1 0; min-width: 0; margin-left: 12px; }
.identityName { font-size: 17px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.viewProfile { font-size: 13px; font-weight: 500; color: ${C.textMuted}; margin-top: 1px; }

.rule { height: 1px; background: ${C.border}; margin: 12px 0; }

.drawerRow { flex-direction: row; align-items: center; gap: 12px; padding: 12px 0; }
.rowLabel { flex: 1 1 0; font-size: 15px; font-weight: 600; }
.rowLabelDanger { color: ${C.danger}; }

/* FREE, not PRO: the sample account is on the free tier, the same as the trial
   pill on Record and the plain avatar ring above. */
.planBadge { border-radius: 999px; border: 1px solid ${C.border}; background: ${C.surfaceAlt}; padding: 2px 8px; }
.planBadgeText { font-size: 9.5px; font-weight: 700; color: ${C.textMuted}; letter-spacing: 0.8px; }
`;

const ROWS = [
  ["star-outline", "Your plan", true],
  ["folder-outline", "Your library", false],
  ["settings-outline", "Settings and privacy", false],
  ["help-circle-outline", "Help &amp; support", false],
];

export function drawer({ mode = "light" } = {}) {
  const rows = ROWS.map(
    ([icon, label, badge]) => `
    <div class="drawerRow">
      ${ic(icon, 21, C.text)}
      <div class="rowLabel">${label}</div>
      ${badge ? `<div class="planBadge"><div class="planBadgeText">FREE</div></div>` : ""}
    </div>`,
  ).join("");

  const panel = `
<div class="scrim"></div>
<div class="panel f">
  <div class="identity">
    ${avatar(52)}
    <div class="identityText f">
      <div class="identityName">${USER.fullName}</div>
      <div class="viewProfile">View profile</div>
    </div>
    ${ic("chevron-forward", 16, C.textFaint)}
  </div>

  <div class="rule"></div>
  ${rows}
  <div class="rule"></div>

  <div class="drawerRow">
    ${ic("log-out-outline", 21, C.danger)}
    <div class="rowLabel rowLabelDanger">Sign out</div>
  </div>
</div>`;

  return shell(`${homeBody(mode)}${panel}`, DRAWER_CSS, { mode });
}
