/* A seasonal Pro offer on the website and in /app (board p-halloween-offer: P2 the banner, P3 the plans, P4 the pricing
 * cards, P5 after it ends).
 *
 * The API says what is running for the reader: GET /api/offers/current answers { offer, ended }. `offer` carries the
 * key, the label ("Halloween offer"), the percent, the last day, the moment it ends for this reader (midnight at the
 * end of the last day in their own time zone) and each plan's offer price; null when nothing runs for them. app.js and
 * pricing.js ask, and load this file and assets/offer.css only when an offer (or, in /app, an ended one) is in the
 * answer, as season.js loads season.css: none of it is downloaded the rest of the year.
 *
 * The top half is pure (the countdown, the sentences, the prices) and has node tests (web-site/tests/offer.test.mjs).
 * The bottom half builds the strip, the plans' line and the cards' line, and keeps every countdown on the page
 * ticking: once a second, once a minute under reduced motion, never while the tab is hidden; at zero it tells the
 * page, which fades the strip and asks the API again.
 *
 * Skins: Halloween (pumpkin wash and hairline, moon-cream label on Night, a bat) and Christmas (pine, candle label on
 * Night, a snowflake), set as <html data-offer="…"> for offer.css. Never Pro's gold; the blue is the one action.
 * Plain script, no build step.
 */
(function () {
  "use strict";

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  /** Each template's season name and glyph. */
  var TEMPLATES = { halloween: { name: "Halloween", glyph: "bat" }, christmas: { name: "Christmas", glyph: "snowflake" } };

  // ── Pure ────────────────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * What is left, as the strip shows it: "2d 14:08:33" from a day up, "14:08:33" under a day, "41:09" in the last
   * hour, "00:00" at the end. Rounded up to the second, so it reads 00:00 at the moment itself and not a second early.
   * `coarse` (reduced motion, ticking by the minute) drops the seconds: "2d 14h 09m", "14h 09m", "42m".
   */
  function countdown(ms, coarse) {
    ms = Math.max(0, Number(ms) || 0);
    if (coarse) {
      var mins = Math.ceil(ms / 60000), md = Math.floor(mins / 1440), mh = Math.floor((mins % 1440) / 60), mm = mins % 60;
      if (md >= 1) return md + "d " + mh + "h " + pad(mm) + "m";
      if (mh >= 1) return mh + "h " + pad(mm) + "m";
      return mm + "m";
    }
    var s = Math.ceil(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d >= 1) return d + "d " + pad(h) + ":" + pad(m) + ":" + pad(sec);
    if (h >= 1) return pad(h) + ":" + pad(m) + ":" + pad(sec);
    return pad(m) + ":" + pad(sec);
  }

  /** How long until the countdown's text next changes: to the next whole second (a minute when coarse). */
  function tickDelay(ms, coarse) {
    var unit = coarse ? 60000 : 1000, r = Math.max(0, Math.floor(ms)) % unit;
    return r === 0 ? unit : r;
  }

  /** The moment the offer ends for this reader, in ms; NaN when the answer has none. */
  function endsAt(offer) { return offer && offer.endsAtUtc ? Date.parse(offer.endsAtUtc) : NaN; }

  /** An offer still running at `now` (ms) with at least one plan priced: what the page may show. */
  function isLive(offer, now) {
    var end = endsAt(offer);
    return !!offer && !isNaN(end) && end > (now === undefined ? Date.now() : now) && Array.isArray(offer.plans) && offer.plans.length > 0;
  }

  /** The template the strip is dressed in ("halloween", "christmas"); null for one this page does not know. */
  function skinOf(offer) {
    var t = offer && String(offer.template || "").toLowerCase();
    return t && Object.prototype.hasOwnProperty.call(TEMPLATES, t) ? t : null;
  }

  /** "Halloween": the template's season, else the label without its " offer". */
  function seasonName(offer) {
    var skin = skinOf(offer);
    if (skin) return TEMPLATES[skin].name;
    return String((offer && offer.label) || "Seasonal offer").replace(/\s+offer$/i, "");
  }

  /** "Halloween offer". */
  function labelOf(offer) { return (offer && offer.label) || seasonName(offer) + " offer"; }

  /** A plan's tag while the offer runs: "Halloween · 30% off". */
  function tagText(offer) { return seasonName(offer) + " · " + offer.percentOff + "% off"; }

  /** The offer's last day ("2026-10-31") as a date at UTC midnight, so no time zone moves it; NaN when unreadable. */
  function dayOf(lastDay) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(lastDay || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }

  /** "Saturday 31 October". */
  function longDay(lastDay) {
    var t = dayOf(lastDay);
    if (isNaN(t)) return "";
    var d = new Date(t);
    return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }

  /**
   * When it ends, said from today (the reader's own date at `now`, a Date): "tonight", "tomorrow", "Saturday" within the
   * week, "Saturday 31 October" further off.
   */
  function whenEnds(lastDay, now) {
    var t = dayOf(lastDay);
    if (isNaN(t)) return "soon";
    now = now || new Date();
    var days = Math.round((t - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    if (days <= 0) return "tonight";
    if (days === 1) return "tomorrow";
    return days <= 6 ? DAYS[new Date(t).getUTCDay()] : longDay(lastDay);
  }

  /** What a screen reader hears in place of the ticking digits: "Halloween offer, 30% off Pro, ends Saturday at midnight". */
  function srSentence(offer, now) {
    return labelOf(offer) + ", " + offer.percentOff + "% off Pro, ends " + whenEnds(offer.lastDay, now) + " at midnight";
  }

  /** The pricing note's sentence: "The Halloween prices hold until midnight on Saturday 31 October, your time." */
  function holdsLine(offer) {
    return "The " + seasonName(offer) + " prices hold until midnight on " + longDay(offer.lastDay) + ", your time.";
  }

  /** "The Halloween offer has ended." */
  function endedLine(ended) { return "The " + labelOf(ended) + " has ended."; }

  /**
   * A plan's offer price in minor units, or null: the offer's plan with the same id (its code when the offer names no
   * id), in the same currency, and cheaper than the plan's own price.
   */
  function offerPrice(plan, offer) {
    if (!plan || !offer || !Array.isArray(offer.plans)) return null;
    for (var i = 0; i < offer.plans.length; i++) {
      var p = offer.plans[i];
      if (!p) continue;
      var same = p.planId !== undefined && p.planId !== null && p.planId !== ""
        ? String(p.planId) === String(plan.id)
        : !!p.code && p.code === plan.code;
      if (!same) continue;
      if (p.currency && plan.currency && String(p.currency).toUpperCase() !== String(plan.currency).toUpperCase()) return null;
      var minor = Number(p.offerAmountMinor);
      return isFinite(minor) && minor > 0 && (!isFinite(plan.amountMinor) || minor < plan.amountMinor) ? minor : null;
    }
    return null;
  }

  /** The plans with each one's offer price beside it (`offerAmountMinor`, null when the offer does not cover it). */
  function mergePlans(plans, offer) {
    return (plans || []).map(function (plan) {
      var copy = {};
      for (var k in plan) if (Object.prototype.hasOwnProperty.call(plan, k)) copy[k] = plan[k];
      copy.offerAmountMinor = offerPrice(plan, offer);
      return copy;
    });
  }

  /** "$6.99", "$55", "₦7,500": as app.js writes money (narrow symbol, cents only when there are some). */
  function money(amountMinor, currency) {
    var amount = amountMinor / 100;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
    catch (e) { return currency + " " + amount.toFixed(2); }
  }

  /** A year's price by the month: "$4.58 a month". */
  function perMonth(amountMinor, currency) { return money(Math.round(amountMinor / 12), currency) + " a month"; }

  function isYearly(interval) { return interval === 1 || /^year/i.test(String(interval || "")); }

  /** The small print under Pay at an offer's price: where the money goes, and that nothing renews. */
  function payFine(interval) {
    return "Secure checkout on Bachs’ page, in US dollars. One payment covers the whole " + (isYearly(interval) ? "year" : "month") + "; nothing renews without you.";
  }

  /** Where this browser remembers that the strip was closed for an offer. */
  function dismissKey(key) { return "nf.offerDismissed." + key; }

  var api = window.NfOffer = {
    TEMPLATES: TEMPLATES,
    countdown: countdown, tickDelay: tickDelay, endsAt: endsAt, isLive: isLive, skinOf: skinOf, seasonName: seasonName,
    labelOf: labelOf, tagText: tagText, longDay: longDay, whenEnds: whenEnds, srSentence: srSentence, holdsLine: holdsLine,
    endedLine: endedLine, offerPrice: offerPrice, mergePlans: mergePlans, money: money, perMonth: perMonth, isYearly: isYearly,
    payFine: payFine, dismissKey: dismissKey
  };
  if (typeof document === "undefined" || !document.documentElement) return;

  // ── The page ────────────────────────────────────────────────────────────
  // One bat in currentColor (practice-art/bat.svg, as season.js draws it).
  var BAT = '<svg viewBox="0 0 40 20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 8L18.4 4.8L17.4 8.6C14.5 4.4 8.5 3.2 1.5 7.2C4.6 8.2 5.8 10.8 5.6 13.8C7.6 12 9.8 12 11 14C12.6 12 14.8 12.1 15.8 15C17 13.2 18.6 13.4 20 15.6C21.4 13.4 23 13.2 24.2 15C25.2 12.1 27.4 12 29 14C30.2 12 32.4 12 34.4 13.8C34.2 10.8 35.4 8.2 38.5 7.2C31.5 3.2 25.5 4.4 22.6 8.6L21.6 4.8Z"/></svg>';
  function icon(id) { return '<svg class="ic" aria-hidden="true" focusable="false"><use href="/assets/icons.svg#i-' + id + '"/></svg>'; }

  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  /** The ticking digits: tabular, hidden from screen readers (the sentence beside them says when). */
  function count(offer) {
    var end = endsAt(offer), c = el("span", "offer-count", countdown(end - Date.now(), reducedMotion()));
    c.setAttribute("data-offer-ends", String(end));
    return c;
  }
  function glyph(offer) {
    var g = el("span", "offer-glyph");
    g.setAttribute("aria-hidden", "true");
    var skin = skinOf(offer);
    g.innerHTML = skin === "christmas" ? icon("snowflake") : skin === "halloween" ? BAT : "";
    return g;
  }
  /** "Halloween offer · 30% off Pro · ends in 2d 14:08:33", read aloud as the sentence instead. */
  function message(offer, endsClass) {
    var p = el("p", "offer-msg");
    p.setAttribute("aria-hidden", "true");
    p.appendChild(el("strong", "", labelOf(offer)));
    p.appendChild(el("span", "offer-sep offer-sep-1", "·"));
    p.appendChild(el("span", "", offer.percentOff + "% off Pro"));
    p.appendChild(el("span", "offer-sep offer-wide", "·"));
    var ends = el("span", "offer-ends " + endsClass, "ends in ");
    ends.appendChild(count(offer));
    p.appendChild(ends);
    return p;
  }
  function spoken(offer) { return el("span", "sr-only", srSentence(offer, new Date()) + "."); }

  /**
   * Home's strip (P2): the glyph, the words and the countdown, "See the offer" (the page's one blue thing) and a close.
   * On a phone the countdown and the link take a second line. The page wires the two buttons.
   */
  function banner(offer) {
    var bar = el("div", "offer-bar on-home");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", labelOf(offer));
    bar.appendChild(glyph(offer));
    bar.appendChild(message(offer, "offer-wide"));
    bar.appendChild(spoken(offer));
    var foot = el("span", "offer-foot");
    var endsM = el("span", "offer-ends offer-narrow", "Ends in ");
    endsM.setAttribute("aria-hidden", "true");
    endsM.appendChild(count(offer));
    foot.appendChild(endsM);
    var go = el("button", "offer-go");
    go.type = "button";
    go.innerHTML = "See the offer" + icon("arrow-right");
    foot.appendChild(go);
    bar.appendChild(foot);
    var x = el("button", "offer-x");
    x.type = "button";
    x.setAttribute("aria-label", "Hide the " + labelOf(offer));
    x.innerHTML = icon("x");
    bar.appendChild(x);
    return bar;
  }

  /** The plans' line under their title (P3): the strip's words without the link or the close, since this is the offer. */
  function plansLine(offer) {
    var line = el("div", "offer-bar in-plans");
    line.appendChild(glyph(offer));
    line.appendChild(message(offer, "offer-line-ends"));
    line.appendChild(spoken(offer));
    return line;
  }

  /** P5's one muted line: "The Halloween offer has ended.", with the clock. */
  function endedNote(ended) {
    var p = el("p", "offer-ended");
    p.setAttribute("role", "status");
    p.innerHTML = icon("clock");
    p.appendChild(el("span", "", endedLine(ended)));
    return p;
  }

  /** A pricing card's line under the price (P4): the clock, "Offer ends in 2d 14:08:33". */
  function cardEnds(offer) {
    var p = el("p", "offer-plan-ends");
    p.innerHTML = icon("clock");
    var seen = el("span", "", "Offer ends in ");
    seen.setAttribute("aria-hidden", "true");
    seen.appendChild(count(offer));
    p.appendChild(seen);
    p.appendChild(el("span", "sr-only", "The offer ends " + whenEnds(offer.lastDay, new Date()) + " at midnight, your time."));
    return p;
  }

  /** Dresses the page in the offer's template, or takes the dress off (null). */
  function dress(offer) {
    var skin = offer ? skinOf(offer) || "plain" : null;
    if (skin) document.documentElement.setAttribute("data-offer", skin);
    else document.documentElement.removeAttribute("data-offer");
  }

  // Every countdown on the page, on one timer: each element carries its end (data-offer-ends, ms).
  var timer = null, listeners = [], told = {};
  function tick() {
    clearTimeout(timer); timer = null;
    var now = Date.now(), coarse = reducedMotion(), soonest = Infinity, done = [];
    var counts = document.querySelectorAll("[data-offer-ends]");
    for (var i = 0; i < counts.length; i++) {
      var end = Number(counts[i].getAttribute("data-offer-ends")), left = end - now, text = countdown(left, coarse);
      if (counts[i].textContent !== text) counts[i].textContent = text;
      if (left <= 0) { if (done.indexOf(end) === -1) done.push(end); } else if (left < soonest) soonest = left;
    }
    done.forEach(function (end) {
      if (told[end]) return;
      told[end] = true;
      listeners.forEach(function (fn) { try { fn(end); } catch (e) { /* one page's handler never stops another's */ } });
    });
    // A hidden tab keeps no timer: coming back ticks at once (below), and the page asks the API again.
    if (soonest < Infinity && document.visibilityState !== "hidden") timer = setTimeout(tick, tickDelay(soonest, coarse) + 15);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { clearTimeout(timer); timer = null; } else tick();
  });
  try {
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.addEventListener) mq.addEventListener("change", tick); else if (mq.addListener) mq.addListener(tick);
  } catch (e) { /* no media queries: once a second */ }

  api.banner = banner;
  api.plansLine = plansLine;
  api.endedNote = endedNote;
  api.cardEnds = cardEnds;
  api.dress = dress;
  /** (Re)starts the countdowns after the page adds or removes some. */
  api.tick = tick;
  /** `fn(endMs)` runs once when a countdown on the page reaches zero. */
  api.watch = function (fn) { listeners.push(fn); };
})();
