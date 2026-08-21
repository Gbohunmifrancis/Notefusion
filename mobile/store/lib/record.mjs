/**
 * Record screen, mid-take.
 *
 * The recording phase rather than the idle one: the idle screen is a mic on a
 * blank canvas, which says nothing the icon hasn't already said. Recording shows
 * the timer, the level meter and the wave — the parts that tell a shopper the
 * app is listening to them.
 *
 * No guidance banner. It exists ("Sing louder or hold closer to the mic") and it
 * is good behaviour, but on a store listing a red banner reads as a fault.
 */

import { C, brand, ic } from "./tokens.mjs";
import { USER } from "./sample.mjs";
import { shell, tabBar } from "./screens.mjs";

const WAVE_BARS = 28;

/** Recording keys. `Auto` is the default and matches how the sample take was keyed. */
const KEYS = [
  "Auto", "C major", "D major", "E major", "F major", "G major",
  "A major", "Bb major", "A minor", "D minor", "E minor",
];

const REC_CSS = `
/* Record is a tab screen, so the floating bar sits over it — hence the 100px. */
.rcContainer { flex: 1 1 0; align-items: center; justify-content: space-between; padding-bottom: 100px; }

.rcTop { width: 100%; align-items: center; padding-top: 8px; gap: 12px; }
.screenTitle { font-size: 22px; font-weight: 700; letter-spacing: -0.3px; }

.trialPill { flex-direction: row; align-items: center; gap: 4px; background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 999px; padding: 5px 12px; }
.trialPillText { font-size: 11.5px; font-weight: 600; color: ${C.accent}; }

.modeToggle { flex-direction: row; background: ${C.surface}; border-radius: 999px; border: 1px solid ${C.border}; padding: 3px; }
.modeSegment { padding: 6px 12px; border-radius: 999px; align-items: center; justify-content: center; }
.modeSegmentActive { background: ${brand(90)}; overflow: hidden; box-shadow: 0 0 8px rgba(37,99,235,0.5); }
.modeTextActive { font-size: 12px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.2px; }
.modeTextInactive { font-size: 12px; font-weight: 600; color: ${C.textFaint}; letter-spacing: 0.2px; }

.keyRow { width: 100%; }
.keyLabel { font-size: 11px; font-weight: 500; color: ${C.textFaint}; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; padding: 0 8px; }
.keyScroll { flex-direction: row; padding: 0 8px; gap: 4px; }
.keyChip { padding: 7px 12px; border-radius: 999px; background: ${C.surface}; border: 1px solid ${C.border}; }
.keyChipActive { background: ${brand(90)}; border: 0; overflow: hidden; box-shadow: 0 0 8px rgba(37,99,235,0.5); }
.keyChipText { font-size: 12px; font-weight: 500; color: ${C.textMuted}; letter-spacing: 0.2px; white-space: nowrap; }
.keyChipTextActive { font-size: 12px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.2px; white-space: nowrap; }

.centerZone { position: relative; align-items: center; justify-content: center; width: 280px; height: 280px; }
/* Frozen mid-animation, at the values the animation actually passes through:
   the orb pulses 0.25↔0.65, ripple1 runs scale 1→1.6 while fading from 0.7, and
   ripple2 runs 1→1.95 from 0.45, trailing it by 420ms. */
.ambientOrb { position: absolute; width: 240px; height: 240px; border-radius: 120px; background: ${C.accentGlow}; opacity: 0.52; }
.rippleRing { position: absolute; border-radius: 999px; border-width: 1.5px; border-style: solid; }
.rippleInner { width: 176px; height: 176px; border-color: rgba(37,99,235,0.7); background: rgba(37,99,235,0.06); transform: scale(1.22); opacity: 0.42; }
.rippleOuter { width: 232px; height: 232px; border-color: rgba(37,99,235,0.45); background: rgba(37,99,235,0.03); transform: scale(1.34); opacity: 0.2; }

.btnOuter { border-radius: 74px; box-shadow: 0 0 28px rgba(37,99,235,0.5); }
/* Recording: the ring turns red. start {0,0} end {1,1} — a diagonal, so 135deg. */
.btnRing { width: 148px; height: 148px; border-radius: 74px; align-items: center; justify-content: center; background: linear-gradient(135deg, #DC2626, #B91C1C); }
.btnGlassDisc { width: 116px; height: 116px; border-radius: 58px; background: ${C.surface}; border: 1px solid ${C.border}; align-items: center; justify-content: center; }
.stopSquare { width: 36px; height: 36px; border-radius: 8px; background: ${C.danger}; box-shadow: 0 0 12px rgba(220,38,38,0.7); }

.waveContainer { position: absolute; bottom: -50px; flex-direction: row; align-items: center; justify-content: center; height: 40px; gap: 2.5px; }
.waveBar { width: 3px; height: 36px; border-radius: 999px; }

.meterArea { flex-direction: row; align-items: center; justify-content: center; margin-top: -8px; margin-bottom: 4px; }
.meterTrack { width: 220px; height: 5px; border-radius: 999px; background: ${C.surfaceAlt}; overflow: hidden; display: flex; }
.meterFill { height: 100%; border-radius: 999px; background: ${C.success}; }

.statusArea { align-items: center; width: 100%; padding: 0 24px; margin-top: 72px; }
.statusTitle { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
.timerText { font-size: 42px; font-weight: 700; letter-spacing: -1px; margin: 4px 0; font-variant-numeric: tabular-nums; text-shadow: 0 0 12px rgba(37,99,235,0.55); }
.statusSub { font-size: 13px; color: ${C.textMuted}; text-align: center; line-height: 20px; margin-top: 4px; padding: 0 12px; }

.bottomAction { width: 100%; padding: 0 24px; }
`;

/** Bar heights, from a fixed curve so a rebuild produces the same wave. */
const waveBars = () =>
  Array.from({ length: WAVE_BARS }, (_, i) => {
    const scale = 0.22 + 0.78 * Math.abs(Math.sin(i * 1.17 + 0.4));
    const color =
      i < WAVE_BARS / 2
        ? `rgba(37, 99, 235, ${0.4 + (i / WAVE_BARS) * 0.6})`
        : `rgba(59, 130, 246, ${0.4 + ((WAVE_BARS - i) / WAVE_BARS) * 0.6})`;
    // scaleY on a 36px bar, which keeps the bar centred the way the transform does.
    return `<div class="waveBar" style="background:${color};transform:scaleY(${scale.toFixed(3)})"></div>`;
  }).join("");

export function record() {
  const keyChips = KEYS.map((k, i) => {
    const on = i === 0;
    return `<div class="keyChip${on ? " keyChipActive" : ""}">
      <div class="${on ? "keyChipTextActive" : "keyChipText"}">${k}</div>
    </div>`;
  }).join("");

  const body = `
<div class="content">
  <div class="rcContainer f">

    <div class="rcTop f">
      <div class="screenTitle">Listening</div>

      <div class="trialPill">
        ${ic("sparkles-outline", 13, C.accent)}
        <div class="trialPillText">${USER.trialRemaining} of ${USER.trialTotal} free transcriptions left</div>
      </div>

      <div class="modeToggle">
        <div class="modeSegment modeSegmentActive"><div class="modeTextActive">Melody</div></div>
        <div class="modeSegment"><div class="modeTextInactive">Polyphonic</div></div>
      </div>

      <div class="keyRow f">
        <div class="keyLabel">Key Signature</div>
        <div class="keyScroll">${keyChips}</div>
      </div>
    </div>

    <div class="centerZone f">
      <div class="ambientOrb"></div>
      <div class="rippleRing rippleOuter"></div>
      <div class="rippleRing rippleInner"></div>
      <div class="btnOuter">
        <div class="btnRing f ac jc">
          <div class="btnGlassDisc f ac jc"><div class="stopSquare"></div></div>
        </div>
      </div>
      <div class="waveContainer">${waveBars()}</div>
    </div>

    <div class="meterArea">
      ${ic("mic-outline", 14, C.success, "margin-right:8px")}
      <div class="meterTrack"><div class="meterFill" style="width:72%"></div></div>
    </div>

    <div class="statusArea f">
      <div class="statusTitle">Listening…</div>
      <div class="timerText">00:12</div>
      <div class="statusSub">Tap the button again when you're done.</div>
    </div>

    <div class="bottomAction f">
      <div class="btn btnPrimary">
        ${ic("stop-circle-outline", 18, "#FFFFFF", "margin-right:8px")}
        <div class="btnLabel" style="color:#FFFFFF">Stop &amp; Transcribe</div>
      </div>
    </div>

  </div>
</div>
${tabBar("Record")}`;

  return shell(body, REC_CSS);
}
