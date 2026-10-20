/* A season's practice path on the web, as the phone has it (mobile/src/screens/practice/SeasonPathScreen.tsx), opened
 * from the Practice hub's season card while that season is on for the singer:
 *
 * - Christmas, the carols (board d-christmas/03; GET /api/practice/carols): a Gloria warm-up, Joy to the World all the
 *   way down, Silent Night in thirds (the piano keeps the tune in headphones) and sung along with its words, Hark! the
 *   Herald's leap and the First Noel's climb. All six earn the Carol singer sticker: snowflakes and quavers, and the
 *   first line of Joy to the World.
 * - Halloween, the Midnight path (board j-halloween/03; GET /api/practice/seasons/halloween): the Mountain King's
 *   tiptoe and climb, Bach's organ turn, the skeletons' waltz, the Marionette's fall and All Saints to finish. All
 *   six earn the Night Singer sticker: bats and quavers, and the Mountain King's first phrase (from the hymn pack,
 *   /hymns/pack.json, fetched only near the end of the path; else his opening seven notes).
 *
 * A side-path with its own place: each drill is heard, counted in, sung and marked by POST /api/practice/drills/grade
 * like any drill (XP, the day's allowance and the streak as ever) and never moves the main path. The next unsung drill
 * is open; any other can be chosen and sung again. The sticker's burst is none for reduced motion, and its tune plays on
 * the piano only after the tap that sang it, and only with the app's sounds on. Playful has Doh, in the season's
 * costume, over the path (at Halloween with Boo beside him); Focused has the longer takes and neither.
 *
 * The words and arithmetic are practice-progress.js's (seasonView, seasonBuddyLine, kingPhrase…) and
 * practice-modes.js's (what plays under a take); practice-view.js lends its drawing (the art, the marks, the toast,
 * the burst). Loaded the first time a path is opened, with practice-carols.css:
 *
 *   NfPracticeCarols.open(rootEl, { season, request, track, choir, practiceTrack, art, dohArt, icon, modeIcon,
 *                                    starGrade, gradeMarks, toast, burst, back })   — season: "christmas" or "halloween"
 *   NfPracticeCarols.leave()   — another view or back to the hub: stop sound and mic
 *   NfPracticeCarols.reset()   — signed out
 */
(function () {
  "use strict";

  var PIANO_WAIT_MS = 8000;
  /** The sticker waits this long at most for the Mountain King's phrase from the hymn pack, then plays his opening. */
  var KING_WAIT_MS = 2500;
  var PACK_URL = "/hymns/pack.json";
  var SOUNDS_KEY = "nf.web.sounds";
  var ctx = null, root = null, gen = 0, season = "christmas", moment = 0;
  var c = fresh();
  var take = null, hear = null, hearing = false, chime = null, sheetEl = null, kingLoad = null;

  function fresh() {
    return { path: null, loading: false, loadError: null, chosen: null, grade: null, gradeFor: null, phase: "idle", error: null, headphones: false };
  }
  function P() { return window.NfPracticeProgress; }
  function W() { return P().seasonWords(season); }
  function halloween() { return season === "halloween"; }
  function T() { return window.NfPracticeTrack; }
  function M() { return window.NfPracticeModes; }
  function playful() { var d = c.path && c.path.drills[0]; return ((d && d.drill.track) || (ctx && ctx.practiceTrack)) === "playful"; }
  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function soundsOn() { try { return localStorage.getItem(SOUNDS_KEY) !== "off"; } catch (e) { return true; } }
  function track(name, detail) { try { if (ctx && ctx.track) ctx.track(name, detail); } catch (e) { /* never in the way */ } }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, href, text, onClick) {
    var b = el("button", "btn " + cls); b.type = "button";
    if (href) b.appendChild(ctx.icon(href));
    b.appendChild(document.createTextNode(text));
    b.addEventListener("click", onClick);
    return b;
  }
  function written(n) { return (n.solfa || "") + (n.octaveMark || ""); }

  // ── Loading ─────────────────────────────────────────────────────────────
  function load(quiet) {
    var g = gen;
    if (!quiet) { c.loading = true; render(); }
    return ctx.request(P().seasonPathUrl(season)).then(function (p) {
      if (g !== gen) return;
      c.path = p; c.loadError = null;
      // One drill from the Night Singer: the Mountain King's phrase is fetched now, so it is ready when it is earned.
      if (halloween() && p && p.season && p.season.next && p.season.total - p.season.sung <= 1) loadKing();
    }, function (err) {
      if (g !== gen || quiet) return;
      c.loadError = err && err.code === "PRACTICE_SEASON_OFF" ? W().away : (err && err.message) || W().failed;
    }).then(function () {
      if (g !== gen) return;
      c.loading = false;
      if (c.phase === "idle") render();
    });
  }

  function drillFor(index) { return c.path ? c.path.drills.filter(function (d) { return d.step.index === index; })[0] || null : null; }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function render() {
    if (!root) return;
    root.innerHTML = "";
    var box = el("div", "pc" + (playful() ? " is-playful" : "") + (halloween() ? " is-halloween" : ""));
    var view = c.path ? P().seasonView(c.path.season, c.chosen) : null;
    box.appendChild(header(view ? view.eyebrow : W().name));
    if (!c.path) {
      if (c.loadError) {
        var failed = el("div", "card pc-failed");
        failed.appendChild(el("p", null, c.loadError));
        failed.appendChild(button("btn-ghost", "/assets/icons.svg#i-restart", "Try again", function () { c.loadError = null; load(); }));
        box.appendChild(failed);
      } else {
        var sk = el("div", "pv-skel");
        for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel"));
        box.appendChild(sk);
      }
      root.appendChild(box);
      return;
    }
    var card = c.path.season;
    if (playful()) {
      var bud = el("div", "pv-buddy pc-buddy"), line = P().seasonBuddyLine(card);
      bud.setAttribute("role", "note"); bud.setAttribute("aria-label", "Doh says: " + line);
      var singing = c.phase === "leadin" || c.phase === "singing";
      var pose = singing ? "doh-sing" : view.allSung ? "doh-cheer" : "doh-wave";
      if (halloween()) {
        // Boo, Halloween's friendly ghost, floats beside Doh (never alone: board j-halloween/03).
        var pair = el("span", "pc-pair");
        pair.appendChild(ctx.dohArt(pose, 72, "pv-buddy-doh"));
        pair.appendChild(ctx.art(singing ? "boo-sing" : "boo", 34, 34, "pc-boo"));
        bud.appendChild(pair);
      } else bud.appendChild(ctx.dohArt(pose, 72, "pv-buddy-doh"));
      var bubble = el("p", "pv-buddy-bubble", line); bubble.setAttribute("aria-hidden", "true");
      bud.appendChild(bubble);
      box.appendChild(bud);
    }
    var list = el("ol", "pc-list");
    view.rows.forEach(function (row) {
      var d = drillFor(row.index), li = el("li", "pc-item is-" + row.state);
      if (row.state === "open" && d) li.appendChild(openCard(d, row));
      else li.appendChild(rowButton(row));
      list.appendChild(li);
    });
    box.appendChild(list);
    var earned = card.next == null, reward = el("div", "pc-reward" + (earned ? " is-earned" : ""));
    reward.appendChild(ctx.art(T().badgeArt(card.badgeCode, earned), 52, 54));
    var rt = el("p");
    rt.appendChild(el("strong", null, W().sticker + " sticker"));
    rt.appendChild(document.createTextNode(earned ? ": yours to keep, after " + W().name + " too." : " for all six. It stays in your book after " + W().name + "."));
    reward.appendChild(rt);
    box.appendChild(reward);
    root.appendChild(box);
  }

  function header(eyebrow) {
    var bar = el("div", "pm-top pc-top");
    var back = el("button", "pm-back"); back.type = "button"; back.setAttribute("aria-label", "Back to Practice");
    back.appendChild(ctx.icon("/assets/icons.svg#i-back"));
    back.addEventListener("click", function () { leave(); ctx.back(); });
    var text = el("div", "pm-top-text");
    text.appendChild(el("p", "pm-eyebrow", eyebrow));
    // The page's heading while the path is open, as a mode's title is (the Practice view's own h1 steps aside).
    var h = el("h1", "pm-title", W().pathTitle); h.id = "pc-title"; h.setAttribute("tabindex", "-1");
    text.appendChild(h);
    bar.appendChild(back); bar.appendChild(text);
    return bar;
  }

  /** A drill not open: its number (a tick once sung), title, carol, and its best mark (stars on Playful). */
  function rowButton(row) {
    var b = el("button", "pc-row"); b.type = "button";
    b.setAttribute("aria-label", row.title + ", " + row.line + (row.state === "done" ? ", sung" : ""));
    var dot = el("span", "pc-dot" + (row.state === "done" ? " is-done" : ""));
    if (row.state === "done") dot.appendChild(ctx.icon("/assets/icons.svg#i-check")); else dot.textContent = String(row.index);
    b.appendChild(dot);
    var t = el("span", "pc-row-text");
    t.appendChild(el("strong", null, row.title));
    t.appendChild(el("span", null, row.line));
    b.appendChild(t);
    if (row.state === "done" && row.bestScore != null) {
      if (playful()) {
        var n = T().starsFor(row.bestScore), st = el("span", "pc-stars", "★★★".slice(0, n));
        st.appendChild(el("i", null, "☆☆☆".slice(0, 3 - n)));
        b.appendChild(st);
      } else b.appendChild(el("span", "pc-best", String(row.bestScore)));
    }
    b.addEventListener("click", function () { choose(row.index); });
    return b;
  }

  function choose(index) {
    if (c.phase !== "idle") return;
    stopHear();
    c.chosen = index; c.grade = null; c.gradeFor = null; c.error = null;
    render();
  }

  /** The drill open for singing: its notes (the piano's tune over a part, a sing-along's words), Listen and Sing it. */
  function openCard(d, row) {
    var drill = d.drill, card = el("section", "card pc-open");
    card.setAttribute("aria-labelledby", "pc-open-title");
    var head = el("div", "pc-open-head");
    head.appendChild(el("span", "pc-dot is-open", String(d.step.index)));
    var ht = el("div", "pc-row-text");
    var h = el("h3", "pc-open-title", d.step.title); h.id = "pc-open-title";
    ht.appendChild(h);
    ht.appendChild(el("span", null, d.backing ? d.step.carol + " · " + drill.dohHeader + " · " + drill.notes.length + " notes" : row.line));
    head.appendChild(ht);
    card.appendChild(head);

    if (d.words && d.words.length) {
      var words = el("p", "pc-words");
      d.words.forEach(function (w, i) { if (i) words.appendChild(el("br")); words.appendChild(document.createTextNode(w)); });
      card.appendChild(words);
    }
    if (d.backing) {
      var lane = el("div", "pc-lane");
      lane.appendChild(el("span", "pc-lane-label", halloween() ? "Piano plays" : "Piano tune"));
      var tune = el("ol", "pc-chips is-tune"); tune.setAttribute("aria-label", "The piano plays: " + d.backing.map(written).join(" "));
      d.backing.forEach(function (n) { var li = el("li", null, written(n)); li.setAttribute("aria-hidden", "true"); tune.appendChild(li); });
      lane.appendChild(tune);
      card.appendChild(lane);
    }
    var sung = el("div", d.backing ? "pc-lane" : "pc-sung");
    if (d.backing) sung.appendChild(el("span", "pc-lane-label", halloween() ? "You sing" : "You, alto"));
    var chips = el("ol", "pc-chips" + (d.syllables && d.syllables.length ? " has-words" : ""));
    chips.id = "pc-chips";
    chips.setAttribute("aria-label", "Sing: " + drill.notes.map(written).join(" "));
    drill.notes.forEach(function (n, i) {
      var li = el("li"); li.setAttribute("aria-hidden", "true");
      li.appendChild(el("b", null, written(n)));
      if (d.syllables && d.syllables.length) li.appendChild(el("small", null, d.syllables[i] || " "));
      chips.appendChild(li);
    });
    sung.appendChild(chips);
    card.appendChild(sung);

    if (d.backing) {
      var phones = el("label", "pc-phones");
      phones.appendChild(ctx.modeIcon("headphones", "pc-phones-ic"));
      var pt = el("span", "pc-phones-text");
      pt.appendChild(el("strong", null, "Headphones help"));
      pt.appendChild(el("span", null, c.headphones ? "The piano keeps the tune for you while you sing." : "With them on, the piano keeps the tune for you."));
      phones.appendChild(pt);
      var sw = el("input", "pm-switch"); sw.type = "checkbox"; sw.checked = c.headphones; sw.disabled = c.phase !== "idle";
      sw.setAttribute("aria-label", "I'm wearing headphones");
      sw.addEventListener("change", function () { c.headphones = sw.checked; render(); });
      phones.appendChild(sw);
      card.appendChild(phones);
    }

    var allowance = drill.allowance, left = P().drillsLeft(allowance);
    var live = el("div", "pv-live"); live.setAttribute("aria-live", "polite");
    var actions = el("div", "pv-actions");
    if (c.phase === "starting") {
      live.appendChild(document.createTextNode("Getting ready…"));
      actions.appendChild(button("btn-ghost pv-wide", "/assets/icons.svg#i-x", "Cancel", cancelTake));
    } else if (c.phase === "leadin" || c.phase === "singing") {
      live.appendChild(el("span", "pv-dot"));
      live.appendChild(el("span", "pv-live-text", liveText()));
      actions.appendChild(button("btn-ghost pv-wide", "/assets/icons.svg#i-stop", c.phase === "leadin" ? "Cancel" : "Stop and mark it", function () {
        if (c.phase === "leadin") cancelTake(); else finishTake();
      }));
    } else if (c.phase === "grading") {
      live.appendChild(document.createTextNode("Marking your take…"));
      var wait = button("btn-primary pv-wide", "/assets/icons.svg#i-clock", "Marking your take…", function () {}); wait.disabled = true;
      actions.appendChild(wait);
    } else {
      live.hidden = true;
      var next = c.path.season.next, passed = c.grade && c.gradeFor === d.step.index && c.grade.score >= M().PASS_SCORE;
      if (passed && next && next.index !== d.step.index) {
        var again = button("btn-ghost", "/assets/icons.svg#i-mic", playful() ? "Again!" : "Sing it again", function () { sing(d); });
        if (left === 0) again.disabled = true;
        actions.appendChild(again);
        var on = button("btn-primary", "/assets/icons.svg#i-arrow-right", W().nextLabel, function () { choose(next.index); });
        on.id = "pc-next";
        actions.appendChild(on);
      } else {
        var hb = button("btn-ghost", hearing ? "/assets/icons.svg#i-stop" : "/assets/icons.svg#i-volume", hearing ? "Stop" : "Listen", function () { toggleHear(d); });
        hb.id = "pc-hear";
        var sb = button("btn-primary", "/assets/icons.svg#i-mic", playful() ? "Sing it!" : "Sing it", function () { sing(d); });
        sb.id = "pc-sing";
        if (left === 0) sb.disabled = true;
        actions.appendChild(hb); actions.appendChild(sb);
      }
    }
    card.appendChild(live);
    card.appendChild(actions);
    var al = P().allowanceLine(allowance);
    if (al) card.appendChild(el("p", "pv-allow", al));
    if (c.error) { var err = el("p", "pv-error", c.error); err.setAttribute("role", "alert"); card.appendChild(err); }
    if (c.grade && c.gradeFor === d.step.index && c.phase === "idle") {
      card.appendChild(playful() ? ctx.starGrade(c.grade, drill.notes, T()) : ctx.gradeMarks(c.grade, drill.notes, P()));
    }
    return card;
  }

  function highlight(i) {
    if (!root) return;
    var chips = root.querySelectorAll("#pc-chips li");
    for (var k = 0; k < chips.length; k++) chips[k].classList.toggle("on", k === i);
  }

  // ── Listen: the part on the rehearsal piano, the tune soft under it ───
  function toggleHear(d) {
    if (c.phase !== "idle") return;
    if (!hear) {
      hear = ctx.choir.createPlayer();
      hear.onTick(function (t) {
        var i = -1, open = drillFor(c.chosen != null ? c.chosen : c.path && c.path.season.next ? c.path.season.next.index : 0);
        if (t.playing && open) open.drill.notes.forEach(function (n, k) { if (t.beat >= n.startBeat && t.beat < n.startBeat + n.durBeats) i = k; });
        highlight(i);
        if (hearing !== t.playing) { hearing = t.playing; if (c.phase === "idle") render(); }
      });
    }
    if (hearing) { hear.stop(); return; }
    var voices = [{ name: "part", notes: d.drill.notes, gain: 1 }];
    if (d.backing) voices.push({ name: "tune", notes: d.backing, gain: M().TUNE_LEVEL });
    hear.load({ voices: voices, tempoBpm: d.drill.tempoBpm, timeSignature: d.drill.timeSignature });
    hear.play();
    track(W().heard, d.drill.id);
  }
  function stopHear() { if (hear) hear.stop(); highlight(-1); }

  // ── Sing it: the count-in, the tune in the ears only with headphones, marked by the server ───
  function liveText() {
    if (!take || take.t0 == null) return "";
    var t = Math.max(0, take.audio.currentTime - take.t0);
    if (t < take.lead) return "Starting note… sing in " + Math.max(1, Math.ceil(take.lead - t));
    return playful() ? "Sing!" : "Singing…";
  }

  function click(audio, at, accent) {
    var osc = audio.createOscillator(), g = audio.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(g); g.connect(audio.destination); osc.start(at); osc.stop(at + 0.06);
  }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /** The count-in's clicks (the bar's accent where the carol's own falls, after any pickup), the pitch pipe, the tune. */
  function schedule(audio, d, plan, t0, pianoReady) {
    var C = ctx.choir, out = pianoReady ? C.createPianoOutput(audio) : null, pickup = d.pickupBeats || 0;
    for (var i = 0; i < plan.beats; i++) {
      var beat = i - plan.beats; // beats before beat one
      click(audio, t0 + i * plan.beatSec, ((((beat - pickup) % plan.beatsPerBar) + plan.beatsPerBar) % plan.beatsPerBar) === 0);
    }
    var one = t0 + plan.seconds;
    var ex = { mode: d.backing ? "harmony" : "intervals", notes: d.drill.notes, backing: d.backing || [], claps: [] };
    M().takeSound(ex, plan, c.headphones).voices.forEach(function (v) {
      v.notes.forEach(function (n) {
        var when = one + n.startBeat * plan.beatSec, dur = n.durBeats * plan.beatSec;
        if (out) C.pianoNote(audio, out, n.pitchMidi, dur, when, v.gain);
        else {
          var osc = audio.createOscillator(), gn = audio.createGain();
          osc.frequency.value = hz(n.pitchMidi);
          gn.gain.setValueAtTime(0, when); gn.gain.linearRampToValueAtTime(0.25 * v.gain, when + 0.02);
          gn.gain.setValueAtTime(0.25 * v.gain, when + dur - 0.05); gn.gain.linearRampToValueAtTime(0, when + dur);
          osc.connect(gn); gn.connect(audio.destination); osc.start(when); osc.stop(when + dur + 0.05);
        }
      });
    });
  }

  function sing(d) {
    if (c.phase !== "idle" || take) return;
    if (P().drillsLeft(d.drill.allowance) === 0) return;
    stopHear();
    c.error = null; c.grade = null; c.gradeFor = null; c.chosen = d.step.index;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { c.error = P().micError({ name: "Unsupported" }); render(); return; }
    var g = gen, AC = window.AudioContext || window.webkitAudioContext, audio = new AC();
    var plan = window.NfPractice.leadInPlan(d.drill.tempoBpm, d.drill.timeSignature);
    var mine = take = { audio: audio, cancelled: false, lead: plan.seconds, d: d };
    c.phase = "starting"; render();
    var piano = Promise.race([
      ctx.choir.loadPiano(audio).then(function () { return true; }, function () { return false; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(false); }, PIANO_WAIT_MS); })
    ]);
    var mic = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    Promise.all([mic, piano]).then(function (got) {
      var stream = got[0];
      if (g !== gen || mine.cancelled || take !== mine) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      mine.stream = stream;
      var mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      var opts = { audioBitsPerSecond: 32000 };
      if (mime) opts.mimeType = mime;
      var chunks = [], rec = new MediaRecorder(stream, opts);
      mine.recorder = rec;
      rec.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      rec.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (g !== gen || mine.cancelled) return; // cancelled: nothing is sent and no drill is spent
        var type = rec.mimeType || mime || "audio/webm";
        send(new Blob(chunks, { type: type }), type.indexOf("mp4") >= 0 ? "carol.m4a" : "carol.webm", d, g, mine.lead);
      });
      if (audio.state === "suspended") audio.resume();
      rec.start();
      mine.t0 = audio.currentTime + 0.05;
      schedule(audio, d, plan, mine.t0, got[1]);
      c.phase = "leadin"; render();
      document.body.classList.add("is-recording");
      track(W().started, "drill=" + d.drill.id + ";step=" + d.step.index);
      mine.timer = setInterval(function () { tick(mine); }, 100);
      var natural = plan.seconds + P().partSeconds(d.drill.notes, d.drill.tempoBpm) + P().TAIL_SEC;
      var seconds = d.drill.maxTakeSeconds > 0 ? Math.min(d.drill.maxTakeSeconds, natural) : natural;
      mine.stopAt = setTimeout(function () { if (take === mine) finishTake(); }, (seconds + 0.05) * 1000);
    }, function (err) {
      if (take === mine) take = null;
      try { audio.close(); } catch (e) { /* closed */ }
      if (g !== gen || mine.cancelled) return;
      c.phase = "idle"; c.error = P().micError(err); render();
    });
  }

  function tick(mine) {
    if (take !== mine || !root) return;
    var t = mine.audio.currentTime - mine.t0;
    if (c.phase === "leadin" && t >= mine.lead) { c.phase = "singing"; render(); }
    var text = root.querySelector(".pv-live-text");
    if (text) text.textContent = liveText();
    highlight(P().noteDueAt(mine.d.drill.notes, mine.d.drill.tempoBpm, mine.lead, t));
  }

  function endTake(cancelled) {
    var mine = take;
    if (!mine) return;
    take = null;
    mine.cancelled = mine.cancelled || cancelled;
    if (mine.timer) clearInterval(mine.timer);
    if (mine.stopAt) clearTimeout(mine.stopAt);
    document.body.classList.remove("is-recording");
    highlight(-1);
    if (mine.recorder && mine.recorder.state !== "inactive") mine.recorder.stop();
    else if (mine.stream) mine.stream.getTracks().forEach(function (t) { t.stop(); });
    try { mine.audio.close(); } catch (e) { /* closed */ }
  }
  function finishTake() { endTake(false); c.phase = "grading"; render(); }
  function cancelTake() { var had = !!take; endTake(true); if (had) { c.phase = "idle"; render(); } }

  function send(blob, name, d, g, lead) {
    var form = new FormData();
    form.append("audio", blob, name);
    form.append("drillId", d.drill.id);
    form.append("leadInSec", String(lead));
    ctx.request("/api/practice/drills/grade", { method: "POST", form: form }).then(function (result) {
      if (g !== gen) return;
      c.grade = result; c.gradeFor = d.step.index; c.phase = "idle"; c.error = null;
      track(W().marked, "drill=" + d.drill.id + ";score=" + result.score);
      P().rewardEvents(result.reward).forEach(function (e) { track(e.name, e.detail); });
      render();
      if (P().earnedSeasonBadge(result.reward && result.reward.newBadges, c.path && c.path.season.badgeCode)) {
        celebrate(result);
      } else {
        var how = T().celebrationFor(d.drill.track, result.score, result.reward, false), moment = P().rewardMoment(result.reward);
        var line = d.drill.track === "playful" ? T().playfulRewardLine(result.reward) : moment && moment.line;
        if (how === "burst") ctx.burst();
        if (how !== "quiet" && line) ctx.toast(line, T().rewardArt(result.reward));
      }
      load(true);
    }, function (err) {
      if (g !== gen) return;
      c.phase = "idle"; c.error = P().gradeError(err);
      render();
    });
  }

  // ── The season's sticker: the burst, the reward card and the tune on the piano ───────
  /** The sticker's tune: the carols' whole Joy to the World line; the Midnight path's Mountain King phrase. */
  function celebrate(result) {
    var mine = ++moment;
    ctx.burst(T().seasonConfettiArt(season));
    if (!halloween()) {
      playTune(P().JOY_LINE, P().CHIME_BPM, "2/4");
      stickerSheet(result, P().JOY_LINE, "Joy to the World");
      return;
    }
    var waited = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, KING_WAIT_MS); });
    Promise.race([loadKing(), waited]).then(function (phrase) {
      if (mine !== moment || !root) return;
      var notes = phrase || P().KING_OPENING;
      playTune(notes, P().KING_BPM, "4/4");
      stickerSheet(result, notes, "In the Hall of the Mountain King");
    });
  }

  /**
   * The Mountain King's first phrase as the hymn pack publishes it, labelled by the solfa engine (choir.js), or null
   * without the pack or the tune. Asked for once, near the end of the path.
   */
  function loadKing() {
    if (kingLoad) return kingLoad;
    kingLoad = (window.fetch ? fetch(PACK_URL, { credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null))
      .then(function (pack) {
        var king = pack && P().mountainKing(pack.hymns);
        if (!king || !king.notes || !king.notes.length || !ctx || !ctx.choir) return null;
        var notes = king.notes.map(function (n) { return { pitchMidi: n[0], startBeat: n[1], durBeats: n[2] }; });
        return P().kingPhrase(ctx.choir.label(notes, king.key));
      })
      .catch(function () { kingLoad = null; return null; });
    return kingLoad;
  }

  /** The tune, once, on the piano: after the tap that sang it, and only with sounds on. */
  function playTune(notes, bpm, time) {
    if (!soundsOn()) return;
    try {
      if (!chime) chime = ctx.choir.createPlayer();
      chime.load({ voices: [{ name: "tune", notes: notes, gain: 0.9 }], tempoBpm: bpm, timeSignature: time });
      chime.play();
    } catch (e) { /* the sticker says it */ }
  }

  function stickerSheet(result, notes, tuneName) {
    closeSheet();
    var words = W(), line = P().stickerLine(season, notes);
    var back = el("div", "pc-sheet-back" + (halloween() ? " is-halloween" : "")), sheet = el("div", "pc-sheet");
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "pc-sheet-title");
    sheet.appendChild(ctx.art(T().badgeArt(c.path.season.badgeCode, true), 132, 136, "pc-sheet-art"));
    var h = el("h2", "pc-sheet-title", words.sticker); h.id = "pc-sheet-title";
    sheet.appendChild(h);
    sheet.appendChild(el("p", "pc-sheet-body", words.stickerBody));
    if (result.reward && result.reward.xpGained > 0) sheet.appendChild(el("p", "pc-sheet-xp", "+" + result.reward.xpGained + " XP · same XP rules as every drill"));
    // A long phrase (the Mountain King's) sets tighter, so it fits a 360 px phone on one line.
    var pill = el("p", "pc-sheet-line" + (line.length > 24 ? " is-long" : ""));
    pill.setAttribute("aria-label", tuneName + ": " + line);
    pill.appendChild(ctx.modeIcon("runs", "pc-sheet-note"));
    var sol = el("span", null, line); sol.setAttribute("aria-hidden", "true");
    pill.appendChild(sol);
    sheet.appendChild(pill);
    var row = el("div", "pc-sheet-actions");
    row.appendChild(button("btn-link", null, "See my stickers", function () { closeSheet(); leave(); ctx.back(); }));
    var done = button("btn-primary", null, "Done", closeSheet); done.id = "pc-sheet-done";
    row.appendChild(done);
    sheet.appendChild(row);
    back.appendChild(sheet);
    back.addEventListener("click", function (e) { if (e.target === back) closeSheet(); });
    back.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
    document.body.appendChild(back);
    sheetEl = back;
    done.focus();
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }

  // ── The way in and out ──────────────────────────────────────────────────
  function open(rootEl, context) {
    var next = context && context.season === "halloween" ? "halloween" : "christmas";
    // Another season's path (the switch moved since the last open) starts from nothing.
    if (next !== season) { gen++; c = fresh(); kingLoad = null; }
    ctx = context; root = rootEl; season = next;
    c.chosen = null; c.grade = null; c.gradeFor = null; c.error = null;
    render();
    load().then(function () { var t = root && root.querySelector("#pc-title"); if (t) t.focus(); });
  }
  function leave() {
    moment++;
    stopHear();
    if (chime) { try { chime.stop(); } catch (e) { /* gone */ } }
    if (take) cancelTake();
    closeSheet();
  }
  function reset() { gen++; leave(); c = fresh(); root = null; }

  window.NfPracticeCarols = { open: open, leave: leave, reset: reset };
})();
