/**
 * Result screen — the notation itself, in three states.
 *
 * `view: "solfa"` and `view: "staff"` are the same take under the two toggle
 * positions; `keyPicker: true` shows the re-key affordance open, which is the
 * only screenshot that can explain movable-do to someone scrolling a store page:
 * the notes did not move, the labels did.
 *
 * Every syllable, every note head and every confidence colour comes from
 * `music.mjs`, which is the app's engine ported verbatim. Nothing here is drawn
 * by hand from an idea of what the output looks like.
 */

import { C, brand, ic } from "./tokens.mjs";
import { TAKE, NOTES } from "./sample.mjs";
import { deriveSolfa, staffSvg, confidenceColor, confidenceLabel, KEY_CHOICES } from "./music.mjs";
import { shell, PLAYER_GRAD, S_CARD } from "./screens.mjs";

const RES_CSS = `
.headerRow { flex-direction: row; align-items: center; justify-content: space-between; margin-top: 8px; margin-bottom: 24px; }
.backBtn, .optionsBtn { padding: 4px; }
.titleGroup { flex-direction: row; align-items: center; gap: 4px; }
.resPageTitle { font-size: 20px; font-weight: 700; }

.summaryCard { margin-bottom: 24px; }
.summaryRow { flex-direction: row; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid ${C.border}; }
.summaryDivider { width: 1px; height: 40px; background: ${C.border}; }
.statItem { flex: 1 1 0; align-items: center; gap: 4px; }
.statIconCircle { width: 30px; height: 30px; border-radius: 15px; display: flex; align-items: center; justify-content: center; }
.statValue { font-size: 14px; font-weight: 700; text-align: center; }
.statLabel { font-size: 10px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textFaint}; text-align: center; }

.keyPicker { padding: 12px 0; border-bottom: 1px solid ${C.border}; }
.keyPickerHint { font-size: 12px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textMuted}; line-height: 18px; margin-bottom: 8px; }
.keyPickerScroll { flex-direction: row; gap: 4px; padding-right: 12px; }
.rkChip { padding: 7px 12px; border-radius: 999px; background: ${C.surface}; border: 1px solid ${C.border}; }
.rkChipActive { background: ${brand(90)}; border: 0; overflow: hidden; box-shadow: 0 0 8px rgba(37,99,235,0.5); }
.rkChipText { font-size: 12px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textMuted}; white-space: nowrap; }
.rkChipTextActive { font-size: 12px; font-weight: 700; letter-spacing: 0.2px; color: #FFFFFF; white-space: nowrap; }

.confRow { padding-top: 12px; align-items: center; }
.confBadge { flex-direction: row; align-items: center; align-self: flex-start; border-width: 1px; border-style: solid; border-radius: 999px; padding: 4px 12px; }
.confDot8 { width: 8px; height: 8px; border-radius: 4px; margin-right: 8px; }
.confText { font-size: 12px; font-weight: 600; letter-spacing: 0.2px; }

.warnRow { flex-direction: row; align-items: flex-start; margin-top: 12px; padding-top: 12px; border-top: 1px solid ${C.accentGlow}; }
.warnDot { width: 8px; height: 8px; border-radius: 4px; background: ${C.warning}; margin-right: 8px; margin-top: 3px; box-shadow: 0 0 5px rgba(217,119,6,0.8); }
/* A <Text> with a nested <Text>, not a View — as a flex container Chromium
   breaks the inline child onto its own line. Same for .sectionTitle below. */
.warnText { font-size: 12px; font-weight: 500; letter-spacing: 0.2px; color: ${C.warning}; flex: 1 1 0; line-height: 18px; display: block; }
.warnLink { font-weight: 700; text-decoration: underline; }

.solfaCardWrap { border-radius: 20px; overflow: hidden; border: 1px solid ${C.border}; margin-bottom: 24px; box-shadow: 0 0 20px rgba(37,99,235,0.25); }
.solfaHeader { flex-direction: row; align-items: center; padding: 10px 16px; gap: 4px; background: ${brand(90)}; }
.solfaHeaderLabel { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #FFFFFF; flex: 1 1 0; margin-left: 2px; }
.viewToggle { flex-direction: row; background: rgba(255,255,255,0.16); border-radius: 999px; padding: 2px; border: 1px solid rgba(255,255,255,0.24); }
.viewToggleBtn { flex-direction: row; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 999px; }
.viewToggleBtnActive { background: rgba(255,255,255,0.28); }
.viewToggleText { font-size: 11px; font-weight: 700; letter-spacing: 0.2px; color: #FFFFFF; }

.solfaBody { background: ${C.accentSoft}; padding: 24px; min-height: 120px; position: relative; overflow: hidden; }
.solfaLineWrap { flex-direction: row; align-items: flex-start; margin-bottom: 12px; }
.solfaLineNum { font-size: 11px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textFaint}; margin-right: 8px; margin-top: 3px; width: 14px; text-align: right; }
/* typography.mono asks Android for "monospace"; here that resolves to Consolas. */
.solfaLine { font-family: monospace; font-size: 16px; font-weight: 600; line-height: 26px; letter-spacing: 1px; color: ${C.textMuted}; flex: 1 1 0; white-space: pre-wrap; }
.solfaLineFirst { color: ${C.text}; font-size: 20px; font-weight: 700; letter-spacing: 2px; line-height: 30px; text-shadow: 0 0 10px rgba(37,99,235,0.6); }
.solfaWatermark { position: absolute; right: 24px; bottom: -8px; font-size: 80px; line-height: 90px; font-weight: 700; color: ${C.accentSoft}; }

/* StaffNotation.tsx — surface card, horizontally scrolled, so it clips right. */
.staffWrap { background: ${C.surface}; border-radius: 14px; border: 1px solid ${C.border}; padding: 12px 0; overflow: hidden; }
.staffScroll { flex-direction: row; align-items: center; padding: 0 12px; }

/* NotePlayer.tsx */
.playerCard { background: ${C.surface}; border-radius: 20px; border: 1px solid ${C.border}; padding: 16px; margin-bottom: 24px; }
.playerTitle { font-size: 12px; font-weight: 700; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.transportRow { flex-direction: row; align-items: center; }
.playButtonWrapper { width: 52px; height: 52px; border-radius: 26px; overflow: hidden; margin-right: 14px; background: ${PLAYER_GRAD}; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(37,99,235,0.4); }
.progressColumn { flex: 1 1 0; justify-content: center; }
.track { height: 28px; justify-content: center; position: relative; display: flex; }
.trackVisual { height: 6px; width: 100%; border-radius: 3px; background: ${C.surfaceAlt}; overflow: hidden; }
.trackFill { height: 100%; border-radius: 3px; background: ${PLAYER_GRAD}; }
.thumb { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 7px; margin-top: -7px; margin-left: -7px; background: ${C.surface}; border: 2px solid ${C.purple}; box-shadow: 0 1px 4px rgba(37,99,235,0.6); }
.timeRow { flex-direction: row; justify-content: space-between; margin-top: 6px; }
.timeText { font-size: 11px; color: ${C.textMuted}; font-variant-numeric: tabular-nums; }
.solfaStrip { margin-top: 18px; overflow: hidden; }
.solfaStripContent { flex-direction: row; align-items: center; padding: 0 2px; }
.chipWrapper { margin-right: 8px; }
.chipInactive { min-width: 40px; align-items: center; padding: 8px 14px; border-radius: 14px; background: ${C.surfaceAlt}; border: 1px solid ${C.borderLight}; }
.chipTextInactive { font-size: 14px; font-weight: 600; color: ${C.textMuted}; }
.chipActive { min-width: 44px; align-items: center; padding: 9px 16px; border-radius: 14px; background: ${PLAYER_GRAD}; box-shadow: 0 2px 8px rgba(37,99,235,0.5); }
.chipTextActive { font-size: 15px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.3px; }

.sectionRow { flex-direction: row; align-items: center; justify-content: space-between; margin-bottom: 12px; }
/* A <Text> with a nested <Text>, not a View — as a flex container Chromium
   breaks the inline child onto its own line. Same for .warnText above. */
.sectionTitle { font-size: 16px; font-weight: 700; display: block; }
.sectionCount { font-size: 14px; font-weight: 400; color: ${C.textFaint}; }
.sectionHint { font-size: 11px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textFaint}; }

.notesScroll { margin: 0 -24px 24px; overflow: hidden; }
.notesContent { flex-direction: row; padding: 4px 24px; gap: 8px; }
.noteChip { width: 60px; border-radius: 14px; background: ${C.surface}; align-items: center; padding-top: 8px; overflow: hidden; border-style: solid; }
.noteSolfa { font-size: 15px; font-weight: 700; }
.noteMidi { font-size: 10px; font-weight: 500; letter-spacing: 0.2px; color: ${C.textFaint}; margin: 4px 0; }
.noteConfBar { height: 3px; width: 100%; }

.exportBlock { margin-bottom: 24px; gap: 4px; }
.exportHeaderRow { flex-direction: row; align-items: center; gap: 4px; }
.exportTitle { font-size: 16px; font-weight: 700; }
.exportHint { font-size: 13px; color: ${C.textMuted}; line-height: 20px; margin-bottom: 8px; }
`;

/** SummaryStat, with its tinted icon circle. */
const stat = (icon, label, value, accent) => `
<div class="statItem f">
  <div class="statIconCircle" style="background:${accent}18">${ic(icon, 14, accent)}</div>
  <div class="statValue">${value}</div>
  <div class="statLabel">${label}</div>
</div>`;

const confBadge = (value) => {
  const color = confidenceColor(value, C);
  return `<div class="confBadge" style="border-color:${color}4D;background:${color}26">
    <div class="confDot8" style="background:${color};box-shadow:0 0 6px ${color}"></div>
    <div class="confText" style="color:${color}">${Math.round(value * 100)}% · ${confidenceLabel(value)}</div>
  </div>`;
};

/** The player, paused five notes in — enough to show the strip tracking playback. */
function player(labels) {
  const active = 4;
  const frac = 0.34;
  const chips = labels
    .map(
      (s, i) => `<div class="chipWrapper">${
        i === active
          ? `<div class="chipActive f"><div class="chipTextActive">${s}</div></div>`
          : `<div class="chipInactive f"><div class="chipTextInactive">${s}</div></div>`
      }</div>`,
    )
    .join("");

  return `
<div class="playerCard f">
  <div class="playerTitle">Play back</div>
  <div class="transportRow">
    <div class="playButtonWrapper">${ic("pause", 22, "#FFFFFF")}</div>
    <div class="progressColumn f">
      <div class="track">
        <div class="trackVisual"><div class="trackFill" style="width:${frac * 100}%"></div></div>
        <div class="thumb" style="left:${frac * 100}%"></div>
      </div>
      <div class="timeRow">
        <div class="timeText">0:06</div>
        <div class="timeText">0:18</div>
      </div>
    </div>
  </div>
  <div class="solfaStrip"><div class="solfaStripContent">${chips}</div></div>
</div>`;
}

export function result({ view = "solfa", keyPicker = false, keyText = TAKE.key } = {}) {
  const derived = deriveSolfa(NOTES, keyText, TAKE.timeSignature);
  const labels = derived.notes.map((n) => n.solfa + n.octaveMark);
  const lowCount = derived.notes.filter((n) => n.conf < 0.5).length;

  const solfaLines = derived.solfaLines
    .map(
      (line, i) => `
    <div class="solfaLineWrap">
      <div class="solfaLineNum">${i + 1}</div>
      <div class="solfaLine${i === 0 ? " solfaLineFirst" : ""}">${line}</div>
    </div>`,
    )
    .join("");

  const staff = staffSvg(derived.notes, TAKE.timeSignature, keyText, C);

  const bodyInner =
    view === "solfa"
      ? `${solfaLines}<div class="solfaWatermark">♪</div>`
      : `<div class="staffWrap"><div class="staffScroll">${staff.svg}</div></div>`;

  const toggle = (v, icon, label) => `
    <div class="viewToggleBtn${view === v ? " viewToggleBtnActive" : ""}">
      ${ic(icon, 12, "#FFFFFF")}<div class="viewToggleText">${label}</div>
    </div>`;

  const picker = keyPicker
    ? `<div class="keyPicker f">
        <div class="keyPickerHint">Change the Doh — your notes stay put, only the labels move.</div>
        <div class="keyPickerScroll">${KEY_CHOICES.map(
          (k) =>
            `<div class="rkChip${k === keyText ? " rkChipActive" : ""}">
              <div class="${k === keyText ? "rkChipTextActive" : "rkChipText"}">${k}</div>
            </div>`,
        ).join("")}</div>
      </div>`
    : "";

  const chips = derived.notes
    .map((n, i) => {
      const cc = confidenceColor(n.conf, C);
      return `<div class="noteChip f" style="border-color:${cc}55;border-width:${n.conf < 0.5 ? 1.5 : 1}px">
        <div class="noteSolfa">${labels[i]}</div>
        <div class="noteMidi">${n.pitchMidi}</div>
        <div class="noteConfBar" style="background:${cc};box-shadow:0 0 4px ${cc}"></div>
      </div>`;
    })
    .join("");

  const body = `
<div class="content">
  <div class="headerRow">
    <div class="backBtn">${ic("arrow-back", 22, C.text)}</div>
    <div class="titleGroup"><div class="resPageTitle">Preview</div></div>
    <div class="optionsBtn">${ic("ellipsis-vertical", 20, C.text)}</div>
  </div>

  <div class="card cardPadded summaryCard f">
    <div class="summaryRow">
      ${stat("key-outline", "Key · tap to change", keyText, C.purple)}
      <div class="summaryDivider"></div>
      ${stat("speedometer-outline", "Tempo", `${TAKE.tempo} BPM`, C.gold)}
      <div class="summaryDivider"></div>
      ${stat("grid-outline", "Meter", TAKE.timeSignature, C.success)}
    </div>
    ${picker}
    <div class="confRow f">${confBadge(TAKE.overallConfidence)}</div>
    ${
      lowCount > 0
        ? `<div class="warnRow">
            <div class="warnDot"></div>
            <div class="warnText">${lowCount} note${lowCount > 1 ? "s" : ""} below 50% confidence — <span class="warnLink">review ${lowCount > 1 ? "them" : "it"} →</span></div>
          </div>`
        : ""
    }
  </div>

  <div class="solfaCardWrap f">
    <div class="solfaHeader">
      ${ic("musical-notes", 14, "#FFFFFF")}
      <div class="solfaHeaderLabel">${view === "solfa" ? "TONIC SOLFA" : "STAFF NOTATION"}</div>
      <div class="viewToggle">${toggle("solfa", "text", "Solfa")}${toggle("staff", "musical-note", "Staff")}</div>
    </div>
    <div class="solfaBody f">${bodyInner}</div>
  </div>

  ${player(labels)}

  <div class="sectionRow">
    <div class="sectionTitle">Notes <span class="sectionCount">(${derived.notes.length})</span></div>
    <div class="sectionHint">Tap a note to fix it</div>
  </div>
  <div class="notesScroll"><div class="notesContent">${chips}</div></div>

  <div class="exportBlock f">
    <div class="exportHeaderRow">
      ${ic("document-text-outline", 16, C.textMuted)}
      <div class="exportTitle">Sheet music</div>
    </div>
    <div class="exportHint">Export as MusicXML to open in Sibelius, MuseScore, or Finale.</div>
    <div class="btn btnSecondary">
      ${ic("share-outline", 18, C.text, "margin-right:8px")}
      <div class="btnLabel" style="color:${C.text}">Export MusicXML</div>
    </div>
  </div>
</div>`;

  return shell(body, RES_CSS);
}

export { S_CARD };
