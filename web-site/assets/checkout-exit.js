/* "What stopped you?" (board g-checkout): after someone comes back from a payment page without paying, one tap
 * says why and the same sheet answers. The rules and the words, kept apart from the page so they are tested
 * (tests/checkout-exit.test.mjs); assets/checkout-why.js draws them, for /app (assets/app.js) and the home
 * pricing (assets/pricing.js). The phone app keeps its own copy in mobile/src/lib/checkoutExit.ts.
 */
(function () {
  "use strict";

  /** The longest "Something else" note, once trimmed (the API's CheckoutExit.NoteMaxLength). */
  var NOTE_MAX = 280;
  /** How many checkouts this browser remembers having asked about. */
  var ASKED_MAX = 20;
  /** Where that list is kept (localStorage). */
  var ASKED_KEY = "nf.checkoutAsked";
  /** Longer than this is not a page left open: the API refuses it (two days). */
  var MAX_SECONDS_OPEN = 2 * 24 * 60 * 60;
  var NOTE_THANKS = "Thanks, we'll read it";
  var THANKS = "Thanks for telling us";

  /** The six answers, in the board's order, each with its icon in the site's sprite (/assets/icons.svg#i-…). */
  var ROWS = [
    { reason: "currency", label: "The price wasn't in my currency", icon: "banknote" },
    { reason: "cardDeclined", label: "My card was declined", icon: "card-x" },
    { reason: "slow", label: "The page was slow or didn't load", icon: "hourglass" },
    { reason: "tooExpensive", label: "It costs too much", icon: "tag" },
    { reason: "justLooking", label: "I'm just looking", icon: "eye" },
    { reason: "somethingElse", label: "Something else", icon: "message" }
  ];

  /** The rows for a checkout in `currency`: the currency one on dollar checkouts only (naira is already theirs). */
  function rows(currency) {
    var dollars = String(currency || "").toUpperCase() === "USD";
    return ROWS.filter(function (r) { return r.reason !== "currency" || dollars; });
  }

  /**
   * Whether to report the return and (if the API agrees) ask: the page was closed without the provider's return,
   * the quick check found no payment, and this checkout has not been asked about here. The website passes
   * returned: false, since its return page cannot tell a cancel from a payment: the API's own look at the
   * provider, made when the return is reported, is what decides there.
   */
  function shouldReportReturn(f) {
    return !!f && !f.returned && f.check === "unpaid" && !!f.reference && (f.asked || []).indexOf(f.reference) < 0;
  }

  /** Whole seconds the page was open, from the moment it was opened to now. */
  function secondsOpen(openedAt, now) {
    if (!isFinite(openedAt) || !isFinite(now)) return 0;
    return Math.min(MAX_SECONDS_OPEN, Math.max(0, Math.round((now - openedAt) / 1000)));
  }

  /** The note as sent: trimmed and cut to NOTE_MAX. */
  function cleanNote(text) { return String(text || "").trim().slice(0, NOTE_MAX); }

  /** The asked list with `reference` first, once, kept to ASKED_MAX. */
  function rememberAsked(asked, reference) {
    return [reference].concat((asked || []).filter(function (r) { return r !== reference; })).slice(0, ASKED_MAX);
  }

  /** The stored asked list, or empty for anything unreadable. */
  function parseAsked(raw) {
    try {
      var value = raw ? JSON.parse(raw) : [];
      return Array.isArray(value) ? value.filter(function (r) { return typeof r === "string"; }).slice(0, ASKED_MAX) : [];
    } catch (e) { return []; }
  }

  /** "$9.99", "₦7,500": the currency's own narrow symbol whatever the browser's language. */
  function formatPrice(amountMinor, currency) {
    var amount = amountMinor / 100;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
    } catch (e) { return currency + " " + amount.toFixed(2); }
  }

  /**
   * The same sheet's answer to a tap (boards 02, 02b): { kind: "answer", title, parts, offerSong, tryAgain },
   * { kind: "toast", message } or { kind: "note" }. `parts` are runs of text, `strong` for the words to act on.
   * ctx: { currency, price, songPrice (null when not on sale to them), buyingSong, keptMinutes }.
   */
  function reply(reason, ctx) {
    var offerSong = !ctx.buyingSong && !!ctx.songPrice;
    switch (reason) {
      case "cardDeclined":
        return { kind: "answer", title: THANKS, offerSong: offerSong, tryAgain: true, parts: [
          { text: "Nothing was charged. Banks sometimes turn down a card payment online. " },
          { text: "Bank transfer", strong: true },
          { text: ", on the same page, usually goes through." }
        ] };
      case "currency":
        return { kind: "answer", title: THANKS, offerSong: false, tryAgain: true, parts: [
          { text: "Your " + ctx.price + " is charged in US dollars. If your card is in another currency, your bank converts it and may add a small fee." }
        ] };
      case "slow":
        return { kind: "answer", title: "Sorry it was slow", offerSong: false, tryAgain: true, parts: [
          { text: "The ways to pay can take up to 20 seconds to appear. " },
          { text: "Try again", strong: true },
          { text: " opens the same checkout: we keep it for " + Math.max(1, Math.round(ctx.keptMinutes || 30)) + " minutes." }
        ] };
      case "tooExpensive":
        return { kind: "answer", title: THANKS, offerSong: offerSong, tryAgain: false, parts: [
          { text: offerSong
            ? "If one song is all you need for now, you can pay for just that, with no subscription."
            : "We read every answer when we set our prices." }
        ] };
      case "justLooking":
        return { kind: "toast", message: ctx.buyingSong ? "Thanks. It's here when you want it." : "Thanks. Pro is here when you want it." };
      case "somethingElse":
        return { kind: "note" };
    }
    return null;
  }

  window.NfCheckoutExit = {
    NOTE_MAX: NOTE_MAX, ASKED_MAX: ASKED_MAX, ASKED_KEY: ASKED_KEY, NOTE_THANKS: NOTE_THANKS, ROWS: ROWS,
    rows: rows, shouldReportReturn: shouldReportReturn, secondsOpen: secondsOpen, cleanNote: cleanNote,
    rememberAsked: rememberAsked, parseAsked: parseAsked, formatPrice: formatPrice, reply: reply
  };
})();
