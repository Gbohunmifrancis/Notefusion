/* Practice on the web: the arithmetic and wording of the Practice view, apart from the page that draws it.
 *
 * How full the XP bar and the weekly ring are, what the streak card and a reward say, the seven day dots, the
 * drill's count-in and how long a take runs, and the plain sentence for anything that goes wrong. Every number
 * is the server's (C# Application/Practice, GET /api/practice/progress); nothing here scores a take.
 * The mobile copies are mobile/src/lib/practiceProgress.ts and lib/take.ts — keep them in step.
 *
 * Plain functions over plain objects; assets/practice-view.js draws the view. Loaded with it, on demand.
 */
(function () {
  "use strict";

  /** Recording runs on this long after the last note, so a held ending is not cut (mobile TAIL_SEC). */
  var TAIL_SEC = 1;
  var LETTERS = "SMTWTFS";

  function clamp01(v) { return typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }

  /** How far through the current level `xp` is, 0–1 (full at the top level). */
  function levelFraction(level, xp) {
    if (!level || level.nextLevelXp == null) return 1;
    var span = level.nextLevelXp - level.minXp;
    return span > 0 ? clamp01((xp - level.minXp) / span) : 1;
  }

  /** How much of the weekly goal is done, 0–1. */
  function weeklyFraction(goal) { return goal && goal.target > 0 ? clamp01(goal.daysDone / goal.target) : 0; }

  /** "12 XP to Ray", "1,250 XP to Soh", or the top level's own line. */
  function nextLevelLine(level) { return level.nextName ? xpAmount(level.xpForNext) + " to " + level.nextName : "Top of the ladder"; }

  /** "12,450 XP": grouped by hand, as the phone's `xpAmount` is. */
  function xpAmount(xp) { return String(Math.round(xp)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " XP"; }

  /** "4-day streak", "1-day streak", "No streak yet" — or "No streak now" when an earlier one lapsed. */
  function streakLabel(days, best) { return days > 0 ? days + "-day streak" : best > 0 ? "No streak now" : "No streak yet"; }

  /** "Your best: 12 days" once a streak has lapsed (the best is kept); null before the first. */
  function bestStreakLine(streak) {
    if (streak.current > 0 || !(streak.best > 0)) return null;
    return "Your best: " + streak.best + " " + (streak.best === 1 ? "day" : "days");
  }

  /** The streak card's line under the count: today done, keep it going, or start one (again, after a lapse). */
  function streakLine(streak) {
    if (streak.todayDone) return "Done for today";
    if (streak.atRisk) return "Sing today to keep it";
    var best = bestStreakLine(streak);
    return best ? best + ". Start a new one today." : "Sing a drill to start one";
  }

  /** The week's one freeze: still there, or spent. */
  function freezeLine(streak) { return streak.freezeAvailable ? "Streak freeze ready this week" : "Freeze used this week"; }

  /** Earned badges first (newest first), then locked ones nearest to done. */
  function sortBadges(badges) {
    var earned = (badges || []).filter(function (b) { return b.earned; })
      .sort(function (a, b) { return String(b.earnedAtUtc || "").localeCompare(String(a.earnedAtUtc || "")); });
    var locked = (badges || []).filter(function (b) { return !b.earned; })
      .sort(function (a, b) { return badgeFraction(b) - badgeFraction(a); });
    return earned.concat(locked);
  }

  /** A badge's progress bar, 0–1 (full once earned). */
  function badgeFraction(b) { return b.earned ? 1 : clamp01(b.progress / Math.max(1, b.target)); }

  /**
   * The one line a marked take earns: a level-up beats a badge beats the XP. Null when it earned nothing to say
   * (the day's XP cap reached and nothing unlocked) — no toast for nothing.
   */
  function rewardMoment(reward) {
    if (!reward) return null;
    if (reward.levelUp) return { line: "Level up — you're now " + reward.level.name + "!", big: true };
    var badge = (reward.newBadges || [])[0];
    if (badge) return { line: "Badge earned: " + badge.title, big: true };
    if (!(reward.xpGained > 0)) return null;
    return { line: reward.streak > 1 ? "+" + reward.xpGained + " XP · " + streakLabel(reward.streak) : "+" + reward.xpGained + " XP", big: false };
  }

  /** The analytics a reward is worth: `level_up` and one `badge_earned` per badge, details as k=v;k=v. */
  function rewardEvents(reward) {
    if (!reward) return [];
    var out = [];
    if (reward.levelUp) out.push({ name: "level_up", detail: "level=" + reward.level.name + ";index=" + reward.level.index });
    (reward.newBadges || []).forEach(function (b) { out.push({ name: "badge_earned", detail: "badge=" + b.code }); });
    return out;
  }

  /** "M", "T", … for a `yyyy-mm-dd`, by the calendar alone (no time zone can move it). */
  function weekdayLetter(day) {
    var p = String(day).split("-").map(Number);
    return LETTERS[new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1)).getUTCDay()];
  }

  var DAY_WORDS = {
    done: "practised",
    frozen: "missed, kept by the streak freeze",
    missed: "missed",
    today: "today, not practised yet",
    none: "before your first practice"
  };
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /** The last seven days as dots: { date, status, letter, label } — a tick for done, a snowflake for frozen. */
  function dayDots(days) {
    return (days || []).map(function (d) {
      var p = String(d.date).split("-").map(Number);
      var wd = WEEKDAYS[new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1)).getUTCDay()];
      var status = DAY_WORDS[d.status] ? d.status : "none";
      return { date: d.date, status: status, letter: weekdayLetter(d.date), label: wd + ": " + DAY_WORDS[status] };
    });
  }

  /** Drills still to be marked today, or null when the allowance is unknown. */
  function drillsLeft(allowance) { return allowance ? Math.max(0, allowance.limit - allowance.used) : null; }

  /**
   * "midnight", "1:30 am": when the drill allowance starts again, on this device's clock. `offsetMinutes` is
   * Date.getTimezoneOffset() at that moment (minutes behind UTC), passed in by the tests.
   */
  function resetTime(resetsAtUtc, offsetMinutes) {
    var t = resetsAtUtc ? Date.parse(resetsAtUtc) : NaN;
    if (!isFinite(t)) return null;
    var offset = typeof offsetMinutes === "number" ? offsetMinutes : new Date(t).getTimezoneOffset();
    var local = new Date(t - offset * 60000), h = local.getUTCHours(), m = local.getUTCMinutes();
    if (h === 0 && m === 0) return "midnight";
    return (h % 12 === 0 ? 12 : h % 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "am" : "pm");
  }

  /** "7 of 10 marked drills left today", or, once they are sung, a warm last word with when more come. */
  function allowanceLine(allowance, offsetMinutes) {
    var left = drillsLeft(allowance);
    if (left == null) return "";
    if (left > 0) return left + " of " + allowance.limit + " marked drills left today";
    var when = resetTime(allowance.resetsAtUtc, offsetMinutes);
    return "That's all " + allowance.limit + " of today's drills. Well sung! " + (when ? "More from " + when + "." : "More tomorrow.");
  }

  // ── The practice path (the server's: grades → units → drills; mobile lib/practiceProgress.ts) ──
  /** "Grade 2 · Unit 3 · 4 of 6", with "· Harder" or "· Easier" when the last take moved it; null without a place. */
  function pathLine(drill) {
    if (!drill || !drill.grade || !(drill.unitIndex > 0) || !(drill.drillCount > 0)) return null;
    var moved = drill.adjustment === "harder" ? " · Harder" : drill.adjustment === "easier" ? " · Easier" : "";
    return drill.grade + " · Unit " + drill.unitIndex + " · " + drill.drillIndex + " of " + drill.drillCount + moved;
  }

  /** How much of the unit is behind the singer, 0–1: the thin bar under the path line. */
  function unitFraction(drill) { return drill && drill.drillCount > 0 ? clamp01((drill.drillIndex - 1) / drill.drillCount) : 0; }

  /** The result's main button: on to the next drill, or the same one again when the path brings it back after a miss. */
  function nextAction(current, next, track) {
    var same = !!next && !!current && next.id === current.id;
    if (track === "playful") return { label: same ? "Try again!" : "Keep going!", same: same };
    return { label: same ? "Try it again" : "Continue", same: same };
  }

  function beatSec(tempo) { return 60 / Math.max(30, tempo || 0); }

  /**
   * The count-in before the singer, five seconds at most: practice.js `leadInPlan` (loaded with the app, before
   * this file) — `beats` clicks ending on beat one, the first note held through the first `holdBeats` of them as a
   * pitch pipe — with the note to hold. The take is sent with its `seconds` as the lead-in the server grades it by
   * (the drill's own `leadInBeats` is the older apps' two bars) — mobile lib/take.leadInFor.
   */
  function leadIn(drill) {
    var plan = window.NfPractice.leadInPlan(drill.tempoBpm, drill.timeSignature);
    var first = (drill.notes || []).slice().sort(function (a, b) { return a.startBeat - b.startBeat; })[0];
    return {
      beats: plan.beats,
      holdBeats: plan.holdBeats,
      beatsPerBar: plan.beatsPerBar,
      pitchMidi: first ? first.pitchMidi : 60,
      beatSec: plan.beatSec,
      seconds: plan.seconds
    };
  }

  /** How long the drill itself runs, in seconds. */
  function partSeconds(notes, tempo) {
    var end = (notes || []).reduce(function (m, n) { return Math.max(m, n.startBeat + Math.max(0, n.durBeats)); }, 0);
    return end * beatSec(tempo);
  }

  /** When the take stops by itself: a second after the last note, never past what the server keeps. */
  function takeSeconds(drill) {
    var natural = leadIn(drill).seconds + partSeconds(drill.notes, drill.tempoBpm) + TAIL_SEC;
    return drill.maxTakeSeconds > 0 ? Math.min(drill.maxTakeSeconds, natural) : natural;
  }

  /** The note due `elapsed` seconds into the recording, or −1 (count-in, between notes, after the end). */
  function noteDueAt(notes, tempo, leadSec, elapsed) {
    var beat = (elapsed - leadSec) / beatSec(tempo);
    for (var i = 0; i < (notes || []).length; i++) {
      var n = notes[i];
      if (beat >= n.startBeat && beat < n.startBeat + n.durBeats) return i;
    }
    return -1;
  }

  /**
   * What a singer reads when a take could not be marked. `err` is the app's ApiError ({status, code, message});
   * its message is already plain (friendlyMessage), so only the cases this view says better are rewritten.
   */
  function gradeError(err) {
    var status = err && err.status, code = err && err.code;
    if (code === "PRACTICE_DAILY_LIMIT") return err.message || "That's today's marked drills done. Come back tomorrow for more.";
    if (status === 429) return "That's a lot of takes in a short time. Wait a minute, then sing it again.";
    if (status === 0 || status === undefined) return "Your take couldn't be sent. Check your connection and sing it again.";
    if (status >= 500) return "We couldn't mark your take just now. Please sing it again in a moment.";
    return (err && err.message) || "We couldn't mark your take. Please sing it again.";
  }

  /** What a singer reads when the microphone could not be opened (getUserMedia's error, by name). */
  function micError(err) {
    var name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
      return "NoteFusion needs your microphone to hear the drill. Allow it for this site (the icon by the address bar), then press Sing it again.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
      return "No microphone was found. Plug one in, or use your phone, and try again.";
    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
      return "Another app is using the microphone. Close it and try again.";
    if (name === "Unsupported" || name === "NotSupportedError") return "This browser can't record audio. Try Chrome, Safari or Firefox.";
    return "We couldn't open the microphone. Please try again.";
  }

  // ── The season's path while its season is on: the Christmas carols (board d-christmas/03) and the Midnight path
  // (board j-halloween/03). The mobile copy is lib/season.ts ──

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /** "Until 6 January" from the path's last day (yyyy-mm-dd); null when it runs until switched off. */
  function untilLabel(until) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until || "");
    if (!m) return null;
    var month = MONTHS[Number(m[2]) - 1];
    return month ? "Until " + Number(m[3]) + " " + month : null;
  }

  /** Each season's words: its name, the card's line, the path's title, the sticker and what the path says. */
  var WORDS = {
    christmas: {
      name: "Christmas", pathTitle: "Carols",
      cardBody: "Six short drills from carols we hold: a Gloria warm-up, Silent Night in thirds, and more.",
      sticker: "Carol singer", stickerBody: "You sang all six carols. This sticker stays in your book after Christmas.",
      allSungLine: "You sang all six carols. Merry Christmas!",
      away: "The carols are put away until next Christmas.", failed: "The carols didn't load. Please try again.",
      nextLabel: "Next carol", opened: "carols_opened", heard: "carol_heard", started: "carol_started", marked: "carol_marked",
      link: "the carols"
    },
    halloween: {
      name: "Halloween", pathTitle: "The Midnight path",
      cardBody: "Six short drills from spooky songs: the Mountain King's tiptoe, Bach's organ turn, the skeletons' waltz, and All Saints to finish.",
      sticker: "Night Singer", stickerBody: "You sang all six on the Midnight path. This sticker stays in your book after Halloween.",
      allSungLine: "You sang all six on the Midnight path. Happy Halloween!",
      away: "The Midnight path is back next Halloween.", failed: "The Midnight path didn't load. Please try again.",
      nextLabel: "Next drill", opened: "midnight_opened", heard: "midnight_heard", started: "midnight_started", marked: "midnight_marked",
      link: "the Midnight path"
    }
  };
  /** A path card's season as this build knows it: anything but "halloween" is the carols. */
  function seasonOf(name) { return name === "halloween" ? "halloween" : "christmas"; }
  function seasonWords(name) { return WORDS[seasonOf(name)]; }
  /** Where a season's path is read: the carols keep their own address, the Midnight path is /seasons/halloween. */
  function seasonPathUrl(name) { return seasonOf(name) === "christmas" ? "/api/practice/carols" : "/api/practice/seasons/" + seasonOf(name); }

  /** The hub's season card (pine, pumpkin): until when, a segment a drill, how many are sung and what is next. */
  function seasonCard(season) {
    var name = seasonOf(season.season), words = WORDS[name], until = untilLabel(season.until), done = season.next == null;
    // The Midnight path names its first drill as the first; the carols always said "Next".
    var lead = name === "halloween" && season.sung === 0 ? "First" : "Next";
    return {
      season: name,
      eyebrow: until ? words.name + " · " + until : words.name,
      title: season.title,
      body: words.cardBody,
      segments: season.steps.map(function (st) { return !!st.passed; }),
      sung: season.sung + " of " + season.total + " sung",
      next: done ? "All sung. The " + words.sticker + " sticker is yours." : lead + ": " + season.next.cue,
      action: done ? "Sing again" : season.sung === 0 ? "Start" : "Continue",
      label: season.title + ": " + season.sung + " of " + season.total + " sung." + (done ? "" : " " + lead + ": " + season.next.cue + ".")
    };
  }

  /** The path as its screen draws it: the step open (the one chosen, else the next unsung, else the last) and the rows. */
  function seasonView(season, chosen) {
    var name = seasonOf(season.season);
    var indexes = season.steps.map(function (st) { return st.index; });
    var fallback = season.next ? season.next.index : indexes.length ? indexes[indexes.length - 1] : 1;
    var open = chosen != null && indexes.indexOf(chosen) >= 0 ? chosen : fallback;
    return {
      season: name,
      eyebrow: WORDS[name].name + " · " + season.sung + " of " + season.total,
      rows: season.steps.map(function (st) {
        return { index: st.index, title: st.title, line: st.carol + " · " + st.detail, state: st.index === open ? "open" : st.passed ? "done" : "todo", bestScore: st.bestScore };
      }),
      open: open,
      allSung: season.next == null
    };
  }

  function fold(text) { return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

  /** Doh's word over each Midnight drill (Playful), by its code (the drill id's part before "@"). */
  var MIDNIGHT_LINES = {
    "midnight-king": "Shh, tiptoe with me: the Mountain King's run, soft and short.",
    "midnight-toccata": "A perfect tiptoe! Now the organ's turn: m r m, quick as a wink.",
    "midnight-climb": "Up we go: the Mountain King climbs through fe and se.",
    "midnight-waltz": "Waltz with the skeletons: down one semitone at a time.",
    "midnight-march": "Tiptoe like a puppet: the Marionette's fall.",
    "midnight-saints": "Last one, for All Saints' Day: sing it from the top doh down."
  };

  /** Doh's word over the Midnight path (Playful), for the drill that is next. */
  function midnightLine(next) {
    var code = String(next.id || "").split("@")[0];
    return Object.prototype.hasOwnProperty.call(MIDNIGHT_LINES, code) ? MIDNIGHT_LINES[code] : "Next: " + next.cue + ". Boo and I are listening!";
  }

  /** Doh's word over the path (Playful), for the step that is next. */
  function seasonBuddyLine(season) {
    var name = seasonOf(season.season), n = season.next;
    if (!n) return WORDS[name].allSungLine;
    if (name === "halloween") return midnightLine(n);
    switch (n.index) {
      case 1: return "A Gloria to warm up: can you sing it all in one breath?";
      case 2: return "Lovely Gloria! Now Joy to the World, all the way down.";
      case 3: return "Joyful! Now sing under the tune, like the altos do.";
      case 4: return "Now sing Silent Night along with the words.";
      case 5: return "Hark! Leap up from low soh to doh.";
      default: return "Last one: " + n.title.toLowerCase() + " with " + n.carol + ".";
    }
  }

  /** Whether a take just earned the season's sticker (its code among the reward's new badges). */
  function earnedSeasonBadge(newBadges, badgeCode) {
    var code = badgeCode || "carol_singer";
    return !!newBadges && newBadges.some(function (b) { return b.code === code; });
  }

  function event(pitchMidi, startBeat, durBeats, solfa, octaveMark) {
    return { pitchMidi: pitchMidi, startBeat: startBeat, durBeats: durBeats, solfa: solfa, octaveMark: octaveMark, degree: 1, conf: 1 };
  }

  /** "Joy to the world, the Lord is come!" an octave up, crotchet = 120: the Carol singer's line (d' t l s f m r d). */
  var JOY_LINE = [[86, 0, 1, "d", "'"], [85, 1, 0.75, "t", ""], [83, 1.75, 0.25, "l", ""], [81, 2, 1.5, "s", ""],
    [79, 3.5, 0.5, "f", ""], [78, 4, 1, "m", ""], [76, 5, 1, "r", ""], [74, 6, 1.5, "d", ""]].map(function (n) {
    return event(n[0], n[1], n[2], n[3], n[4]);
  });
  var CHIME_BPM = 120;

  /** The Mountain King's tempo (crotchet = 150) and its tiptoe: each note sounds this share of its written length. */
  var KING_BPM = 150, DETACHED = 0.6, KING_PHRASE_NOTES = 13;
  /**
   * Grieg's "In the Hall of the Mountain King" (B minor, la-based: doh D), its opening seven notes l, t, d r m d m:
   * quavers and a crotchet, B4 C#5 D5 E5 F#5 D5 F#5, short and detached. The Night Singer's tune when the hymn pack
   * does not have the tune.
   */
  var KING_OPENING = (function () {
    var at = 0;
    return [[71, 0.5, "l", ","], [73, 0.5, "t", ","], [74, 0.5, "d", ""], [76, 0.5, "r", ""], [78, 0.5, "m", ""], [74, 0.5, "d", ""], [78, 1, "m", ""]].map(function (n) {
      var e = event(n[0], at, Math.round(n[1] * DETACHED * 1000) / 1000, n[2], n[3]);
      at += n[1];
      return e;
    });
  })();

  /**
   * The Night Singer's phrase from the Mountain King as the hymn pack publishes it, labelled by the solfa engine: its
   * first phrase (l, t, d r m d m · ma t, ma · r ta, r) from its first note, moved by whole octaves to sit where the
   * opening does and played detached. Fewer notes than the opening (no pack, or no such tune): the opening itself.
   */
  function kingPhrase(labelled) {
    var sorted = (labelled || []).slice().sort(function (a, b) { return a.startBeat - b.startBeat; });
    if (sorted.length < KING_OPENING.length) return KING_OPENING.map(function (n) { return Object.assign({}, n); });
    var phrase = sorted.slice(0, KING_PHRASE_NOTES), first = phrase[0];
    var shift = 12 * Math.round((KING_OPENING[0].pitchMidi - first.pitchMidi) / 12);
    return phrase.map(function (n, i) {
      var next = phrase[i + 1], written = next ? next.startBeat - n.startBeat : n.durBeats;
      return Object.assign({}, n, {
        pitchMidi: n.pitchMidi + shift,
        startBeat: Math.round((n.startBeat - first.startBeat) * 1000) / 1000,
        durBeats: Math.round(Math.min(n.durBeats, written) * DETACHED * 1000) / 1000
      });
    });
  }

  function solfaLine(notes) { return notes.map(function (n) { return (n.solfa || "") + (n.octaveMark || ""); }).join(" "); }

  /** A phrase as the sticker prints it, a dot after each figure that ends on a longer note: "l, t, d r m d m · ma t, ma · r ta, r". */
  function phraseLine(notes) {
    var sorted = notes.slice().sort(function (a, b) { return a.startBeat - b.startBeat; });
    function length(i) { return sorted[i + 1].startBeat - sorted[i].startBeat; }
    var out = "";
    sorted.forEach(function (n, i) {
      if (i > 0) out += i >= 2 && length(i - 1) > length(i - 2) + 1e-9 ? " · " : " ";
      out += (n.solfa || "") + (n.octaveMark || "");
    });
    return out;
  }

  /** The sticker sheet's line: the whole carol line at Christmas, the Mountain King's phrase with its figures at Halloween. */
  function stickerLine(name, notes) { return seasonOf(name) === "halloween" ? phraseLine(notes) : solfaLine(notes); }

  /** The pack's "In the Hall of the Mountain King" (the Night Singer's phrase), or null while the pack has none. */
  function mountainKing(hymns) {
    return (hymns || []).filter(function (h) { return fold(h.title).indexOf("mountain king") >= 0; })[0] || null;
  }

  window.NfPracticeProgress = {
    untilLabel: untilLabel, seasonOf: seasonOf, seasonWords: seasonWords, seasonPathUrl: seasonPathUrl,
    seasonCard: seasonCard, seasonView: seasonView, seasonBuddyLine: seasonBuddyLine, earnedSeasonBadge: earnedSeasonBadge,
    // The carols' own names, as the Christmas season first had them.
    carolsCard: seasonCard, carolsView: seasonView, carolsBuddyLine: seasonBuddyLine, earnedCarolSinger: earnedSeasonBadge,
    JOY_LINE: JOY_LINE, CHIME_BPM: CHIME_BPM, KING_OPENING: KING_OPENING, KING_BPM: KING_BPM, KING_PHRASE_NOTES: KING_PHRASE_NOTES,
    kingPhrase: kingPhrase, mountainKing: mountainKing, solfaLine: solfaLine, phraseLine: phraseLine, stickerLine: stickerLine,
    TAIL_SEC: TAIL_SEC,
    levelFraction: levelFraction, weeklyFraction: weeklyFraction, nextLevelLine: nextLevelLine, xpAmount: xpAmount,
    streakLabel: streakLabel, bestStreakLine: bestStreakLine, streakLine: streakLine, freezeLine: freezeLine,
    sortBadges: sortBadges, badgeFraction: badgeFraction, rewardMoment: rewardMoment, rewardEvents: rewardEvents,
    weekdayLetter: weekdayLetter, dayDots: dayDots, drillsLeft: drillsLeft, allowanceLine: allowanceLine, resetTime: resetTime,
    pathLine: pathLine, unitFraction: unitFraction, nextAction: nextAction,
    leadIn: leadIn, partSeconds: partSeconds, takeSeconds: takeSeconds, noteDueAt: noteDueAt,
    gradeError: gradeError, micError: micError
  };
})();
