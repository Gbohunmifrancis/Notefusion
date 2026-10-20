/* "What stopped you?" on the website (board g-checkout 04): the same ask as the phone app's, in the site's own pop-up.
 * At phone width a bottom sheet in the tool pop-up's shape (12 px top corners, the 40 px grabber), past 640 px the
 * centred dialog. Six one-tap rows and "Not now"; a tap is answered in the same sheet, "Something else" opens a short
 * text box, "I'm just looking" closes with a toast. The words and rules are assets/checkout-exit.js; this file only
 * draws them. Loaded when a checkout comes back unpaid, by /app (assets/app.js) and the home pricing (assets/pricing.js),
 * with assets/checkout-why.css.
 */
(function () {
  "use strict";

  var shown = null; // { root, card, opts, lastFocus, after }

  function icon(id) {
    return '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-' + id + '"/></svg>';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text) {
    var b = el("button", cls, text);
    b.type = "button";
    return b;
  }

  /**
   * Opens the ask. opts: { currency, price, songPrice (null when not on sale to them), buyingSong, keptMinutes,
   * onAnswer(reason, note) (fire and forget), onTryAgain(), onSong(), onClose() }. Not now, Escape, the scrim and
   * Close send nothing.
   */
  function open(opts) {
    close(true);
    var root = el("div", "why-modal");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "why-title");
    var card = el("div", "why-card");
    card.tabIndex = -1;
    root.appendChild(card);
    shown = { root: root, card: card, opts: opts, lastFocus: document.activeElement, after: null };
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    root.addEventListener("keydown", trap);
    document.body.appendChild(root);
    ask();
  }

  /**
   * Swaps what the sheet shows: the old body leaves, the new one fades in (200 ms, no bounce). Focus moves into the
   * sheet itself, so a screen reader reads it from the title and Tab reaches the rows, without a ring on a row
   * nobody chose; the text box takes it, to be typed in.
   */
  function render(build, field) {
    if (!shown) return;
    var body = el("div", "why-body");
    build(body);
    shown.card.innerHTML = "";
    shown.card.appendChild(body);
    var target = field ? body.querySelector(field) : shown.card;
    if (target) target.focus({ preventScroll: true });
  }

  function heading(body, text) {
    var h = el("h2", null, text);
    h.id = "why-title";
    body.appendChild(h);
  }

  function ask() {
    var X = window.NfCheckoutExit, o = shown.opts;
    render(function (body) {
      heading(body, "No payment was made");
      body.appendChild(el("p", "why-lead", "What stopped you? One tap helps us fix it."));
      var list = el("div", "why-rows");
      X.rows(o.currency).forEach(function (r) {
        var b = button("why-row");
        b.innerHTML = '<span class="why-tile">' + icon(r.icon) + "</span>";
        b.appendChild(el("span", null, r.label));
        b.addEventListener("click", function () { tap(r.reason); });
        list.appendChild(b);
      });
      body.appendChild(list);
      var foot = el("div", "why-foot");
      var later = button("why-text", "Not now");
      later.addEventListener("click", function () { close(); });
      foot.appendChild(later);
      body.appendChild(foot);
    });
  }

  function tap(reason) {
    var X = window.NfCheckoutExit, o = shown.opts;
    var r = X.reply(reason, o);
    if (!r) return;
    if (r.kind === "note") { note(); return; }
    o.onAnswer(reason);
    if (r.kind === "toast") { close(); toast(r.message); return; }
    answer(r);
  }

  function answer(r) {
    var o = shown.opts;
    render(function (body) {
      heading(body, r.title);
      var lead = el("p", "why-lead");
      r.parts.forEach(function (p) { lead.appendChild(p.strong ? el("b", null, p.text) : document.createTextNode(p.text)); });
      body.appendChild(lead);
      // A person to ask, under every answer: the one tap above may not have been the whole story.
      var help = el("p", "why-lead", "Still stuck? Write to ");
      var mail = el("a", null, "hello@notefusion.studio"); mail.href = "mailto:hello@notefusion.studio";
      help.appendChild(mail); help.appendChild(document.createTextNode(" and we'll help you pay."));
      body.appendChild(help);
      if (r.offerSong && o.songPrice) {
        var offer = button("why-offer");
        offer.innerHTML = '<span class="why-tile">' + icon("disc") + "</span>";
        var words = el("span");
        words.appendChild(el("b", null, "Just this song"));
        words.appendChild(el("small", null, "A smaller payment, no subscription."));
        offer.appendChild(words);
        offer.appendChild(el("span", "why-price", o.songPrice));
        offer.setAttribute("aria-label", "Just this song, " + o.songPrice + ". A smaller payment, no subscription.");
        offer.addEventListener("click", function () { close(false, o.onSong); });
        body.appendChild(offer);
      }
      var foot = el("div", "why-foot");
      var done = button("why-text", "Close");
      done.addEventListener("click", function () { close(); });
      foot.appendChild(done);
      if (r.tryAgain) {
        var again = button("btn btn-primary why-go", "Try again");
        again.addEventListener("click", function () { close(false, o.onTryAgain); });
        foot.appendChild(again);
      }
      body.appendChild(foot);
    });
  }

  function note() {
    var X = window.NfCheckoutExit, o = shown.opts;
    render(function (body) {
      heading(body, "What stopped you?");
      body.appendChild(el("p", "why-lead", "A line is plenty. We read every one."));
      var field = el("textarea", "why-field");
      field.maxLength = X.NOTE_MAX;
      field.rows = 4;
      field.placeholder = "What got in the way?";
      field.setAttribute("aria-label", "What stopped you?");
      body.appendChild(field);
      var count = el("p", "why-count", "0 / " + X.NOTE_MAX);
      count.setAttribute("aria-live", "polite");
      body.appendChild(count);
      var foot = el("div", "why-foot");
      var back = button("why-text", "Back");
      back.addEventListener("click", ask);
      var send = button("btn btn-primary why-go", "Send");
      send.disabled = true;
      field.addEventListener("input", function () {
        count.textContent = field.value.length + " / " + X.NOTE_MAX;
        send.disabled = !X.cleanNote(field.value);
      });
      send.addEventListener("click", function () {
        var words = X.cleanNote(field.value);
        if (!words) return;
        o.onAnswer("somethingElse", words);
        close();
        toast(X.NOTE_THANKS);
      });
      foot.appendChild(back);
      foot.appendChild(send);
      body.appendChild(foot);
    }, ".why-field");
  }

  /** Closes the sheet; `then` runs once it has gone (a checkout opened from it). */
  function close(silent, then) {
    if (!shown) return;
    var s = shown;
    shown = null;
    s.root.remove();
    if (s.lastFocus && s.lastFocus.focus && s.lastFocus !== document.body) {
      try { s.lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
    }
    if (!silent && s.opts.onClose) s.opts.onClose();
    if (then) then();
  }

  /** Escape closes this sheet only (not a page's dialog under it); Tab stays inside the sheet. */
  function trap(e) {
    if (!shown) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    var items = Array.prototype.filter.call(shown.card.querySelectorAll("button, textarea"), function (x) { return !x.disabled; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Good news that leaves by itself: a tick and a few words, 2.5 s. */
  function toast(message) {
    var old = document.querySelector(".why-toast");
    if (old) old.remove();
    var t = el("div", "why-toast");
    t.setAttribute("role", "status");
    t.innerHTML = icon("check");
    t.appendChild(el("span", null, message));
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("is-leaving"); }, 2300);
    setTimeout(function () { t.remove(); }, 2500);
  }

  window.NfCheckoutWhy = { open: open, close: function () { close(); }, toast: toast };
})();
