/* Region-aware public pricing. Paid amounts come from the API's active seeded plans. */
(function () {
  "use strict";

  var container = document.getElementById("pricing-plans");
  if (!container) return;

  var regionLabel = document.getElementById("pricing-region");
  var regionNote = document.getElementById("pricing-region-note");
  var pricingApi =
    "https://notefusion-api-3c2513a1e974.herokuapp.com/api/billing/public-plans";
  var playUrl = "https://play.google.com/store/apps/details?id=com.notefusion.com";

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

  function action(label, featured, source) {
    var link = document.createElement("a");
    link.className = "btn " + (featured ? "btn-primary btn--primary" : "btn-ghost btn--ghost");
    link.href = playUrl;
    link.target = "_blank";
    link.rel = "noopener";
    if (source) link.setAttribute("data-download-source", source);
    link.textContent = label;
    return link;
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
    blurb.textContent = "Try the complete transcription workflow before upgrading.";
    card.appendChild(blurb);

    card.appendChild(
      featureList([
        "Your first " + trialCount + " transcriptions",
        "Tonic Solfa and staff notation",
        "All 24 keys with one-tap re-keying",
        "Playback, MusicXML export and library sync",
      ]),
    );
    card.appendChild(action("Download Free App", false, "pricing_free"));
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
      tag.textContent = plan.interval === "lifetime" ? "One payment" : "Best value";
      card.appendChild(tag);
    }

    var title = document.createElement("h3");
    title.textContent =
      plan.interval === "lifetime"
        ? "Pro Lifetime"
        : plan.interval === "yearly"
          ? "Pro Yearly"
          : "Pro Monthly";
    card.appendChild(title);

    var price = document.createElement("div");
    price.className = "price";
    price.appendChild(document.createTextNode(formatPrice(plan) + " "));
    var period = document.createElement("small");
    period.textContent =
      plan.interval === "lifetime"
        ? "one-time"
        : plan.interval === "yearly"
          ? "/ year"
          : "/ month";
    price.appendChild(period);
    card.appendChild(price);

    var blurb = document.createElement("p");
    blurb.className = "blurb";
    blurb.textContent =
      plan.interval === "lifetime"
        ? "Pay once and keep NoteFusion Pro for life."
        : "Unlimited transcription for regular rehearsals, teaching and arranging.";
    card.appendChild(blurb);

    var billingTerm =
      plan.interval === "lifetime"
        ? "One payment; Pro access does not expire"
        : plan.interval === "yearly"
          ? saving
            ? "Save " + saving + "% compared with paying monthly"
            : "Renews yearly until cancelled"
          : "Renews monthly until cancelled";

    card.appendChild(
      featureList([
        "Unlimited transcriptions",
        "Everything in Free, nothing held back",
        billingTerm,
        "A receipt emailed after payment",
      ]),
    );
    card.appendChild(action("Get NoteFusion Pro", true, "pricing_" + (plan.interval || "pro")));
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
    var lifetime = plans.find(function (plan) {
      return plan.interval === "lifetime";
    });

    if ((isNigeria && (!monthly || !yearly)) || (!isNigeria && !lifetime)) {
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
    if (isNigeria) {
      container.appendChild(paidCard(monthly, false, saving));
      container.appendChild(paidCard(yearly, true, saving));
    } else {
      container.appendChild(paidCard(lifetime, true, null));
    }

    if (regionLabel) {
      regionLabel.textContent = isNigeria ? "Pricing for Nigeria" : "International pricing";
      regionLabel.hidden = false;
    }
    if (regionNote) {
      regionNote.textContent = isNigeria
        ? "Nigerian pricing is shown in naira; monthly and yearly plans renew until cancelled."
        : "International pricing is shown in US dollars as a one-time lifetime purchase.";
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
