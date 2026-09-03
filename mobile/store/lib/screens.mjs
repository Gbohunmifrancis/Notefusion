/**
 * The app's screens as HTML, at 412×915 CSS px — one CSS px per React Native dp,
 * so every number below is the number in the stylesheet it came from. 412×915dp
 * is a Pixel 6/7/8 window, the most common Android viewport there is; the Record
 * screen's spacing (a 72dp status margin over 100dp of tab-bar clearance) needs
 * about 890dp, so a compact 360×800 phone crowds it.
 *
 * Why HTML and not a device screenshot: the store set has to be reproducible and
 * has to show one coherent session. Rebuilding the markup from the real
 * stylesheets keeps the pixels honest without needing a device, a signed build
 * and a recording session every time a colour changes.
 *
 * Four React Native behaviours are emulated deliberately:
 *   1. `flex-shrink: 0` globally. RN never shrinks a child below its content, so
 *      an overflowing column overflows rather than squeezing — if a screen is
 *      too tall here, it is too tall on a device too, and the render check will
 *      say so instead of quietly compressing it.
 *   2. `box-sizing: border-box`, which is RN's only box model.
 *   3. `position: relative` on every div, which is RN's default for a View. It is
 *      what makes an overlay behave: in CSS a positioned sibling paints over an
 *      in-flow one regardless of document order, so without this the splash's
 *      gradient hid its own wordmark.
 *   4. Weight-selected Inter/Poppins instead of family-selected. See `tokens.mjs`.
 *
 * The one thing that is NOT faithful: `typography.mono`. The app asks Android
 * for "monospace" and gets Roboto Mono; there is no monospace TTF in
 * node_modules, so these pages fall through to Chromium's default (Consolas on
 * Windows), which is a little narrower. It affects the solfa lines only.
 */

import { C, FONT_FACES, brand, ic, paletteVars } from "./tokens.mjs";
import { TAKE, NOTES, LIBRARY, USER } from "./sample.mjs";
import { deriveSolfa, staffSvg, confidenceColor, confidenceLabel } from "./music.mjs";

export const DEVICE_W = 412;
export const DEVICE_H = 915;

/** Safe-area insets of the device being imitated — a gesture-navigation phone. */
const INSET_TOP = 26;
const INSET_BOTTOM = 20;

/** `shadow.card` from the theme. A var, so dark mode gets the stronger one. */
const S_CARD = C.shadowCard;

/** NotePlayer's own gradient is [c.purple, c.gold], not gradients.brand. */
const PLAYER_GRAD = `linear-gradient(90deg, ${C.purple}, ${C.gold})`;

// ─── Base stylesheet ─────────────────────────────────────────────────────────

const CSS = `
${FONT_FACES}

/* RN reset: border-box everywhere, no default margins, and no shrinking. */
* { margin: 0; padding: 0; box-sizing: border-box; flex-shrink: 0; }
/* Every RN View is a flex container laying out down the page, and every RN View is
   position: relative by default. A <div> here is a View, so it gets both —
   otherwise a rule that only says "flex-direction: row" silently stacks its
   children, and, worse, CSS paints any absolutely-positioned sibling *above* the
   in-flow ones no matter the document order, which RN never does. With every div
   positioned, document order decides what covers what, exactly as on a device, and
   an absolute child resolves against its own parent the way RN resolves it. */
div { display: flex; flex-direction: column; position: relative; }
html, body { width: ${DEVICE_W}px; height: ${DEVICE_H}px; overflow: hidden; }
body {
  background: ${C.bg};
  color: ${C.text};
  font-family: Inter, sans-serif;
  font-weight: 400;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
/* fonts.display / fonts.displayBold. Poppins announces; it never sets body copy,
   so it is opt-in per element rather than inherited from <body>. */
.display { font-family: Poppins, sans-serif; }
.ion { font-family: Ionicons; font-style: normal; font-weight: 400; line-height: 1; }

/* Layout atoms. RN's default flex direction is column, unlike CSS. */
.f { display: flex; flex-direction: column; }
.r { display: flex; flex-direction: row; }
.ac { align-items: center; }
.jc { justify-content: center; }
.sb { justify-content: space-between; }
.g1 { flex: 1 1 0; }

/* Screen.tsx */
.safe { position: relative; width: ${DEVICE_W}px; height: ${DEVICE_H}px; background: ${C.bg}; display: flex; flex-direction: column; }
.content { flex: 1 1 0; padding: 0 16px 24px; display: flex; flex-direction: column; }

/* Card.tsx */
.card { background: ${C.surface}; border-radius: 20px; border: 1px solid ${C.border}; box-shadow: ${S_CARD}; }
.cardPadded { padding: 16px; }

/* Button.tsx */
.btn { display: flex; flex-direction: row; align-items: center; justify-content: center; height: 54px; padding: 0 24px; border-radius: 999px; overflow: hidden; }
.btnPrimary { background: ${brand(90)}; }
.btnSecondary { background: ${C.surface}; border: 1px solid ${C.border}; }
.btnLabel { font-size: 16px; font-weight: 600; }
.btnIcon { margin-right: 8px; }
.btnDisabled { opacity: 0.4; }

/* TextField.tsx */
.tfWrap { margin-bottom: 16px; }
/* typography.label at c.text — 14/600, 8dp clear of the field. */
.tfLabel { font-size: 14px; font-weight: 600; color: ${C.text}; margin-bottom: 8px; }
.tfField { flex-direction: row; align-items: center; background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 14px; padding: 0 16px; height: 56px; }
.tfInput { flex: 1 1 0; font-size: 16px; font-weight: 400; color: ${C.text}; }
.tfPlaceholder { color: ${C.textFaint}; }

/* OrDivider.tsx — hairline rules with the label between them. */
.orRow { flex-direction: row; align-items: center; gap: 16px; margin: 16px 0; }
.orRule { flex: 1 1 0; height: 1px; background: ${C.border}; }
.orLabel { font-size: 15px; font-weight: 400; color: ${C.textMuted}; }

/* GoogleButton.tsx */
.gBtn { height: 56px; border-radius: 14px; border: 1px solid ${C.border}; background: ${C.surface}; align-items: center; justify-content: center; }
.gRow { flex-direction: row; align-items: center; gap: 12px; }
.gLabel { font-size: 16px; font-weight: 600; color: ${C.text}; }

/* Avatar.tsx — free account, so the ring is the plain border colour. The three
   sizes are derived from one size prop (a 3px ring, initials at 0.33x), so the
   boxes are set inline and only the paint lives here. */
.avatar { background: ${C.border}; display: flex; align-items: center; justify-content: center; }
.avatarFace { background: ${C.surface}; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.avatarInitials { font-weight: 700; color: ${C.textMuted}; }

/* Status bar — the OS chrome, drawn rather than iconised. */
.statusbar { height: ${INSET_TOP}px; padding: 0 16px; }
.sbtime { font-size: 11.5px; font-weight: 600; letter-spacing: 0.2px; }
.sbbars { display: flex; flex-direction: row; align-items: flex-end; gap: 1.5px; }
.battshell { width: 17px; height: 9px; border: 1.2px solid ${C.text}; border-radius: 2.5px; padding: 1.2px; display: flex; }
.battfill { width: 68%; background: ${C.text}; border-radius: 1px; }
.battnub { width: 1.5px; height: 4px; margin-left: 0.8px; background: ${C.text}; border-radius: 0 1px 1px 0; }

/* TabNavigator.tsx */
.tabWrap { position: absolute; left: 0; right: 0; bottom: 0; padding-bottom: ${INSET_BOTTOM}px; align-items: center; }
.tabBar { width: 100%; align-items: flex-end; justify-content: space-around; background: ${C.surface}; padding: 4px 8px 6px; box-shadow: 0 -2px 8px rgba(0,0,0,0.04); }
.tabItem { flex: 1 1 0; align-items: center; justify-content: center; padding: 2px 0; }
.tabLabel { font-size: 11px; font-weight: 500; color: ${C.textMuted}; margin-top: 3px; }
.tabLabelActive { font-weight: 700; color: ${C.accent}; }
.centerBtnWrap { flex: 1 1 0; align-items: center; justify-content: center; margin-top: -20px; }
/* Diagonal, matching the tab bar's start {0,0} → end {1,1}. Home's mic stage
   uses the same gradient because it is the same action. */
.centerBtn { width: 54px; height: 54px; border-radius: 27px; background: ${brand(135)}; box-shadow: 0 4px 10px rgba(37,99,235,0.4); }
.centerLabel { margin-top: 4px; font-weight: 700; color: ${C.accent}; }
.gesturePill { position: absolute; bottom: 8px; left: ${(DEVICE_W - 108) / 2}px; width: 108px; height: 4px; border-radius: 2px; background: ${C.gesture}; }
`;

// ─── Shared chrome ───────────────────────────────────────────────────────────

const statusBar = () => `
<div class="statusbar r ac sb">
  <div class="sbtime">9:41</div>
  <div class="r ac" style="gap:5px">
    <div class="sbbars">${[3, 5, 7, 9]
      .map((h) => `<div style="width:2.5px;height:${h}px;border-radius:1px;background:${C.text}"></div>`)
      .join("")}</div>
    <div class="r ac">
      <div class="battshell"><div class="battfill"></div></div>
      <div class="battnub"></div>
    </div>
  </div>
</div>`;

/**
 * `TabNavigator.tsx`'s own list, in order. Three items with the mic in the
 * middle — it used to be five (Profile and Subscription trailed it) and what
 * centres the mic is an *odd* count, so three does it just as well. Both of
 * those destinations moved to the side bar; see `drawer.mjs`.
 */
const TABS = [
  { label: "Home", icon: "home-outline", on: "home" },
  { center: true, label: "Record" },
  { label: "Library", icon: "folder-outline", on: "folder" },
];

const tabBar = (active) => `
<div class="tabWrap f">
  <div class="tabBar r">
    ${TABS.map((t) => {
      if (t.center) {
        return `<div class="centerBtnWrap f">
          <div class="centerBtn f ac jc">${ic("mic", 26, "#FFFFFF")}</div>
          <div class="tabLabel centerLabel">Record</div>
        </div>`;
      }
      const sel = t.label === active;
      return `<div class="tabItem f">
        ${ic(sel ? t.on : t.icon, 22, sel ? C.accent : C.textMuted)}
        <div class="tabLabel${sel ? " tabLabelActive" : ""}">${t.label}</div>
      </div>`;
    }).join("")}
  </div>
</div>
<div class="gesturePill"></div>`;

/** Header size is 38; the drawer's identity row asks for 52. */
const avatar = (size = 38) => {
  const inner = size - 6;
  return `<div class="avatar" style="width:${size}px;height:${size}px;border-radius:${size / 2}px">
  <div class="avatarFace" style="width:${inner}px;height:${inner}px;border-radius:${inner / 2}px">
    <div class="avatarInitials" style="font-size:${Math.round(size * 0.33)}px">${USER.initials}</div>
  </div>
</div>`;
};

const button = (label, icon, variant = "primary") => {
  const color = variant === "primary" ? "#FFFFFF" : C.text;
  return `<div class="btn btn${variant === "primary" ? "Primary" : "Secondary"}">
    ${icon ? ic(icon, 18, color, "margin-right:8px") : ""}
    <div class="btnLabel" style="color:${color}">${label}</div>
  </div>`;
};

/**
 * `TextField.tsx`'s field. `placeholder: true` renders `text` in the faint
 * placeholder colour instead of as a typed value; `secure` adds the eye toggle
 * that reveals a password; `label` is the caption above it, which the component
 * draws only when it is given one — the auth screens rely on placeholders and pass
 * none, the Result screen's title field passes "Title".
 */
const textField = (text, { placeholder = false, secure = false, label = null } = {}) => `
<div class="tfWrap f">
  ${label === null ? "" : `<div class="tfLabel">${label}</div>`}
  <div class="tfField">
    <div class="tfInput${placeholder ? " tfPlaceholder" : ""}">${text}</div>
    ${secure ? ic("eye-outline", 22, C.textFaint) : ""}
  </div>
</div>`;

/** `OrDivider.tsx`. */
const orDivider = (label = "or") => `
<div class="orRow"><div class="orRule"></div><div class="orLabel">${label}</div><div class="orRule"></div></div>`;

/**
 * `GoogleButton.tsx`. The four-colour "G" is inline SVG copied verbatim from the
 * component — Google's brand terms require the mark's own colours and
 * proportions, so it is not redrawn and not recoloured by the theme.
 */
const googleButton = (label = "Continue with Google") => `
<div class="gBtn f">
  <div class="gRow">
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
    </svg>
    <div class="gLabel">${label}</div>
  </div>
</div>`;

/**
 * Wraps a screen body in the document shell. `extra` holds screen-scoped CSS.
 *
 * `mode` picks the palette, and it does so by swapping the `:root` block alone —
 * every rule below is written against `var(--token)`, so no screen module needs
 * to know which mode it is being rendered in. `showTabBar` is the caller's job;
 * this only draws the safe area and the status bar.
 *
 * `scrollY` pans a screen that is taller than the window, for the frames of the
 * walkthrough that show something below the fold. It is a negative margin on
 * `.content` rather than a real scroll because there is nothing to scroll — the
 * page is exactly as tall as the device. The status bar and the tab bar stay put,
 * which is what a ScrollView does too.
 *
 * The margin moves `.content`'s own box up with it, so without the `clip-path` the
 * panned content would be painted over the status bar — a ScrollView clips at its
 * own top edge instead. The inset is measured in the element's own coordinates, so
 * insetting by the same `scrollY` lands exactly on the edge the content started at.
 * Both are emitted last so they win on equal specificity, and neither is set for
 * the store tiles, whose layout checks assume the screen starts at the top.
 */
function shell(body, extra = "", { mode = "light", scrollY = 0 } = {}) {
  const pan =
    scrollY > 0
      ? `.content { margin-top: -${scrollY}px; clip-path: inset(${scrollY}px 0 0 0); }`
      : "";
  return `<!doctype html><html data-mode="${mode}"><head><meta charset="utf-8">
<style>${paletteVars(mode)}${CSS}${extra}${pan}</style></head>
<body><div class="safe">${statusBar()}${body}</div></body></html>`;
}

// ─── Home ────────────────────────────────────────────────────────────────────

const HOME_CSS = `
.topHeader { justify-content: space-between; align-items: center; margin-bottom: 16px; }
.headerActions { flex-direction: row; align-items: center; gap: 12px; }
.headerIconBtn { padding: 4px; }
.greetingRow { flex-direction: row; align-items: center; gap: 8px; margin-bottom: 2px; }
.greetingTitle { font-size: 22px; font-weight: 700; }
.greetingSub { font-size: 14px; color: ${C.textMuted}; margin-bottom: 24px; }
.stageCard { background: ${C.surface}; border-radius: 28px; border: 1px solid ${C.border}; padding: 24px; align-items: center; margin-bottom: 32px; box-shadow: ${S_CARD}; }
.micCircleWrap { margin-bottom: 12px; }
/* Same diagonal brand gradient as the tab bar's mic — it is the same action. */
.micCircle { width: 88px; height: 88px; border-radius: 44px; background: ${brand(135)}; box-shadow: 0 6px 16px rgba(37,99,235,0.35); }
.tapText { font-size: 16px; font-weight: 700; color: ${C.accent}; text-align: center; }
.importSubLink { font-size: 13px; font-weight: 500; color: ${C.textFaint}; text-align: center; margin-top: 2px; margin-bottom: 16px; }
.recentSectionHeader { flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.recentSectionTitle { font-size: 18px; font-weight: 700; }
.seeAllText { font-size: 14px; font-weight: 600; color: ${C.accent}; }
.recentCard { margin-bottom: 8px; }
.recentRow { flex-direction: row; align-items: center; padding: 12px; }
.noteIconBadge { width: 40px; height: 40px; border-radius: 14px; background: ${C.accentSoft}; display: flex; align-items: center; justify-content: center; }
.recentInfo { flex: 1 1 0; min-width: 0; margin: 0 12px; }
.recentTitle { font-size: 15px; font-weight: 700; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recentMeta { font-size: 13px; color: ${C.textMuted}; margin-top: 2px; }
`;

/**
 * Home's body, without the document shell — `drawer.mjs` renders it underneath
 * the side bar, so the two screens cannot drift apart.
 *
 * `mode` only reaches the header's theme toggle, which shows the mode you would
 * get by tapping it: a moon on a light canvas, a sun on a dark one.
 */
export function homeBody(mode = "light") {
  const rows = LIBRARY.slice(0, 3)
    .map(
      (t) => `
    <div class="card recentCard">
      <div class="recentRow">
        <div class="noteIconBadge">${ic("musical-notes-outline", 20, C.accent)}</div>
        <div class="recentInfo f">
          <div class="recentTitle">${t.title}</div>
          <div class="recentMeta">${t.key} · ${t.tempo} BPM</div>
        </div>
        ${ic("chevron-forward", 16, C.textFaint)}
      </div>
    </div>`,
    )
    .join("");

  return `
<div class="content">
  <div class="f" style="padding-top:4px">
    <div class="topHeader r">
      ${avatar()}
      <div class="headerActions">
        <div class="headerIconBtn">${ic(mode === "dark" ? "sunny-outline" : "moon-outline", 22, C.text)}</div>
        <div class="headerIconBtn">${ic("notifications-outline", 22, C.text)}</div>
      </div>
    </div>

    <div class="greetingRow"><div class="greetingTitle">Good morning, ${USER.fullName.split(" ")[0]}</div></div>
    <div class="greetingSub">What will you transcribe today?</div>

    <div class="stageCard f">
      <div class="micCircleWrap"><div class="micCircle f ac jc">${ic("mic", 42, "#FFFFFF")}</div></div>
      <div class="tapText">Tap to start recording</div>
      <div class="importSubLink">or import audio file</div>
    </div>

    <div class="recentSectionHeader">
      <div class="recentSectionTitle">Recent</div>
      <div class="seeAllText">See all</div>
    </div>
  </div>
  ${rows}
</div>
${tabBar("Home")}`;
}

export function home({ mode = "light" } = {}) {
  return shell(homeBody(mode), HOME_CSS, { mode });
}

// ─── Library ─────────────────────────────────────────────────────────────────

const LIB_CSS = `
.pageTitleCentre { font-size: 20px; font-weight: 700; text-align: center; margin-bottom: 12px; }
.searchBar { flex-direction: row; align-items: center; background: ${C.surface}; border-radius: 999px; border: 1px solid ${C.border}; padding: 0 16px; height: 46px; margin-bottom: 12px; }
.searchPlaceholder { font-size: 15px; color: ${C.textFaint}; }
.filterRow { flex-direction: row; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.filterTabs { flex-direction: row; align-items: center; gap: 4px; }
.filterTab { padding: 6px 12px; border-radius: 999px; background: ${C.surface}; border: 1px solid ${C.border}; }
.filterTabActive { background: ${C.ink}; border-color: ${C.ink}; }
.filterTabText { font-size: 13px; font-weight: 500; color: ${C.textMuted}; }
.filterTabTextActive { color: ${C.onInk}; font-weight: 700; }
.optionsBtn { padding: 4px; }
.itemRow { flex-direction: row; align-items: center; padding: 12px 0; }
.libBadge { width: 44px; height: 44px; border-radius: 14px; background: ${C.accentSoft}; display: flex; align-items: center; justify-content: center; margin-right: 12px; }
/* min-width: 0 so the ellipsised title can shrink. Yoga has no content-based
   automatic minimum, so in the app the Text truncates instead of pushing the
   badge off the row. */
.itemInfo { flex: 1 1 0; min-width: 0; }
.itemTitle { font-size: 16px; font-weight: 700; margin-bottom: 2px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.itemDate { font-size: 13px; color: ${C.textMuted}; }
.typeBadge { background: ${C.accentSoft}; border-radius: 999px; padding: 4px 12px; }
.typeBadgeText { font-size: 12px; font-weight: 600; color: ${C.accent}; }
.itemDivider { height: 1px; background: ${C.border}; }
`;

export function library({ mode = "light" } = {}) {
  const rows = LIBRARY.map(
    (t) => `
    <div class="itemRow">
      <div class="libBadge">${ic("musical-notes-outline", 22, C.accent)}</div>
      <div class="itemInfo f">
        <div class="itemTitle">${t.title}</div>
        <div class="itemDate">${t.date} • ${t.time}</div>
      </div>
      <div class="typeBadge"><div class="typeBadgeText">${t.type}</div></div>
    </div>`,
  ).join(`<div class="itemDivider"></div>`);

  const filters = ["All", "Tonic Solfa", "Staff Notation"]
    .map(
      (f, i) => `<div class="filterTab${i === 0 ? " filterTabActive" : ""}">
        <div class="filterTabText${i === 0 ? " filterTabTextActive" : ""}">${f}</div>
      </div>`,
    )
    .join("");

  const body = `
<div class="content">
  <div class="f" style="padding-top:4px;margin-bottom:12px">
    <div class="pageTitleCentre">Library</div>
    <div class="searchBar">
      ${ic("search-outline", 18, C.textFaint, "margin-right:8px")}
      <div class="searchPlaceholder">Search notes...</div>
    </div>
    <div class="filterRow">
      <div class="filterTabs">${filters}</div>
      <div class="optionsBtn">${ic("options-outline", 20, C.text)}</div>
    </div>
  </div>
  ${rows}
</div>
${tabBar("Library")}`;

  return shell(body, LIB_CSS, { mode });
}

export const SCREENS_CSS = CSS;
export {
  shell,
  tabBar,
  statusBar,
  button,
  avatar,
  textField,
  orDivider,
  googleButton,
  S_CARD,
  PLAYER_GRAD,
  INSET_TOP,
  INSET_BOTTOM,
  HOME_CSS,
};
