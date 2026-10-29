/* The arcade on the web: the quick games, opened in the Practice view's place from its Arcade row, played stage after
 * stage with no end (the phone's screens/practice/PracticeGameScreen.tsx plays one-off games). Which note? (hear doh,
 * then a note; tap it), Staff to solfa (Playful's "Note race": a note on the stave, its solfa tapped before the note's
 * time runs out) and Name that hymn (a hymn's opening; its name picked from the choices). Tapped, not sung: no mic.
 *
 * Each stage is the server's deal at a level (GET /api/practice/games/{game}?level=), its rounds carrying their answers
 * so a tap is told at once — right in green with a bright panel, a wrong one grey, never red. A stage's answers go back
 * to be marked (POST /api/practice/games/grade), which records the day's first six that count (XP, the streak) and says
 * the level to deal next: up after a good stage, with the level-up screen; the same, or one down after a poor one, and
 * the next stage straight on. The level is kept in this browser (practice-arcade.js), so the game picks up where it
 * stopped. Leaving mid-stage sends nothing. Words: practice-games.js and practice-arcade.js; sound: the rehearsal piano.
 *
 *   NfPracticeGameView.open(rootEl, { request, track, choir, game, practiceTrack, art, burst, back })
 *   NfPracticeGameView.leave()   — another view or back: stop the clocks and the piano
 */
(function () {
  "use strict";

  /** A wrong tap in Staff to solfa shows the right key this long before the next note. */
  var STAFF_MISS_MS = 650;
  /** The "level 7 again" line shows this long at the top of the next stage. */
  var NOTE_MS = 2600;

  var ctx = null, root = null, gen = 0, g = null, player = null, clock = null, advance = null;

  function fresh(game) {
    return {
      game: game, level: 1, best: 1, deal: null, loading: true, loadError: null, phase: "intro", index: 0, answers: [], marks: [],
      picked: null, roundStarted: 0, stageStarted: 0, grade: null, sendError: null, run: 0, bestRun: 0, note: null, news: null,
      firstStage: true, xp: 0
    };
  }
  function G() { return window.NfPracticeGames; }
  function A() { return window.NfPracticeArcade; }
  function T() { return window.NfPracticeTrack; }
  function trackOf() { return (g.deal && g.deal.track) || ctx.practiceTrack || null; }
  function staff() { return g.game === "staff"; }
  function round() { return g.deal ? g.deal.rounds[g.index] : null; }
  function rounds() { return g.deal ? g.deal.rounds.length : 0; }
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
  /** A chunky button: a bright fill on a darker lip, pressed down when tapped. */
  function chunky(tone, text, onClick, href) {
    var b = el("button", "pg-chunky gg-" + tone); b.type = "button";
    if (href) b.appendChild(sprite(href));
    b.appendChild(document.createTextNode(text));
    b.addEventListener("click", onClick);
    return b;
  }
  function announce(text) { var live = root && root.querySelector("#pg-live"); if (live) live.textContent = text; }

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
    else if (g.game === "hymn" || g.game === "which-scale") playNotes(r.notes, r.tempoBpm || 96);
  }

  // ── The game ────────────────────────────────────────────────────────────
  function clearTimers() {
    if (clock) clearInterval(clock);
    if (advance) clearTimeout(advance);
    clock = null; advance = null;
  }

  /** Deals a stage at the game's level; the first one opens on the intro, the rest go straight on. */
  function loadStage() {
    var my = gen;
    clearTimers(); stopSound();
    g.loading = true; g.loadError = null; g.deal = null; g.index = 0; g.answers = []; g.marks = []; g.picked = null; g.grade = null;
    render();
    return ctx.request("/api/practice/games/" + g.game + "?level=" + g.level).then(function (d) {
      if (my !== gen) return;
      g.deal = d; g.loading = false;
      if (g.firstStage) { g.phase = "intro"; render(); focusTitle(); }
      else begin();
    }, function (err) {
      if (my !== gen) return;
      g.loading = false; g.loadError = (err && err.message) || "That didn't load. Check your connection and try again.";
      render();
    });
  }

  function begin() {
    if (!g.deal) return;
    g.firstStage = false;
    g.phase = "playing"; g.stageStarted = Date.now();
    track("practice_game_stage_started", "game=" + g.game + ";level=" + g.level);
    startRound();
  }

  /** A round starts: its sound, and Staff to solfa's clock for the note. */
  function startRound() {
    clearTimers();
    g.picked = null; g.roundStarted = Date.now();
    var r = round();
    if (staff()) {
      var limit = (g.deal.secondsPerRound || 4) * 1000;
      clock = setInterval(function () {
        var left = 1 - (Date.now() - g.roundStarted) / limit;
        var fill = root && root.querySelector("#pg-note-time");
        if (fill) fill.style.width = Math.max(0, left) * 100 + "%";
        if (left <= 0) { clearTimers(); tap(""); }
      }, 100);
    } else hearRound(r);
    render();
  }

  function tap(choice) {
    var r = round();
    if (!r || g.phase !== "playing" || g.picked != null || g.answers.length > g.index) return;
    if (clock) { clearInterval(clock); clock = null; }
    var right = choice === r.answer;
    g.answers.push(choice); g.marks.push(right);
    g.run = A().runAfter(g.run, right); g.bestRun = Math.max(g.bestRun, g.run);
    g.picked = choice;
    if (staff()) {
      if (right && r.noteMidi != null) playNotes([{ pitchMidi: r.noteMidi, startBeat: 0, durBeats: 0.5 }], 120);
      render();
      advance = setTimeout(next, right ? 260 : STAFF_MISS_MS);
      return;
    }
    // A wrong ear answer hears both again: doh, then the right note.
    if (!right && g.game === "which-note") hearRound(r);
    render();
    var said = G().verdict(g.game, r, choice === "" ? "—" : choice);
    announce(said.title + " " + said.line);
    var go = root.querySelector("#pg-next"); if (go) go.focus();
  }

  function next() {
    if (!g.deal) return;
    if (g.index + 1 >= rounds()) { endStage(); return; }
    g.index++;
    startRound();
  }

  function endStage() {
    if (!g.deal || g.phase === "checking" || g.phase === "levelup") return;
    clearTimers();
    g.phase = "checking"; g.sendError = null; render();
    send();
  }

  function send() {
    var my = gen, seconds = Math.round((Date.now() - g.stageStarted) / 100) / 10, was = g.level;
    g.sendError = null; render();
    ctx.request("/api/practice/games/grade", { method: "POST", body: { dealId: g.deal.dealId, answers: g.answers.slice(), seconds: seconds } }).then(function (grade) {
      if (my !== gen) return;
      g.grade = grade;
      var gained = grade.counted && grade.reward ? grade.reward.xpGained : 0;
      g.xp += gained;
      var nextLevel = grade.nextLevel || was;
      var kept = A().remember(g.game, nextLevel);
      g.best = kept.best;
      track("practice_game_stage", "game=" + g.game + ";level=" + was + ";score=" + grade.score + ";next=" + nextLevel + ";counted=" + (grade.counted ? 1 : 0) + ";xp=" + gained);
      g.level = nextLevel;
      if (nextLevel > was) {
        g.phase = "levelup"; render();
        if (ctx.burst) ctx.burst();
        celebrate(grade);
        announce("Level " + nextLevel + "! " + A().levelNews(g.game, nextLevel));
        var go = root.querySelector("#pg-keep-going"); if (go) go.focus();
        return;
      }
      g.note = nextLevel < was
        ? "Back to level " + nextLevel + ": a little gentler. You'll climb again."
        : "Level " + nextLevel + " again: " + A().stageGoal(rounds()) + " right in a stage moves you up.";
      setTimeout(function () { if (my === gen && g) { g.note = null; render(); } }, NOTE_MS);
      loadStage();
    }, function (err) {
      if (my !== gen) return;
      g.sendError = (err && err.message) || "Your answers didn't reach us. Check your connection and send them again.";
      render();
    });
  }

  /** The level-up's stars moment, when the moments' player is on the page (assets/moments.js). */
  function celebrate(grade) {
    try {
      if (window.NfMoments) window.NfMoments.play({ piece: "stars", values: { stars: grade.score >= 90 ? 3 : 2 } });
    } catch (e) { /* the screen says it on its own */ }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function render() {
    if (!root || !g) return;
    root.innerHTML = "";
    var box = el("div", "pm pg" + (trackOf() === "playful" ? " is-playful" : ""));
    var live = el("p", "sr-only"); live.id = "pg-live"; live.setAttribute("aria-live", "polite");
    if (g.phase === "levelup") { box.appendChild(levelUp()); box.appendChild(live); root.appendChild(box); return; }
    box.appendChild(header());
    box.appendChild(live);
    if (g.note) { var n = el("p", "pg-note", g.note); n.setAttribute("role", "status"); box.appendChild(n); }

    if (g.loading && !g.deal) {
      var sk = el("div", "pv-skel"); for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel")); box.appendChild(sk);
    } else if (!g.deal) {
      var failed = el("div", "pg-card");
      failed.appendChild(el("p", null, g.loadError));
      failed.appendChild(chunky("blue", "Try again", function () { loadStage(); }, "/assets/icons.svg#i-restart"));
      box.appendChild(failed);
    } else if (g.phase === "intro") box.appendChild(intro());
    else if (g.phase === "playing") box.appendChild(playing());
    else if (g.phase === "checking") box.appendChild(checking());
    root.appendChild(box);
  }

  /** The top: leave, the stage's bar toward the next level, the run's flame; under it the level and what it brought. */
  function header() {
    var top = el("div", "pg-top");
    var row = el("div", "pg-top-row");
    var back = el("button", "pg-close"); back.type = "button"; back.setAttribute("aria-label", "Leave the game (your level is kept)");
    back.appendChild(sprite("/assets/icons.svg#i-x"));
    back.addEventListener("click", goBack);
    row.appendChild(back);
    var bar = el("div", "pg-stagebar"), fill = el("i");
    fill.style.width = Math.round(A().stageFraction(g.marks, rounds() || 1) * 100) + "%";
    bar.appendChild(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Toward level " + (g.level + 1));
    bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(A().stageFraction(g.marks, rounds() || 1) * 100)));
    row.appendChild(bar);
    var flame = el("span", "pg-run" + (g.run >= 2 ? " is-hot" : ""));
    flame.setAttribute("aria-label", g.run + " right in a row");
    flame.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3-1-3 0-6 1-9z" fill="currentColor"/></svg>';
    flame.appendChild(el("b", null, "×" + g.run));
    row.appendChild(flame);
    top.appendChild(row);

    var meta = el("div", "pg-level-row");
    var lvl = el("span", "pg-level gg-blue", "LEVEL " + g.level); lvl.id = "pm-title"; lvl.setAttribute("tabindex", "-1");
    meta.appendChild(lvl);
    meta.appendChild(el("span", "pg-news", A().levelNews(g.game, g.level)));
    if (g.deal && g.phase === "playing") {
      var left = A().toLevelUp(g.marks, rounds());
      meta.appendChild(el("span", "pg-left", left > 0 ? left + " more to level " + (g.level + 1) : "Level " + (g.level + 1) + " next!"));
    }
    top.appendChild(meta);
    return top;
  }

  function intro() {
    var d = g.deal, card = el("section", "pg-card pg-intro-card");
    card.appendChild(el("p", "pg-eyebrow", "ARCADE · NEVER ENDS"));
    card.appendChild(el("h1", "pg-intro-title", G().gameTitle(g.game, trackOf())));
    card.appendChild(el("p", "pg-intro", G().gameIntro(g.game, trackOf()).replace(/, as many as you can in (a minute|60 seconds)\./, ", before its time runs out.")));
    var facts = el("ul", "pg-facts");
    facts.appendChild(el("li", null, "Level " + g.level + (g.best > g.level ? " · your best is " + g.best : "")));
    facts.appendChild(el("li", null, A().stageGoal(rounds()) + " of " + rounds() + " right moves you up a level"));
    facts.appendChild(el("li", null, d.gamesToday >= d.gamesPerDay
      ? "Today's " + d.gamesPerDay + " stages that earn XP are done: the rest are for fun"
      : (d.gamesPerDay - d.gamesToday) + " of today's " + d.gamesPerDay + " stages earn XP"));
    card.appendChild(facts);
    var go = chunky("green", trackOf() === "playful" ? "LET'S PLAY!" : "START", begin);
    go.id = "pg-start"; go.classList.add("pg-wide");
    card.appendChild(go);
    return card;
  }

  function playing() {
    var r = round(), wrap = el("div", "pg-play");
    if (staff()) wrap.appendChild(staffRound(r));
    else wrap.appendChild(g.game === "which-note" ? whichNote(r) : g.game === "which-scale" ? scaleRound(r) : hymnRound(r));
    if (g.picked != null && !staff()) wrap.appendChild(feedback(r));
    return wrap;
  }

  /** The panel under a round once it is answered: green and bright when right, grey when not, and CONTINUE. */
  function feedback(r) {
    var said = G().verdict(g.game, r, g.picked === "" ? "—" : g.picked), right = said.right;
    var panel = el("div", "pg-panel" + (right ? " is-right" : ""));
    var head = el("div", "pg-panel-head");
    var mark = el("span", "pg-panel-mark"); mark.appendChild(sprite(right ? "/assets/icons.svg#i-check" : "/assets/icons.svg#i-x"));
    head.appendChild(mark);
    var text = el("div", "pg-panel-text");
    text.appendChild(el("strong", null, right ? (g.run >= 3 ? said.title + " " + g.run + " in a row!" : said.title) : said.title));
    if (said.line) text.appendChild(el("span", null, said.line));
    head.appendChild(text);
    panel.appendChild(head);
    var last = g.index + 1 >= rounds();
    var go = chunky(right ? "green" : "blue", last ? "FINISH STAGE" : "CONTINUE", next);
    go.id = "pg-next"; go.classList.add("pg-wide");
    panel.appendChild(go);
    return panel;
  }

  /** Which note?: the play buttons, then the notes: a ladder up to eight, a grid of chunky tiles past that. */
  function whichNote(r) {
    var box = el("div", "pg-ask");
    box.appendChild(el("h2", "pg-q", "Which note did you hear?"));
    box.appendChild(el("p", "pg-sub", "Doh is " + r.doh + ". Doh plays first, then the note."));
    var plays = el("div", "pg-plays");
    var play = el("button", "pg-play-big"); play.type = "button"; play.setAttribute("aria-label", "Play doh and the note again");
    play.appendChild(sprite("/assets/icons.svg#i-volume"));
    play.addEventListener("click", function () { hearRound(r); });
    plays.appendChild(play);
    box.appendChild(plays);
    var many = r.choices.length > 8, ladder = el("div", many ? "pg-grid" : "pg-ladder");
    r.choices.slice().reverse().forEach(function (s) {
      var shown = g.picked != null, isAnswer = s === r.answer;
      var b = el("button", "pg-tile" + (s === "d" ? " is-doh" : "") + (shown && isAnswer ? " is-right" : "") + (shown && s === g.picked && !isAnswer ? " is-wrong" : ""));
      b.type = "button"; b.disabled = shown;
      b.setAttribute("aria-label", G().syllableName(s));
      b.appendChild(el("b", null, s));
      if (!many) b.appendChild(el("span", null, G().syllableName(s)));
      b.addEventListener("click", function () { tap(s); });
      ladder.appendChild(b);
    });
    box.appendChild(ladder);
    return box;
  }

  /** Staff to solfa: the note's clock, the stave, then the syllables; a miss shows the right key for a moment. */
  function staffRound(r) {
    var box = el("div", "pg-staff");
    var time = el("div", "pg-notetime"), fill = el("i"); fill.id = "pg-note-time";
    var left = g.picked != null ? 0 : 1 - (Date.now() - g.roundStarted) / ((g.deal.secondsPerRound || 4) * 1000);
    fill.style.width = Math.max(0, Math.min(1, left)) * 100 + "%";
    time.appendChild(fill); time.setAttribute("aria-hidden", "true");
    box.appendChild(time);
    var card = el("div", "pg-stave-card");
    card.setAttribute("role", "img"); card.setAttribute("aria-label", "Doh is " + r.doh + ". The note is " + r.noteName + ".");
    card.appendChild(el("p", "pg-stave-key", "Doh is " + r.doh));
    var stave = el("div", "pg-stave"); stave.innerHTML = staveSvg(r.noteName, r.fifths || 0);
    card.appendChild(stave);
    box.appendChild(card);
    var keys = el("div", "pg-keys");
    r.choices.forEach(function (s) {
      var b = el("button", "pg-tile pg-key" + (g.picked != null && s === r.answer ? " is-right" : "") + (g.picked === s && s !== r.answer ? " is-wrong" : ""));
      b.appendChild(el("b", null, s));
      b.type = "button"; b.disabled = g.picked != null; b.setAttribute("aria-label", G().syllableName(s));
      b.addEventListener("click", function () { tap(s); });
      keys.appendChild(b);
    });
    box.appendChild(keys);
    return box;
  }

  /** Name that hymn: replay the opening, the hymns to pick from; the right one shows its opening in solfa. */
  function hymnRound(r) {
    var box = el("div", "pg-ask");
    box.appendChild(el("h2", "pg-q", "Which hymn opens like this?"));
    box.appendChild(el("p", "pg-sub", "Its opening, on the piano"));
    var plays = el("div", "pg-plays");
    var play = el("button", "pg-play-big"); play.type = "button"; play.setAttribute("aria-label", "Play the opening again");
    play.appendChild(sprite("/assets/icons.svg#i-volume"));
    play.addEventListener("click", function () { hearRound(r); });
    plays.appendChild(play);
    box.appendChild(plays);
    var list = el("div", "pg-choices");
    (r.hymns || []).forEach(function (h) {
      var shown = g.picked != null, isAnswer = h.slug === r.answer;
      var b = el("button", "pg-tile pg-choice" + (shown && isAnswer ? " is-right" : "") + (shown && h.slug === g.picked && !isAnswer ? " is-wrong" : "") + (shown && !isAnswer && h.slug !== g.picked ? " is-dim" : ""));
      b.type = "button"; b.disabled = shown;
      b.appendChild(el("strong", null, h.title));
      if (h.firstLine) b.appendChild(el("span", null, h.firstLine));
      if (shown && isAnswer) b.appendChild(el("span", "pg-solfa", openingSolfa(r)));
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

  /** Which scale?: replay the scale, the scales to pick from; the right one shows its solfa up and back down. */
  function scaleRound(r) {
    var box = el("div", "pg-ask");
    box.appendChild(el("h2", "pg-q", "Which scale is this?"));
    box.appendChild(el("p", "pg-sub", "Up and back down, on the piano"));
    var plays = el("div", "pg-plays");
    var play = el("button", "pg-play-big"); play.type = "button"; play.setAttribute("aria-label", "Play the scale again");
    play.appendChild(sprite("/assets/icons.svg#i-volume"));
    play.addEventListener("click", function () { hearRound(r); });
    plays.appendChild(play);
    box.appendChild(plays);
    var list = el("div", "pg-choices");
    (r.scales || []).forEach(function (sc) {
      var shown = g.picked != null, isAnswer = sc.code === r.answer;
      var b = el("button", "pg-tile pg-choice" + (shown && isAnswer ? " is-right" : "") + (shown && sc.code === g.picked && !isAnswer ? " is-wrong" : "") + (shown && !isAnswer && sc.code !== g.picked ? " is-dim" : ""));
      b.type = "button"; b.disabled = shown;
      b.appendChild(el("strong", null, sc.title));
      if (shown && isAnswer) b.appendChild(el("span", "pg-solfa", sc.solfa));
      b.addEventListener("click", function () { tap(sc.code); });
      list.appendChild(b);
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

  function checking() {
    var card = el("section", "pg-card pg-checking");
    if (g.sendError) {
      card.appendChild(el("p", "pg-intro", "Your answers didn't reach us."));
      var e = el("p", "pv-error", g.sendError); e.setAttribute("role", "alert"); card.appendChild(e);
      var again = chunky("blue", "SEND THEM AGAIN", send, "/assets/icons.svg#i-restart"); again.classList.add("pg-wide");
      card.appendChild(again);
    } else {
      var right = g.marks.filter(Boolean).length;
      card.appendChild(el("p", "pg-check-count", right + " of " + rounds() + " right"));
      card.appendChild(el("p", "pg-meta", "Checking your stage…"));
    }
    return card;
  }

  /** The level-up screen: Doh cheering, the new level, the stage's numbers, what's coming, and on. */
  function levelUp() {
    var grade = g.grade, wrap = el("section", "pg-levelup");
    wrap.setAttribute("aria-labelledby", "pg-levelup-title");
    var hero = el("div", "pg-levelup-hero");
    if (ctx.art) hero.appendChild(ctx.art("doh-cheer", 150));
    wrap.appendChild(hero);
    wrap.appendChild(el("p", "pg-eyebrow", G().gameTitle(g.game, trackOf()).toUpperCase() + " · LEVEL UP"));
    var h = el("h1", "pg-levelup-title", "Level " + g.level + "!"); h.id = "pg-levelup-title";
    wrap.appendChild(h);
    wrap.appendChild(el("p", "pg-levelup-news", A().levelNews(g.game, g.level)));
    var stats = el("div", "pg-stats");
    [["RIGHT", grade.score + "%", "green"], ["BEST RUN", "×" + g.bestRun, "orange"], ["XP", "+" + (grade.counted && grade.reward ? grade.reward.xpGained : 0), "cyan"]].forEach(function (s) {
      var c = el("div", "pg-stat gg-" + s[2]);
      c.appendChild(el("span", "pg-stat-head", s[0]));
      c.appendChild(el("b", null, s[1]));
      stats.appendChild(c);
    });
    wrap.appendChild(stats);
    var coming = el("div", "pg-coming");
    coming.appendChild(el("p", "pg-coming-head", "WHAT'S COMING"));
    A().comingNext(g.game, g.level).forEach(function (c) {
      var row = el("div", "pg-coming-row");
      row.appendChild(el("span", "pg-coming-num" + (c.level === g.level + 1 ? " is-next" : ""), c.level == null ? "∞" : String(c.level)));
      row.appendChild(el("span", null, c.text));
      coming.appendChild(row);
    });
    wrap.appendChild(coming);
    var go = chunky("blue", "KEEP GOING", function () { g.phase = "playing"; loadStage(); });
    go.id = "pg-keep-going"; go.classList.add("pg-wide");
    wrap.appendChild(go);
    var rest = el("button", "pg-rest", "Take a break (your level is kept)"); rest.type = "button";
    rest.addEventListener("click", goBack);
    wrap.appendChild(rest);
    return wrap;
  }

  // ── The stave ───────────────────────────────────────────────────────────
  /**
   * A treble stave with one note, as SVG markup in currentColor (the phone's components/practice/Stave.tsx): the clef
   * (the "staff" glyph's drawing, its curl on the G line), the key signature where a hymn book prints it, the note, and
   * the ledger lines a note above or below the stave sits on (the arcade's higher levels reach low C and top C).
   */
  var GAP = 13, HEIGHT = GAP * 12, TOP = GAP * 4, BOTTOM = TOP + GAP * 4, CLEF_SCALE = GAP / 3, CLEF_STROKE = 2.1 / CLEF_SCALE, WIDTH = 320;
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
      // Ledger lines: every line step between the stave and the note (below: −2, −4…; above: 10, 12…).
      for (var l = -2; l >= step; l -= 2) out.push('<line class="pg-line" x1="' + (noteX - GAP * 1.2) + '" x2="' + (noteX + GAP * 1.2) + '" y1="' + y(l) + '" y2="' + y(l) + '"/>');
      for (var u = 10; u <= step; u += 2) out.push('<line class="pg-line" x1="' + (noteX - GAP * 1.2) + '" x2="' + (noteX + GAP * 1.2) + '" y1="' + y(u) + '" y2="' + y(u) + '"/>');
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
    // The chat button steps aside on a phone while a game is on screen: it sat over CONTINUE.
    document.body.classList.add("nf-in-game");
    g = fresh(context.game);
    var kept = A().recall(g.game, context.practiceTrack || null);
    g.level = kept.level; g.best = kept.best;
    loadStage();
  }
  /** Another view (or back to the hub): the clocks stop and the piano falls quiet; nothing is sent, the level is kept. */
  function leave() { clearTimers(); stopSound(); document.body.classList.remove("nf-in-game"); }
  function reset() { gen++; leave(); g = null; root = null; }

  window.NfPracticeGameView = { open: open, leave: leave, reset: reset };
})();
