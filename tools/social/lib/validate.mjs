// The checks every post passes before it can go out, written or templated. See voice.md for why.
import { weightedLength, findUrls, emojiIn } from "./xtext.mjs";

export const MAX_LENGTH = 260; // X allows 280; the margin keeps a post from being cut on a client that counts differently
export const MAX_HASHTAGS = 2;
export const MAX_EMOJI = 1;
export const SITE = "https://notefusion.studio";

/** Hype and cliché the voice never uses. Matched as whole words, case-insensitive. */
export const BANNED = [
  "revolutionary", "revolutionise", "revolutionize", "game-changer", "game changer", "game-changing", "groundbreaking",
  "cutting-edge", "disrupt", "disruptive", "unleash", "supercharge", "seamless", "seamlessly", "next-level", "world-class",
  "best-in-class", "mind-blowing", "insane", "magic", "magical", "10x", "excited to announce", "thrilled to",
  "unlock the power", "skyrocket", "effortless", "effortlessly", "state-of-the-art", "the future of", "buckle up",
];

/** What must never reach a public post: addresses, internal hosts, config names, anything shaped like a key. */
const LEAKS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "an IP address"],
  [/\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0/i, "a local address"],
  [/\b(?:api|admin|console)\.notefusion\.studio\b/i, "an internal hostname"],
  [/amazonaws|herokuapp|vercel\.app|\bec2\b|github\.com/i, "an infrastructure hostname"],
  [/\b[A-Za-z][A-Za-z0-9]*__[A-Za-z0-9_]+\b/, "a configuration key"],
  [/\b(?:NF|X|GEMINI|GITHUB|VERCEL)_[A-Z_]{3,}\b/, "an environment variable"],
  [/\b(?:sk-|ghp_|gho_|ghs_|github_pat_|AIza|xox[abp]-)[\w-]{6,}/, "something shaped like a key"],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/, "something shaped like a token"],
];

const HASHTAG = /(?:^|[^\w&])#([\p{L}\p{N}_]+)/gu;
const MENTION = /(?:^|[^\w])@\w/;
const NUMBER = /\d+(?:[.,:/]\d+)*/g;

/** The numbers a text states, each as its digit runs ("3/4" → "3", "4"; "1,398" → "1398"). */
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(NUMBER)) {
    const raw = m[0];
    out.add(raw.replace(/,/g, ""));
    for (const part of raw.split(/[.:/]/)) out.add(part.replace(/,/g, ""));
  }
  return out;
}

export function hashtagsIn(text) {
  return [...String(text).matchAll(HASHTAG)].map((m) => m[1]);
}

/**
 * The post's problems; none means it may go out.
 * @param {string} text
 * @param {{ allowLink?: boolean, linkUrl?: string, facts?: string }} [opts]
 *   allowLink  a link to notefusion.studio is allowed (posts with a link cost X more; see docs/SOCIAL.md)
 *   facts      the story's source text: every number the post states must appear there, so it cannot invent one
 */
export function validatePost(text, opts = {}) {
  const errors = [];
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, errors: ["The post is empty."], length: 0 };
  const length = weightedLength(t);
  if (length > MAX_LENGTH) errors.push(`It is ${length} characters as X counts them; the most is ${MAX_LENGTH}.`);

  const tags = hashtagsIn(t);
  if (tags.length > MAX_HASHTAGS) errors.push(`It has ${tags.length} hashtags; use at most ${MAX_HASHTAGS}.`);
  const emoji = emojiIn(t);
  if (emoji.length > MAX_EMOJI) errors.push(`It has ${emoji.length} emoji; use at most ${MAX_EMOJI}.`);
  const dashes = (t.match(/—/g) || []).length;
  if (dashes > 1) errors.push(`It has ${dashes} em dashes; use at most one.`);
  if (MENTION.test(t)) errors.push("It mentions an account (@...); mention nobody.");

  const lower = t.toLowerCase();
  const hype = BANNED.filter((w) => new RegExp(`(?<![\\w-])${w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w-])`, "i").test(lower));
  if (hype.length) errors.push(`It uses hype words: ${hype.join(", ")}.`);

  for (const [re, what] of LEAKS) if (re.test(t)) errors.push(`It contains ${what}.`);

  const urls = findUrls(t).map((u) => u.url);
  if (urls.length && !opts.allowLink) errors.push("It has a link; leave links out of this post.");
  else if (urls.length > 1) errors.push("It has more than one link.");
  else if (urls.length === 1) {
    const u = /^https?:\/\//i.test(urls[0]) ? urls[0] : `https://${urls[0]}`;
    let host = "";
    try { host = new URL(u).hostname.toLowerCase(); } catch { /* reported below */ }
    if (host !== "notefusion.studio" && host !== "www.notefusion.studio") errors.push(`The link ${urls[0]} is not on notefusion.studio.`);
  }

  if (opts.facts != null) {
    const known = numbersIn(opts.facts);
    let prose = t.replace(HASHTAG, " ");
    for (const u of urls) prose = prose.split(u).join(" ");
    const invented = [...numbersIn(prose)].filter((n) => !known.has(n) && !/[.:/]/.test(n));
    if (invented.length) errors.push(`It states numbers the story does not: ${invented.join(", ")}. Use only numbers from the story, or none.`);
  }
  return { ok: errors.length === 0, errors, length };
}
