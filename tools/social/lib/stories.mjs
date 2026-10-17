// What the next post is about: one thing that shipped since the last post, or an evergreen angle from
// backlog.json when nothing new did. Never a pull request or backlog item that was already posted.
import { execFileSync } from "node:child_process";

export const LOOKBACK_DAYS = 14; // a merged PR not posted within this long is old news and is let go
export const LIBRARY_COOLDOWN_DAYS = 14; // hymn-library batches: at most one post per this many days

/** Pull requests that change nothing a reader would notice. Matched on the title only. */
const OPS = new RegExp(
  [
    String.raw`^\s*(?:ci|build|chore|deps?|bump|refactor|lint|tests?|docs?|infra|ops)\b`,
    String.raw`\b(?:dependabot|renovate|workflows?|github actions|deploy(?:s|ed|ing|ment)?|ec2|vercel|heroku|docker(?:file)?|runner|lockfile|typo|readme|migration only|flaky)\b`,
    String.raw`^\s*(?:admin|console)\b`,
  ].join("|"),
  "i",
);
/** Batches of hymn tunes added to the library: one post now and then, not one per batch. */
const LIBRARY = /^\s*cceh\b|\b(?:hymn tunes?|more tunes|tunes? published|composers? dated|import(?:ed|s)? .*hymns?|hymn library batch)\b/i;

export function classify(pr) {
  const title = String(pr.title || "");
  if (/\[skip social\]|\[no social\]/i.test(`${title}\n${pr.body || ""}`)) return "ops";
  if (pr.author && /\[bot\]$|^dependabot|^renovate/i.test(pr.author)) return "ops";
  if (LIBRARY.test(title)) return "library";
  if (OPS.test(title)) return "ops";
  return "feature";
}

/** A PR body as story material: no comments, code, tool footers or links; at most `max` characters. */
export function cleanBody(body, max = 2000) {
  return String(body || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^.*(?:Generated with \[Claude Code\]|Claude-Session:|Co-Authored-By:|https:\/\/claude\.ai\/code).*$/gim, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

// ── Sources ───────────────────────────────────────────────────────────────────

/** Merged PRs into `base` since `since`, from the GitHub REST API. */
export async function prsFromGitHub({ repo, token, base, since, fetchImpl = fetch }) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "notefusion-social" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return res.json();
  };
  if (!base) base = (await get(`/repos/${repo}`)).default_branch;
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await get(`/repos/${repo}/pulls?state=closed&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=100&page=${page}`);
    for (const p of batch) {
      if (!p.merged_at || new Date(p.merged_at) < since) continue;
      out.push({ number: p.number, title: p.title, body: p.body || "", mergedAt: p.merged_at, author: p.user?.login || "", labels: (p.labels || []).map((l) => l.name) });
    }
    if (batch.length < 100 || new Date(batch[batch.length - 1].updated_at) < since) break;
  }
  return out;
}

/**
 * The same from local history, for a run without a token: merge commits on `ref` named "Merge pull request
 * #N from ...", whose body (GitHub puts the PR title there) is the title. No PR body is available this way.
 */
export function prsFromGit({ cwd, ref = "HEAD", since }) {
  const out = execFileSync("git", ["log", "--merges", "--first-parent", `--since=${since.toISOString()}`, "--format=%cI%x1f%s%x1f%b%x1e", ref], { cwd, encoding: "utf8", maxBuffer: 16 << 20 });
  const prs = [];
  for (const rec of out.split("\x1e")) {
    const [date, subject, body] = rec.replace(/^\n+/, "").split("\x1f");
    const m = /^Merge pull request #(\d+) from (\S+)/.exec(subject || "");
    if (!m) continue;
    const lines = String(body || "").trim().split("\n");
    prs.push({ number: Number(m[1]), title: lines[0] || subject, body: lines.slice(1).join("\n").trim(), mergedAt: date, author: m[2].split("/")[0], labels: [] });
  }
  return prs;
}

// ── Choosing ──────────────────────────────────────────────────────────────────

/** Entries that spend a story: posted, refused as a duplicate, possibly posted, or claimed by a run that died. */
const SPENT = new Set(["posted", "duplicate", "unknown", "pending"]);

export function spent(history) {
  const prs = new Set(), ids = new Set();
  for (const h of history || []) {
    if (!SPENT.has(h.status || "posted")) continue;
    if (h.storyId) ids.add(h.storyId);
    for (const n of h.prs || []) prs.add(Number(n));
  }
  return { prs, ids };
}

const days = (n) => n * 86_400_000;

function prStory(pr) {
  return {
    id: `pr:${pr.number}`,
    kind: "pr",
    prs: [pr.number],
    title: pr.title,
    facts: `${pr.title}\n\n${cleanBody(pr.body)}`.trim(),
    mergedAt: pr.mergedAt,
  };
}

function libraryStory(prs) {
  const sorted = [...prs].sort((a, b) => a.number - b.number);
  const last = sorted[sorted.length - 1];
  return {
    id: `library:${last.number}`,
    kind: "library",
    prs: sorted.map((p) => p.number),
    title: "More hymn tunes in the library",
    angle: "The hymn library grew: more public-domain hymn tunes have their own pages in tonic solfa and staff, and the hymn finder now recognises them.",
    facts: sorted.map((p) => `${p.title}\n${cleanBody(p.body, 600)}`).join("\n\n"),
    scene: "hymns-index",
    link: "https://notefusion.studio/hymns",
    mergedAt: last.mergedAt,
  };
}

function backlogStory(item) {
  return {
    id: `backlog:${item.id}`,
    kind: "backlog",
    prs: [],
    title: item.title,
    angle: item.angle,
    facts: `${item.title}\n${item.angle}\n${(item.facts || []).join("\n")}`,
    scene: item.scene,
    viewport: item.viewport,
    link: item.link,
    fallback: item.fallback,
  };
}

/**
 * The next story, or null when there is nothing to say.
 * Order: a feature PR merged in the last LOOKBACK_DAYS and never posted (the newest first); else the unposted
 * hymn-library batches as one story, if no library post went out in LIBRARY_COOLDOWN_DAYS; else the first
 * unposted backlog item. `topic` overrides: a backlog id, "pr:N" / "#N", or free text to write about.
 */
export function selectStory({ prs = [], backlog = [], history = [], now = new Date(), topic = "" }) {
  const { prs: donePrs, ids: doneIds } = spent(history);
  const t = String(topic || "").trim();
  if (t) {
    const item = backlog.find((b) => b.id === t || `backlog:${b.id}` === t);
    if (item) return backlogStory(item);
    const n = /^(?:pr:|#)(\d+)$/i.exec(t);
    if (n) {
      const pr = prs.find((p) => p.number === Number(n[1]));
      if (!pr) throw new Error(`PR #${n[1]} is not among the merged pull requests read for this run.`);
      return prStory(pr);
    }
    const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    return { id: `topic:${slug}`, kind: "topic", prs: [], title: t, angle: t, facts: t };
  }

  const fresh = prs.filter((p) => !donePrs.has(p.number) && now - new Date(p.mergedAt) <= days(LOOKBACK_DAYS));
  const features = fresh.filter((p) => classify(p) === "feature").sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
  if (features.length) return prStory(features[0]);

  const library = fresh.filter((p) => classify(p) === "library");
  const lastLibrary = (history || []).filter((h) => SPENT.has(h.status || "posted") && String(h.storyId || "").startsWith("library:")).map((h) => new Date(h.date)).sort((a, b) => b - a)[0];
  if (library.length && (!lastLibrary || now - lastLibrary >= days(LIBRARY_COOLDOWN_DAYS))) return libraryStory(library);

  const item = backlog.find((b) => !doneIds.has(`backlog:${b.id}`));
  return item ? backlogStory(item) : null;
}
