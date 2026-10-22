// web-site/sitemap.xml (regenerated: hand-written entries kept, blog, hymn and tool entries rebuilt) and
// the blog's RSS feed.
import { ORIGIN } from "./site.mjs";
import { escapeXml, rfc822 } from "./util.mjs";

const GENERATED_PREFIXES = ["/blog", "/hymns", "/tools", "/compare"];

/** The entries of an existing sitemap that the build does not own, verbatim. */
export function handWrittenEntries(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]);
    if (!loc) continue;
    const p = loc[1].trim().replace(ORIGIN, "") || "/";
    if (GENERATED_PREFIXES.some((g) => p === g || p.startsWith(g + "/"))) continue;
    const field = (name) => { const f = new RegExp(`<${name}>([^<]+)</${name}>`).exec(m[1]); return f ? f[1].trim() : null; };
    out.push({ loc: loc[1].trim(), lastmod: field("lastmod"), changefreq: field("changefreq"), priority: field("priority") });
  }
  return out;
}

export function sitemapXml(entries) {
  const urls = entries.map((e) => [
    "  <url>",
    `    <loc>${escapeXml(e.loc)}</loc>`,
    e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
    e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
    e.priority ? `    <priority>${e.priority}</priority>` : null,
    "  </url>",
  ].filter(Boolean).join("\n"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- The blog and hymn entries are written by tools/blog/build.mjs; add other pages by hand and the build keeps them. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

/** Feed readers show a post away from the site, so its links and images need the full address. */
function absolute(html) {
  return html.replace(/(href|src)="\/(?!\/)/g, `$1="${ORIGIN}/`);
}

export function feedXml(posts, authors) {
  const latest = posts.length ? posts.map((p) => p.modified).sort().pop() : "2026-01-01";
  const items = posts.slice(0, 20).map((p) => `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${ORIGIN}${p.url}</link>
      <guid isPermaLink="true">${ORIGIN}${p.url}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <dc:creator>${escapeXml(authors[p.author].name)}</dc:creator>
${p.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n")}
      <description>${escapeXml(p.description)}</description>
      <content:encoded><![CDATA[${absolute(p.html).replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>The NoteFusion blog</title>
    <link>${ORIGIN}/blog</link>
    <atom:link href="${ORIGIN}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Tonic Solfa, choirs and church music: practical guides from the team behind NoteFusion.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
