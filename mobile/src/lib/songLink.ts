/**
 * The song link inside pasted text: the one rule the worker (server/app/ingest/links.py) applies,
 * mirrored here — as web-site/assets/songlink.js and the C# `SongLinks` do — so a share sheet's
 * "Listen to … on Spotify: https://…" is read the same way everywhere, a wrong link gets a plain
 * answer at once, and only the link itself is sent. Keep the four in lock-step.
 *
 * No imports: the tests run on Node's own type stripping.
 */

export type SongProvider = "youtube" | "spotify" | "apple_music" | "instagram" | "tiktok";

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i;
// A link to one of the services typed without its scheme ("youtube.com/watch?v=…"), read as https://.
const BARE_LINK = /(?:^|[\s(\[<"'“‘«])((?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|spotify\.com|spotify\.link|app\.link|apple\.com|instagram\.com|tiktok\.com)\/[^\s<>"]+)/i;
const TRAILING = /[.,;:!?'")\]}>»”’…]+$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;
const TIKTOK_ID = /^\d{8,24}$/;
const SHORT_CODE = /^[A-Za-z0-9_-]{4,32}$/;

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

/** Host, path segments and query of a URL without `new URL()`, which RN's polyfill handles unevenly. */
function parts(url: string): { host: string; path: string[]; query: Map<string, string> } | null {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/:\d+$/, "");
  const path = m[2].split("/").filter(Boolean).map((s) => safeDecode(s));
  const query = new Map<string, string>();
  for (const pair of (m[3] ?? "").split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    const v = eq < 0 ? "" : safeDecode(pair.slice(eq + 1));
    if (!query.has(k)) query.set(k, v);
  }
  return { host, path, query };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** Which service a single-song link points at, or null when it is not one we can read. */
export function providerOf(url: string): SongProvider | null {
  const u = parts(url);
  if (!u) return null;
  const { host, path, query } = u;
  if (host === "youtu.be" || host === "www.youtu.be") return path[0] && VIDEO_ID.test(path[0]) ? "youtube" : null;
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    if (path[0] === "watch") return VIDEO_ID.test(query.get("v") ?? "") ? "youtube" : null;
    if (path[0] === "shorts" || path[0] === "live" || path[0] === "embed") {
      return path[1] && VIDEO_ID.test(path[1]) ? "youtube" : null;
    }
    return null;
  }
  if (host === "open.spotify.com") {
    const at = /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(path[0] ?? "") ? 1 : 0;
    return path[at] === "track" && /^[A-Za-z0-9]+$/.test(path[at + 1] ?? "") ? "spotify" : null;
  }
  if (host === "spotify.link" || host === "spotify.app.link") return path[0] ? "spotify" : null;
  if (host === "music.apple.com" || host === "geo.music.apple.com") {
    if (!/^[a-z]{2}$/i.test(path[0] ?? "")) return null;
    if (path[1] === "song") return /^\d+$/.test(path[path.length - 1] ?? "") ? "apple_music" : null;
    if (path[1] === "album") return /^\d+$/.test(query.get("i") ?? "") ? "apple_music" : null;
    return null;
  }
  if (host === "instagram.com" || host === "www.instagram.com" || host === "m.instagram.com") {
    // /<kind>/<code>/ or /<user>/<kind>/<code>/
    for (let i = 0; i < Math.min(2, path.length); i++) {
      if (["reel", "reels", "p", "tv"].includes(path[i]) && INSTAGRAM_CODE.test(path[i + 1] ?? "")) return "instagram";
    }
    return null;
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return path.length === 1 && SHORT_CODE.test(path[0]) ? "tiktok" : null;
  if (host === "tiktok.com" || host === "www.tiktok.com" || host === "m.tiktok.com") {
    if (path.length === 2 && path[0] === "t") return SHORT_CODE.test(path[1]) ? "tiktok" : null;
    if (path.length === 3 && path[0].startsWith("@") && path[1] === "video") return TIKTOK_ID.test(path[2]) ? "tiktok" : null;
    if (path.length === 2 && path[0] === "v" && path[1].endsWith(".html")) return TIKTOK_ID.test(path[1].slice(0, -5)) ? "tiktok" : null;
    return null;
  }
  return null;
}

/** The services whose own video is fetched; a store's song is found on YouTube by its title and artist. */
export function fetchesItsOwnVideo(provider: SongProvider): boolean {
  return provider === "youtube" || provider === "instagram" || provider === "tiktok";
}

/** `{ url, provider }` for the song link in pasted text, or null when there is none we can read. */
export function extractSongUrl(text: string | null | undefined): { url: string; provider: SongProvider } | null {
  const url = firstUrl(text);
  const provider = url && providerOf(url);
  return url && provider ? { url, provider } : null;
}

/** What to tell someone whose text holds no song link we can read. */
export function songLinkHint(text: string): string {
  return firstUrl(text)
    ? "That link isn't a single song. Paste a link to a YouTube, Instagram or TikTok video, a Spotify track or an Apple Music song."
    : "Paste a link to a YouTube, Instagram or TikTok video, a Spotify track or an Apple Music song.";
}
