/**
 * Choir invite codes, as a singer meets them: typed from a rehearsal notice ("ab3k-7mqz"),
 * or inside a link — the app's `notefusion://join/CODE`, or the website's
 * `https://notefusion.studio/app?join=CODE` that a director shares. Mirrors the server's
 * `ChoirAccess.NormaliseCode`: letters and digits only, upper-cased, exactly eight.
 *
 * A regex, not `new URL()`: React Native's URL polyfill does not implement `host` for custom
 * schemes. No React Native imports, so `node --test` can run it.
 */

export const CHOIR_CODE_LENGTH = 8;

/** The code a singer typed, cleaned up, or null when it cannot be one. */
export function normaliseChoirCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const code = input.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return code.length === CHOIR_CODE_LENGTH ? code : null;
}

/**
 * The invite code inside a link, or null when the link is not a choir invite. Only the join
 * shapes match, so `notefusion://listen` and `notefusion://billing/return` are never touched.
 */
export function choirCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const app = /^notefusion:\/\/\/?join\/([^/?#]+)/i.exec(url);
  if (app) return normaliseChoirCode(decodeURIComponent(app[1]!));
  const web = /^https:\/\/(?:www\.)?notefusion\.studio\/app(?:\/join\/([^/?#]+)|\/?\?(?:[^#]*&)?join=([^&#]+))/i.exec(url);
  if (web) return normaliseChoirCode(decodeURIComponent((web[1] ?? web[2])!));
  return null;
}

/** A pasted message, link or bare code, whichever it is. */
export function choirCodeFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const link = /(notefusion:\/\/\S+|https:\/\/(?:www\.)?notefusion\.studio\/\S+)/i.exec(text);
  if (link) return choirCodeFromUrl(link[1]);
  return normaliseChoirCode(text);
}
