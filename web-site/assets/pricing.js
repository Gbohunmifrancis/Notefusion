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
      return u.protocol === "https:" && /(^|\.)(paystack\.com|paystack\.co|bachs\.io)$/i.test(u.hostname);
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
        // What /app compares against when the browser comes back (only non-members are offered a plan here).
        try {
          localStorage.setItem("nf.checkout", JSON.stringify({
            planId: plan.id, startedAt: Date.now(), wasActive: false, periodEnd: null, lifetime: false, planCode: null
          }));
        } catch (e) { /* private mode: the ?paid=1 return still confirms */ }
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

  function freeCard(trialCount) {
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
    blurb.textContent = "Hum a tune, preview a song, keep the sheet. No card needed.";
    card.appendChild(blurb);

    card.appendChild(
      featureList([
        "One song preview from a link (the first minute)",
        "Hummed and sung tunes, " + trialCount + " to start",
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
    blurb.textContent = "Whole songs, four parts and every download, for the choir that rehearses every week.";
    card.appendChild(blurb);

    // One payment buys one period; nothing is charged again unless you start a new checkout.
    var billingTerm =
      plan.interval === "yearly"
        ? (saving ? "A year of Pro; save " + saving + "% against paying monthly" : "A year of Pro, paid once")
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
    card.appendChild(action(accessToken() ? "Upgrade to Pro" : "Sign up and upgrade", true, "pricing_" + (plan.interval || "pro"), null, plan));
    return card;
  }

  function showError() {
    container.className = "plans plans--single reveal is-visible";
    container.setAttribute("aria-busy", "false");
    container.replaceChildren();

    var card = document.createElement("div");
    card.className = "plan plan--loading";
    var title = document.createElement("h3");
    title.textContent = "Pricing unavailable";
    var message = document.createElement("p");
    message.className = "blurb";
    message.textContent =
      "We couldn't confirm your location, so we won't guess which price applies to you.";
    var retry = document.createElement("button");
    retry.className = "btn btn-secondary";
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", load);
    card.appendChild(title);
    card.appendChild(message);
    card.appendChild(retry);
    container.appendChild(card);

    if (regionLabel) regionLabel.hidden = true;
    if (regionNote) {
      regionNote.textContent = "No price is shown because your region could not be confirmed.";
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
    container.appendChild(freeCard(3));
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
      .catch(showError)
      .finally(function () {
        if (timeout !== null) window.clearTimeout(timeout);
      });
  }

  load();
})();

