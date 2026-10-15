// Blog pages: posts, the paginated list, tag pages, the author page, and the home-page strip.
import { ORIGIN, PAGE_SIZE, DEFAULT_OG } from "./site.mjs";
import { escapeHtml, humanDate, countWords } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, PUBLISHER, ctaBox } from "./layout.mjs";
import { renderMarkdown, renderInline } from "./markdown.mjs";

const WORDS_PER_MINUTE = 200;

/** Renders every post's body once; the list pages and related posts reuse the result. */
export function preparePosts(posts, { hymnsBySlug }) {
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
  }
  return posts;
}

function tagLink(t) { return `<a class="tag" href="/blog/tag/${t}">${escapeHtml(t.replace(/-/g, " "))}</a>`; }

function card(p, headingLevel = 2) {
  const h = `h${headingLevel}`;
  return `<article class="post-card">
  <${h}><a href="${p.url}">${escapeHtml(p.title)}</a></${h}>
  <p class="post-meta"><time datetime="${p.date}">${humanDate(p.date)}</time> · ${p.minutes} min read</p>
  <p>${escapeHtml(p.description)}</p>
  <p class="tags">${p.tags.map(tagLink).join(" ")}</p>
</article>`;
}

function related(post, posts) {
  return posts.filter((p) => p !== post)
    .map((p) => ({ p, shared: p.tags.filter((t) => post.tags.includes(t)).length }))
    .sort((a, b) => b.shared - a.shared || (a.p.date < b.p.date ? 1 : -1))
    .slice(0, 3).map((x) => x.p);
}

export function renderPost(post, { posts, authors, hymnsBySlug }) {
  const author = authors[post.author];
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [post.url, post.title]];
  const image = post.cover ? { src: post.cover.src, width: post.cover.width, height: post.cover.height, alt: post.cover.alt } : DEFAULT_OG;
  const toc = post.toc.filter((t) => t.depth === 2);
  const tocHtml = toc.length >= 4 ? `<nav class="toc" aria-labelledby="toc-title"><p id="toc-title">In this guide</p><ol>${toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join("")}${post.faq ? '<li><a href="#faq">Frequently asked questions</a></li>' : ""}</ol></nav>` : "";
  const faqHtml = post.faq ? `<section class="faq" id="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Frequently asked questions</h2>
  ${post.faq.map((f) => `<h3>${escapeHtml(f.q)}</h3>\n  <p>${renderInline(f.a)}</p>`).join("\n  ")}
</section>` : "";
  const hymnsHtml = post.hymnsUsed.length ? `<section class="side-list" aria-labelledby="hymns-in-post"><h2 id="hymns-in-post">Hymns in this post</h2><ul>${post.hymnsUsed.map((s) => hymnsBySlug.get(s)).map((h) => `<li><a href="/hymns/${h.slug}">${escapeHtml(h.title)} in Tonic Solfa</a></li>`).join("")}</ul></section>` : "";
  const rel = related(post, posts);
  const relHtml = rel.length ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">Keep reading</h2><div class="post-list">${rel.map((p) => card(p, 3)).join("\n")}</div></section>` : "";
  const cover = post.cover ? `<img class="cover" src="${escapeHtml(post.cover.src)}" alt="${escapeHtml(post.cover.alt)}" width="${post.cover.width}" height="${post.cover.height}" fetchpriority="high">` : "";
  const updated = post.updated && post.updated !== post.date ? ` · Updated <time datetime="${post.updated}">${humanDate(post.updated)}</time>` : "";

  const body = `${breadcrumbs(crumbs)}
<article class="post">
  <header class="post-header">
    <p class="site-page-kicker">${post.tags.map((t) => escapeHtml(t.replace(/-/g, " "))).join(" · ")}</p>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="post-lede">${escapeHtml(post.description)}</p>
    <p class="post-meta">By <a href="${author.url}" rel="author">${escapeHtml(author.name)}</a>, ${escapeHtml(author.role)} · <time datetime="${post.date}">${humanDate(post.date)}</time>${updated} · ${post.minutes} min read</p>
  </header>
  ${cover}
  ${tocHtml}
  <div class="post-body">
${post.html}
  </div>
  ${faqHtml}
  ${ctaBox("blog")}
  <aside class="author-box" aria-label="About the author">
    <p><strong>${escapeHtml(author.name)}</strong>, ${escapeHtml(author.role)}</p>
    <p>${escapeHtml(author.short)} <a href="${author.url}">More about ${escapeHtml(author.name)}</a>.</p>
  </aside>
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
      author: { "@type": "Person", name: author.name, jobTitle: author.role, url: ORIGIN + author.url },
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
    path: post.url, title: `${post.title} | NoteFusion`, description: post.description, ogType: "article", image, jsonLd: ld, body, active: "/blog",
    article: { published: post.date, modified: post.modified, tags: post.tags },
  });
}

export function blogPagePath(n) { return n === 1 ? "/blog" : `/blog/page/${n}`; }

export function renderBlogIndex(posts, { pageNo, pages, hymns }) {
  const slice = posts.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const path = blogPagePath(pageNo);
  const prev = pageNo > 1 ? blogPagePath(pageNo - 1) : null, next = pageNo < pages ? blogPagePath(pageNo + 1) : null;
  const head = [prev ? `<link rel="prev" href="${ORIGIN + prev}">` : "", next ? `<link rel="next" href="${ORIGIN + next}">` : ""].filter(Boolean).join("\n");
  const pager = pages > 1 ? `<nav class="pager" aria-label="More posts">${prev ? `<a href="${prev}" rel="prev">← Newer posts</a>` : "<span></span>"}<span>Page ${pageNo} of ${pages}</span>${next ? `<a href="${next}" rel="next">Older posts →</a>` : "<span></span>"}</nav>` : "";
  const crumbs = [["/", "Home"], ["/blog", "Blog"]];
  const hymnTeaser = pageNo === 1 && hymns.length ? `<aside class="teaser"><h2>Hymns in Tonic Solfa</h2><p>Public-domain hymns with the solfa written out line by line under the words, the staff, and a piano to sing along with.</p><p class="teaser-links">${hymns.slice(0, 6).map((h) => `<a href="/hymns/${h.slug}">${escapeHtml(h.shortTitle || h.title)}</a>`).join("")}<a href="/hymns">All hymns →</a></p></aside>` : "";
  const body = `${breadcrumbs(crumbs)}
<section class="site-page-intro">
  <p class="site-page-kicker">Blog</p>
  <h1>${pageNo === 1 ? "Tonic Solfa, choirs and church music" : `The NoteFusion blog, page ${pageNo}`}</h1>
  <p>Practical guides for choir directors, music teachers and singers who read Tonic Solfa — from the founder of NoteFusion.</p>
</section>
<div class="post-list">
${slice.map((p) => card(p)).join("\n")}
</div>
${pager}
${hymnTeaser}`;
  return page({
    path, title: pageNo === 1 ? "Blog: Tonic Solfa, choirs and church music | NoteFusion" : `Blog, page ${pageNo} | NoteFusion`,
    description: "Guides to reading and teaching Tonic Solfa, running choir rehearsals, and getting any song written down for your choir, from the team behind NoteFusion.",
    head, body, active: "/blog",
    jsonLd: [{ "@context": "https://schema.org", "@type": "Blog", name: "The NoteFusion blog", url: ORIGIN + "/blog", publisher: PUBLISHER, inLanguage: "en",
      blogPost: slice.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: ORIGIN + p.url, datePublished: p.date })) }, breadcrumbLd(crumbs)],
  });
}

export function renderTag(tag, posts) {
  const path = `/blog/tag/${tag}`;
  const name = tag.replace(/-/g, " ");
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [path, `Tagged “${name}”`]];
  const body = `${breadcrumbs(crumbs)}
<section class="site-page-intro"><p class="site-page-kicker">Blog</p><h1>Posts about ${escapeHtml(name)}</h1><p>${posts.length} post${posts.length === 1 ? "" : "s"}.</p></section>
<div class="post-list">
${posts.map((p) => card(p)).join("\n")}
</div>`;
  // Tag pages repeat the posts' own summaries: useful to readers, thin for search, so they are kept out of the index.
  return page({ path, title: `Posts about ${name} | NoteFusion blog`, description: `NoteFusion blog posts about ${name}.`, robots: "noindex, follow", body, active: "/blog", jsonLd: [breadcrumbLd(crumbs)] });
}

export function renderAuthor(author, posts) {
  const crumbs = [["/", "Home"], ["/blog", "Blog"], [author.url, author.name]];
  const bio = author.bio.split(/\n\s*\n/).map((p) => `<p>${renderInline(p.trim())}</p>`).join("\n");
  const body = `${breadcrumbs(crumbs)}
<section class="site-page-intro"><p class="site-page-kicker">Author</p><h1>${escapeHtml(author.name)}</h1><p>${escapeHtml(author.role)}</p></section>
<div class="card author-bio">
${bio}
</div>
<h2 class="list-title">Posts by ${escapeHtml(author.name)}</h2>
<div class="post-list">
${posts.map((p) => card(p, 3)).join("\n")}
</div>`;
  return page({
    path: author.url, title: `${author.name}, ${author.role} | NoteFusion`, description: author.short.slice(0, 160), ogType: "profile", body, active: "/blog",
    jsonLd: [{ "@context": "https://schema.org", "@type": "ProfilePage", url: ORIGIN + author.url,
      mainEntity: { "@type": "Person", name: author.name, jobTitle: author.role, description: author.short, url: ORIGIN + author.url, worksFor: PUBLISHER, ...(author.sameAs ? { sameAs: author.sameAs } : {}) } }, breadcrumbLd(crumbs)],
  });
}

export const HOME_START = "<!-- blog-latest:start -->", HOME_END = "<!-- blog-latest:end -->";

/** The "Latest from the blog" strip on the home page, between the markers in web-site/index.html. */
export function renderHomeStrip(posts) {
  if (!posts.length) return `${HOME_START}\n${HOME_END}`;
  const items = posts.slice(0, 3).map((p) => `      <a class="nf-blog-card" href="${p.url}">
        <span class="nf-blog-date">${humanDate(p.date)} · ${p.minutes} min read</span>
        <span class="nf-blog-title">${escapeHtml(p.title)}</span>
        <span class="nf-blog-desc">${escapeHtml(p.description)}</span>
      </a>`).join("\n");
  return `${HOME_START}
<!-- Generated by tools/blog/build.mjs: the newest posts. Edit the posts, not this block. -->
<section class="nf-blog-strip" id="blog" aria-labelledby="blog-title">
  <style>
    .nf-blog-strip { padding: 72px 0 24px; }
    .nf-blog-strip .nf-blog-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
    .nf-blog-strip .nf-blog-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
    .nf-blog-card { display: flex; flex-direction: column; gap: 8px; padding: 22px; border: 1px solid #e6edf6; border-radius: 18px; background: #fff; box-shadow: 0 6px 22px rgba(24,57,106,.045); color: #0f172a; text-decoration: none; transition: box-shadow .16s, transform .16s; }
    .nf-blog-card:hover { box-shadow: 0 12px 30px rgba(24,57,106,.10); transform: translateY(-2px); }
    .nf-blog-date { color: #64748b; font-size: 13px; }
    .nf-blog-title { font-size: 18px; font-weight: 700; letter-spacing: -.02em; line-height: 1.3; }
    .nf-blog-desc { color: #516178; font-size: 14.5px; line-height: 1.55; }
    .nf-blog-all { font-weight: 650; color: #1d4ed8; text-decoration: none; }
    @media (prefers-reduced-motion: reduce) { .nf-blog-card { transition: none; } .nf-blog-card:hover { transform: none; } }
  </style>
  <div class="wrap">
    <div class="nf-blog-head">
      <div>
        <span class="eyebrow">From the blog</span>
        <h2 class="section-title" id="blog-title">Learn Tonic Solfa, run better rehearsals</h2>
      </div>
      <a class="nf-blog-all" href="/blog">All posts →</a>
    </div>
    <div class="nf-blog-grid">
${items}
    </div>
  </div>
</section>
${HOME_END}`;
}
