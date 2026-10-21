/* "More ways to practise" on the web: the mode screens (boards c-practice/6b–6d), the phone's screens/practice/* mirrored.
 *
 *   Warm up        breathe, lip trills and sirens (the guides played here: the piano a step higher each round, a sliding
 *                  hum for a siren), then the range finder: lowest, highest, and the range said plainly. Never marked.
 *   Pitch match    eight notes in one take, each heard then held; a live tuner needle (pitch-track.js, YIN on the mic)
 *                  shows in tune / a little flat / a little sharp and the cents, in the grader's own 35/80-cent windows.
 *                  The needle only guides: the set is marked once by the server.
 *   Riffs & runs   the run as blocks with its solfa, 60–100 %: marked note by note while its quick notes last 0.3 s,
 *                  past that by its shape and landing note, the singer's pitch line drawn over the pattern.
 *   Intervals      hear doh, then sing the note asked.
 *   Harmony        the line over (or under) a tune; the tune plays under the take only with headphones on.
 *   Rhythm         hear the claps, clap them back after the count-in; each clap in time, close or off.
 *
 * Every mark and every XP point is the server's (POST /api/practice/modes/grade); the browser reports nothing.
 * Wrong notes are grey, never red. Loaded by practice-view.js the first time a mode is opened (with pitch-track.js and
 * practice-modes.css); the words and arithmetic are practice-modes.js (shared with the phone, tests in both).
 *
 *   NfPracticeModeView.open(rootEl, { request, track, choir, mode, practiceTrack, icon, art, back })
 *   NfPracticeModeView.leave()   — stop sound and mic
 *   NfPracticeModeView.reset()   — signed out
 */
(function () {
  "use strict";

  var PIANO_WAIT_MS = 8000;
  /** The needle reads the microphone this often (about 20 times a second). */
  var NEEDLE_MS = 50;
  /** "Hear it" counts a bar in before a rhythm. */
  var HEAR_COUNT_IN = 4;

  var ctx = null, root = null, gen = 0;
  var m = fresh();
  var take = null;   // the take in hand
  var sound = null;  // what plays without the microphone: { kind, stop(), t0, audio?, seconds }
  var player = null; // the rehearsal piano for "Hear it" and the trills

  function fresh() {
    return {
      mode: null, data: null, loading: false, loadError: null, index: 0, code: null, percent: null, grade: null, error: null,
      phase: "idle", headphones: false, takeUrl: null, warm: null, range: null, step: 0, view: "routine", breathFrom: null, heardLive: null
    };
  }

  function M() { return window.NfPracticeModes; }
  function P() { return window.NfPracticeProgress; }
  function T() { return window.NfPracticeTrack; }
  function playful() { return ((m.data && m.data.track) || ctx.practiceTrack) === "playful"; }
  function exercises() { return (m.data && m.data.exercises) || []; }
  function track(name, detail) { try { if (ctx && ctx.track) ctx.track(name, detail); } catch (e) { /* never in the way */ } }

  // ── DOM ─────────────────────────────────────────────────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sprite(href) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic"); svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", href); svg.appendChild(use);
    return svg;
  }
  function button(cls, href, text, onClick) {
    var b = el("button", "btn " + cls); b.type = "button";
    if (href) b.appendChild(sprite(href));
    b.appendChild(document.createTextNode(text));
    b.addEventListener("click", onClick);
    return b;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function $(id) { return root ? root.querySelector("#" + id) : null; }

  /** The top bar: round back button, the mode small above the step's title, one thing on the right. */
  function header(eyebrow, title, pill, onBack) {
    var bar = el("div", "pm-top");
    var back = el("button", "pm-back"); back.type = "button"; back.setAttribute("aria-label", "Back");
    back.appendChild(sprite("/assets/icons.svg#i-back"));
    back.addEventListener("click", onBack || goBack);
    var text = el("div", "pm-top-text");
    text.appendChild(el("p", "pm-eyebrow", eyebrow));
    // The page's heading while a mode is open: the Practice view's own h1 steps aside then (practice-view.css).
    var h = el("h1", "pm-title", title); h.id = "pm-title"; h.setAttribute("tabindex", "-1");
    text.appendChild(h);
    bar.appendChild(back); bar.appendChild(text);
    if (pill) bar.appendChild(el("span", "pm-pill", pill));
    return bar;
  }

  function actions(nodes, status) {
    var row = el("div", "pm-actions");
    var st = el("div", "pm-status"); st.id = "pm-status"; st.setAttribute("aria-live", "polite");
    if (status) { st.appendChild(el("i", "pm-dot")); st.appendChild(el("span", null, status)); }
    row.appendChild(st);
    var btns = el("div", "pm-buttons");
    nodes.forEach(function (n) { if (n) btns.appendChild(n); });
    row.appendChild(btns);
    return row;
  }

  function errorLine(text) { var e = el("p", "pv-error", text); e.setAttribute("role", "alert"); return e; }
  function allowanceLine() { return m.data ? el("p", "pv-allow", P().allowanceLine(m.data.allowance)) : null; }
  function noneLeft() { return !!m.data && m.data.allowance.used >= m.data.allowance.limit; }

  /** A list of the mode's other exercises (or the next one, after a mark). */
  function list(title, items) {
    var box = el("div", "pm-list-box");
    box.appendChild(el("h3", "pm-list-title", title));
    var ul = el("ul", "pm-list");
    items.forEach(function (it) {
      var li = el("li"), b = el("button", "pm-row" + (it.on ? " on" : "")); b.type = "button";
      var t = el("span", "pm-row-text");
      t.appendChild(el("strong", null, it.title));
      if (it.sub) t.appendChild(el("span", it.mono ? "pm-mono" : null, it.sub));
      b.appendChild(t);
      if (it.value) b.appendChild(el("span", "pm-row-value", it.value));
      if (it.state) b.appendChild(el("span", "pm-state " + it.state));
      else b.appendChild(sprite("/assets/icons.svg#i-chev"));
      b.addEventListener("click", it.onClick);
      li.appendChild(b); ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  /**
   * A marked take: the server's score and summary (Playful: stars and a word), the marks — green in tune, ink close,
   * grey off (struck through, never red), dashed not heard — and what it earned.
   */
  function resultCard(o) {
    var card = el("section", "pm-result" + (playful() ? " is-playful" : ""));
    card.setAttribute("aria-label", "Your take, marked");
    if (playful()) {
      var stars = T().starsFor(o.score), head = el("div", "pm-stars");
      var pic = o.art(T().starsArt(stars), 132, 64); pic.setAttribute("alt", stars + " of 3 stars");
      head.appendChild(pic);
      head.appendChild(el("strong", "pm-star-word", T().starWord(stars)));
      head.appendChild(el("p", "pm-sub", o.summary));
      card.appendChild(head);
    } else {
      var row = el("div", "pm-score-row");
      row.appendChild(el("strong", "pm-score " + (o.score >= 80 ? "good" : o.score >= 50 ? "fair" : "low"), String(o.score)));
      var tx = el("div");
      tx.appendChild(el("p", "pm-summary", o.summary));
      if (o.sub) tx.appendChild(el("p", "pm-sub", o.sub));
      row.appendChild(tx);
      card.appendChild(row);
    }
    if (o.marks && o.marks.length) {
      var marks = el("div", "pm-marks");
      o.marks.forEach(function (mk) {
        var s = el("span", "pm-mark " + mk.tone);
        s.appendChild(el("b", null, mk.text));
        if (!playful() && mk.sub) s.appendChild(el("small", null, mk.sub));
        s.title = mk.tone === "hit" ? "in tune" : mk.tone === "near" ? "close" : mk.tone === "off" ? "off" : "not heard";
        s.setAttribute("role", "img"); s.setAttribute("aria-label", mk.text + ": " + s.title + (!playful() && mk.sub && mk.sub !== "—" ? ", " + mk.sub : ""));
        marks.appendChild(s);
      });
      card.appendChild(marks);
    }
    if (o.legend) card.appendChild(el("p", "pm-legend", o.legend));
    (o.extra || []).forEach(function (n) { if (n) card.appendChild(n); });
    var earned = playful() ? T().playfulRewardLine(o.reward) : (P().rewardMoment(o.reward) || {}).line;
    if (earned) {
      var e = el("p", "pm-earned"); e.appendChild(sprite("/assets/icons.svg#i-sparkle")); e.appendChild(document.createTextNode(earned));
      card.appendChild(e);
    }
    return card;
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  function load(quiet) {
    var g = gen, mode = m.mode;
    if (!quiet) { m.loading = true; render(); }
    var req = mode === "warm-up"
      ? Promise.all([ctx.request("/api/practice/warm-up"), ctx.request("/api/practice/range").catch(function () { return null; })])
      : ctx.request("/api/practice/modes/" + mode);
    return req.then(function (got) {
      if (g !== gen || m.mode !== mode) return;
      if (mode === "warm-up") { m.warm = got[0]; m.range = got[1]; } else m.data = got;
      m.loadError = null;
    }, function (err) {
      if (g !== gen || quiet) return;
      m.loadError = (err && err.message) || "We couldn't load this. Please try again.";
    }).then(function () {
      if (g !== gen) return;
      m.loading = false;
      if (m.phase === "idle" && !quiet) render();
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function render() {
    if (!root) return;
    root.innerHTML = "";
    var box = el("div", "pm pm-" + m.mode + (playful() ? " is-playful" : ""));
    var view;
    if (m.mode === "warm-up") view = warmUpView();
    else if (m.mode === "pitch-match") view = pitchView();
    else if (m.mode === "runs") view = runsView();
    else if (m.mode === "rhythm") view = rhythmView();
    else view = notesView();
    view.forEach(function (n) { if (n) box.appendChild(n); });
    root.appendChild(box);
  }

  /** The skeleton while a mode loads, or its failure with a way to try again; null once it is here. */
  function loadingOr() {
    if (m.loading && !m.data && !m.warm) {
      var sk = el("div", "pv-skel");
      for (var i = 0; i < 2; i++) sk.appendChild(el("div", "skel"));
      return sk;
    }
    if (m.loadError) {
      var f = el("div", "card pv-failed");
      f.appendChild(el("p", null, m.loadError));
      f.appendChild(button("btn-ghost", "/assets/icons.svg#i-restart", "Try again", function () { m.loadError = null; load(); }));
      return f;
    }
    return null;
  }

  // ── Pitch match (board 6b) ──────────────────────────────────────────────
  function pitchView() {
    var exs = exercises(), ex = exs[m.index], out = [];
    out.push(header(M().modeTitle("pitch-match", ctx.practiceTrack), m.grade ? "Your set" : ex ? ex.title : "Hold each note", ex && ex.dohHeader));
    var wait = loadingOr(); if (wait) return out.concat([wait]);
    if (!ex) return out;
    var chips = el("ol", "pm-chips"); chips.id = "pm-chips";
    chips.setAttribute("aria-label", "The set: " + ex.notes.map(M().written).join(" "));
    ex.notes.forEach(function (n) { var li = el("li", null, M().written(n)); li.setAttribute("aria-hidden", "true"); chips.appendChild(li); });
    out.push(chips);
    if (m.grade && m.grade.marks) {
      var g = m.grade;
      out.push(resultCard({
        score: g.score, summary: g.summary, sub: T().tuningLine(g.marks.tuningCents), reward: g.reward, art: ctx.art,
        marks: M().noteMarks(g.marks, ex.notes).map(function (k) { return { text: k.text, sub: k.cents, tone: k.tone }; }),
        legend: playful() ? "✓ spot on · ~ close · struck through: not quite" : "✓ in tune · ~ close · struck through: off. Numbers are cents off."
      }));
      var advice = M().pitchAdvice(g.marks, ex.notes);
      if (advice) {
        var a = el("div", "pm-advice");
        a.appendChild(el("strong", null, advice.title));
        a.appendChild(el("p", null, advice.body));
        out.push(a);
      }
    } else {
      out.push(pitchStage(ex));
    }
    if (m.error) out.push(errorLine(m.error));
    if (m.phase === "idle") out.push(allowanceLine());
    var next = exs.length > 1 ? exs[(m.index + 1) % exs.length] : null;
    out.push(m.phase === "idle" ? actions(
      m.grade
        ? [button("btn-ghost", null, "Again", function () { startTake(ex); }), next && button("btn-primary", null, "Next set", function () { openExercise((m.index + 1) % exs.length); })]
        : [hearButton(function () { hearExercise(ex); }), singButton(playful() ? "Sing it!" : "Start", function () { startTake(ex); })]
    ) : liveActions());
    if (m.phase === "idle" && exs.length > 1) {
      var items = (m.grade ? [next] : exs.filter(function (_, i) { return i !== m.index; })).map(function (e) {
        return { title: e.title, sub: e.notes.map(M().written).join(" "), mono: true, value: e.bestScore != null && !playful() ? "Best " + e.bestScore : e.dohHeader, onClick: function () { openExercise(exs.indexOf(e)); } };
      });
      out.push(list(m.grade ? "Next set" : "Other sets", items));
    }
    return out;
  }

  /** The note in hand, big; the needle; the hold strip. Updated in place while a take runs (pitchTick). */
  function pitchStage(ex) {
    var stage = el("div", "pm-stage");
    var first = ex.notes[0];
    var big = el("p", "pm-big", first ? M().written(first) : ""); big.id = "pm-big";
    stage.appendChild(big);
    var cap = el("p", "pm-caption", first ? M().noteCaption(first, 0, ex.notes.length, M().flatKey(ex.dohHeader)) : ""); cap.id = "pm-caption";
    stage.appendChild(cap);
    stage.appendChild(gauge());
    var word = el("p", "pm-word", m.phase === "idle" ? "Ready" : "Get ready"); word.id = "pm-word"; word.setAttribute("aria-live", "polite");
    stage.appendChild(word);
    var cents = el("p", "pm-cents", " "); cents.id = "pm-cents";
    stage.appendChild(cents);
    var hold = el("div", "pm-hold"); hold.id = "pm-hold";
    var hh = el("div", "pm-hold-head");
    var lab = el("span"); lab.appendChild(el("b", null, "Hold it")); lab.appendChild(document.createTextNode(" · 4 beats"));
    hh.appendChild(lab);
    var time = el("span", null, "0.0 of 4 s"); time.id = "pm-hold-time";
    hh.appendChild(time);
    hold.appendChild(hh);
    var NS = { viewBox: "0 0 300 60", preserveAspectRatio: "none", class: "pm-hold-svg", "aria-hidden": "true" };
    var svg = svgEl("svg", NS);
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: 300, height: 60, class: "pm-hold-bg" }));
    svg.appendChild(svgEl("rect", { x: 0, y: 30 - 30 * 35 / 100, width: 300, height: 60 * 35 / 100, class: "pm-hold-band" }));
    svg.appendChild(svgEl("line", { x1: 0, x2: 300, y1: 30, y2: 30, class: "pm-hold-mid" }));
    svg.appendChild(svgEl("polyline", { id: "pm-trace", points: "", class: "pm-trace" }));
    svg.appendChild(svgEl("circle", { id: "pm-trace-dot", cx: -10, cy: 30, r: 4, class: "pm-trace-dot" }));
    hold.appendChild(svg);
    stage.appendChild(hold);
    var hint = el("p", "pm-hint", m.phase === "idle" ? ex.prompt + " Eight notes, one take: the needle shows how close you are as you hold." : ""); hint.id = "pm-hint";
    stage.appendChild(hint);
    return stage;
  }

  /** The tuner's dial: grey beyond, ink close (80 cents), green in tune (35 cents); flat left, sharp right. */
  function gauge() {
    var cx = 120, cy = 118, r = 96;
    function pt(a) { var rad = a * Math.PI / 180; return (cx + r * Math.sin(rad)).toFixed(1) + " " + (cy - r * Math.cos(rad)).toFixed(1); }
    function arc(a1, a2, cls) { return svgEl("path", { d: "M" + pt(a1) + "A" + r + " " + r + " 0 0 1 " + pt(a2), class: cls }); }
    var svg = svgEl("svg", { viewBox: "0 -6 240 142", class: "pm-gauge", id: "pm-gauge", role: "img", "aria-label": "Tuning meter" });
    var A = M().needleAngle;
    svg.appendChild(arc(-66, 66, "pm-arc off"));
    svg.appendChild(arc(A(-M().CLOSE_CENTS), A(M().CLOSE_CENTS), "pm-arc close"));
    svg.appendChild(arc(A(-M().IN_TUNE_CENTS), A(M().IN_TUNE_CENTS), "pm-arc in"));
    [-30, 0, 30].forEach(function (a) {
      var rad = a * Math.PI / 180;
      svg.appendChild(svgEl("line", { x1: cx + (r - 22) * Math.sin(rad), y1: cy - (r - 22) * Math.cos(rad), x2: cx + (r - 30) * Math.sin(rad), y2: cy - (r - 30) * Math.cos(rad), class: "pm-tick" }));
    });
    var zero = svgEl("text", { x: cx, y: cy - r - 11, class: "pm-gauge-label", "text-anchor": "middle" }); zero.textContent = "0";
    var flat = svgEl("text", { x: 16, y: cy + 14, class: "pm-gauge-label" }); flat.textContent = "flat";
    var sharp = svgEl("text", { x: 224, y: cy + 14, class: "pm-gauge-label", "text-anchor": "end" }); sharp.textContent = "sharp";
    svg.appendChild(zero); svg.appendChild(flat); svg.appendChild(sharp);
    var needle = svgEl("g", { id: "pm-needle", class: "pm-needle none", transform: "rotate(0 " + cx + " " + cy + ")" });
    needle.appendChild(svgEl("line", { x1: cx, y1: cy, x2: cx, y2: cy - r + 16 }));
    needle.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 8 }));
    svg.appendChild(needle);
    return svg;
  }

  function setNeedle(cents) {
    var n = $("pm-needle"), zone = M().needleZone(cents);
    if (n) { n.setAttribute("transform", "rotate(" + M().needleAngle(cents).toFixed(1) + " 120 118)"); n.setAttribute("class", "pm-needle " + zone); }
    var g = $("pm-gauge"); if (g) g.setAttribute("aria-label", cents == null ? "Tuning meter: listening" : "Tuning meter: " + Math.round(cents) + " cents");
    return zone;
  }

  // ── Riffs & runs (board 6c) ─────────────────────────────────────────────
  function runState() {
    var exs = exercises(), ex = null;
    exs.forEach(function (e) { if (e.code === m.code) ex = e; });
    ex = ex || M().firstOpenRun(exs);
    if (!ex) return null;
    var steps = M().speedSteps(ex), step = null;
    steps.forEach(function (s) { if (s.percent === m.percent) step = s; });
    if (!step) step = steps.filter(function (s) { return !s.passed; })[0] || steps[steps.length - 1];
    var sung = Object.assign({}, ex, { id: step.exerciseId, tempoBpm: step.tempoBpm, grader: step.grader, speedPercent: step.percent, bestScore: step.bestScore });
    return { ex: ex, steps: steps, step: step, sung: sung, unit: M().unitRuns(exs, ex) };
  }

  function runsView() {
    var rs = runState(), out = [];
    out.push(header(M().modeTitle("runs", ctx.practiceTrack), rs ? rs.ex.title : "Riffs & runs", rs && rs.ex.dohHeader));
    var wait = loadingOr(); if (wait) return out.concat([wait]);
    if (!rs) return out;
    var ex = rs.ex, place = 0;
    rs.unit.forEach(function (r, i) { if (r.code === ex.code) place = i + 1; });
    if (ex.group) out.push(el("p", "pm-where", ex.group + " · " + place + " of " + rs.unit.length));
    var roll = M().runRoll(ex.notes), g = m.grade;
    if (g && g.run) {
      var card = el("section", "pm-result");
      card.appendChild(el("h3", "pm-card-title", "Your run, over the pattern"));
      card.appendChild(rollSvg(roll, M().traceOnRoll(g.run.trace, roll, rs.sung.tempoBpm)));
      M().runShapeLines(g.run, ex.notes[ex.notes.length - 1]).forEach(function (l) {
        var c = el("div", "pm-check" + (l.ok ? " ok" : ""));
        c.appendChild(el("i", "pm-check-mark", l.ok ? "✓" : ""));
        var t = el("div"); t.appendChild(el("strong", null, l.title)); t.appendChild(el("span", null, l.sub)); c.appendChild(t);
        card.appendChild(c);
      });
      var line = [(P().rewardMoment(g.reward) || {}).line || "Score " + g.score, g.score >= M().PASS_SCORE ? "run learned" : null].filter(Boolean).join(" · ");
      var e = el("p", "pm-earned"); e.appendChild(sprite("/assets/icons.svg#i-sparkle")); e.appendChild(document.createTextNode(line));
      card.appendChild(e);
      out.push(card);
    } else {
      var block = el("div", "pm-roll-block");
      block.appendChild(rollSvg(roll, null));
      var solfa = el("p", "pm-run-solfa"); solfa.setAttribute("aria-hidden", "true");
      ex.notes.forEach(function (n, i) { var s = el("span", i === ex.notes.length - 1 ? "land" : null, M().written(n)); s.setAttribute("data-i", i); solfa.appendChild(s); });
      block.appendChild(solfa);
      out.push(block);
    }
    // The speed stepper, and where marking turns from note by note to shape + landing note.
    var head = el("div", "pm-speed-head");
    head.appendChild(el("span", null, "Speed"));
    head.appendChild(el("span", null, M().speedCaption(rs.step)));
    out.push(head);
    var seg = el("div", "pm-seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", "Speed");
    rs.steps.forEach(function (s) {
      var on = s.percent === rs.step.percent, b = el("button", "pm-seg-item" + (on ? " on" : "") + (s.passed ? " done" : "")); b.type = "button";
      b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(on));
      b.setAttribute("aria-label", s.label + (s.passed ? ", passed" : ""));
      b.appendChild(el("span", null, s.label));
      if (s.passed) b.appendChild(el("small", null, "✓"));
      b.disabled = m.phase !== "idle";
      b.addEventListener("click", function () { stopSound(); m.percent = s.percent; m.grade = null; dropTake(); render(); });
      seg.appendChild(b);
    });
    out.push(seg);
    var bands = el("div", "pm-bands");
    M().markingBands(rs.steps).forEach(function (b) {
      var d = el("div", "pm-band"); d.style.flex = String(b.to - b.from + 1);
      d.appendChild(el("i")); d.appendChild(el("span", null, b.label));
      bands.appendChild(d);
    });
    out.push(bands);
    if (m.phase === "idle" && !g && rs.step.percent !== 100) {
      var full = button("btn-text pm-full", "/assets/icons.svg#i-volume", sound && sound.kind === "full" ? "Stop" : "Hear it at 100%", function () { hearRun(rs, true); });
      out.push(full);
    }
    if (g && g.marks) {
      var next = M().nextSpeed(rs.steps, rs.step.percent, g.score);
      out.push(resultCard({
        score: g.score, summary: g.summary, sub: g.score >= M().PASS_SCORE ? "Clean at " + rs.step.percent + "%" : "At " + rs.step.percent + "%",
        reward: g.reward, art: ctx.art,
        marks: M().noteMarks(g.marks, ex.notes).map(function (k) { return { text: k.text, sub: k.cents, tone: k.tone }; }),
        legend: playful() ? null : "✓ in tune · ~ close · struck through: off. Numbers are cents off.",
        extra: [!playful() && m.takeUrl ? button("btn-text", "/assets/icons.svg#i-play", sound && sound.kind === "replay" ? "Stop" : "Replay my take", replay) : null]
      }));
      var adv = M().runAdvice(g.marks, ex.notes, next);
      if (adv.lead || adv.rest) {
        var p = el("p", "pm-advice-line");
        if (adv.lead) p.appendChild(el("strong", null, adv.lead + " "));
        if (adv.rest) p.appendChild(document.createTextNode(adv.rest));
        out.push(p);
      }
    }
    if (m.error) out.push(errorLine(m.error));
    if (m.phase === "idle") out.push(allowanceLine());
    var nxt = g ? M().nextSpeed(rs.steps, rs.step.percent, g.score) : null;
    var nextRun = rs.unit.filter(function (r, i) { return i >= place && r.code !== ex.code; })[0] || rs.unit.filter(function (r) { return r.code !== ex.code; })[0];
    out.push(m.phase === "idle" ? actions(
      g
        ? [button("btn-ghost", null, "Again", function () { m.percent = rs.step.percent; startTake(rs.sung); }),
           nxt ? button("btn-primary", null, "Try " + nxt.percent + "%", function () { m.percent = nxt.percent; m.grade = null; dropTake(); render(); })
             : nextRun ? button("btn-primary", null, "Next run", function () { openRun(nextRun.code); }) : null]
        : [hearButton(function () { hearRun(rs, false); }), singButton("Sing it", function () { m.percent = rs.step.percent; startTake(rs.sung); })]
    ) : liveActions());
    if (m.phase === "idle" && rs.unit.length > 1) {
      var rows = (g && nextRun ? [nextRun] : rs.unit).map(function (r) {
        return { title: r.title, sub: r.solfa, mono: true, on: r.state === "current", state: r.state, onClick: function () { openRun(r.code); } };
      });
      out.push(list(g ? "Next in this unit" : "In this unit", rows));
    }
    return out;
  }

  function openRun(code) { stopSound(); m.code = code; m.percent = null; m.grade = null; m.error = null; dropTake(); render(); focusTitle(); }

  /** A run as blocks, a row per note (highest first); with a trace, the pattern in outline and the take's line over it. */
  function rollSvg(roll, trace) {
    var W = 320, ROW = 22, LABEL = 28, PAD = 10, H = roll.rows.length * ROW + PAD * 2, inner = W - LABEL - PAD;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "pm-roll", role: "img" });
    svg.setAttribute("aria-label", (trace ? "Your pitch line over " : "The run: ") + roll.blocks.map(function (b) { return b.label; }).join(" "));
    function x(f) { return LABEL + f * inner; }
    function y(row) { return PAD + row * ROW + ROW / 2; }
    roll.rows.forEach(function (r, i) {
      svg.appendChild(svgEl("rect", { x: LABEL, y: PAD + i * ROW + 3, width: inner, height: ROW - 6, rx: 4, class: "pm-roll-lane" }));
      var t = svgEl("text", { x: 4, y: y(i) + 4, class: "pm-roll-label" }); t.textContent = r.label; svg.appendChild(t);
    });
    roll.blocks.forEach(function (b) {
      svg.appendChild(svgEl("rect", {
        x: x(b.x) + 1, y: PAD + b.row * ROW + 4, width: Math.max(6, b.w * inner - 3), height: ROW - 8, rx: 5,
        class: trace ? "pm-roll-outline" : "pm-roll-note", "data-i": b.index
      }));
    });
    if (trace && trace.length > 1) {
      svg.appendChild(svgEl("polyline", { points: trace.map(function (p) { return x(p.x).toFixed(1) + "," + y(p.y).toFixed(1); }).join(" "), class: "pm-roll-trace" }));
      var last = trace[trace.length - 1];
      svg.appendChild(svgEl("circle", { cx: x(last.x), cy: y(last.y), r: 4, class: "pm-roll-dot" }));
    }
    return svg;
  }

  function hearRun(rs, full) {
    if (sound) { var was = sound.kind; stopSound(); render(); if (was === (full ? "full" : "hear")) return; }
    var s = full ? rs.steps[rs.steps.length - 1] : rs.step;
    playNotes(M().hearVoices(rs.ex), s.tempoBpm, rs.ex.timeSignature, full ? "full" : "hear", function (sec) {
      highlightRoll(M().noteDue(rs.ex.notes, s.tempoBpm, sec));
    });
  }

  function highlightRoll(i) {
    if (!root) return;
    root.querySelectorAll(".pm-roll-note").forEach(function (r) { r.classList.toggle("on", Number(r.getAttribute("data-i")) === i); });
    root.querySelectorAll(".pm-run-solfa span").forEach(function (r) { r.classList.toggle("on", Number(r.getAttribute("data-i")) === i); });
  }

  // ── Intervals and Sing the harmony ──────────────────────────────────────
  function notesView() {
    var exs = exercises(), ex = exs[m.index], out = [], harmony = m.mode === "harmony";
    out.push(header(M().modeTitle(m.mode, ctx.practiceTrack), ex ? ex.title : M().modeTitle(m.mode, ctx.practiceTrack), ex && ex.dohHeader));
    var wait = loadingOr(); if (wait) return out.concat([wait]);
    if (!ex) return out;
    var jump = harmony ? null : M().intervalParts(ex);
    if (jump) {
      var j = el("div", "pm-jump");
      j.setAttribute("role", "img"); j.setAttribute("aria-label", "From " + jump.from + ", " + (jump.up ? "up " : "down ") + (jump.size || "") + " to " + jump.to);
      [0, 1].forEach(function (k) {
        var n = el("div", "pm-jump-note" + (k === 1 ? " target" : "")); n.setAttribute("data-i", k);
        n.appendChild(el("b", null, M().written(ex.notes[k])));
        n.appendChild(el("span", null, k === 0 ? jump.from : jump.to));
        j.appendChild(n);
        if (k === 0) {
          var arrow = el("div", "pm-jump-arrow");
          arrow.appendChild(el("span", "pm-arrow", jump.up ? "↑" : "↓"));
          if (jump.size) arrow.appendChild(el("small", null, jump.size));
          j.appendChild(arrow);
        }
      });
      out.push(j);
    } else {
      var lines = el("div", "pm-lines");
      lines.appendChild(el("p", "pm-line-label", "Your line" + (ex.group ? " · " + ex.group.toLowerCase() : "")));
      lines.appendChild(chipRow(ex.notes, "pm-chips mine"));
      lines.appendChild(el("p", "pm-line-label", "The tune"));
      lines.appendChild(chipRow(ex.backing, "pm-chips tune"));
      out.push(lines);
    }
    var prompt = el("p", "pm-prompt", ex.prompt); prompt.id = "pm-hint"; prompt.setAttribute("aria-live", "polite");
    out.push(prompt);
    if (harmony) {
      var hp = el("label", "pm-phones");
      hp.appendChild(ctx.icon("headphones", "pm-phones-ic"));
      var tx = el("span", "pm-phones-text");
      tx.appendChild(el("strong", null, "I'm wearing headphones"));
      tx.appendChild(el("span", null, m.headphones ? "The tune plays softly in your ears while you sing." : "Without them, hear it first, then sing your line alone."));
      hp.appendChild(tx);
      var sw = el("input", "pm-switch"); sw.type = "checkbox"; sw.checked = m.headphones; sw.disabled = m.phase !== "idle";
      sw.setAttribute("role", "switch");
      sw.addEventListener("change", function () { m.headphones = sw.checked; render(); });
      hp.appendChild(sw);
      out.push(hp);
    }
    if (m.grade && m.grade.marks) {
      out.push(resultCard({
        score: m.grade.score, summary: m.grade.summary, reward: m.grade.reward, art: ctx.art,
        marks: M().noteMarks(m.grade.marks, ex.notes).map(function (k) { return { text: k.text, sub: k.cents, tone: k.tone }; }),
        legend: playful() ? null : "✓ in tune · ~ close · struck through: off. Numbers are cents off."
      }));
    }
    if (m.error) out.push(errorLine(m.error));
    if (m.phase === "idle") out.push(allowanceLine());
    out.push(m.phase === "idle" ? actions(
      m.grade
        ? [button("btn-ghost", null, "Again", function () { startTake(ex); }), exs.length > 1 && button("btn-primary", null, harmony ? "Next line" : playful() ? "Next jump" : "Next interval", function () { openExercise((m.index + 1) % exs.length); })]
        : [hearButton(function () { hearExercise(ex); }), singButton(playful() ? "Sing it!" : "Sing it", function () { startTake(ex); })]
    ) : liveActions());
    if (m.phase === "idle" && exs.length > 1) {
      out.push(list(harmony ? "More lines" : playful() ? "More jumps" : "More intervals", exs.map(function (e, i) {
        return { title: e.title, sub: e.group || e.notes.map(M().written).join(" "), on: i === m.index, value: e.bestScore != null && !playful() ? "Best " + e.bestScore : null, onClick: function () { openExercise(i); } };
      })));
    }
    return out;
  }

  function chipRow(notes, cls) {
    var row = el("ol", cls);
    notes.forEach(function (n, i) { var li = el("li", null, M().written(n)); li.setAttribute("data-i", i); row.appendChild(li); });
    return row;
  }

  // ── Rhythm ──────────────────────────────────────────────────────────────
  function rhythmView() {
    var exs = exercises(), ex = exs[m.index], out = [];
    out.push(header(M().modeTitle("rhythm", ctx.practiceTrack), ex ? ex.title : M().modeTitle("rhythm", ctx.practiceTrack), ex && ex.tempoBpm + " BPM"));
    var wait = loadingOr(); if (wait) return out.concat([wait]);
    if (!ex) return out;
    var layout = M().clapLayout(ex.claps), marks = m.grade && m.grade.rhythm ? M().clapMarks(m.grade.rhythm) : [];
    var grid = el("div", "pm-claps");
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", "The rhythm: " + ex.claps.map(function (c) { return M().clapSyllable(c.durBeats); }).join(" "));
    var lane = el("div", "pm-clap-lane");
    for (var b = 0; b < layout.beats; b++) { var line = el("i", "pm-beat" + (b % 4 === 0 ? " bar" : "")); line.style.left = (b / layout.beats * 100) + "%"; lane.appendChild(line); }
    layout.blocks.forEach(function (bk) {
      var mk = marks[bk.index], c = el("span", "pm-clap" + (mk ? " " + mk.tone : ""));
      c.setAttribute("data-i", bk.index);
      c.style.left = (bk.x * 100) + "%"; c.style.width = Math.max(3, bk.w * 100 - 1.2) + "%";
      lane.appendChild(c);
    });
    grid.appendChild(lane);
    var syl = el("div", "pm-syllables"); syl.setAttribute("aria-hidden", "true");
    ex.claps.forEach(function (c) { var s = el("span", null, M().clapSyllable(c.durBeats)); s.style.left = (c.startBeat / layout.beats * 100) + "%"; syl.appendChild(s); });
    grid.appendChild(syl);
    out.push(grid);
    var prompt = el("p", "pm-prompt", ex.prompt + " Clap after the count-in; tapping the table works too."); prompt.id = "pm-hint"; prompt.setAttribute("aria-live", "polite");
    out.push(prompt);
    if (m.grade && m.grade.rhythm) {
      var rg = m.grade.rhythm, advice = M().rhythmAdvice(rg);
      out.push(resultCard({
        score: m.grade.score, summary: m.grade.summary, reward: m.grade.reward, art: ctx.art,
        marks: marks.map(function (k, i) { return { text: String(k.index + 1), sub: k.tone === "missed" ? "—" : M().centsText(rg.claps[i] && rg.claps[i].errorMs), tone: k.tone }; }),
        legend: playful() ? "✓ in time · ~ close · struck through: off" : "✓ in time · ~ close · struck through: off. Numbers are ms early (−) or late (+).",
        extra: [advice ? el("p", "pm-advice-line", advice) : null]
      }));
    }
    if (m.error) out.push(errorLine(m.error));
    if (m.phase === "idle") out.push(allowanceLine());
    out.push(m.phase === "idle" ? actions(
      m.grade
        ? [button("btn-ghost", null, "Again", function () { startTake(ex); }), exs.length > 1 && button("btn-primary", null, "Next rhythm", function () { openExercise((m.index + 1) % exs.length); })]
        : [hearButton(function () { hearRhythm(ex); }), singButton("Clap it", function () { startTake(ex); })]
    ) : liveActions());
    if (m.phase === "idle" && exs.length > 1) {
      out.push(list("More rhythms", exs.map(function (e, i) {
        return { title: e.title, sub: e.claps.map(function (c) { return M().clapSyllable(c.durBeats); }).join(" "), on: i === m.index, value: e.bestScore != null && !playful() ? "Best " + e.bestScore : null, onClick: function () { openExercise(i); } };
      })));
    }
    return out;
  }

  // ── Warm up and the range finder (board 6d) ─────────────────────────────
  function warmUpView() {
    if (m.view === "low" || m.view === "high") return rangeView(m.view);
    if (m.view === "result") return rangeResultView();
    var out = [];
    out.push(header("Warm up", playful() ? "Warm up with Doh" : "Voice warm-up", m.warm ? M().minutesLabel(m.warm.totalSeconds) : null));
    var wait = loadingOr(); if (wait) return out.concat([wait]);
    if (!m.warm) return out;
    var steps = M().warmUpSteps(m.warm), list0 = el("ol", "pm-steps");
    steps.forEach(function (s, i) {
      var li = el("li", "pm-step" + (i < m.step ? " done" : i === m.step ? " now" : ""));
      var dot = el("button", "pm-step-dot", i < m.step ? "✓" : String(s.number)); dot.type = "button";
      dot.setAttribute("aria-label", "Step " + s.number + ": " + s.title + (i < m.step ? ", done" : i === m.step ? ", now" : ""));
      dot.addEventListener("click", function () { goStep(i); });
      li.appendChild(dot);
      var body = el("div", "pm-step-body"), head = el("div", "pm-step-head");
      head.appendChild(el("strong", null, s.title)); head.appendChild(el("span", null, s.clock));
      body.appendChild(head);
      body.appendChild(el("p", null, s.instruction));
      if (i === m.step) body.appendChild(stepPanel(s, i));
      li.appendChild(body);
      list0.appendChild(li);
    });
    out.push(list0);
    if (m.error) out.push(errorLine(m.error));
    var info = el("p", "pm-info"); info.appendChild(sprite("/assets/icons.svg#i-info"));
    info.appendChild(document.createTextNode("Warm-ups aren't marked or scored. They get your voice ready for today's path."));
    out.push(info);
    out.push(actions([button("btn-ghost", null, "Skip to the path", goBack)]));
    return out;
  }

  function stepPanel(s, i) {
    var panel = el("div", "pm-panel");
    if (s.kind === "breath" && s.breath) {
      var live = el("div", "pm-breath"); live.id = "pm-breath"; live.setAttribute("aria-live", "polite");
      if (m.breathFrom != null) {
        var now = M().breathAt(s.breath, (performance.now() - m.breathFrom) / 1000);
        live.appendChild(el("strong", "pm-breath-word", now.word));
        live.appendChild(el("b", "pm-breath-count", String(now.count || "")));
        live.appendChild(el("span", null, "Round " + now.cycle + " of " + s.breath.cycles));
      } else live.appendChild(el("p", null, "About " + Math.round(M().breathSeconds(s.breath)) + " seconds. Follow the words as they change."));
      panel.appendChild(live);
      var row = el("div", "pm-panel-actions");
      row.appendChild(button(m.breathFrom != null ? "btn-ghost" : "btn-primary", m.breathFrom != null ? "/assets/icons.svg#i-stop" : "/assets/icons.svg#i-play",
        m.breathFrom != null ? "Stop" : "Start breathing", function () { m.breathFrom != null ? stopSound() : startBreath(s.breath); render(); }));
      row.appendChild(button("btn-text", null, "Next", function () { goStep(i + 1); }));
      panel.appendChild(row);
    } else if (s.kind === "guide" && s.guide) {
      panel.appendChild(el("p", null, s.guide.rounds + " rounds, a step higher each time. " + (s.guide.glide ? "One smooth line, no steps." : "Keep the air steady and let the lips buzz.")));
      panel.appendChild(guideSvg(s.guide));
      var round = el("p", "pm-round", ""); round.id = "pm-round"; round.setAttribute("aria-live", "polite");
      if (sound && sound.kind === "guide") round.textContent = "Round 1 of " + s.guide.rounds;
      panel.appendChild(round);
      var r2 = el("div", "pm-panel-actions"), playing = sound && sound.kind === "guide";
      r2.appendChild(button(playing ? "btn-ghost" : "btn-primary", playing ? "/assets/icons.svg#i-stop" : "/assets/icons.svg#i-play", playing ? "Stop" : "Play the guide", function () { playGuide(s.guide); }));
      r2.appendChild(button("btn-text", null, "Next", function () { goStep(i + 1); }));
      panel.appendChild(r2);
    } else if (s.kind === "range") {
      var known = m.range && M().rangeHeadline(m.range);
      panel.appendChild(el("p", null, known ? "Last time: " + known + (m.range.voicePart ? " · " + M().voicePartLine(m.range.voicePart) : "") + "." : "Two short takes: your lowest easy note, then your highest."));
      var r3 = el("div", "pm-panel-actions");
      r3.appendChild(button("btn-primary", "/assets/icons.svg#i-mic", "Find my range", function () { stopSound(); m.view = "low"; m.error = null; m.heardLive = null; render(); focusTitle(); }));
      if (known) r3.appendChild(button("btn-text", null, "See it", function () { m.view = "result"; render(); focusTitle(); }));
      panel.appendChild(r3);
    }
    return panel;
  }

  function goStep(i) {
    stopSound();
    var n = m.warm ? m.warm.steps.length : 0;
    m.step = Math.max(0, Math.min(n - 1, i)); m.error = null;
    render();
  }

  function guideSvg(guide) {
    var pts = M().guideShape(guide), W = 300, H = 96, top = 10, span = H - 34;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "pm-guide", role: "img", "aria-label": "The guide: " + pts.map(function (p) { return p.solfa; }).join(" ") });
    function px(x) { return 10 + x * (W - 20); }
    function py(y) { return top + y * span; }
    if (!guide.glide) pts.forEach(function (p) { svg.appendChild(svgEl("rect", { x: px(p.x) - 12, y: py(p.y) - 4, width: 24, height: 8, rx: 4, class: "pm-guide-note" })); });
    svg.appendChild(svgEl("polyline", { points: pts.map(function (p) { return px(p.x).toFixed(1) + "," + py(p.y).toFixed(1); }).join(" "), class: "pm-guide-line" }));
    pts.forEach(function (p) {
      var t = svgEl("text", { x: px(p.x), y: H - 6, "text-anchor": "middle", class: "pm-guide-label" }); t.textContent = p.solfa; svg.appendChild(t);
    });
    return svg;
  }

  function rangeView(end) {
    var out = [], recording = m.phase === "live", sending = m.phase === "sending", heard = m.range && m.range.heard && m.lastEnd === end ? m.range.heard : null;
    out.push(header("Find your range", M().rangeTitle(end), end === "low" ? "1 of 2" : "2 of 2", function () { cancelTake(); m.view = "routine"; render(); }));
    out.push(el("p", "pm-lead", M().rangeInstruction(end)));
    var box = el("div", "pm-range-note"); box.setAttribute("aria-live", "polite");
    var big = el("p", "pm-big", recording ? (m.heardLive || "…") : heard ? heard.name : (end === "low" ? m.range && m.range.low : m.range && m.range.high) || "?");
    big.id = "pm-range-big";
    if (!recording && !heard) big.classList.add("idle");
    box.appendChild(big);
    var sub = el("p", "pm-caption", recording ? "Listening · 0.0 of " + M().RANGE_TAKE_SECONDS + " s" : sending ? "Finding your steadiest note…" : heard ? M().heardLine(heard)
      : "Press Start, then hold the note for about " + M().RANGE_TAKE_SECONDS + " seconds.");
    sub.id = "pm-range-sub";
    box.appendChild(sub);
    if (recording) { var bar = el("div", "pm-range-bar"); var f = el("i"); f.id = "pm-range-fill"; bar.appendChild(f); box.appendChild(bar); }
    out.push(box);
    if (m.error) out.push(errorLine(m.error));
    var tip = el("div", "pm-tip");
    tip.appendChild(ctx.art(recording ? "doh-sing" : "doh-encourage", 56, 56));
    tip.appendChild(el("p", "pm-bubble", M().rangeTip(end)));
    out.push(tip);
    out.push(recording ? actions([button("btn-ghost", "/assets/icons.svg#i-stop", "Stop", function () { finishTake(); })], "Listening")
      : m.phase === "starting" ? actions([disabledButton("Getting ready…")])
      : sending ? actions([disabledButton("Measuring…")])
        : heard ? actions([
          button("btn-ghost", null, "Again", function () { startRange(end); }),
          button("btn-primary", "/assets/icons.svg#i-arrow-right", end === "low" ? "Now your highest" : "See my range", function () { m.error = null; m.heardLive = null; m.view = end === "low" ? "high" : "result"; render(); focusTitle(); })
        ]) : actions([singButton("Start", function () { startRange(end); })]));
    return out;
  }

  function rangeResultView() {
    var r = m.range || {}, out = [];
    out.push(header("Find your range", "Your range", null, function () { m.view = "routine"; render(); }));
    out.push(el("p", "pm-range-head", M().rangeHeadline(r) || "Not measured yet"));
    if (r.span) out.push(el("p", "pm-range-span", r.span + ", comfortably"));
    var sol = M().rangeSolfaLine(r);
    if (sol) out.push(el("p", "pm-range-solfa", sol));
    if (r.lowMidi != null && r.highMidi != null) out.push(keyboardSvg(r.lowMidi, r.highMidi));
    var part = M().voicePartLine(r.voicePart);
    if (part) {
      var card = el("div", "pm-part");
      card.appendChild(ctx.icon("people", "pm-part-ic"));
      var t = el("div"); t.appendChild(el("strong", null, part)); t.appendChild(el("span", null, "A guide for choir parts, not a label"));
      card.appendChild(t);
      out.push(card);
    }
    out.push(el("p", "pm-info", "Voices warm up and change. Measure again any day."));
    out.push(actions([
      button("btn-ghost", null, "Measure again", function () { m.view = "low"; m.heardLive = null; render(); }),
      button("btn-primary", null, "Done", function () { m.view = "routine"; m.step = m.warm ? m.warm.steps.length - 1 : 0; render(); })
    ]));
    return out;
  }

  function keyboardSvg(lo, hi) {
    var keys = M().rangeKeys(lo, hi), whites = keys.filter(function (k) { return !k.black; }), W = 320, w = W / whites.length, TOP = 26, KH = 76;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + (TOP + KH), class: "pm-keys", role: "img", "aria-label": "A keyboard with " + M().midiName(lo) + " to " + M().midiName(hi) + " lit" });
    function wi(midi) { for (var i = 0; i < whites.length; i++) if (whites[i].midi === midi) return i; return -1; }
    function xOf(midi) { var k = keys.filter(function (q) { return q.midi === midi; })[0]; return !k ? 0 : !k.black ? wi(midi) * w + w / 2 : (wi(midi - 1) + 1) * w; }
    [lo, hi].forEach(function (mm) {
      var t = svgEl("text", { x: xOf(mm), y: 12, "text-anchor": "middle", class: "pm-key-end" }); t.textContent = M().midiName(mm); svg.appendChild(t);
      svg.appendChild(svgEl("line", { x1: xOf(mm), x2: xOf(mm), y1: 16, y2: TOP - 2, class: "pm-key-tick" }));
    });
    whites.forEach(function (k, i) {
      svg.appendChild(svgEl("rect", { x: i * w + 0.5, y: TOP, width: w - 1.5, height: KH, rx: 3, class: "pm-key white" + (k.lit ? " lit" : "") }));
      if (k.label) { var t = svgEl("text", { x: i * w + w / 2, y: TOP + KH - 6, "text-anchor": "middle", class: "pm-key-label" + (k.lit ? " lit" : "") }); t.textContent = k.label; svg.appendChild(t); }
    });
    keys.filter(function (k) { return k.black; }).forEach(function (k) {
      svg.appendChild(svgEl("rect", { x: xOf(k.midi) - w * 0.32, y: TOP, width: w * 0.64, height: KH * 0.6, rx: 2, class: "pm-key black" + (k.lit ? " lit" : "") }));
    });
    return svg;
  }

  // ── Buttons that start sound or a take ──────────────────────────────────
  function hearButton(onClick) {
    var on = sound && sound.kind === "hear";
    var b = button("btn-ghost", on ? "/assets/icons.svg#i-stop" : "/assets/icons.svg#i-volume", on ? "Stop" : playful() ? "Listen" : "Hear it", onClick);
    b.id = "pm-hear";
    return b;
  }
  function singButton(text, onClick) {
    var b = button("btn-primary", "/assets/icons.svg#i-mic", text, onClick);
    b.id = "pm-sing";
    if (m.mode !== "warm-up" && noneLeft()) b.disabled = true;
    return b;
  }
  function disabledButton(text) { var b = button("btn-primary", "/assets/icons.svg#i-clock", text, function () {}); b.disabled = true; return b; }
  function liveActions() {
    if (m.phase === "sending") return actions([disabledButton("Marking…")]);
    return actions([button("btn-ghost", "/assets/icons.svg#i-stop", "Stop", cancelTake)], m.phase === "starting" ? "Getting ready…" : "Listening");
  }

  function openExercise(i) { stopSound(); m.index = i; m.grade = null; m.error = null; dropTake(); render(); focusTitle(); }
  function focusTitle() { var t = $("pm-title"); if (t) t.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }

  // ── Sound without the microphone ────────────────────────────────────────
  function stopSound() {
    if (!sound) return;
    var s = sound; sound = null;
    try { s.stop(); } catch (e) { /* already stopped */ }
    m.breathFrom = null;
    highlightRoll(-1); highlightChips(-1);
  }

  /** Notes on the rehearsal piano; `onBeat(beat)` while they play; the view redraws when they end. */
  function playNotes(voices, tempo, ts, kind, onBeat) {
    if (!player) player = ctx.choir.createPlayer();
    var mine = sound = { kind: kind, stop: function () { player.stop(); } };
    player.onTick(function (t) {
      if (sound !== mine) return;
      if (!t.playing && t.beat === 0 && mine.started) { sound = null; highlightRoll(-1); highlightChips(-1); render(); return; }
      if (t.playing) { mine.started = true; if (onBeat) onBeat(t.beat * 60 / Math.max(30, tempo)); }
    });
    player.load({ voices: voices.map(function (v, i) { return { name: "v" + i, notes: v.notes, gain: v.gain }; }), tempoBpm: tempo, timeSignature: ts || "4/4" });
    player.play();
    render();
  }

  function highlightChips(i) {
    if (!root) return;
    root.querySelectorAll(".pm-chips.mine li, .pm-jump-note").forEach(function (li) { li.classList.toggle("on", Number(li.getAttribute("data-i")) === i); });
  }

  function hearExercise(ex) {
    if (sound) { var was = sound.kind; stopSound(); render(); if (was === "hear") return; }
    track("practice_mode_heard", "mode=" + ex.mode);
    playNotes(M().hearVoices(ex), ex.tempoBpm, ex.timeSignature, "hear", function (sec) {
      highlightChips(ex.mode === "pitch-match" ? -1 : M().noteDue(ex.notes, ex.tempoBpm, sec));
    });
  }

  function newAudio() { var AC = window.AudioContext || window.webkitAudioContext; return new AC(); }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function click(audio, at, accent, gain) {
    var osc = audio.createOscillator(), g = audio.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.4 * (gain == null ? 1 : gain), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(g); g.connect(audio.destination); osc.start(at); osc.stop(at + 0.06);
  }

  /** The warm-up's guide: the trills on the piano, round by round; a siren as one sliding hum (a piano cannot slide). */
  function playGuide(guide) {
    if (sound && sound.kind === "guide") { stopSound(); render(); return; }
    stopSound();
    track("warm_up_guide_played", "glide=" + guide.glide);
    var seconds = M().guideSeconds(guide);
    if (!guide.glide) {
      playNotes([{ notes: M().guideNotes(guide), gain: 1 }], guide.tempoBpm, "4/4", "guide", function (sec) {
        var r = $("pm-round"); if (r) r.textContent = "Round " + M().guideRoundAt(guide, sec) + " of " + guide.rounds;
      });
      return;
    }
    var audio = newAudio(), t0 = audio.currentTime + 0.08, master = audio.createGain();
    master.gain.value = 0.22; master.connect(audio.destination);
    M().glideRounds(guide).forEach(function (points) {
      if (points.length < 2) return;
      var start = t0 + points[0].t, stop = t0 + points[points.length - 1].t, g = audio.createGain();
      g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(1, start + 0.06);
      g.gain.setValueAtTime(1, stop - 0.06); g.gain.linearRampToValueAtTime(0, stop);
      g.connect(master);
      [[1, 1], [2, 0.3], [3, 0.12]].forEach(function (pair) {
        var osc = audio.createOscillator(), og = audio.createGain();
        og.gain.value = pair[1];
        osc.frequency.setValueAtTime(hz(points[0].midi) * pair[0], start);
        for (var i = 1; i < points.length; i++) osc.frequency.exponentialRampToValueAtTime(hz(points[i].midi) * pair[0], t0 + points[i].t);
        osc.connect(og); og.connect(g); osc.start(start); osc.stop(stop + 0.05);
      });
    });
    var mine = sound = { kind: "guide", stop: function () { clearInterval(mine.timer); try { audio.close(); } catch (e) { /* closed */ } } };
    mine.timer = setInterval(function () {
      if (sound !== mine) return;
      var t = audio.currentTime - t0, r = $("pm-round");
      if (r) r.textContent = "Round " + M().guideRoundAt(guide, Math.max(0, t)) + " of " + guide.rounds;
      if (t > seconds + 0.3) { stopSound(); render(); }
    }, 200);
    render();
  }

  function startBreath(breath) {
    stopSound();
    m.breathFrom = performance.now();
    var mine = sound = { kind: "breath", stop: function () { clearInterval(mine.timer); } };
    mine.timer = setInterval(function () {
      if (sound !== mine) return;
      var now = M().breathAt(breath, (performance.now() - m.breathFrom) / 1000);
      if (now.done) { stopSound(); goStep(m.step + 1); return; }
      var box = $("pm-breath");
      if (box) {
        box.innerHTML = "";
        box.appendChild(el("strong", "pm-breath-word", now.word));
        box.appendChild(el("b", "pm-breath-count", String(now.count)));
        box.appendChild(el("span", null, "Round " + now.cycle + " of " + breath.cycles));
      }
    }, 200);
  }

  /** A clap: three bursts of noise a few milliseconds apart and a short decay (the phone's lib/synth renderClap). */
  function clapBuffer(audio) {
    var n = Math.ceil(0.12 * audio.sampleRate), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    var seed = 22222, prevIn = 0, prevOut = 0;
    for (var i = 0; i < n; i++) {
      var t = i / audio.sampleRate;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var noise = (seed / 0x7fffffff) * 2 - 1, env = 0;
      [0, 0.009, 0.018].forEach(function (at) { if (t >= at) env = Math.max(env, Math.exp(-(t - at) / 0.003)); });
      if (t >= 0.018) env = Math.max(env, 0.7 * Math.exp(-(t - 0.018) / 0.045));
      var x = noise * env;
      prevOut = 0.9 * (prevOut + x - prevIn); prevIn = x;
      d[i] = 0.75 * prevOut;
    }
    return buf;
  }

  function hearRhythm(ex) {
    if (sound) { var was = sound.kind; stopSound(); render(); if (was === "hear") return; }
    var audio = newAudio(), beat = M().beatSeconds(ex.tempoBpm), t0 = audio.currentTime + 0.1, one = t0 + HEAR_COUNT_IN * beat;
    var layout = M().clapLayout(ex.claps), end = ex.claps.reduce(function (mx, c) { return Math.max(mx, c.startBeat + c.durBeats); }, 0);
    for (var i = 0; i < HEAR_COUNT_IN; i++) click(audio, t0 + i * beat, i === 0);
    for (var b = 0; b < Math.ceil(end - 1e-9); b++) click(audio, one + b * beat, b % 4 === 0, 0.35);
    var clap = clapBuffer(audio);
    ex.claps.forEach(function (c) { var src = audio.createBufferSource(); src.buffer = clap; src.connect(audio.destination); src.start(one + c.startBeat * beat); });
    var mine = sound = { kind: "hear", stop: function () { clearInterval(mine.timer); try { audio.close(); } catch (e) { /* closed */ } } };
    mine.timer = setInterval(function () {
      if (sound !== mine) return;
      var at = (audio.currentTime - one) / beat;
      highlightClap(ex, at);
      if (at > layout.beats + 0.5) { stopSound(); render(); }
    }, 50);
    track("practice_mode_heard", "mode=rhythm");
    render();
  }

  function highlightClap(ex, beat) {
    if (!root) return;
    var due = -1;
    ex.claps.forEach(function (c, i) { if (beat >= c.startBeat && beat < c.startBeat + Math.min(c.durBeats, 0.5)) due = i; });
    root.querySelectorAll(".pm-clap").forEach(function (c) { c.classList.toggle("on", Number(c.getAttribute("data-i")) === due); });
  }

  function replay() {
    if (sound && sound.kind === "replay") { stopSound(); render(); return; }
    stopSound();
    if (!m.takeUrl) return;
    var a = new Audio(m.takeUrl);
    var mine = sound = { kind: "replay", stop: function () { a.pause(); } };
    a.addEventListener("ended", function () { if (sound === mine) { sound = null; render(); } });
    var p = a.play();
    if (p && p.catch) p.catch(function () { if (sound === mine) { sound = null; m.error = "We couldn't play your take back."; render(); } });
    render();
  }
  function dropTake() {
    if (m.takeUrl) { try { URL.revokeObjectURL(m.takeUrl); } catch (e) { /* gone */ } }
    m.takeUrl = null;
  }

  // ── Takes: the count-in, what the mode plays, the microphone, the server ─
  /**
   * Opens the microphone and records. `opts.ex` is the exercise (null for the range finder); `opts.live` reads the
   * pitch for the needle (pitch match) or the note heard (the range finder); `opts.send(blob, name, lead)` sends it.
   */
  function record(opts) {
    if (m.phase !== "idle" || take) return;
    stopSound();
    m.error = null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { m.error = P().micError({ name: "Unsupported" }); render(); return; }
    var g = gen, audio = newAudio();
    var countIn = opts.ex ? window.NfPractice.leadInPlan(opts.ex.tempoBpm, opts.ex.timeSignature) : { beats: 0, holdBeats: 0, beatsPerBar: 4, beatSec: 1, seconds: 0 };
    var mine = take = { audio: audio, cancelled: false, lead: countIn.seconds, ex: opts.ex, opts: opts };
    m.phase = "starting"; render();
    var piano = opts.ex && opts.ex.mode !== "rhythm"
      ? Promise.race([ctx.choir.loadPiano(audio).then(function () { return true; }, function () { return false; }),
          new Promise(function (resolve) { setTimeout(function () { resolve(false); }, PIANO_WAIT_MS); })])
      : Promise.resolve(false);
    var mic = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    Promise.all([mic, piano]).then(function (got) {
      var stream = got[0];
      if (g !== gen || mine.cancelled || take !== mine) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      mine.stream = stream;
      var mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      var recOpts = { audioBitsPerSecond: 32000 };
      if (mime) recOpts.mimeType = mime;
      var chunks = [], rec = new MediaRecorder(stream, recOpts);
      mine.recorder = rec;
      rec.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      rec.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (g !== gen || mine.cancelled) return; // cancelled: nothing is sent and nothing is spent
        var type = rec.mimeType || mime || "audio/webm", blob = new Blob(chunks, { type: type });
        opts.send(blob, type.indexOf("mp4") >= 0 ? "take.m4a" : "take.webm", mine.lead, g);
      });
      if (opts.live) {
        var src = audio.createMediaStreamSource(stream), an = audio.createAnalyser();
        an.fftSize = 2048; src.connect(an);
        mine.analyser = an; mine.buf = new Float32Array(an.fftSize); mine.smooth = window.NfPitchTrack.createSmoother(5); mine.trace = []; mine.slot = -1;
      }
      if (audio.state === "suspended") audio.resume();
      rec.start();
      mine.t0 = audio.currentTime + 0.05;
      if (opts.ex) scheduleTake(audio, opts.ex, countIn, mine.t0, got[1], m.headphones);
      m.phase = countIn.seconds > 0 ? "leadin" : "live"; render();
      window.scrollTo({ top: 0 }); // the note in hand, the needle and Stop, on one phone screen (smooth by the stylesheet, unless less motion is asked for)
      document.body.classList.add("is-recording");
      mine.timer = setInterval(function () { tick(mine); }, NEEDLE_MS);
      mine.stopAt = setTimeout(function () { if (take === mine) finishTake(); }, (opts.seconds + 0.05) * 1000);
    }, function (err) {
      if (take === mine) take = null;
      try { audio.close(); } catch (e) { /* closed */ }
      if (g !== gen || mine.cancelled) return;
      m.phase = "idle"; m.error = P().micError(err); render();
    });
  }

  /** The count-in's clicks (higher a whole bar before beat one), the pitch pipe, and what the mode plays under the take. */
  function scheduleTake(audio, ex, countIn, t0, pianoReady, headphones) {
    var C = ctx.choir, out = pianoReady ? C.createPianoOutput(audio) : null;
    for (var i = 0; i < countIn.beats; i++) click(audio, t0 + i * countIn.beatSec, (countIn.beats - i) % countIn.beatsPerBar === 0);
    var one = t0 + countIn.seconds, beat = countIn.beatSec;
    M().takeSound(ex, countIn, headphones).voices.forEach(function (v) {
      v.notes.forEach(function (n) {
        var when = one + n.startBeat * beat, dur = n.durBeats * beat;
        if (out) C.pianoNote(audio, out, n.pitchMidi, dur, when, v.gain);
        else { // the piano did not load in time: a plain tone still gives the pitch
          var osc = audio.createOscillator(), gn = audio.createGain();
          osc.frequency.value = hz(n.pitchMidi);
          gn.gain.setValueAtTime(0, when); gn.gain.linearRampToValueAtTime(0.25 * v.gain, when + 0.02);
          gn.gain.setValueAtTime(0.25 * v.gain, when + dur - 0.05); gn.gain.linearRampToValueAtTime(0, when + dur);
          osc.connect(gn); gn.connect(audio.destination); osc.start(when); osc.stop(when + dur + 0.05);
        }
      });
    });
  }

  function tick(mine) {
    if (take !== mine || !root) return;
    var t = mine.audio.currentTime - mine.t0, sinceOne = t - mine.lead;
    if (m.phase === "leadin" && sinceOne >= 0) { m.phase = "live"; render(); }
    var status = $("pm-status");
    if (status && m.phase === "leadin") {
      status.lastChild.textContent = "Starting in " + Math.max(1, Math.ceil(-sinceOne));
    }
    if (m.mode === "pitch-match" && mine.ex) pitchTick(mine, sinceOne);
    else if (m.mode === "warm-up") rangeTick(mine, t);
    else if (m.mode === "rhythm" && mine.ex) highlightClap(mine.ex, sinceOne / M().beatSeconds(mine.ex.tempoBpm));
    else if (mine.ex) {
      var i = sinceOne >= 0 ? M().noteDue(mine.ex.notes, mine.ex.tempoBpm, sinceOne) : -1;
      if (m.mode === "runs") highlightRoll(i); else highlightChips(i);
      var hint = $("pm-hint");
      if (hint && m.phase === "live") hint.textContent = "Sing!";
    }
  }

  /** Reads the voice off the microphone: the median of the last readings, in cents from `target` (octaves out). */
  function readCents(mine, target) {
    mine.analyser.getFloatTimeDomainData(mine.buf);
    var r = window.NfPitchTrack.detectPitch(mine.buf, mine.audio.sampleRate);
    return mine.smooth.push(r ? M().centsOff(r.freq, target) : null);
  }

  function pitchTick(mine, sinceOne) {
    var ex = mine.ex, slots = M().pitchSlots(ex), mo = M().pitchMomentAt(slots, sinceOne);
    var idx = Math.max(0, mo.index), note = ex.notes[idx];
    if (idx !== mine.slot) { mine.slot = idx; mine.smooth.reset(); mine.trace = []; }
    var chips = root.querySelectorAll("#pm-chips li");
    for (var k = 0; k < chips.length; k++) { chips[k].classList.toggle("on", k === idx && sinceOne >= 0); chips[k].classList.toggle("done", k < idx); }
    var big = $("pm-big"), cap = $("pm-caption"), word = $("pm-word"), cents = $("pm-cents"), hint = $("pm-hint"), hold = $("pm-hold");
    if (big) big.textContent = M().written(note);
    if (cap) cap.textContent = M().noteCaption(note, idx, ex.notes.length, M().flatKey(ex.dohHeader));
    var syl = M().syllableName(note.solfa, note.octaveMark);
    if (sinceOne < 0 || mo.phase === "tone" || mo.phase === "before") {
      setNeedle(null);
      if (word) { word.textContent = sinceOne < 0 ? "Get ready" : "Listen…"; word.className = "pm-word none"; }
      if (cents) cents.textContent = " ";
      if (hint) hint.textContent = sinceOne < 0 ? "The first note plays after the count-in." : "Hear " + syl + ", then hold it.";
      if (hold) hold.classList.remove("on");
      return;
    }
    if (mo.phase === "done") return;
    var c = readCents(mine, note.pitchMidi), zone = setNeedle(c), words = M().needleWords(c, syl);
    if (word) { word.textContent = words.title; word.className = "pm-word " + zone; }
    if (cents) cents.textContent = c == null ? " " : (c > 0 ? "+" : c < 0 ? "−" : "") + Math.abs(Math.round(c)) + " cents";
    if (hint) hint.textContent = words.hint;
    if (hold) {
      hold.classList.add("on");
      var x = Math.min(1, mo.held / Math.max(0.1, mo.holdSeconds));
      if (c != null) mine.trace.push({ x: x, c: c });
      var pts = mine.trace.map(function (p) { return (p.x * 300).toFixed(1) + "," + (30 - Math.max(-100, Math.min(100, p.c)) * 0.3).toFixed(1); });
      var line = $("pm-trace"), dot = $("pm-trace-dot"), time = $("pm-hold-time");
      if (line) line.setAttribute("points", pts.join(" "));
      if (dot) {
        var last = mine.trace[mine.trace.length - 1];
        dot.setAttribute("cx", last ? (last.x * 300).toFixed(1) : -10);
        dot.setAttribute("cy", last ? (30 - Math.max(-100, Math.min(100, last.c)) * 0.3).toFixed(1) : 30);
        dot.setAttribute("class", "pm-trace-dot " + zone);
      }
      if (time) time.textContent = Math.min(mo.held, mo.holdSeconds).toFixed(1) + " of " + Math.round(mo.holdSeconds) + " s";
    }
  }

  /** The range finder hears the note live on the web (the server still reads the steadiest hold). */
  function rangeTick(mine, t) {
    var sub = $("pm-range-sub"), fill = $("pm-range-fill"), big = $("pm-range-big");
    if (sub) sub.textContent = "Listening · " + Math.min(M().RANGE_TAKE_SECONDS, t).toFixed(1) + " of " + M().RANGE_TAKE_SECONDS + " s";
    if (fill) fill.style.width = Math.min(100, t / M().RANGE_TAKE_SECONDS * 100) + "%";
    if (!mine.analyser) return;
    mine.analyser.getFloatTimeDomainData(mine.buf);
    var r = window.NfPitchTrack.detectPitch(mine.buf, mine.audio.sampleRate);
    var midi = mine.smooth.push(r ? M().midiOf(r.freq) : null);
    if (midi != null) { m.heardLive = M().midiName(midi); if (big) big.textContent = m.heardLive; }
  }

  /** Ends the recording; `cancelled` takes are dropped, the rest go to be marked or measured. */
  function endTake(cancelled) {
    var mine = take;
    if (!mine) return;
    take = null;
    mine.cancelled = mine.cancelled || cancelled;
    if (mine.timer) clearInterval(mine.timer);
    if (mine.stopAt) clearTimeout(mine.stopAt);
    document.body.classList.remove("is-recording");
    if (mine.recorder && mine.recorder.state !== "inactive") mine.recorder.stop();
    else if (mine.stream) mine.stream.getTracks().forEach(function (t) { t.stop(); });
    try { mine.audio.close(); } catch (e) { /* closed */ }
  }
  function finishTake() { endTake(false); m.phase = "sending"; render(); }
  function cancelTake() { var had = !!take; endTake(true); if (had || m.phase !== "idle") { m.phase = "idle"; render(); } }

  /** A mode's take, marked: one of the day's marked drills, recorded by the server as practice. */
  function startTake(ex) {
    var lead = window.NfPractice.leadInPlan(ex.tempoBpm, ex.timeSignature).seconds;
    m.grade = null; dropTake();
    track("practice_mode_started", "mode=" + ex.mode + ";exercise=" + ex.id);
    record({
      ex: ex, live: ex.mode === "pitch-match", seconds: M().takeSeconds(ex, lead),
      send: function (blob, name, leadSec, g) {
        var form = new FormData();
        form.append("audio", blob, name);
        form.append("exerciseId", ex.id);
        form.append("leadInSec", String(leadSec));
        ctx.request("/api/practice/modes/grade", { method: "POST", form: form }).then(function (grade) {
          if (g !== gen) return;
          m.grade = grade; m.phase = "idle"; m.error = null;
          try { m.takeUrl = URL.createObjectURL(blob); } catch (e) { m.takeUrl = null; }
          track("practice_mode_marked", "mode=" + ex.mode + ";score=" + grade.score + ";xp=" + ((grade.reward && grade.reward.xpGained) || 0));
          P().rewardEvents(grade.reward).forEach(function (e) { track(e.name, e.detail); });
          render();
          window.scrollTo({ top: 0 }); // smooth by the stylesheet, unless less motion is asked for
          load(true).then(function () { if (g === gen && m.phase === "idle") render(); });
        }, function (err) {
          if (g !== gen) return;
          m.phase = "idle"; m.error = P().gradeError(err);
          if (err && err.code === "PRACTICE_DAILY_LIMIT" && m.data) m.data.allowance = Object.assign({}, m.data.allowance, { used: m.data.allowance.limit });
          render();
        });
      }
    });
  }

  /** The range finder: a few seconds holding the lowest (or highest) easy note, measured by the server. */
  function startRange(end) {
    m.lastEnd = null; m.heardLive = null;
    record({
      ex: null, live: true, seconds: M().RANGE_TAKE_SECONDS,
      send: function (blob, name, leadSec, g) {
        var form = new FormData();
        form.append("audio", blob, name);
        form.append("end", end);
        ctx.request("/api/practice/range", { method: "POST", form: form }).then(function (r) {
          if (g !== gen) return;
          m.range = r; m.lastEnd = end; m.phase = "idle"; m.error = null;
          track("range_measured", "end=" + end);
          render();
        }, function (err) {
          if (g !== gen) return;
          m.phase = "idle"; m.error = (err && err.message) || "We couldn't measure that. Please try again.";
          render();
        });
      }
    });
  }

  // ── The view's way in and out ───────────────────────────────────────────
  function goBack() { leave(); if (ctx && ctx.back) ctx.back(); }

  function open(rootEl, context) {
    leave();
    gen++;
    ctx = context; root = rootEl;
    m = fresh();
    m.mode = context.mode;
    render();
    load().then(function () { focusTitle(); });
  }
  /** Another view (or back to the hub): nothing keeps sounding or listening. */
  function leave() {
    stopSound();
    if (take) endTake(true);
    if (m.phase !== "idle") m.phase = "idle";
  }
  function reset() { gen++; leave(); dropTake(); m = fresh(); root = null; }

  window.NfPracticeModeView = { open: open, leave: leave, reset: reset };
})();
