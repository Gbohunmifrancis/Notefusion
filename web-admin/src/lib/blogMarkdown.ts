/**
 * A preview of a post's Markdown, in the site's flavour: the same `marked` version and options as the build
 * (`tools/blog/lib/markdown.mjs`): GFM, heading ids, `> [!TIP]` / `> [!NOTE]` callouts, pull quotes, images
 * sized by their title ("1200x675 | caption"). Two differences, both deliberate:
 *
 * - A ```solfa block is shown as a labelled placeholder. The solfa itself is written by NoteFusion's engine
 *   when the site is built, from the hymn data the console does not hold; the checks beside the editor say
 *   whether the block will build.
 * - The preview is safe to show untrusted text (a Gemini draft): raw HTML is printed as text, and links and
 *   images keep only site paths and http(s) addresses. The site itself refuses raw script HTML at publishing.
 */

import { Marked, type Tokens } from "marked";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only addresses a reader could follow on the site: site paths, fragments and http(s). */
function safeUrl(href: string): string {
  const h = href.trim();
  if (h.startsWith("/") || h.startsWith("#") || /^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  return "#";
}

/** "hymn: amazing-grace\nbars: 1-5" → a short label for the placeholder. */
function solfaLabel(source: string): string {
  const fields: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*(?:\s#.*)?$/i.exec(line);
    if (m && m[1]) fields[m[1].toLowerCase()] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  if (fields.scale) return `The ${fields.scale}${fields.harmonic === "true" ? " (harmonic minor)" : ""} scale`;
  if (fields.hymn) {
    const parts = [fields.hymn.replace(/-/g, " ")];
    if (fields.bars) parts.push(`bars ${fields.bars}`);
    if (fields.key) parts.push(`in ${fields.key}`);
    if (fields.words === "false") parts.push("no words");
    return parts.join(", ");
  }
  return "Solfa block (give a hymn: or a scale:)";
}

export interface PreviewHeading {
  depth: number;
  id: string;
  text: string;
}

export function renderPreview(markdown: string): { html: string; toc: PreviewHeading[] } {
  const toc: PreviewHeading[] = [];
  const ids = new Set<string>();

  const img = (href: string, title: string | null | undefined, text: string) => {
    const size = /^(\d+)x(\d+)(?:\s*\||$)/.exec(title ?? "");
    const dims = size ? ` width="${size[1]}" height="${size[2]}"` : "";
    const missing = size ? "" : ` data-missing-size="true" title="Give the image its size as the title, e.g. &quot;1200x675&quot;"`;
    return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text)}"${dims}${missing} loading="lazy">`;
  };

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const text = inner.replace(/<[^>]+>/g, "");
        let id = slugify(text) || "section";
        for (let n = 2; ids.has(id); n++) id = `${slugify(text)}-${n}`;
        ids.add(id);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text });
        const warn = depth === 1 ? ' data-h1="true" title="The title is the page\'s only h1: start sections at ##"' : "";
        return `<h${depth} id="${id}"${warn}>${inner}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        if ((lang ?? "").trim() === "solfa") {
          return `<figure class="solfa-placeholder"><span>Solfa</span> ${escapeHtml(solfaLabel(text))}<small>Written out by NoteFusion's engine when the site is built.</small></figure>\n`;
        }
        return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
      },
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const h = safeUrl(href.replace(/^https:\/\/notefusion\.studio(?=\/|$)/, "") || "/");
        const external = !h.startsWith("/") && !h.startsWith("#");
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(h)}"${t}${external ? ' target="_blank" rel="noopener" data-external="true"' : ""}>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        return img(href, title, text);
      },
      paragraph({ tokens }: Tokens.Paragraph) {
        const only = tokens.length === 1 ? tokens[0] : undefined;
        if (only && only.type === "image") {
          const t = only as Tokens.Image;
          const caption = /\|\s*(.+)$/.exec(t.title ?? "");
          return `<figure>${img(t.href, t.title, t.text)}${caption?.[1] ? `<figcaption>${escapeHtml(caption[1].trim())}</figcaption>` : ""}</figure>\n`;
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        const m = /^<p>\[!(NOTE|TIP)\]\s*/.exec(inner);
        if (m) {
          const label = m[1] === "TIP" ? "Tip" : "Note";
          const rest = inner.slice(m[0].length);
          return `<aside class="callout"><p class="callout-label">${label}</p>${rest.startsWith("</p>") ? rest.slice(4) : "<p>" + rest}</aside>\n`;
        }
        return `<blockquote class="pull-quote">${inner}</blockquote>\n`;
      },
    },
  });

  const html = marked.parse(markdown ?? "", { async: false }) as string;
  return { html, toc };
}

/** Inline Markdown (FAQ answers): links and emphasis only, made safe the same way. */
export function renderInlinePreview(markdown: string): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      html({ text }: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(text);
      },
      link({ href, tokens }: Tokens.Link) {
        return `<a href="${escapeHtml(safeUrl(href))}">${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return marked.parseInline(markdown ?? "", { async: false }) as string;
}

/** Words as the site counts them (the drafter's 1,200–2,200), solfa blocks left out. */
export function countWords(markdown: string): number {
  const prose = (markdown ?? "").replace(/```[\s\S]*?```/g, " ");
  return (prose.match(/[A-Za-zÀ-ÿ0-9'’]+/g) ?? []).length;
}
