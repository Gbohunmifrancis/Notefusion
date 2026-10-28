/**
 * The link inside pasted text, so a share sheet's "Listen to … on Spotify: https://…" is cut down to its link and
 * only the link is sent: the rule the worker's extract_url (server/app/ingest/links.py) applies, as the C# API's
 * SongLinks and web-site/assets/songlink.js do. Whether a link is a song we can read is the worker's alone: any link
 * is looked up, and one it cannot use comes back as the API's plain TRANS_INVALID_LINK sentence.
 *
 * No imports: the tests run on Node's own type stripping.
 */

export type SongProvider = "youtube" | "spotify" | "apple_music" | "instagram" | "tiktok";

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
// A link to one of the services typed without its scheme ("youtube.com/watch?v=…"), read as https://.
const BARE_LINK = /(?:^|[\s(\[<"'“‘«])((?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|spotify\.com|spotify\.link|app\.link|apple\.com|instagram\.com|tiktok\.com)\/[^\s<>"]+)/i;
const TRAILING = /[.,;:!?'")\]}>»”’…]+$/;

/**
 * The first http(s) link in the text, or else the first link to a service typed without "https://", with sentence
 * punctuation trimmed off its end; or null.
 */
export function firstUrl(text: string | null | undefined): string | null {
  const m = URL_IN_TEXT.exec(text ?? "");
  const bare = m ? null : BARE_LINK.exec(text ?? "");
  const raw = m ? m[0] : bare ? `https://${bare[1]}` : null;
  const url = raw ? raw.replace(TRAILING, "") : null;
  // A bare scheme ("https://.") is not a link, as the worker also rules.
  return url && url.length > "https://".length ? url : null;
}

/** The services, by the hosts their links live on. */
const SERVICES: readonly [RegExp, SongProvider][] = [
  [/^(?:www\.)?youtu\.be$|^(?:[a-z0-9-]+\.)*youtube\.com$/, "youtube"],
  [/^open\.spotify\.com$|^spotify(?:\.app)?\.link$/, "spotify"],
  [/^(?:geo\.)?music\.apple\.com$/, "apple_music"],
  [/^(?:www\.|m\.)?instagram\.com$/, "instagram"],
  [/^(?:www\.|m\.|vm\.|vt\.)?tiktok\.com$/, "tiktok"],
];

/**
 * Which service a link's host belongs to, for its mark and words while the server reads it: never a judgement on
 * the link, which the server's answer (`LinkInfo.provider`) replaces. Null for any other host.
 */
export function serviceOf(url: string): SongProvider | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  const host = m ? m[1].toLowerCase().replace(/:\d+$/, "") : "";
  return SERVICES.find(([hosts]) => hosts.test(host))?.[1] ?? null;
}

/** The server's provider as one of ours, or null for one this build does not know. */
export function asProvider(provider: string | null | undefined): SongProvider | null {
  return SERVICES.some(([, p]) => p === provider) ? (provider as SongProvider) : null;
}

/** The services whose own video is fetched; a store's song is found on YouTube by its title and artist. */
export function fetchesItsOwnVideo(provider: SongProvider): boolean {
  return provider === "youtube" || provider === "instagram" || provider === "tiktok";
}

/** `{ url, provider }` for the link in pasted text (`provider` its host's service, or null), or null when it holds none. */
export function extractSongUrl(text: string | null | undefined): { url: string; provider: SongProvider | null } | null {
  const url = firstUrl(text);
  return url ? { url, provider: serviceOf(url) } : null;
}

/** What to tell someone whose text holds no link at all. */
export function songLinkHint(): string {
  return "Paste a link to a YouTube or Instagram video, a Spotify track or an Apple Music song.";
}

/**
 * A lookup refused only for now (YouTube, Instagram or TikTok not answering at this moment): the job reads the link
 * again itself and a failed one costs nothing, so Transcribe stays, with `NOT_NOW_LINE` said instead of the refusal.
 * A refusal for good (no video, private, live, too long) or a link that is not a song still stops it. Mirrors
 * web-site/assets/songlink.js `notNow` and the C# `SongSections.IsForGood`.
 */
export function lookupNotNow(code: string | null | undefined): boolean {
  return code === "TRANS_LINK_REFUSED" || code === "TRANS_LINK_POST_REFUSED";
}

export const NOT_NOW_LINE = "We couldn't read this song's details just now. Transcribe still tries it, from the start.";

/** The longest Transcribe waits on a lookup still going before it sends the link from the start (the web's GRACE_MS). */
export const LOOKUP_GRACE_MS = 6000;
