/**
 * The engraver page. Runs inside the WebView, below the OSMD bundle that
 * scripts/build-engraver.mjs inlines above it.
 *
 * This file is the whole contract with the native side, in both directions:
 *
 *   native → page   window.NF.render / cursorTo / setZoom
 *   page → native   ready | rendered | tap | error, as JSON over postMessage
 *
 * Positions crossing the boundary are always **quarter-note beats**, never note
 * indices or pixels. Beats are what both sides already agree on — the wire
 * carries `startBeat` in quarter notes and this page reads OSMD timestamps in
 * whole notes, so one multiply relates them exactly. An index would have to
 * survive rests, tie splits and the renderer's own ordering; a beat does not.
 */

/* global opensheetmusicdisplay */

(function () {
  "use strict";

  var osmd = null;
  var container = document.getElementById("score");
  /** Cached [beat, svgElement] for hit-testing taps, rebuilt on every render. */
  var heads = [];

  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  function fail(where, err) {
    post({ type: "error", where: where, message: String((err && err.message) || err) });
  }

  // ── Set-up ────────────────────────────────────────────────────────────────

  function create(options) {
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
      backend: "svg",
      autoResize: false,
      // The screen already has a title and a part is always "Voice" here, so
      // both would only cost vertical space on a phone.
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      measureNumberInterval: options.measureNumberInterval || 1,
      drawLyrics: options.lyrics !== false,
      // No <beam> is emitted by the generator on purpose — grouping is a visual
      // decision and this is where visual decisions are made.
      autoBeam: true,
      autoBeamOptions: { beam_rests: false, maintain_stem_directions: false },
      cursorsOptions: [
        { type: 0, color: options.cursorColor || "#14B8A6", alpha: 0.4, follow: true },
      ],
    });
  }

  function applyColors(options) {
    if (!osmd || !options) return;
    var rules = osmd.EngravingRules || osmd.rules;
    if (!rules) return;
    if (options.ink) {
      // Each of these is a separate default in OSMD, and every one of them is
      // black out of the box — a single DefaultColorMusic leaves the ledger
      // lines and the lyrics behind, which is invisible ink on a dark page.
      rules.DefaultColorMusic = options.ink;
      rules.DefaultColorNotehead = options.ink;
      rules.DefaultColorStem = options.ink;
      rules.DefaultColorRest = options.ink;
      rules.DefaultColorLabel = options.ink;
      rules.DefaultColorTitle = options.ink;
      rules.LedgerLineColorDefault = options.ink;
      rules.StaffLineColor = options.ink;
      rules.DefaultColorLyrics = options.lyricColor || options.ink;
    }
    if (options.cursorColor) rules.DefaultColorCursor = options.cursorColor;
    if (options.pageBackground) rules.PageBackgroundColor = options.pageBackground;
    // Per-note colours come from the MusicXML's own notehead colour, which is
    // how each head keeps showing its own confidence.
    rules.ColoringEnabled = true;
  }

  /**
   * Every notehead, with the beat whose note it belongs to.
   *
   * A tie continuation reports the beat of the head that was *struck* rather than
   * its own: it is the same sound, and the native side only knows onsets, so this
   * is what makes tapping the held half of a tie open the note that started it.
   * Leaving continuations out instead — which is what this used to do — left them
   * to the nearest-head search, and that resolved a tie inside a bar to the
   * *next* note and a tie across a system break to nothing at all.
   */
  function indexHeads() {
    heads = [];
    if (!osmd || !osmd.GraphicSheet || !osmd.GraphicSheet.MeasureList) return;

    osmd.GraphicSheet.MeasureList.forEach(function (staves) {
      (staves || []).forEach(function (measure) {
        if (!measure || !measure.staffEntries) return;
        measure.staffEntries.forEach(function (entry) {
          (entry.graphicalVoiceEntries || []).forEach(function (voiceEntry) {
            (voiceEntry.notes || []).forEach(function (gNote) {
              var source = gNote.sourceNote;
              if (!source || source.isRest()) return;
              var tie = source.NoteTie || source.noteTie;
              var struck =
                tie && tie.StartNote && tie.StartNote !== source ? tie.StartNote : source;
              var stamp = struck.getAbsoluteTimestamp ? struck.getAbsoluteTimestamp() : null;
              if (!stamp) return;
              var element = gNote.getSVGGElement ? gNote.getSVGGElement() : null;
              if (!element) return;
              heads.push({ beat: stamp.RealValue * 4, element: element });
            });
          });
        });
      });
    });
  }

  function contentHeight() {
    var svg = container.querySelector("svg");
    if (svg) {
      var box = svg.getBoundingClientRect();
      if (box.height > 0) return Math.ceil(box.height);
    }
    return Math.ceil(container.scrollHeight || document.body.scrollHeight || 0);
  }

  // ── Native → page ─────────────────────────────────────────────────────────

  var api = {
    render: function (payload) {
      try {
        if (!osmd) create(payload.options || {});
        applyColors(payload.options || {});
        if (payload.options && payload.options.zoom) osmd.zoom = payload.options.zoom;

        osmd
          .load(payload.xml)
          .then(function () {
            applyColors(payload.options || {});
            osmd.render();
            indexHeads();
            if (osmd.cursor) {
              osmd.cursor.reset();
              if (payload.options && payload.options.showCursor) osmd.cursor.show();
              else osmd.cursor.hide();
            }
            post({
              type: "rendered",
              height: contentHeight(),
              heads: heads.length,
              token: payload.token,
            });
          })
          .catch(function (err) {
            fail("load", err);
          });
      } catch (err) {
        fail("render", err);
      }
    },

    /**
     * Move the playback cursor to `beat`, stepping forward from wherever it is.
     * Playback is monotonic, so the common case walks a step or two; a backward
     * seek resets and walks from the start.
     */
    cursorTo: function (beat) {
      try {
        if (!osmd || !osmd.cursor) return;
        var cursor = osmd.cursor;
        if (beat === null || beat === undefined || beat < 0) {
          cursor.reset();
          cursor.hide();
          return;
        }
        cursor.show();
        var at = function () {
          var it = cursor.iterator;
          return it && it.currentTimeStamp ? it.currentTimeStamp.RealValue * 4 : 0;
        };
        if (at() > beat + 1e-6) cursor.reset();
        var guard = 0;
        while (at() <= beat - 1e-6 && !cursor.iterator.EndReached && guard++ < 10000) {
          cursor.next();
        }
      } catch (err) {
        fail("cursorTo", err);
      }
    },

    /** The engraved sheet as standalone SVG markup, for the PDF export. */
    svg: function (token) {
      try {
        var node = container.querySelector("svg");
        post({ type: "svg", token: token, svg: node ? node.outerHTML : "" });
      } catch (err) {
        fail("svg", err);
      }
    },

    setZoom: function (zoom) {
      try {
        if (!osmd) return;
        osmd.zoom = zoom;
        osmd.render();
        indexHeads();
        post({ type: "rendered", height: contentHeight(), heads: heads.length });
      } catch (err) {
        fail("setZoom", err);
      }
    },
  };

  window.NF = api;

  // ── Page → native ─────────────────────────────────────────────────────────

  /**
   * Resolve a tap to the nearest notehead. Bounding boxes come from the live SVG
   * rather than OSMD's own layout units, so zoom, scroll and page transforms are
   * already accounted for and need no arithmetic here.
   */
  function onTap(clientX, clientY) {
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < heads.length; i++) {
      var box = heads[i].element.getBoundingClientRect();
      if (!box || (box.width === 0 && box.height === 0)) continue;
      var dx = clientX - (box.left + box.width / 2);
      var dy = clientY - (box.top + box.height / 2);
      var distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = heads[i];
      }
    }
    // Roughly a staff's height. Beyond that the tap was on empty paper, and
    // opening an editor for a note the user was nowhere near is worse than
    // doing nothing.
    if (best === null || bestDistance > 60 * 60) return;
    post({ type: "tap", beat: best.beat });
  }

  document.addEventListener(
    "click",
    function (event) {
      onTap(event.clientX, event.clientY);
    },
    false,
  );

  post({ type: "ready" });
})();
