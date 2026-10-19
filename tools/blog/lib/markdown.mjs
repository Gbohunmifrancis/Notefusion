// Markdown → HTML for posts: heading ids and a table of contents, solfa blocks rendered by the
// engine, lazy images with their size, and a record of every internal link and hymn used.
import { Marked } from "marked";
import { escapeHtml, slugify } from "./util.mjs";
import { renderSolfaBlock } from "./grid-html.mjs";
import { ORIGIN } from "./site.mjs";

/**
 * Only addresses a reader can follow: site paths, fragments, relative paths, http(s) and mailto. A post is
 * untrusted text (a Gemini draft can publish itself), and these pages share the /app origin that holds the
 * reader's sign-in, so a javascript: (or any other scheme's) link becomes "#".
 */
export function safeUrl(href) {
  const h = String(href ?? "").trim();
  // Read as the browser will: character references decoded ("javascript&#58;" is "javascript:" in an attribute) and
  // the tabs, newlines and control characters it drops from a URL dropped, before the scheme is looked at.
  const read = h
    .replace(/&#x([0-9a-f]+);?/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 10), 0x10ffff)))
    .replace(/&(colon|tab|newline);/gi, (_, n) => ({ colon: ":", tab: "\t", newline: "\n" })[n.toLowerCase()])
    .replace(/[\u0000-\u0020\u007f]/g, "");
  const scheme = /^([^:/?#]+):/.exec(read);
  return !scheme || /^(https?|mailto)$/i.test(scheme[1]) ? h : "#";
}

/** Raw HTML in a post is printed as text, never passed through: same reason as safeUrl. */
function rawHtmlAsText({ text }) {
  return escapeHtml(text);
}

export function renderMarkdown(src, { hymnsBySlug, file = "post" }) {
  const toc = [], ids = new Set(), hymnsUsed = new Set(), links = [], errors = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = inner.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
        if (depth === 1) errors.push(`"${text}" is a top-level heading (#); the title is the page's only h1, so start sections at ##`);
        let id = slugify(text) || "section", n = 2;
        while (ids.has(id)) id = `${slugify(text)}-${n++}`;
        ids.add(id);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        if ((lang || "").trim() === "solfa") {
          try {
            const r = renderSolfaBlock(text, { hymnsBySlug });
            if (r.hymn) hymnsUsed.add(r.hymn);
            return r.html + "\n";
          } catch (e) { errors.push(e.message); return ""; }
        }
        return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
      },
      html: rawHtmlAsText,
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        let h = safeUrl(href);
        if (h.startsWith(ORIGIN)) h = h.slice(ORIGIN.length) || "/";
        const internal = h.startsWith("/") || h.startsWith("#");
        links.push(h);
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(h)}"${t}${internal ? "" : ' rel="noopener"'}>${inner}</a>`;
      },
      image({ href, title, text }) {
        return img(href, title, text);
      },
      paragraph({ tokens }) {
        // An image on a line of its own is a figure; "1200x675 | A caption" as its title gives it a caption.
        if (tokens.length === 1 && tokens[0].type === "image") {
          const t = tokens[0];
          const caption = /\|\s*(.+)$/.exec(t.title || "");
          return `<figure class="post-figure">${img(t.href, t.title, t.text)}${caption ? `<figcaption>${escapeHtml(caption[1].trim())}</figcaption>` : ""}</figure>\n`;
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      blockquote({ tokens }) {
        // "> [!NOTE]" or "> [!TIP]" on the first line makes a callout box. Any other quote is a pull quote: a
        // line from the post itself, set large (never words put in someone else's mouth).
        const inner = this.parser.parse(tokens);
        const m = /^<p>\[!(NOTE|TIP)\]\s*/.exec(inner);
        if (m) {
          const label = m[1] === "TIP" ? "Tip" : "Note";
          const rest = inner.slice(m[0].length);
          return `<aside class="callout callout-${label.toLowerCase()}"><p class="callout-label">${label}</p>${rest.startsWith("</p>") ? rest.slice(4) : "<p>" + rest}</aside>\n`;
        }
        return `<blockquote class="pull-quote">${inner}</blockquote>\n`;
      },
      table(token) {
        const html = this.constructor.prototype.table.call(this, token);
        return `<div class="table-wrap">${html}</div>\n`;
      },
    },
  });
  function img(href, title, text) {
    // ![alt](/assets/blog/x.jpg "1200x675") — the size keeps the layout from shifting as it loads.
    const m = /^(\d+)x(\d+)(?:\s*\||$)/.exec(title || "");
    if (!m) errors.push(`image ${href}: give its size as the title, e.g. ![alt](${href} "1200x675")`);
    const size = m ? ` width="${m[1]}" height="${m[2]}"` : "";
    return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text)}"${size} loading="lazy" decoding="async">`;
  }
  const html = marked.parse(src);
  if (errors.length) throw new Error(`${file}:\n  - ${errors.join("\n  - ")}`);
  return { html, toc, hymnsUsed: [...hymnsUsed], links };
}

/** Inline markdown (FAQ answers, author bios): links and emphasis, no blocks, no raw HTML. */
export function renderInline(src) {
  return new Marked({
    gfm: true,
    renderer: {
      html: rawHtmlAsText,
      // Written here rather than by marked, whose own renderer leaves "&#58;" in an href for the browser to decode.
      link({ href, title, tokens }) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(safeUrl(href))}"${t}>${this.parser.parseInline(tokens)}</a>`;
      },
      image({ href, title, text }) {
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(text)}"${t}>`;
      },
    },
  }).parseInline(src);
}
