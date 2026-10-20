/* Region-aware public pricing. Paid amounts come from the API's active seeded plans. */
(function () {
  "use strict";

  var container = document.getElementById("pricing-plans");
  if (!container) return;

  var regionLabel = document.getElementById("pricing-region");
  var regionNote = document.getElementById("pricing-region-note");
  var pricingApi =
    window.location.hostname === "localhost"
      ? "http://localhost:5080/api/billing/public-plans"
      : "https://api.notefusion.studio/api/billing/public-plans";
  var api = window.location.hostname === "localhost" ? "http://localhost:5080" : "https://api.notefusion.studio";
  var TOKENS_KEY = "nf.web.tokens";

  /** Checkout funnel steps for the dashboard; the names match CheckoutSteps in the API. */
  function track(name, detail) { try { if (window.nfTrack) window.nfTrack(name, detail); } catch (e) { /* ignore */ } }
  /** Records the step and only then leaves: a step queued just before a navigation is often lost. */
  function trackThenGo(name, detail, url) {
    var sent;
    try { sent = window.nfTrackNow ? window.nfTrackNow(name, detail) : null; } catch (e) { sent = null; }
    (sent || Promise.resolve()).then(function () { window.location.href = url; });
  }

  // The top of the funnel: the plans scrolled into view, once per page.
  if ("IntersectionObserver" in window) {
    var plansSeen = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { track("Plans viewed", "home"); plansSeen.disconnect(); }
    }, { threshold: 0.4 });
    plansSeen.observe(container);
  }

  /** The web app's session, if this browser has one: the pricing page can then check out directly. */
  function accessToken() {
    try { var t = JSON.parse(localStorage.getItem(TOKENS_KEY) || "null"); return t && t.accessToken ? t.accessToken : null; } catch (e) { return null; }
  }

  /**
   * Upgrade: a signed-in browser goes straight to the hosted checkout for the plan; anyone
   * else is sent to the web app to create an account or sign in, and the plan id rides along so
   * the checkout opens by itself once they are in.
   */
  function trustedCheckout(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" && /(^|\.)(paystack\.com|paystack\.co|bachs\.io|flutterwave\.com)$/i.test(u.hostname);
    } catch (e) { return false; }
  }

  function startCheckout(plan, button) {
    var token = accessToken();
    var fallback = "/app?signup=1&upgrade=" + encodeURIComponent(plan.id);
    if (!token) { trackThenGo("Chose a plan signed out", plan.id, fallback); return; }
    track("Checkout started", plan.id);
    button.disabled = true;
    var label = button.textContent;
    button.textContent = "Opening checkout…";
    fetch(api + "/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      // "web": the provider's return page brings the browser back to /app?paid=1, not to the phone app.
      body: JSON.stringify({ planId: plan.id, client: "web" }),
    })
      .then(function (r) {
        if (r.ok) return r.json();
        return r.json().catch(function () { return null; }).then(function (e) {
          // An earlier checkout turned out to be paid: /app shows the welcome instead of a second charge.
          if (e && e.code === "BILLING_PAYMENT_ALREADY_RECEIVED") { window.location.href = "/app?paid=1"; return null; }
          throw new Error((e && e.code ? e.code + " " : "") + "(HTTP " + r.status + ")");
        });
      })
      .then(function (session) {
        if (session === null) return;
        if (!session || !session.checkoutUrl) throw new Error("No checkout URL in the response");
        // Only the providers' hosted checkouts are followed: https on Paystack or Bachs, nothing else.
        if (!trustedCheckout(session.checkoutUrl)) throw new Error("Unexpected checkout host");
        // What /app compares against when the browser comes back (only non-members are offered a plan here), and what
        // "What stopped you?" needs if Back brings it here unpaid: the checkout's id and the plan "Try again" reopens.
        try {
          localStorage.setItem("nf.checkout", JSON.stringify({
            planId: plan.id, startedAt: Date.now(), wasActive: false, periodEnd: null, lifetime: false, planCode: null,
            reference: session.reference, from: "home", single: plan.interval === "single",
            plan: { id: plan.id, code: plan.code, name: plan.name, amountMinor: plan.amountMinor, currency: plan.currency, interval: plan.interval }
          }));
        } catch (e) { /* private mode: the ?paid=1 return still confirms */ }
        openedHere = true;
        var provider = "";
        try { provider = new URL(session.checkoutUrl).hostname; } catch (e) { /* ignore */ }
        trackThenGo("Checkout opened", provider, session.checkoutUrl);
      })
      .catch(function (err) {
        // An expired session, a plan the account cannot buy, or a provider hiccup: the app sorts it out.
        trackThenGo("Checkout failed", (err && err.message ? err.message : "Network error") + " · home",
          "/app?upgrade=" + encodeURIComponent(plan.id));
      })
      .finally(function () { button.disabled = false; button.textContent = label; });
  }

  /** A tick from the site's icon sprite (Lucide, /assets/icons.svg). */
  function checkIcon() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "ic ic-16");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS(NS, "use");
    use.setAttribute("href", "/assets/icons.svg#i-check");
    svg.appendChild(use);
    return svg;
  }

  function featureList(items) {
    var list = document.createElement("ul");
    items.forEach(function (item) {
      var row = document.createElement("li");
      var copy = document.createElement("span");
      copy.textContent = item;
      row.appendChild(checkIcon());
      row.appendChild(copy);
      list.appendChild(row);
    });
    return list;
  }

  function action(label, featured, source, href, plan) {
    var wrapper = document.createElement("div");
    var cls = "btn " + (featured ? "btn-primary" : "btn-secondary");
    var control;
    if (plan) {
      control = document.createElement("button");
      control.type = "button";
      control.addEventListener("click", function () { startCheckout(plan, control); });
    } else {
      control = document.createElement("a");
      control.href = href || "/app?signup=1";
    }
    control.className = cls;
    if (source) control.setAttribute("data-download-source", source);
    control.textContent = label;
    wrapper.appendChild(control);
    return wrapper;
  }

  /**
   * The free plan: hums and recordings every week (back Friday 18:00 WAT, FreeTier in the API), one short
   * song-link preview, and songs for Pro or one at a time at the region's one-song price when the API sent it.
   */
  function freeCard(trialCount, single) {
    var card = document.createElement("div");
    card.className = "plan";

    var title = document.createElement("h3");
    title.textContent = "Free";
    card.appendChild(title);

    var price = document.createElement("div");
    price.className = "price";
    price.textContent = "Free";
    card.appendChild(price);

    var blurb = document.createElement("p");
    blurb.className = "blurb";
    blurb.textContent = trialCount + " hummed or recorded transcriptions every week, back every Friday evening. No card needed.";
    card.appendChild(blurb);

    card.appendChild(
      featureList([
        trialCount + " hums or recordings a week, back every Friday at 6pm (West Africa Time)",
        "One free preview of a song link: its first minute",
        single
          ? "Song links and whole songs: Pro, or " + formatPrice(single) + " a song"
          : "Song links and whole songs: Pro, or buy just one song",
        "Tonic Solfa and staff notation, all 24 keys",
        "Rehearsal playback, lyrics, transpose and a share link",
      ]),
    );
    card.appendChild(action("Create a free account", false, "pricing_free", "/app?signup=1"));
    return card;
  }

  function formatPrice(plan) {
    var whole = Math.trunc(plan.amountMinor / 100);
    var minor = Math.abs(plan.amountMinor % 100);
    var grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    var major = minor === 0 ? grouped : grouped + "." + String(minor).padStart(2, "0");
    var symbol = plan.currency === "NGN" ? "₦" : plan.currency === "USD" ? "$" : plan.currency + " ";
    return symbol + major;
  }

  function paidCard(plan, featured, saving) {
    var card = document.createElement("div");
    card.className = "plan" + (featured ? " plan--featured" : "");

    if (featured) {
      var tag = document.createElement("span");
      tag.className = "plan-tag";
      tag.textContent = "Best value";
      card.appendChild(tag);
    }

    var title = document.createElement("h3");
    title.textContent = plan.interval === "yearly" ? "Pro Yearly" : "Pro Monthly";
    card.appendChild(title);

    var price = document.createElement("div");
    price.className = "price";
    price.appendChild(document.createTextNode(formatPrice(plan) + " "));
    var period = document.createElement("small");
    period.textContent = plan.interval === "yearly" ? "/ year" : "/ month";
    price.appendChild(period);
    card.appendChild(price);

    var blurb = document.createElement("p");
    blurb.className = "blurb";
    // A year is priced by the month as well, with its saving, under the price (the web app's plans say the same):
    // the saving used to be the card's last line, and the month's figure was nowhere.
    blurb.textContent = plan.interval === "yearly"
      ? formatPrice({ amountMinor: Math.round(plan.amountMinor / 12), currency: plan.currency }) + " a month, paid once a year." +
        (saving ? " Save " + saving + "% against paying monthly." : "")
      : "Whole songs, four parts and every download, for the choir that rehearses every week.";
    card.appendChild(blurb);

    // One payment buys one period; nothing is charged again unless you start a new checkout.
    var billingTerm =
      plan.interval === "yearly"
        ? "A year of Pro, paid once"
        : "A month of Pro, paid once; buy again whenever you like";

    card.appendChild(
      featureList([
        "Whole songs from a link: up to six minutes, twenty a month",
        "Alto, tenor and bass written under every tune",
        "Sing-along marking, note by note",
        "Clean PDF, MusicXML and MIDI downloads",
        "Priority lane: never queued behind anyone",
        billingTerm,
      ]),
    );
    // Each button says what it buys ("Upgrade — ₦7,500 a month"): both used to read "Upgrade to Pro" (signed out, "Sign
    // up and upgrade"), so the buttons alone, as a screen reader lists them, never said which plan was which.
    var cost = formatPrice(plan) + (plan.interval === "yearly" ? " a year" : " a month");
    card.appendChild(action((accessToken() ? "Upgrade — " : "Get Pro — ") + cost, true, "pricing_" + (plan.interval || "pro"), null, plan));
    return card;
  }

  /**
   * No prices to show. `unreachable`: the request itself failed (no connection, a timeout, a fault), which trying again
   * can mend. Otherwise the API could not place the visitor (a VPN, say): no price is guessed, and trying again would
   * only say the same, so the way on is the app, which prices by the account's own country.
   */
  function showError(unreachable) {
    container.className = "plans plans--single reveal is-visible";
    container.setAttribute("aria-busy", "false");
    container.replaceChildren();

    var card = document.createElement("div");
    card.className = "plan plan--loading";
    var title = document.createElement("h3");
    title.textContent = unreachable ? "Prices didn't load" : "Pricing unavailable";
    var message = document.createElement("p");
    message.className = "blurb";
    message.textContent = unreachable
      ? "We couldn't reach NoteFusion just now. Check your connection, then try again."
      : "We couldn't confirm your location, so we won't guess which price applies to you. Your account shows the prices for its country.";
    card.appendChild(title);
    card.appendChild(message);
    if (unreachable) {
      var retry = document.createElement("button");
      retry.className = "btn btn-secondary";
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", load);
      card.appendChild(retry);
    } else {
      card.appendChild(action("See the prices in the app", false, "pricing_location", "/app?upgrade=1"));
    }
    container.appendChild(card);

    if (regionLabel) regionLabel.hidden = true;
    if (regionNote) {
      regionNote.textContent = unreachable ? "Prices didn't load." : "No price is shown because your region could not be confirmed.";
    }
  }

  /** The signed-in browser's subscription when it is active; null for everyone else. */
  function membership() {
    var token = accessToken();
    if (!token) return Promise.resolve(null);
    return fetch(api + "/api/billing/my-subscription", { headers: { Accept: "application/json", Authorization: "Bearer " + token }, cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (sub) { return sub && sub.isActive ? sub : null; })
      .catch(function () { return null; });
  }

  function renderMember(sub) {
    container.className = "plans plans--single reveal is-visible";
    container.setAttribute("aria-busy", "false");
    container.replaceChildren();

    var card = document.createElement("div");
    card.className = "plan plan--featured";
    var tag = document.createElement("span");
    tag.className = "plan-tag";
    tag.textContent = "Your plan";
    card.appendChild(tag);
    var title = document.createElement("h3");
    title.textContent = "You're on NoteFusion Pro";
    card.appendChild(title);
    var blurb = document.createElement("p");
    blurb.className = "blurb";
    var when = sub.currentPeriodEndUtc && !sub.isLifetime
      ? new Date(sub.currentPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "";
    blurb.textContent = sub.isLifetime
      ? "Lifetime access. Thank you for supporting NoteFusion."
      : sub.isGift
        ? "Complimentary access from the NoteFusion team."
        : (sub.planName || "NoteFusion Pro") + (when ? ", Pro until " + when : "") + ". Thank you for supporting NoteFusion.";
    card.appendChild(blurb);
    card.appendChild(
      featureList([
        "Whole songs: up to six minutes, twenty a month",
        "Alto, tenor and bass written under any tune, when you ask",
        "Sing-along marking, note by note",
        "Clean PDF, MusicXML and MIDI downloads",
        "Priority lane: never queued behind anyone",
      ]),
    );
    card.appendChild(action("Open the app", true, "pricing_member", "/app"));
    container.appendChild(card);

    if (regionLabel) regionLabel.hidden = true;
    if (regionNote) regionNote.textContent = "You're signed in as a Pro member; there is nothing to buy here.";
  }

  function render(payload) {
    var country =
      payload && typeof payload.countryCode === "string"
        ? payload.countryCode.toUpperCase()
        : null;
    if (!country || !Array.isArray(payload.plans)) {
      showError();
      return;
    }

    var isNigeria = country === "NG";
    var expectedCurrency = isNigeria ? "NGN" : "USD";
    var plans = payload.plans.filter(function (plan) {
      return (
        plan &&
        plan.currency === expectedCurrency &&
        Number.isFinite(plan.amountMinor) &&
        plan.amountMinor > 0
      );
    });
    var monthly = plans.find(function (plan) {
      return plan.interval === "monthly";
    });
    var yearly = plans.find(function (plan) {
      return plan.interval === "yearly";
    });

    if (!monthly && !yearly) {
      showError();
      return;
    }

    var saving = null;
    if (monthly && yearly) {
      saving = Math.round((1 - yearly.amountMinor / (monthly.amountMinor * 12)) * 100);
      if (saving <= 0) saving = null;
    }

    container.className = "plans reveal is-visible" + (isNigeria ? " plans--nigeria" : "");
    container.setAttribute("aria-busy", "false");
    container.replaceChildren();
    var single =
      payload.single &&
      payload.single.currency === expectedCurrency &&
      Number.isFinite(payload.single.amountMinor) &&
      payload.single.amountMinor > 0
        ? payload.single
        : null;
    container.appendChild(freeCard(3, single));
    if (monthly) container.appendChild(paidCard(monthly, !yearly, saving));
    if (yearly) container.appendChild(paidCard(yearly, true, saving));

    if (regionLabel) {
      regionLabel.textContent = isNigeria ? "Pricing for Nigeria" : "International pricing";
      regionLabel.hidden = false;
    }
    if (regionNote) {
      regionNote.textContent = isNigeria
        ? "Nigerian pricing is shown in naira. One payment buys one month or one year of Pro; nothing is charged again unless you buy another period."
        : "International pricing is shown in US dollars. One payment buys one month or one year of Pro; nothing is charged again unless you buy another period.";
    }
  }

  function load() {
    container.setAttribute("aria-busy", "true");
    var controller = "AbortController" in window ? new AbortController() : null;
    var timeout = controller
      ? window.setTimeout(function () {
          controller.abort();
        }, 8000)
      : null;

    fetch(pricingApi, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Pricing request failed");
        return response.json();
      })
      .then(function (payload) {
        // A member has nothing to buy here: show the membership instead of the prices.
        return membership().then(function (sub) { sub ? renderMember(sub) : render(payload); });
      })
      .catch(function () { showError(true); })
      .finally(function () {
        if (timeout !== null) window.clearTimeout(timeout);
      });
  }

  load();

  // ── Back from a checkout this page opened, unpaid: "What stopped you?" (board g-checkout) ──────────
  // The provider's own return goes to /app, which asks there; Back from the payment page lands here. The rules and
  // words are assets/checkout-exit.js and the sheet assets/checkout-why.js, loaded only then.
  var openedHere = false;
  var whyBusy = false;
  var WHY_ASSETS = ["/assets/checkout-exit.js?v=1", "/assets/checkout-why.css?v=2", "/assets/checkout-why.js?v=2"];
  var whyLoads = {};
  function loadAsset(url) {
    if (!whyLoads[url]) {
      whyLoads[url] = new Promise(function (resolve, reject) {
        var css = /\.css(\?|$)/.test(url), tag = document.createElement(css ? "link" : "script");
        if (css) { tag.rel = "stylesheet"; tag.href = url; } else { tag.src = url; tag.async = false; }
        tag.onload = resolve;
        tag.onerror = function () { tag.remove(); delete whyLoads[url]; reject(new Error("failed " + url)); };
        document.head.appendChild(tag);
      });
    }
    return whyLoads[url];
  }
  function authed(path, body) {
    var token = accessToken();
    if (!token) return Promise.reject(new Error("signed out"));
    return fetch(api + path, {
      method: body ? "POST" : "GET",
      headers: body
        ? { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token }
        : { Accept: "application/json", Authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  /**
   * Reports the return (how long the page was open) and asks when the API says so. The API looks at the provider
   * again before it answers, which is this page's payment check: a paid checkout is fulfilled there and never asked
   * about, and neither is one with a transfer under way. Once per checkout; anything that fails asks nothing.
   */
  function backFromCheckout() {
    var snap = null;
    try { snap = JSON.parse(localStorage.getItem("nf.checkout") || "null"); } catch (e) { snap = null; }
    if (whyBusy || !accessToken() || !snap || snap.from !== "home" || !snap.reference || !(Date.now() - snap.startedAt < 2 * 60 * 60 * 1000)) return;
    whyBusy = true;
    var returnedAt = Date.now();
    var exitPath = "/api/billing/checkouts/" + encodeURIComponent(snap.reference) + "/exit";
    Promise.all(WHY_ASSETS.map(loadAsset)).then(function () {
      var X = window.NfCheckoutExit;
      var asked;
      try { asked = X.parseAsked(localStorage.getItem(X.ASKED_KEY)); } catch (e) { asked = []; }
      if (!X.shouldReportReturn({ returned: false, check: "unpaid", reference: snap.reference, asked: asked })) return null;
      var seconds = X.secondsOpen(snap.startedAt, returnedAt);
      return Promise.all([
        authed(exitPath, { secondsOpen: seconds }),
        authed("/api/billing/plans/single").catch(function () { return []; })
      ]).then(function (got) {
        try { localStorage.setItem(X.ASKED_KEY, JSON.stringify(X.rememberAsked(asked, snap.reference))); } catch (e) { /* private mode */ }
        var reply = got[0];
        var song = (got[1] || []).filter(function (p) { return p.interval === "single"; })[0];
        if (!reply || !reply.ask) return;
        window.NfCheckoutWhy.open({
          currency: reply.currency,
          price: X.formatPrice(reply.amountMinor, reply.currency),
          songPrice: song ? X.formatPrice(song.amountMinor, song.currency) : null,
          buyingSong: !!snap.single,
          keptMinutes: reply.keptMinutes,
          onAnswer: function (reason, note) {
            var body = { secondsOpen: seconds, reason: reason };
            if (note) body.note = note;
            authed(exitPath, body).catch(function () { /* a lost answer is only a missing row */ });
          },
          // The same plan: the API hands back the same checkout while it is kept.
          onTryAgain: function () { if (snap.plan) startCheckout(snap.plan, document.createElement("button")); },
          onSong: function () { if (song) startCheckout(song, document.createElement("button")); }
        });
      });
    }).catch(function () { /* offline or refused: nothing recorded, so nothing to ask */ })
      .then(function () { whyBusy = false; });
  }
  window.addEventListener("pageshow", function (e) { if (e.persisted) backFromCheckout(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && openedHere) backFromCheckout(); });
  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav && nav.type === "back_forward") backFromCheckout(); // a Back that reloaded the page
  } catch (e) { /* no navigation timing: nothing to tell */ }
})();

