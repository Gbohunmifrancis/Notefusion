import fs from "node:fs";
import path from "node:path";

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export const escapeXml = escapeHtml;

/** JSON for a <script type="application/ld+json"> (or any JSON data block): "<" can never close the tag. */
export function jsonForScript(data) {
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

export function slugify(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

export function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}
/** "15 October 2026" (the site writes British dates). */
export function humanDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** RFC 822 for RSS, at noon UTC so no reader's time zone moves the day. */
export function rfc822(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAYS[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, "0")} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} 12:00:00 +0000`;
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Words in a piece of text (markdown or plain), for reading time and the drafter's length check. */
export function countWords(text) {
  const m = String(text).match(/[A-Za-zÀ-ÿ0-9'’]+/g);
  return m ? m.length : 0;
}
