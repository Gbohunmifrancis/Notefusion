/* The quick games on the web (board s-practice-fun/s3), opened in the Practice view's place from its "Quick games" row,
 * as the phone's screens/practice/PracticeGameScreen.tsx: Which note? (hear doh, then a note; tap it on the Curwen
 * modulator), Staff to solfa (Playful's "Note race": a note on the stave, its solfa tapped, as many as a minute allows)
 * and Name that hymn (a hymn's opening; its name picked from three). Tapped, not sung: no microphone.
 *
 * The server deals the rounds with their answers (GET /api/practice/games/{game}), so a tap is told at once — the right
 * one in mint, a wrong one grey and dashed, never red. At the end the answers go back to be marked by the server
 * (POST /api/practice/games/grade), which records a game that counts: XP, the day for the streak, six games a day.
 * Leaving mid-game sends nothing. The words and arithmetic are practice-games.js; the sound is the rehearsal piano.
 *
 *   NfPracticeGameView.open(rootEl, { request, track, choir, game, practiceTrack, art, burst, back })
 *   NfPracticeGameView.leave()   — another view or back: stop the clock and the piano
 */
(function () {
  "use strict";

  /** A wrong tap in the race shows the right key this long before the next note. */
  var RACE_MISS_MS = 650;

  var ctx = null, root = null, gen = 0, g = null, player = null, timer = null, advance = null;

  function fresh(game) {
    return {
      game: game, deal: null, loading: true, loadError: null, phase: "intro", index: 0, answers: [], marks: [],
      picked: null, timeLeft: 0, startedAt: 0, grade: null, sendError: null
    };
  }
  function G() { return window.NfPracticeGames; }
  function T() { return window.NfPracticeTrack; }
  function trackOf() { return (g.deal && g.deal.track) || ctx.practiceTrack || null; }
  function race() { return g.game === "staff"; }
  function round() { return g.deal ? g.deal.rounds[g.index] : null; }
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
  function announce(text) { var live = root && root.querySelector("#pg-live"); if (live) live.textContent = text; }

  /** The top bar, as a mode's: back, "Quick game · no mic" over the game's name, the round or the clock. */
  function header() {
    var bar = el("div", "pm-top");
    var back = el("button", "pm-back"); back.type = "button"; back.setAttribute("aria-label", "Back");
    back.appendChild(sprite("/assets/icons.svg#i-back"));
    back.addEventListener("click", goBack);
    var text = el("div", "pm-top-text");
    text.appendChild(el("p", "pm-eyebrow", "Quick game · no mic"));
    var h = el("h1", "pm-title", G().gameTitle(g.game, trackOf())); h.id = "pm-title"; h.setAttribute("tabindex", "-1");
    text.appendChild(h);
    bar.appendChild(back); bar.appendChild(text);
    var pill = pillText();
    if (pill) { var p = el("span", "pm-pill", pill); p.id = "pg-pill"; bar.appendChild(p); }
    return bar;
  }
  function pillText() {
    if (!g.deal) return null;
    if (race()) return G().clock(g.phase === "intro" ? (g.deal.timeLimitSeconds || 60) : g.timeLeft);
    return Math.min(g.index + 1, g.deal.rounds.length) + " of " + g.deal.rounds.length;
  }

  // ── Sound ───────────────────────────────────────────────────────────────
  function playNotes(notes, tempo) {
    if (!notes || !notes.length || !ctx.choir) return;
    try {
      if (!player) player = ctx.choir.createPlayer();
      player.stop();
      player.load({
        voices: [{ name: "game", notes: notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats, conf: 1 }; }), gain: 1 }],
        tempoBpm: tempo, timeSignature: "4/4"
      });
      player.play();
    } catch (e) { /* no sound is no game-breaker: the round still reads */ }
  }
  function stopSound() { try { if (player) player.stop(); } catch (e) { /* stopped */ } }
  function hearRound(r) {
    if (!r) return;
    if (g.game === "which-note") playNotes(G().earNotes(r), G().EAR_TEMPO);
    else if (g.game === "hymn") playNotes(r.notes, r.tempoBpm || 96);
  }

  // ── The game ────────────────────────────────────────────────────────────
  function clearTimers() {
    if (timer) clearInterval(timer);
    if (advance) clearTimeout(advance);
    timer = null; advance = null;
  }

  function load() {
    var my = gen;
    clearTimers(); stopSound();
    g = fresh(g.game);
    render();
    return ctx.request("/api/practice/games/" + g.game).then(function (d) {
      if (my !== gen) return;
      g.deal = d; g.loading = false; g.timeLeft = d.timeLimitSeconds || 0;
      render(); focusTitle();
    }, function (err) {
      if (my !== gen) return;
      g.loading = false; g.loadError = (err && err.message) || "That didn't load. Check your connection and try again.";
      render();
    });
  }

  function start() {
    if (!g.deal) return;
    g.startedAt = Date.now(); g.phase = "playing";
    track("practice_game_started", "game=" + g.game);
    if (race()) {
      var limit = g.deal.timeLimitSeconds || 60;
      g.timeLeft = limit;
      timer = setInterval(function () {
        g.timeLeft = limit - (Date.now() - g.startedAt) / 1000;
        tickClock();
        if (g.timeLeft <= 0) finish();
      }, 200);
    } else hearRound(g.deal.rounds[0]);
    render();
  }

  /** The race's clock and bar move in place, so a tap is never lost to a redraw. */
  function tickClock() {
    var pill = root && root.querySelector("#pg-pill"), fill = root && root.querySelector("#pg-timer");
    if (pill) pill.textContent = pillText();
    if (fill) fill.style.width = Math.max(0, Math.min(1, g.timeLeft / (g.deal.timeLimitSeconds || 60))) * 100 + "%";
  }

  function tap(choice) {
    var r = round();
    if (!r || g.phase !== "playing" || g.picked != null || g.answers.length > g.index) return;
    var right = choice === r.answer;
    g.answers.push(choice); g.marks.push(right);
    if (race()) {
      if (right && r.noteMidi != null) playNotes([{ pitchMidi: r.noteMidi, startBeat: 0, durBeats: 0.5 }], 120);
      var moveOn = function () {
        g.picked = null;
        if (g.index + 1 >= g.deal.rounds.length) { finish(); return; }
        g.index++; render();
      };
      if (right) moveOn();
      else { g.picked = choice; render(); advance = setTimeout(moveOn, RACE_MISS_MS); }
      return;
    }
    g.picked = choice;
    var said = G().verdict(g.game, r, choice);
    // A wrong ear answer hears both again: doh, then the right note.
    if (!right && g.game === "which-note") hearRound(r);
    render();
    announce(said.title + " " + said.line);
    var next = root.querySelector("#pg-next"); if (next) next.focus();
  }

  function next() {
    if (!g.deal) return;
    if (g.index + 1 >= g.deal.rounds.length) { finish(); return; }
    g.picked = null; g.index++;
    hearRound(g.deal.rounds[g.index]);
    render();
  }

  function finish() {
    if (!g.deal || g.phase === "sending" || g.phase === "done") return;
    clearTimers();
    g.phase = "sending"; g.sendError = null; render();
    send();
  }

  function send() {
    var my = gen, seconds = Math.round((Date.now() - g.startedAt) / 100) / 10;
    g.sendError = null; render();
    ctx.request("/api/practice/games/grade", { method: "POST", body: { dealId: g.deal.dealId, answers: g.answers.slice(), seconds: seconds } }).then(function (grade) {
      if (my !== gen) return;
      g.grade = grade; g.phase = "done";
      track("practice_game_finished", "game=" + g.game + ";score=" + grade.score + ";counted=" + (grade.counted ? 1 : 0) + ";xp=" + (grade.reward ? grade.reward.xpGained : 0));
      if (grade.counted && grade.score >= 80 && ctx.burst) ctx.burst();
      render();
      announce(G().resultTitle(grade) + ". " + G().resultLine(grade, g.deal.gamesPerDay));
    }, function (err) {
      if (my !== gen) return;
      g.sendError = (err && err.message) || "Your answers didn't reach us. Check your connection and send them again.";
      render();
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function render() {
    if (!root || !g) return;
    root.innerHTML = "";
    var box = el("div", "pm pg" + (trackOf() === "playful" ? " is-playful" : ""));
    box.appendChild(header());
    var live = el("p", "sr-only"); live.id = "pg-live"; live.setAttribute("aria-live", "polite"); box.appendChild(live);

    if (g.loading && !g.deal) {
      var sk = el("div", "pv-skel"); for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel")); box.appendChild(sk);
    } else if (!g.deal) {
      var failed = el("div", "pg-card");
      failed.appendChild(el("p", null, g.loadError));
      failed.appendChild(button("btn-ghost", "/assets/icons.svg#i-restart", "Try again", function () { load(); }));
      box.appendChild(failed);
    } else if (g.phase === "intro") box.appendChild(intro());
    else if (g.phase === "playing") box.appendChild(playing());
    else if (g.phase === "sending") box.appendChild(sending());
    else if (g.grade) box.appendChild(done());
    root.appendChild(box);
  }

  function intro() {
    var d = g.deal, card = el("section", "pg-card");
    card.appendChild(el("p", "pg-intro", G().gameIntro(g.game, trackOf())));
    card.appendChild(el("p", "pg-meta", d.gamesToday >= d.gamesPerDay
      ? "Today's " + d.gamesPerDay + " games that earn XP are done. This one is for fun."
      : "Earns XP: " + (d.gamesPerDay - d.gamesToday) + " of today's " + d.gamesPerDay + " games left."));
    var go = button("btn-primary pg-block", "/assets/icons.svg#i-play", trackOf() === "playful" ? "Let's play!" : "Start", start);
    go.id = "pg-start";
    card.appendChild(go);
    return card;
  }

  function combo() {
    var n = G().comboOf(g.marks);
    if (n < 2) return null;
    var c = el("span", "pg-combo", "×" + n); c.setAttribute("aria-label", n + " right in a row");
    return c;
  }

  function playing() {
    var r = round(), wrap = el("div", "pg-play");
    if (race()) {
      var top = el("div", "pg-race-top");
      var bar = el("div", "pg-timer"), fill = el("i"); fill.id = "pg-timer";
      fill.style.width = Math.max(0, Math.min(1, g.timeLeft / (g.deal.timeLimitSeconds || 60))) * 100 + "%";
      bar.appendChild(fill); bar.setAttribute("aria-hidden", "true"); top.appendChild(bar);
      var line = el("div", "pg-scoreline");
      var right = el("span", "pg-meta"); right.appendChild(el("b", "pg-big", String(g.marks.filter(Boolean).length))); right.appendChild(document.createTextNode(" right"));
      line.appendChild(right);
      var cb = combo(); if (cb) line.appendChild(cb);
      top.appendChild(line);
      wrap.appendChild(top);
      wrap.appendChild(staffRound(r));
      return wrap;
    }
    var dotsRow = el("div", "pg-dots-row"), dots = el("div", "pg-dots");
    dots.setAttribute("aria-hidden", "true");
    g.deal.rounds.forEach(function (_, i) {
      dots.appendChild(el("i", i < g.marks.length ? (g.marks[i] ? "ok" : "miss") : i === g.index ? "now" : null));
    });
    dotsRow.appendChild(dots);
    var c2 = combo(); if (c2) dotsRow.appendChild(c2);
    wrap.appendChild(dotsRow);
    wrap.appendChild(g.game === "which-note" ? whichNote(r) : hymnRound(r));
    if (g.picked != null) {
      var said = G().verdict(g.game, r, g.picked), v = el("div", "pg-verdict" + (said.right ? " is-right" : ""));
      var mark = el("span", "pg-verdict-mark"); mark.appendChild(sprite(said.right ? "/assets/icons.svg#i-check" : "/assets/icons.svg#i-x")); v.appendChild(mark);
      var t = el("div", "pg-verdict-text"); t.appendChild(el("strong", null, said.title)); t.appendChild(el("span", null, said.line)); v.appendChild(t);
      var nx = button("btn-primary", null, g.index + 1 >= g.deal.rounds.length ? "Finish" : "Next", next); nx.id = "pg-next";
      v.appendChild(nx);
      wrap.appendChild(v);
    }
    return wrap;
  }

  /** Which note?: the play button and the modulator, top doh at the top, doh at the foot in the accent's wash. */
  function whichNote(r) {
    var box = el("div", "pg-ask");
    box.appendChild(el("h2", "pg-q", "Doh, then which note?"));
    box.appendChild(el("p", "pg-sub", "Doh is " + r.doh + " · tap the " + (trackOf() === "playful" ? "step" : "rung") + " you heard"));
    var play = el("button", "pg-play-big"); play.type = "button"; play.setAttribute("aria-label", "Play doh and the note again");
    play.appendChild(sprite("/assets/icons.svg#i-play"));
    play.addEventListener("click", function () { hearRound(r); });
    box.appendChild(play);
    var ladder = el("div", "pg-ladder");
    r.choices.slice().reverse().forEach(function (s) {
      var shown = g.picked != null, isAnswer = s === r.answer;
      var b = el("button", "pg-rung" + (s === "d" ? " is-doh" : "") + (shown && isAnswer ? " is-right" : "") + (shown && s === g.picked && !isAnswer ? " is-wrong" : ""));
      b.type = "button"; b.disabled = shown;
      b.setAttribute("aria-label", G().syllableName(s) + (s === "d'" ? ", top" : ""));
      b.appendChild(el("b", null, s));
      b.appendChild(el("span", null, G().syllableName(s) + (shown && isAnswer ? " ✓" : "")));
      b.addEventListener("click", function () { tap(s); });
      ladder.appendChild(b);
    });
    box.appendChild(ladder);
    return box;
  }

  /** Staff to solfa: the stave, then the syllables; a miss shows the right key for a moment. */
  function staffRound(r) {
    var box = el("div", "pg-staff");
    var card = el("div", "pg-stave-card");
    card.setAttribute("role", "img"); card.setAttribute("aria-label", "Doh is " + r.doh + ". The note is " + r.noteName + ".");
    card.appendChild(el("p", "pg-stave-key", "Doh is " + r.doh));
    var stave = el("div", "pg-stave"); stave.innerHTML = staveSvg(r.noteName, r.fifths || 0);
    card.appendChild(stave);
    box.appendChild(card);
    var keys = el("div", "pg-keys");
    r.choices.forEach(function (s) {
      var b = el("button", "pg-key" + (g.picked != null && s === r.answer ? " is-right" : "") + (g.picked === s && s !== r.answer ? " is-wrong" : ""), s);
      b.type = "button"; b.disabled = g.picked != null; b.setAttribute("aria-label", G().syllableName(s));
      b.addEventListener("click", function () { tap(s); });
      keys.appendChild(b);
    });
    box.appendChild(keys);
    return box;
  }

  /** Name that hymn: replay the opening, three hymns to pick from; the right one shows its opening in solfa. */
  function hymnRound(r) {
    var box = el("div", "pg-ask");
    box.appendChild(el("h2", "pg-q", "Which hymn opens like this?"));
    box.appendChild(el("p", "pg-sub", "Its opening, on the piano"));
    box.appendChild(button("btn-ghost pg-again", "/assets/icons.svg#i-play", "Play it again", function () { hearRound(r); }));
    var list = el("div", "pg-choices");
    (r.hymns || []).forEach(function (h) {
      var shown = g.picked != null, isAnswer = h.slug === r.answer;
      var b = el("button", "pg-choice" + (shown && isAnswer ? " is-right" : "") + (shown && !isAnswer ? " is-dim" : ""));
      b.type = "button"; b.disabled = shown;
      b.appendChild(el("strong", null, h.title + (shown && isAnswer ? " ✓" : "")));
      if (h.firstLine) b.appendChild(el("span", null, h.firstLine));
      if (shown && isAnswer) {
        b.appendChild(el("span", "pg-solfa", openingSolfa(r)));
      }
      b.addEventListener("click", function () { tap(h.slug); });
      list.appendChild(b);
      if (shown && isAnswer) {
        var a = el("a", "pg-hymn-link", "Open the hymn's page"); a.href = "/hymns/" + (h.slug.indexOf("tune-") === 0 ? "tunes/" + h.slug.slice(5) : h.slug);
        list.appendChild(a);
      }
    });
    box.appendChild(list);
    return box;
  }

  /** A hymn's opening in solfa, labelled by the choir page's engine in its key: "s, d m d m r d l,". */
  function openingSolfa(r) {
    if (!r.notes || !r.notes.length || !r.key || !window.NfChoir) return "";
    return window.NfChoir.label(r.notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats }; }), r.key)
      .sort(function (a, b) { return a.startBeat - b.startBeat; })
      .slice(0, 12)
      .map(function (n) { return n.solfa + n.octaveMark; })
      .join(" ");
  }

  function sending() {
    var card = el("section", "pg-card");
    card.appendChild(el("p", "pg-intro", g.sendError ? "Your answers didn't reach us." : "Marking your answers…"));
    if (g.sendError) {
      var e = el("p", "pv-error", g.sendError); e.setAttribute("role", "alert"); card.appendChild(e);
      card.appendChild(button("btn-primary pg-block", "/assets/icons.svg#i-restart", "Send them again", send));
    }
    return card;
  }

  function done() {
    var grade = g.grade, playful = trackOf() === "playful", card = el("section", "pg-card pg-done");
    if (playful && ctx.art && T()) {
      var stars = T().starsFor(grade.score);
      card.appendChild(ctx.art(T().starsArt(stars), 148));
      card.appendChild(el("h2", "pg-done-title", T().starWord(stars)));
      card.appendChild(el("p", "pg-meta", G().resultTitle(grade) + " · " + G().resultLine(grade, g.deal.gamesPerDay)));
    } else {
      card.appendChild(el("p", "pg-score", String(grade.score)));
      card.appendChild(el("h2", "pg-done-title", G().resultTitle(grade)));
      card.appendChild(el("p", "pg-meta", G().resultLine(grade, g.deal.gamesPerDay)));
    }
    var reward = grade.reward && window.NfPracticeProgress && window.NfPracticeProgress.rewardMoment ? window.NfPracticeProgress.rewardMoment(grade.reward) : null;
    if (reward && reward.big) card.appendChild(el("p", "pg-reward", reward.line));
    card.appendChild(button("btn-primary pg-block", "/assets/icons.svg#i-restart", "Play again", function () { track("practice_game_again", "game=" + g.game); load(); }));
    card.appendChild(button("btn-ghost pg-block", null, "Back to Practice", goBack));
    return card;
  }

  // ── The stave ───────────────────────────────────────────────────────────
  /**
   * A treble stave with one note, as SVG markup in currentColor (the phone's components/practice/Stave.tsx): the clef
   * (the "staff" glyph's drawing, its curl on the G line), the key signature where a hymn book prints it, and the note.
   */
  var GAP = 13, HEIGHT = GAP * 10, TOP = GAP * 3, BOTTOM = TOP + GAP * 4, CLEF_SCALE = GAP / 3, CLEF_STROKE = 2.1 / CLEF_SCALE, WIDTH = 320;
  function staveSvg(noteName, fifths) {
    var step = G().staffStep(noteName), y = function (s) { return BOTTOM - (s * GAP) / 2; }, noteX = 200, out = [];
    out.push('<svg viewBox="0 0 ' + WIDTH + " " + HEIGHT + '" width="100%" height="' + HEIGHT + '" aria-hidden="true" focusable="false">');
    for (var i = 0; i < 5; i++) out.push('<line class="pg-line" x1="6" x2="' + (WIDTH - 6) + '" y1="' + (TOP + i * GAP) + '" y2="' + (TOP + i * GAP) + '"/>');
    out.push('<g transform="translate(2 ' + (y(2) - 15 * CLEF_SCALE) + ") scale(" + CLEF_SCALE + ')" fill="none" stroke="currentColor" stroke-width="' + CLEF_STROKE + '" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12.6 21.4c-1.2.9-3 .1-2.7-1.3.2-1 1.6-1.3 2.3-.5"/>' +
      '<path d="M12.4 19.8 10.9 4.9c-.2-1.7 1.5-2.6 2.4-1.2 1 1.7-.6 4.4-3.3 6.8-2.5 2.2-3.1 4.7-1.7 6.5 1.5 1.9 5 1.7 6.2-.4 1.1-1.9-.2-4.2-2.4-4-1.9.2-2.9 2-2 3.4"/></g>');
    G().keySignature(fifths).forEach(function (k, i) { out.push(accidental(k.sign, 70 + i * 11, y(k.step))); });
    if (step != null) {
      var ny = y(step);
      out.push('<ellipse cx="' + noteX + '" cy="' + ny + '" rx="' + GAP * 0.66 + '" ry="' + GAP * 0.47 + '" fill="currentColor" transform="rotate(-20 ' + noteX + " " + ny + ')"/>');
      out.push(step >= 4
        ? '<line x1="' + (noteX - GAP * 0.6) + '" x2="' + (noteX - GAP * 0.6) + '" y1="' + (ny + 2) + '" y2="' + (ny + GAP * 3.4) + '" stroke="currentColor" stroke-width="1.8"/>'
        : '<line x1="' + (noteX + GAP * 0.6) + '" x2="' + (noteX + GAP * 0.6) + '" y1="' + (ny - 2) + '" y2="' + (ny - GAP * 3.4) + '" stroke="currentColor" stroke-width="1.8"/>');
    }
    out.push("</svg>");
    return out.join("");
  }
  function accidental(sign, x, yy) {
    if (sign === "#") {
      return '<g stroke="currentColor"><line x1="' + (x - 2.2) + '" x2="' + (x - 2.2) + '" y1="' + (yy - GAP * 1.05) + '" y2="' + (yy + GAP * 1.15) + '" stroke-width="1.2"/>' +
        '<line x1="' + (x + 2.2) + '" x2="' + (x + 2.2) + '" y1="' + (yy - GAP * 1.15) + '" y2="' + (yy + GAP * 1.05) + '" stroke-width="1.2"/>' +
        '<line x1="' + (x - 4.5) + '" x2="' + (x + 4.5) + '" y1="' + (yy - GAP * 0.25) + '" y2="' + (yy - GAP * 0.55) + '" stroke-width="2.6"/>' +
        '<line x1="' + (x - 4.5) + '" x2="' + (x + 4.5) + '" y1="' + (yy + GAP * 0.55) + '" y2="' + (yy + GAP * 0.25) + '" stroke-width="2.6"/></g>';
    }
    return '<g stroke="currentColor" fill="none"><line x1="' + (x - 3) + '" x2="' + (x - 3) + '" y1="' + (yy - GAP * 1.7) + '" y2="' + (yy + GAP * 0.5) + '" stroke-width="1.3"/>' +
      '<path d="M' + (x - 3) + " " + (yy + GAP * 0.5) + " C " + (x + 5) + " " + (yy - GAP * 0.1) + " " + (x + 5) + " " + (yy - GAP * 0.9) + " " + (x - 3) + " " + (yy - GAP * 0.25) + '" stroke-width="1.8"/></g>';
  }

  // ── The view's way in and out ───────────────────────────────────────────
  function focusTitle() { var h = root && root.querySelector("#pm-title"); if (h) try { h.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ } }
  function goBack() { leave(); if (ctx && ctx.back) ctx.back(); }

  function open(rootEl, context) {
    leave();
    gen++;
    ctx = context; root = rootEl;
    g = fresh(context.game);
    load();
  }
  /** Another view (or back to the hub): the clock stops and the piano falls quiet; nothing is sent. */
  function leave() { clearTimers(); stopSound(); }
  function reset() { gen++; leave(); g = null; root = null; }

  window.NfPracticeGameView = { open: open, leave: leave, reset: reset };
})();
