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

  /** The web app's session, if this browser has one: the pricing page can then check out directly. */
  function accessToken() {
    try { var t = JSON.parse(localStorage.getItem(TOKENS_KEY) || "null"); return t && t.accessToken ? t.accessToken : null; } catch (e) { return null; }
  }

  /**
   * Upgrade: a signed-in browser goes straight to the hosted checkout for the plan; anyone
   * else is sent to the web app to create an account or sign in, and the plan id rides along so
   * the checkout opens by itself once they are in.
   */
  function startCheckout(plan, button) {
    var token = accessToken();
    var fallback = "/app?signup=1&upgrade=" + encodeURIComponent(plan.id);
    if (!token) { window.location.href = fallback; return; }
    button.disabled = true;
    var label = button.textContent;
    button.textContent = "Opening checkout…";
    fetch(api + "/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ planId: plan.id }),
    })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (session) {
        if (!session || !session.checkoutUrl) throw new Error("no url");
        window.location.href = session.checkoutUrl;
      })
      .catch(function () {
        // An expired session, a plan the account cannot buy, or a provider hiccup: the app sorts it out.
        window.location.href = "/app?upgrade=" + encodeURIComponent(plan.id);
      })
      .finally(function () { button.disabled = false; button.textContent = label; });
  }

  function checkIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "17");
    svg.setAttribute("height", "17");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    var tick = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    tick.setAttribute("points", "20 6 9 17 4 12");
    svg.appendChild(tick);
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
    wrapper.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-top:4px;";
    var cls = "btn " + (featured ? "btn-primary btn--primary" : "btn-ghost btn--ghost");
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
    blurb.textContent = "Whole songs, four parts, every download — for the choir that rehearses every week.";
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
    retry.className = "btn btn--ghost";
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
    container.appendChild(freeCard(isNigeria ? 5 : 10));
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
      .then(render)
      .catch(showError)
      .finally(function () {
        if (timeout !== null) window.clearTimeout(timeout);
      });
  }

  load();
})();

