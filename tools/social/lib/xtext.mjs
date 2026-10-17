// How long X thinks a post is: twitter-text v3's weighted length, without the dependency.
//
// X counts in weights: most Latin, Greek, Cyrillic, Hebrew, Arabic and general punctuation weigh 1, everything
// else (CJK, most symbols) weighs 2, an emoji (one grapheme cluster, however many code points) weighs 2, and
// every URL weighs 23 whatever its length. The limit is 280. Text is NFC-normalised first.
// https://docs.x.com/resources/fundamentals/counting-characters

/** The code point ranges that weigh 1 (twitter-text config v3); everything else weighs 2. */
const LIGHT = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
export const URL_WEIGHT = 23;
export const X_LIMIT = 280;

/**
 * The top-level domains a bare "word.tld" is linked under. Not the whole list: enough that a domain the
 * post could plausibly name is counted (and caught) as a link. A false hit only over-counts.
 */
const TLDS = "com|org|net|io|ai|app|dev|co|studio|ng|uk|us|me|ly|gg|xyz|so|tv|fm|sh|info|biz|page|site|music|church|africa|edu|gov|tech|online|store|blog|link|to|in|ke|gh|za";
const URL_RE = new RegExp(
  String.raw`(?<![\w@.\-/])(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS})(?![a-z0-9-])(?::\d+)?(?:\/[^\s]*)?`,
  "gi",
);
const TRAILING = /[.,!?;:'")\]]+$/;

/** The links X would make of this text: [{ url, index }]. Trailing punctuation is not part of a link. */
export function findUrls(text) {
  const out = [];
  for (const m of String(text).normalize("NFC").matchAll(URL_RE)) {
    const url = m[0].replace(TRAILING, "");
    if (url) out.push({ url, index: m.index });
  }
  return out;
}

const EMOJI = /\p{Emoji_Presentation}|\ufe0f|\p{Regional_Indicator}|\u20e3/u; // shown as emoji (a bare © or ♪ is text)
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** True for a grapheme cluster X counts as one emoji. */
export function isEmoji(grapheme) {
  return EMOJI.test(grapheme) && !/^[\x00-\x7f]$/.test(grapheme);
}

/** The emoji in the text, one entry per grapheme cluster. */
export function emojiIn(text) {
  return [...segmenter.segment(String(text).normalize("NFC"))].map((s) => s.segment).filter(isEmoji);
}

function codePointWeight(cp) {
  return LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
}

/** X's weighted length of a post. */
export function weightedLength(text) {
  const s = String(text).normalize("NFC");
  let total = 0;
  let pos = 0;
  const count = (chunk) => {
    for (const { segment } of segmenter.segment(chunk)) {
      if (isEmoji(segment)) { total += 2; continue; }
      for (const ch of segment) total += codePointWeight(ch.codePointAt(0));
    }
  };
  for (const { url, index } of findUrls(s)) {
    count(s.slice(pos, index));
    total += URL_WEIGHT;
    pos = index + url.length;
  }
  count(s.slice(pos));
  return total;
}
