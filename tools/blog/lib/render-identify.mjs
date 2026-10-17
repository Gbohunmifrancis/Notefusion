// /hymns/identify: "Hum to find a hymn". A visitor hums a few bars, assets/hymn-identify.js records up to
// twenty seconds with the site's recorder (assets/recorder.js) and posts it to the API's anonymous
// POST /api/hymns/identify, which asks the worker's hymn matcher; the page shows the hymn found with a link to
// its solfa page, or how to hum it more clearly. Free, no account; nothing about the recording is kept.
import { ORIGIN, ASSET_VERSION } from "./site.mjs";
import { escapeHtml } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox, icon } from "./layout.mjs";

export const IDENTIFY_PATH = "/hymns/identify";
/** The page's own date for the sitemap: change it when the page changes, so a rebuild stays byte-for-byte the same. */
export const IDENTIFY_UPDATED = "2026-10-17";
/** The most of a hum that is heard; the worker's NF_IDENTIFY_MAX_SECONDS. */
export const IDENTIFY_MAX_SECONDS = 20;

const TITLE = "Find a Hymn by Humming It — Hum to Find a Hymn | NoteFusion";
const DESCRIPTION = "Can't remember a hymn's name? Hum or sing a few bars and NoteFusion tells you which hymn it is, with its tonic solfa, words and sheet music. Free.";

function faq(count) {
  return [
    { q: "How do I find a hymn by humming it?", a: `Press “Hum a tune”, allow the microphone, and hum or sing the first line or two of the hymn — up to ${IDENTIFY_MAX_SECONDS} seconds. Press Stop, then “Find this hymn”. If the tune is one of ours, you get its name and a link to its page, with the tonic solfa, the words, the staff notation and a piano to sing along with.` },
    { q: "Which hymns can it recognise?", a: `The ${count} hymns and hymn tunes in the NoteFusion hymnal, from Amazing Grace and Abide with Me to the tunes of the old hymn books, in any key and at any speed. It only names a hymn when it is sure; if it is not, it says so rather than guess.` },
    { q: "Do I need to sing the words?", a: "No. Humming, la-la or the words all work: it listens to the tune, not the words. Hum steadily and clearly, in a quiet room, starting from the beginning of the hymn or of the chorus." },
    { q: "Is it free, and what happens to my recording?", a: "It is free and needs no account. The recording is used only to find the tune and is deleted as soon as the answer is sent back; nothing about it is kept." },
  ];
}

export function renderIdentify({ hymns, tunes = [] }) {
  const count = hymns.length + tunes.length;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [IDENTIFY_PATH, "Hum to find a hymn"]];
  const questions = faq(count);
  const body = `${breadcrumbs(crumbs)}
<header class="masthead identify-masthead">
  <h1>Hum a hymn, find its name</h1>
  <p class="masthead-dek">Can't remember what a hymn is called? Hum or sing the first line or two and NoteFusion tells you which hymn it is, with its tonic solfa, words and sheet music. Free, no account needed.</p>
</header>

<section class="identify" id="identify" aria-labelledby="identify-title">
  <h2 id="identify-title" class="visually-hidden">Hum to find a hymn</h2>
  <div class="identify-start" id="identify-start">
    <button type="button" class="identify-record" id="identify-record" data-track="Hymn identify: record" disabled>
      ${icon("mic")}
      <span>Hum a tune</span>
    </button>
    <p class="identify-hint">Up to ${IDENTIFY_MAX_SECONDS} seconds: the first line or two, steadily and clearly. Words, la-la or humming all work.</p>
    <p class="identify-alt"><label class="identify-file-label">or choose a recording <input type="file" id="identify-file" accept="audio/*" class="visually-hidden"></label></p>
  </div>
  <div class="identify-status" id="identify-status" role="status" aria-live="polite"></div>
  <div class="identify-result" id="identify-result" hidden tabindex="-1"></div>
  <noscript><p class="identify-hint">Turn on JavaScript to record a tune. You can still <a href="/hymns">browse every hymn</a> by title, first line or tune.</p></noscript>
  <p class="identify-privacy">Your recording is used only to find the tune and is deleted straight away.</p>
</section>

<section class="identify-about" aria-labelledby="tips-title">
  <h2 id="tips-title">How to hum it so it's recognised</h2>
  <ul class="tips">
    <li><strong>Start at the beginning</strong> of the hymn or of its chorus — the first line or two, about ten to twenty seconds.</li>
    <li><strong>Hum slowly and steadily</strong>, one clear note at a time. Any key and any speed is fine.</li>
    <li><strong>Find a quiet spot</strong> and hold the phone or laptop near you; music playing in the background confuses it.</li>
    <li><strong>No luck?</strong> Try again from the first line, or <a href="/hymns">browse all ${count} hymns and tunes</a> by title, first line or tune.</li>
  </ul>
</section>

<section class="faq identify-about" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions</h2>
${questions.map((f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>

<div class="identify-about">
${ctaBox("identify")}
</div>`;

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Hum to find a hymn",
      url: ORIGIN + IDENTIFY_PATH,
      description: DESCRIPTION,
      applicationCategory: "MusicApplication",
      operatingSystem: "Any (web browser)",
      browserRequirements: "Requires a microphone and JavaScript.",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "NoteFusion", url: ORIGIN + "/" },
    },
    breadcrumbLd(crumbs),
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  return page({
    path: IDENTIFY_PATH, title: TITLE, description: DESCRIPTION, jsonLd: ld, body, active: "/hymns", bodyClass: "identify-page",
    head: `<link rel="stylesheet" href="/assets/hymn-identify.css?v=${ASSET_VERSION.hymnIdentifyCss}">`,
    // The recorder's styles are only needed once it opens on a tap: loaded after the page, never blocking its first paint.
    scripts: `<link rel="stylesheet" href="/assets/recorder.css?v=${ASSET_VERSION.recorderCss}">\n<script src="/assets/recorder.js?v=${ASSET_VERSION.recorderJs}" defer></script>\n<script src="/assets/hymn-identify.js?v=${ASSET_VERSION.hymnIdentifyJs}" defer></script>`,
  });
}

/** The line on the hymn index that points here. */
export function identifyCallout() {
  return `<p class="identify-callout"><a href="${IDENTIFY_PATH}" data-track="Hymns: hum to find">Can't remember the name? <strong>Hum the tune and we'll find the hymn</strong> ${icon("arrow-right", "ic-16")}</a></p>`;
}
