// Blog pages: posts, the paginated list, tag pages, the author page, and the home-page strip.
// The look is a publication's: a serif for reading, a byline at the top of every post, a kicker, a
// standfirst, and lists that read like a front page. Read counts are filled in by assets/blog.js from
// the API ([data-reads-path] placeholders), never written into the HTML, so a new read never makes the
// committed pages stale.
import { ORIGIN, PAGE_SIZE, DEFAULT_OG, ASSET_VERSION } from "./site.mjs";
import { escapeHtml, humanDate, countWords } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, PUBLISHER, ctaBox, icon } from "./layout.mjs";
import { renderMarkdown, renderInline } from "./markdown.mjs";

const WORDS_PER_MINUTE = 200;

/** Renders every post's body once; the list pages and related posts reuse the result. */
export function preparePosts(posts, { hymnsBySlug, authors = {} }) {
  for (const p of posts) {
    const r = renderMarkdown(p.body, { hymnsBySlug, file: `content/blog/${p.slug}.md` });
    p.html = r.html;
    p.toc = r.toc;
    p.links = r.links;
    p.hymnsUsed = [...new Set([...(p.hymns || []), ...r.hymnsUsed])];
    p.words = countWords(p.body.replace(/```[\s\S]*?```/g, " "));
    p.minutes = Math.max(1, Math.ceil(p.words / WORDS_PER_MINUTE));
    p.url = `/blog/${p.slug}`;
    p.modified = p.updated || p.date;
    p.authorInfo = authors[p.author] || null;
  }
  return posts;
}

/** "tonic-solfa" → "Tonic Solfa". */
export function tagName(t) { return t.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

/** "Francis" → "F", "Ada Lovelace" → "AL": the monogram shown when an author has no photo. */
export function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || "?")[0]).toUpperCase();
}

/** The author's photo, or their initials in a quiet disc; `size` in CSS pixels. Decorative beside their name. */
export function avatar(author, size) {
  if (author.photo) return `<img class="avatar avatar-${size}" src="${escapeHtml(author.photo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
  return `<span class="avatar avatar-initials avatar-${size}" aria-hidden="true">${escapeHtml(initials(author.name))}</span>`;
}

/**
 * Where the read count goes: empty in the HTML, filled by assets/blog.js. It keeps its room while it waits
 * (and if the API never answers), so nothing on the page moves.
 */
function readsSlot(p, compact = false) {
  return `<span class="meta-reads" data-reads-path="${p.url}"${compact ? ' data-reads-format="compact"' : ""} aria-hidden="true"></span>`;
}

function kicker(p) {
  const t = p.tags[0];
  return `<p class="kicker"><a href="/blog/tag/${t}">${escapeHtml(tagName(t))}</a></p>`;
}

/** "By Francis · 15 October 2026 · 9 min read · 1,234 reads" for lists. */
function listMeta(p) {
  const a = p.authorInfo;
  return `<p class="story-meta">${a ? `<span>By ${escapeHtml(a.name)}</span>` : ""}<span><time datetime="${p.date}">${humanDate(p.date)}</time></span><span>${p.minutes} min read</span>${readsSlot(p, true)}</p>`;
}

function dek(p) { return p.dek || p.description; }

/** A post in a list: kicker, headline, standfirst, byline. */
function story(p, headingLevel = 2) {
  const h = `h${headingLevel}`;
  return `<article class="story">
  ${kicker(p)}
  <${h} class="story-title"><a href="${p.url}">${escapeHtml(p.title)}</a></${h}>
  <p class="story-dek">${escapeHtml(dek(p))}</p>
  ${listMeta(p)}
</article>`;
}

/** The newest post, set large at the top of the blog's front page. */
function feature(p) {
  const a = p.authorInfo;
  const cover = p.cover ? `<a class="feature-cover" href="${p.url}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(p.cover.src)}" alt="" width="${p.cover.width}" height="${p.cover.height}"></a>` : "";
  return `<article class="feature${p.cover ? " has-cover" : ""}" aria-labelledby="feature-title">
  ${cover}
  <div class="feature-text">
    <p class="kicker"><span class="kicker-latest">Latest</span><a href="/blog/tag/${p.tags[0]}">${escapeHtml(tagName(p.tags[0]))}</a></p>
    <h2 class="feature-title" id="feature-title"><a href="${p.url}">${escapeHtml(p.title)}</a></h2>
    <p class="feature-dek">${escapeHtml(dek(p))}</p>
    <div class="byline byline-small">
      ${a ? avatar(a, 32) : ""}
      <p class="byline-meta">${a ? `<span>By ${escapeHtml(a.name)}</span>` : ""}<span><time datetime="${p.date}">${humanDate(p.date)}</time></span><span>${p.minutes} min read</span>${readsSlot(p)}</p>
    </div>
  </div>
</article>`;
}

/** Topic links under the masthead; `current` is the tag being shown, or null on the front page. */
function topicNav(tags, current) {
  return `<nav class="topics" aria-label="Topics"><a href="/blog"${current ? "" : ' aria-current="page"'}>All</a>${tags.map((t) => `<a href="/blog/tag/${t}"${t === current ? ' aria-current="page"' : ""}>${escapeHtml(tagName(t))}</a>`).join("")}</nav>`;
}

function related(post, posts) {
  return posts.filter((p) => p !== post)
    .map((p) => ({ p, shared: p.tags.filter((t) => post.tags.includes(t)).length }))
    .sort((a, b) => b.shared - a.shared || (a.p.date < b.p.date ? 1 : -1))
    .slice(0, 3).map((x) => x.p);
}

/** Plain share links, WhatsApp first (where choirs pass things on). No third-party script loads. */
function shareLinks(post) {
  const url = ORIGIN + post.url;
  const u = encodeURIComponent(url), t = encodeURIComponent(post.title);
  const links = [
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${post.title} ${url}`)}`],
    ["X", `https://x.com/intent/post?text=${t}&amp;url=${u}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
  ];
  return `<section class="share" aria-labelledby="share-title">
  <h2 class="share-title" id="share-title">Share this guide</h2>
  <ul class="share-links">${links.map(([name, href]) => `<li><a href="${href}" target="_blank" rel="noopener" data-track="Share: ${name}">${name}</a></li>`).join("")}<li><a href="${url}" data-copy-link data-track="Share: copy link">Copy link</a></li></ul>
</section>`;
}

function authorCard(author) {
  return `<aside class="author-card" aria-label="About the author">
  ${avatar(author, 64)}
  <div>
    <p class="author-card-kicker">Written by</p>
    <p class="author-card-name"><a href="${author.url}" rel="author">${escapeHtml(author.name)}</a>, <span>${escapeHtml(author.role)}</span></p>
    <p class="author-card-bio">${escapeHtml(author.short)} <a href="${author.url}">More from ${escapeHtml(author.name)} <span aria-hidden="true">→</span></a></p>
  </div>
</aside>`;
}

const blogScripts = () => `<script src="/assets/blog.js?v=${ASSET_VERSION.blogJs}" defer></script>`;

const INLINE_CTA = `<p class="inline-cta"><a href="/app?utm_source=blog-inline" data-track="Blog: inline cta">Got a recording? Get it in solfa&nbsp;→</a></p>\n`;
/**
 * A post's body with the way into the app inside it (board m-ux-medium W4c): the hymn pages' inline line, before the
 * second section heading, so a reader meets it about two screens in rather than only after the FAQ, the share links
 * and the author. A post with fewer than two sections has it at the end of the body, before the FAQ. The CTA box at
 * the end stays. (Headings are the only "<h2 " in a body: code and raw HTML are escaped.)
 */
export function withInlineCta(html) {
  const first = html.indexOf("<h2 ");
  const second = first < 0 ? -1 : html.indexOf("<h2 ", first + 1);
  return second < 0 ? html + INLINE_CTA : html.slice(0, second) + INLINE_CTA + html.slice(second);
}

export function renderPost(post, { posts, authors, hymnsBySlug }) {
  const author = authors[post.author];
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [post.url, post.title]];
  const image = post.cover ? { src: post.cover.src, width: post.cover.width, height: post.cover.height, alt: post.cover.alt } : DEFAULT_OG;
  const toc = post.toc.filter((t) => t.depth === 2);
  const tocHtml = toc.length >= 4 ? `<nav class="toc" aria-labelledby="toc-title"><p id="toc-title">In this article</p><ol>${toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join("")}${post.faq ? '<li><a href="#faq">Frequently asked questions</a></li>' : ""}</ol></nav>` : "";
  const faqHtml = post.faq ? `<section class="faq" id="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Frequently asked questions</h2>
  ${post.faq.map((f) => `<h3>${escapeHtml(f.q)}</h3>\n  <p>${renderInline(f.a)}</p>`).join("\n  ")}
</section>` : "";
  const hymnsHtml = post.hymnsUsed.length ? `<section class="side-list" aria-labelledby="hymns-in-post"><h2 id="hymns-in-post">Hymns in this post</h2><ul>${post.hymnsUsed.map((s) => hymnsBySlug.get(s)).map((h) => `<li><a href="/hymns/${h.slug}">${escapeHtml(h.title)}</a> <span>in Tonic Solfa, ${escapeHtml(h.view.header.replace(/^Doh/, "doh"))}</span></li>`).join("")}</ul></section>` : "";
  const rel = related(post, posts);
  const relHtml = rel.length ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">Keep reading</h2><div class="story-list">${rel.map((p) => story(p, 3)).join("\n")}</div></section>` : "";
  const cover = post.cover ? `<figure class="cover"><img src="${escapeHtml(post.cover.src)}" alt="${escapeHtml(post.cover.alt)}" width="${post.cover.width}" height="${post.cover.height}" fetchpriority="high"></figure>` : "";
  const updated = post.updated && post.updated !== post.date ? `<span>Updated <time datetime="${post.updated}">${humanDate(post.updated)}</time></span>` : "";

  const body = `${breadcrumbs(crumbs)}
<article class="post">
  <header class="post-header">
    ${kicker(post)}
    <h1>${escapeHtml(post.title)}</h1>
    <p class="post-lede">${escapeHtml(dek(post))}</p>
    <div class="byline">
      <a class="byline-photo" href="${author.url}" tabindex="-1" aria-hidden="true">${avatar(author, 48)}</a>
      <div>
        <p class="byline-name">By <a href="${author.url}" rel="author">${escapeHtml(author.name)}</a><span class="byline-role">, ${escapeHtml(author.role)}</span></p>
        <p class="byline-meta"><span><time datetime="${post.date}">${humanDate(post.date)}</time></span>${updated}<span>${post.minutes} min read</span>${readsSlot(post)}</p>
      </div>
    </div>
  </header>
  ${cover}
  ${tocHtml}
  <div class="post-body">
${withInlineCta(post.html)}
  </div>
  ${faqHtml}
  ${shareLinks(post)}
  ${authorCard(author)}
  ${ctaBox("blog")}
</article>
${hymnsHtml}
${relHtml}`;

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.modified,
      inLanguage: "en",
      mainEntityOfPage: { "@type": "WebPage", "@id": ORIGIN + post.url },
      url: ORIGIN + post.url,
      image: { "@type": "ImageObject", url: image.src.startsWith("http") ? image.src : ORIGIN + image.src, width: image.width, height: image.height },
      author: { "@type": "Person", name: author.name, jobTitle: author.role, url: ORIGIN + author.url, ...(author.photo ? { image: ORIGIN + author.photo } : {}) },
      publisher: PUBLISHER,
      keywords: post.tags.join(", "),
      wordCount: post.words,
      articleSection: "Blog",
    },
    breadcrumbLd(crumbs),
  ];
  if (post.faq) ld.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") } })),
  });

  return page({
    // A post written in the admin console may set its own <title> and meta description for search results.
    path: post.url, title: post.seoTitle || `${post.title} | NoteFusion`, description: post.seoDescription || post.description, ogType: "article", image, jsonLd: ld, body, active: "/blog",
    article: { published: post.date, modified: post.modified, tags: post.tags }, scripts: blogScripts(), bodyClass: "is-post",
  });
}

export function blogPagePath(n) { return n === 1 ? "/blog" : `/blog/page/${n}`; }

function allTags(posts) { return [...new Set(posts.flatMap((p) => p.tags))].sort(); }

/** The hymns, presented as a page of a hymnal: title, first line, doh. */
function hymnal(hymns) {
  return `<section class="hymnal" aria-labelledby="hymnal-title">
  <div class="hymnal-head">
    <h2 id="hymnal-title">Hymns in Tonic Solfa</h2>
    <p>Public-domain hymns with the solfa written out under the words, the staff, and a piano to sing along with.</p>
  </div>
  <ol class="hymnal-list">
${hymns.slice(0, 8).map((h) => `    <li><a href="/hymns/${h.slug}"><span class="hymnal-name">${escapeHtml(h.shortTitle || h.title)}</span><span class="hymnal-first">${escapeHtml(h.verses[0].lines[0].replace(/[,;:.!?]+$/, ""))}</span></a><span class="hymnal-doh">${escapeHtml(h.view.header)}</span></li>`).join("\n")}
  </ol>
  <p class="hymnal-all"><a href="/hymns">All ${hymns.length} hymns <span aria-hidden="true">→</span></a></p>
</section>`;
}

export function renderBlogIndex(posts, { pageNo, pages, hymns }) {
  const slice = posts.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const path = blogPagePath(pageNo);
  const prev = pageNo > 1 ? blogPagePath(pageNo - 1) : null, next = pageNo < pages ? blogPagePath(pageNo + 1) : null;
  const head = [prev ? `<link rel="prev" href="${ORIGIN + prev}">` : "", next ? `<link rel="next" href="${ORIGIN + next}">` : ""].filter(Boolean).join("\n");
  const pager = pages > 1 ? `<nav class="pager" aria-label="More posts">${prev ? `<a href="${prev}" rel="prev">← Newer posts</a>` : "<span></span>"}<span>Page ${pageNo} of ${pages}</span>${next ? `<a href="${next}" rel="next">Older posts →</a>` : "<span></span>"}</nav>` : "";
  const crumbs = [["/", "Home"], ["/blog", "Blog"]];
  // Page one reads like a front page: the newest post set large, the next few beside it, the rest below, then the
  // site's one call to action (board n-ux-low V3d) before the hymns. Later pages are a plain list.
  const first = pageNo === 1 ? slice[0] : null;
  const side = first ? slice.slice(1, 5) : [];
  const rest = first ? slice.slice(5) : slice;
  const top = first ? `<div class="front-top${side.length ? "" : " is-single"}">
${feature(first)}
${side.length ? `<section class="front-side" aria-labelledby="side-title">
<h2 class="section-label" id="side-title">More guides</h2>
<div class="story-list">
${side.map((p) => story(p, 3)).join("\n")}
</div>
</section>` : ""}
</div>` : "";
  const restHtml = rest.length ? `<section class="stories" aria-labelledby="stories-title">
<h2 class="section-label" id="stories-title">${first ? "Earlier" : "Posts"}</h2>
<div class="story-list">
${rest.map((p) => story(p, 3)).join("\n")}
</div>
</section>` : "";
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <p class="kicker">The NoteFusion blog</p>
  <h1>${pageNo === 1 ? "Tonic Solfa, choirs and church music" : `The NoteFusion blog, page ${pageNo}`}</h1>
  <p class="masthead-dek">Practical guides for choir directors, music teachers and singers who read Tonic Solfa — from the founder of NoteFusion.</p>
  ${topicNav(allTags(posts), null)}
</header>
${top}
${restHtml}
${pager}
${pageNo === 1 ? ctaBox("blog-index") : ""}
${pageNo === 1 && hymns.length ? hymnal(hymns) : ""}`;
  return page({
    path, title: pageNo === 1 ? "Blog: Tonic Solfa, choirs and church music | NoteFusion" : `Blog, page ${pageNo} | NoteFusion`,
    description: "Guides to reading and teaching Tonic Solfa, running choir rehearsals, and getting any song written down for your choir, from the team behind NoteFusion.",
    head, body, active: "/blog", scripts: blogScripts(), bodyClass: "is-front",
    jsonLd: [{ "@context": "https://schema.org", "@type": "Blog", name: "The NoteFusion blog", url: ORIGIN + "/blog", publisher: PUBLISHER, inLanguage: "en",
      blogPost: slice.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: ORIGIN + p.url, datePublished: p.date })) }, breadcrumbLd(crumbs)],
  });
}

export function renderTag(tag, posts, { allPosts = posts } = {}) {
  const path = `/blog/tag/${tag}`;
  const name = tagName(tag);
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [path, `Tagged “${tag.replace(/-/g, " ")}”`]];
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <p class="kicker">Topic</p>
  <h1>${escapeHtml(name)}</h1>
  <p class="masthead-dek">${posts.length} post${posts.length === 1 ? "" : "s"} on the NoteFusion blog.</p>
  ${topicNav(allTags(allPosts), tag)}
</header>
<div class="story-list">
${posts.map((p) => story(p, 2)).join("\n")}
</div>`;
  // Tag pages repeat the posts' own summaries: useful to readers, thin for search, so they are kept out of the index.
  return page({ path, title: `Posts about ${tag.replace(/-/g, " ")} | NoteFusion blog`, description: `NoteFusion blog posts about ${tag.replace(/-/g, " ")}.`, robots: "noindex, follow", body, active: "/blog", jsonLd: [breadcrumbLd(crumbs)], scripts: blogScripts() });
}

export function renderAuthor(author, posts) {
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [author.url, author.name]];
  const bio = author.bio.split(/\n\s*\n/).map((p) => `<p>${renderInline(p.trim())}</p>`).join("\n");
  const body = `${breadcrumbs(crumbs)}
<header class="profile">
  ${avatar(author, 96)}
  <div>
    <p class="kicker">Author</p>
    <h1>${escapeHtml(author.name)}</h1>
    <p class="profile-role">${escapeHtml(author.role.charAt(0).toUpperCase() + author.role.slice(1))}</p>
  </div>
</header>
<div class="author-bio">
${bio}
</div>
<section class="stories" aria-labelledby="posts-by">
<h2 class="section-label" id="posts-by">Posts by ${escapeHtml(author.name)}</h2>
<div class="story-list">
${posts.map((p) => story(p, 3)).join("\n")}
</div>
</section>`;
  return page({
    path: author.url, title: `${author.name}, ${author.role} | NoteFusion`, description: author.short.slice(0, 160), ogType: "profile", body, active: "/blog", scripts: blogScripts(),
    jsonLd: [{ "@context": "https://schema.org", "@type": "ProfilePage", url: ORIGIN + author.url,
      mainEntity: { "@type": "Person", name: author.name, jobTitle: author.role, description: author.short, url: ORIGIN + author.url, ...(author.photo ? { image: ORIGIN + author.photo } : {}), worksFor: PUBLISHER, ...(author.sameAs ? { sameAs: author.sameAs } : {}) } }, breadcrumbLd(crumbs)],
  });
}

export const HOME_START = "<!-- blog-latest:start -->", HOME_END = "<!-- blog-latest:end -->";

/** The "From the blog" strip on the home page, between the markers in web-site/index.html (styled by home.css). */
export function renderHomeStrip(posts) {
  if (!posts.length) return `${HOME_START}\n${HOME_END}`;
  const items = posts.slice(0, 3).map((p) => `      <li><a class="post-link" href="${p.url}">
        <span class="post-tag">${escapeHtml(tagName(p.tags[0]))}</span>
        <span class="post-title">${escapeHtml(p.title)}</span>
        <span class="post-dek">${escapeHtml(dek(p))}</span>
        <span class="post-date">${humanDate(p.date)} · ${p.minutes} min read</span>
      </a></li>`).join("\n");
  return `${HOME_START}
<!-- Generated by tools/blog/build.mjs: the newest posts. Edit the posts, not this block. -->
<section class="section" id="blog" aria-labelledby="blog-title">
  <div class="wrap">
    <div class="section-head section-head--row">
      <h2 id="blog-title">From the blog</h2>
      <a class="text-link" href="/blog">All posts ${icon("arrow-right", "ic-16")}</a>
    </div>
    <ul class="post-list">
${items}
    </ul>
  </div>
</section>
${HOME_END}`;
}
