// Blog posts live in the API's database (the admin console writes and publishes them). At deploy time the
// build reads every live post from GET /api/blog/published and renders it like a post that used to be a
// Markdown file in content/blog. A post that does not validate or render is left out with a warning rather
// than failing the whole site: the API refuses to publish one in the first place, so this is a second net.
import { validatePost } from "./content.mjs";
import { renderMarkdown } from "./markdown.mjs";

export const DEFAULT_API_URL = "https://api.notefusion.studio";

function defaultSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * The API's answer ({ version, posts }). With `waitSeconds`, an API that is not answering yet (a deploy of
 * the API racing this one, a 404 from an API that predates the endpoint, a 5xx) is asked again every 20 s
 * until then. Throws when there is no answer: the deploy must fail rather than publish a site without its blog.
 */
export async function fetchPublished({ apiUrl = DEFAULT_API_URL, waitSeconds = 0, fetchImpl = fetch, sleep = defaultSleep, log = () => {} } = {}) {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/blog/published`;
  const attempts = 1 + Math.floor(Math.max(0, waitSeconds) / 20);
  for (let attempt = 1; ; attempt++) {
    let res = null, problem;
    try { res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "notefusion-blog-build" } }); }
    catch (e) { problem = `${url}: ${e.message}`; }
    if (res) {
      if (res.ok) {
        let json;
        try { json = await res.json(); } catch { throw new Error(`${url} did not return JSON`); }
        if (!json || !Array.isArray(json.posts)) throw new Error(`${url} did not return { posts: [...] }`);
        return json;
      }
      problem = `${url} answered ${res.status}`;
      const retryable = res.status === 404 || res.status === 408 || res.status === 429 || res.status >= 500;
      if (!retryable) throw new Error(`Could not read the blog posts: ${problem}`);
    }
    if (attempt >= attempts) throw new Error(`Could not read the blog posts: ${problem}`);
    log(`${problem}; asking again in 20 s (attempt ${attempt} of ${attempts}).`);
    await sleep(20_000);
  }
}

/** One post from the API as the build's post object (the shape content.mjs's loadPosts produces). */
export function toPost(p) {
  const post = {
    slug: p.slug,
    title: p.title,
    description: p.description,
    date: p.date,
    author: p.author,
    tags: p.tags || [],
    keyword: p.keyword || undefined,
    faq: p.faq && p.faq.length ? p.faq.map((f) => ({ q: f.question, a: f.answer })) : null,
    draft: false,
    body: String(p.body || "").replace(/\r\n/g, "\n"),
    file: `api:/blog/${p.slug}`,
    source: "api",
  };
  if (p.dek) post.dek = p.dek;
  if (p.updated) post.updated = p.updated;
  if (p.seoTitle) post.seoTitle = p.seoTitle;
  if (p.seoDescription) post.seoDescription = p.seoDescription;
  if (p.cover) post.cover = { src: p.cover.src, alt: p.cover.alt, width: p.cover.width, height: p.cover.height };
  return post;
}

/**
 * The API's posts that validate and render, and the ones left out with the reason. `hymnsBySlug` is the
 * published hymns (solfa blocks must name one); `authors` the site's authors.
 */
export function postsFromApi(json, { authors, hymnsBySlug }) {
  const posts = [], skipped = [];
  const hymnSlugs = new Set(hymnsBySlug.keys());
  for (const raw of json.posts) {
    const post = toPost(raw);
    try {
      validatePost(post, { file: post.file, authors, hymnSlugs });
      renderMarkdown(post.body, { hymnsBySlug, file: post.file });
      posts.push(post);
    } catch (e) {
      skipped.push({ slug: post.slug, reason: e.message.replace(/^[^\n]*?api:\/blog\/[a-z0-9-]+:\s*/, "") });
    }
  }
  return { posts, skipped };
}
