// Automated checks on a drafted post, before it becomes a pull request. They catch the mechanical
// problems (length, headings, links, placeholders, AI boilerplate, invented numbers, hand-written
// solfa) so the founder's review can be about substance. Each problem is a sentence the drafter
// can send back to the model for one revision.
import { countWords } from "./util.mjs";
import { renderMarkdown } from "./markdown.mjs";

export const LIMITS = { titleMax: 60, titleMin: 20, descMin: 110, descMax: 155, wordsMin: 1200, wordsMax: 2200, h2Min: 4, faqMin: 3, faqMax: 8, tagsMax: 4 };

const BANNED = [
  /\bas an ai\b/i, /\blanguage model\b/i, /\bi cannot (?:help|assist|provide)\b/i, /\bi'?m sorry\b/i, /\bas of my (?:knowledge|last)\b/i,
  /\bdelve\b/i, /\bin today'?s fast[- ]paced\b/i, /\btapestry\b/i, /\bgame[- ]changer\b/i, /\bunlock the (?:power|secrets?)\b/i,
  /\bin conclusion\b/i, /\bembark on a journey\b/i, /\bnavigat(?:e|ing) the (?:world|complexities)\b/i,
];
const PLACEHOLDERS = [/\bTODO\b/, /\bTBD\b/, /lorem ipsum/i, /\[insert\b/i, /\{\{|\}\}/, /\bplaceholder\b/i, /\bXXX?\b/, /\?\?\?/, /\[(?:link|url|name|date)\]/i];
const INVENTED = [
  [/\b\d+(?:\.\d+)?\s?(?:%|per ?cent\b)/i, "a percentage"],
  [/\b(?:studies|research|surveys?|statistics|data|experts?)\s+(?:show|shows|suggest|suggests|found|finds|reveal|reveals|prove|proves|say|says)\b/i, "an appeal to studies, research or experts"],
  [/\baccording to\b/i, "an attribution (\"according to …\")"],
  [/\b(?:a|one) (?:recent )?(?:study|survey|report)\b/i, "a study or survey"],
  [/[“"][^”"\n]{20,}[”"]\s*,?\s*(?:says?|said|told|explains?|explained|recalls?|recalled)\b/i, "a quotation attributed to someone"],
  [/[“"][^”"\n]{20,}[”"]\s*(?:—|–)\s*[A-Z]/, "a quotation attributed to someone"],
  [/\btestimonials?\b/i, "a testimonial"],
  [/\b(?:millions|thousands|hundreds) of (?:choirs|singers|churches|users|people)\b/i, "a claimed count of people"],
];
// Six or more solfa syllables in a row, outside a ```solfa block: solfa the model wrote itself.
const SYL = "(?:d|r|m|f|s|l|t|de|re|fe|se|le|ra|ma|sa|la|ta|doh|ray|me|fah|soh|lah|te)[,']*";
const SOLFA_RUN = new RegExp(`(?:^|[\\s(*_\`|:])${SYL}(?:[\\s:|.\\-–]+${SYL}){5,}(?=$|[\\s).,;*_\`|])`, "im");

function stripFences(md) { return md.replace(/```[\s\S]*?```/g, "\n"); }

/**
 * Problems with a draft, as sentences (empty when it passes).
 * draft: {title, description, slug, tags, faq: [{q, a}], body}
 * ctx: {posts, hymnsBySlug, requiredLinks, linkExists(path) → boolean}
 */
export function checkDraft(draft, ctx) {
  const p = [];
  const L = LIMITS;
  const title = String(draft.title || "").trim(), desc = String(draft.description || "").trim(), body = String(draft.body || "");
  if (title.length < L.titleMin || title.length > L.titleMax) p.push(`The title is ${title.length} characters; it must be ${L.titleMin}–${L.titleMax}.`);
  if (desc.length < L.descMin || desc.length > L.descMax) p.push(`The description is ${desc.length} characters; it must be ${L.descMin}–${L.descMax}.`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug || "")) p.push(`The slug "${draft.slug}" must be lowercase words joined by hyphens.`);
  if (ctx.posts.some((x) => x.slug === draft.slug)) p.push(`A post with the slug "${draft.slug}" already exists.`);
  if (ctx.posts.some((x) => x.title.trim().toLowerCase() === title.toLowerCase())) p.push(`A post titled "${title}" already exists.`);
  const tags = Array.isArray(draft.tags) ? draft.tags : [];
  if (!tags.length || tags.length > L.tagsMax || tags.some((t) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t))) p.push(`Give 1–${L.tagsMax} tags, each lowercase-hyphenated (e.g. tonic-solfa).`);

  const prose = stripFences(body);
  const words = countWords(prose);
  if (words < L.wordsMin || words > L.wordsMax) p.push(`The body is ${words} words; it must be ${L.wordsMin}–${L.wordsMax} (not counting solfa blocks).`);
  if (/^#\s/m.test(prose)) p.push("The body has a top-level heading (# …). The title is the page's only h1; start sections at ##.");
  const h2 = (prose.match(/^##\s+\S/gm) || []).length;
  if (h2 < L.h2Min) p.push(`The body has ${h2} sections (## headings); it needs at least ${L.h2Min}.`);
  if (/^#{2,3}\s+(?:faqs?|frequently asked)/im.test(prose)) p.push("Put the questions and answers in the faq field, not in a body section.");
  if (/<\s*(?:script|iframe|style|object|embed|form)\b/i.test(body)) p.push("The body contains raw HTML (script, iframe, style, form…); use Markdown only.");

  const faq = Array.isArray(draft.faq) ? draft.faq : [];
  if (faq.length < L.faqMin || faq.length > L.faqMax) p.push(`The FAQ has ${faq.length} questions; it needs ${L.faqMin}–${L.faqMax}.`);
  faq.forEach((f, i) => {
    if (!f || !String(f.q || "").trim().endsWith("?")) p.push(`FAQ ${i + 1}: the question must end with a question mark.`);
    if (!f || countWords(f.a || "") < 12) p.push(`FAQ ${i + 1}: the answer must be at least one full sentence (12+ words).`);
  });

  const all = [title, desc, body, ...faq.flatMap((f) => [f?.q || "", f?.a || ""])].join("\n");
  for (const re of BANNED) if (re.test(all)) p.push(`Remove the stock phrase matching ${re} — write it plainly.`);
  for (const re of PLACEHOLDERS) if (re.test(all)) p.push(`There is placeholder text (${re}); every sentence must be finished.`);
  for (const [re, what] of INVENTED) {
    const m = re.exec(all);
    if (m) p.push(`Remove ${what} ("${m[0].trim().slice(0, 60)}"): no statistics, studies, quotes or testimonials may be invented.`);
  }
  // The bare scale is allowed in prose (the prompt says so); any other run of six or more is not.
  const run = SOLFA_RUN.exec(stripFences(all).replace(/\bd r m f s l t(?: d')?|\bdoh,? ray,? me,? fah,? soh,? lah,? te\b/gi, " "));
  if (run) p.push(`Solfa written by hand ("${run[0].trim().slice(0, 40)}"): every solfa example must be a \`\`\`solfa block from the catalogue.`);

  // Links: the required ones present, /app present, every internal one resolving.
  let rendered = null;
  try { rendered = renderMarkdown(body, { hymnsBySlug: ctx.hymnsBySlug, file: "draft" }); }
  catch (e) { p.push(`The body does not build: ${e.message.replace(/^draft:\s*/, "")}`); }
  const faqLinks = faq.flatMap((f) => [...String(f?.a || "").matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]));
  const links = [...(rendered ? rendered.links : []), ...faqLinks];
  const internal = links.filter((h) => h.startsWith("/"));
  for (const req of ctx.requiredLinks || []) if (!internal.some((h) => h.split(/[?#]/)[0] === req)) p.push(`Link to ${req} somewhere in the body.`);
  if (!internal.some((h) => h.split(/[?#]/)[0] === "/app")) p.push("Link to /app (the NoteFusion web app) once, where it helps the reader.");
  for (const h of links) {
    if (!h.startsWith("/") && !h.startsWith("#")) p.push(`Remove the external link ${h}; link only to pages on notefusion.studio.`);
    else if (h.startsWith("/") && !ctx.linkExists(h)) p.push(`The link ${h} goes to a page that does not exist.`);
  }
  return [...new Set(p)];
}
