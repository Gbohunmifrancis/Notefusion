// Choosing what to post: one story, never one already posted, ops-only pull requests skipped, hymn-library
// batches folded into one post now and then, the backlog when nothing shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { classify, cleanBody, selectStory, spent, prsFromGit, prsFromGitHub } from "../lib/stories.mjs";
import { sceneFor, viewportFor, SCENES } from "../lib/scenes.mjs";

const NOW = new Date("2026-10-17T16:07:00Z");
const ago = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const pr = (number, title, daysAgo = 1, body = "") => ({ number, title, body, mergedAt: ago(daysAgo), author: "Gbohunmifrancis" });
const BACKLOG = JSON.parse(fs.readFileSync(new URL("../backlog.json", import.meta.url), "utf8")).items;

test("pull requests are features, hymn-library batches, or ops", () => {
  assert.equal(classify(pr(1, "Learn my part, Hum to find a hymn, and the admin console in NoteFusion's night look")), "feature");
  assert.equal(classify(pr(2, "Harmony: inner parts that move as lines, measured against real hymn books")), "feature");
  assert.equal(classify(pr(3, "CCEH: dates for seven more composers; 6 more tunes, SCHULER refused")), "library");
  assert.equal(classify(pr(4, "CCEH tunes: tune pages + hymn recognition (first 189 of 1,398 crawled)")), "library");
  assert.equal(classify(pr(5, "Deploy the admin console on every merge that touches it")), "ops");
  assert.equal(classify(pr(6, "ci: cache the NuGet packages")), "ops");
  assert.equal(classify(pr(7, "Bump marked from 18.0.13 to 18.0.14")), "ops");
  assert.equal(classify(pr(8, "Refactor the quota gate")), "ops");
  assert.equal(classify(pr(9, "Admin: blog analytics")), "ops");
  assert.equal(classify({ ...pr(10, "Shiny thing"), author: "dependabot[bot]" }), "ops");
  assert.equal(classify(pr(11, "A quiet fix", 1, "Nothing to say. [skip social]")), "ops");
});

test("a PR body loses comments, code, links and tool footers", () => {
  const body = "What changed\n<!-- template -->\n```js\nsecret()\n```\nSee https://example.com/x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\nhttps://claude.ai/code/session_x\nCo-Authored-By: Claude <noreply@anthropic.com>";
  assert.equal(cleanBody(body), "What changed\n\nSee");
});

test("the newest unposted feature PR wins; ops PRs are never picked", () => {
  const prs = [pr(100, "Deploy the web site from CI", 0.5), pr(101, "Hymn recognition: use the hymnbook version?", 3), pr(102, "Four parts: a Hear row to mute or solo each voice", 1)];
  const s = selectStory({ prs, backlog: BACKLOG, history: [], now: NOW });
  assert.equal(s.id, "pr:102");
  assert.deepEqual(s.prs, [102]);
  assert.match(s.facts, /Hear row/);
});

test("a posted PR is not posted again, nor one claimed by a run that may have posted it", () => {
  const prs = [pr(101, "Hymn recognition", 3), pr(102, "Four parts", 1), pr(103, "Learn my part", 2)];
  const history = [
    { storyId: "pr:102", prs: [102], status: "posted", date: ago(1) },
    { storyId: "pr:103", prs: [103], status: "unknown", date: ago(1) },
  ];
  assert.equal(selectStory({ prs, backlog: BACKLOG, history, now: NOW }).id, "pr:101");
  history.push({ storyId: "pr:101", prs: [101], status: "pending", date: ago(0) });
  assert.equal(selectStory({ prs, backlog: BACKLOG, history, now: NOW }).kind, "backlog");
});

test("a failed attempt does not spend the story", () => {
  const history = [{ storyId: "pr:102", prs: [102], status: "failed", date: ago(0) }];
  assert.equal(selectStory({ prs: [pr(102, "Four parts", 1)], backlog: [], history, now: NOW }).id, "pr:102");
  assert.equal(spent(history).prs.size, 0);
});

test("PRs older than the lookback are let go", () => {
  const s = selectStory({ prs: [pr(90, "Old news feature", 20)], backlog: BACKLOG, history: [], now: NOW });
  assert.equal(s.id, `backlog:${BACKLOG[0].id}`);
});

test("hymn-library batches become one story, at most once per cooldown", () => {
  const prs = [pr(97, "CCEH tunes: tune pages + hymn recognition (first 189 of 1,398 crawled)", 3), pr(98, "CCEH: 44 composers dated (41 more tunes published, 4 refused)", 2), pr(99, "Deploy the admin console", 1)];
  const s = selectStory({ prs, backlog: BACKLOG, history: [], now: NOW });
  assert.equal(s.id, "library:98");
  assert.deepEqual(s.prs, [97, 98]);
  assert.equal(s.scene, "hymns-index");
  assert.match(s.facts, /1,398/);
  // A later batch inside the cooldown waits: the backlog goes first.
  const history = [{ storyId: "library:98", prs: [97, 98], status: "posted", date: ago(2) }];
  const later = [...prs, pr(104, "CCEH: 20 more hymn tunes", 1)];
  assert.equal(selectStory({ prs: later, backlog: BACKLOG, history, now: NOW }).kind, "backlog");
  // After it, the waiting batch is posted on its own.
  const afterCooldown = new Date(NOW.getTime() + 13 * 86_400_000);
  const s2 = selectStory({ prs: [pr(104, "CCEH: 20 more hymn tunes", -12.5)], backlog: [], history, now: afterCooldown });
  assert.equal(s2.id, "library:104");
});

test("the backlog goes in file order, each item once; then nothing", () => {
  const history = [];
  const seen = [];
  for (;;) {
    const s = selectStory({ prs: [], backlog: BACKLOG, history, now: NOW });
    if (!s) break;
    seen.push(s.id);
    history.push({ storyId: s.id, prs: s.prs, status: "posted", date: NOW.toISOString() });
  }
  assert.deepEqual(seen, BACKLOG.map((b) => `backlog:${b.id}`));
  assert.equal(new Set(BACKLOG.map((b) => b.id)).size, BACKLOG.length, "backlog ids are unique");
});

test("a topic overrides: a backlog id, a PR number, or free text", () => {
  const prs = [pr(102, "Four parts", 1)];
  assert.equal(selectStory({ prs, backlog: BACKLOG, now: NOW, topic: "learn-my-part" }).id, "backlog:learn-my-part");
  assert.equal(selectStory({ prs, backlog: BACKLOG, now: NOW, topic: "#102" }).id, "pr:102");
  assert.equal(selectStory({ prs, backlog: BACKLOG, now: NOW, topic: "pr:102" }).id, "pr:102");
  assert.throws(() => selectStory({ prs, backlog: BACKLOG, now: NOW, topic: "#7" }), /PR #7/);
  const free = selectStory({ prs, backlog: BACKLOG, now: NOW, topic: "Why I record choirs on a phone" });
  assert.equal(free.id, "topic:why-i-record-choirs-on-a-phone");
  assert.equal(free.facts, "Why I record choirs on a phone");
});

test("every backlog item names a real scene and has a fallback", () => {
  for (const b of BACKLOG) {
    assert.ok(SCENES[b.scene], `${b.id}: scene ${b.scene}`);
    assert.ok(b.fallback && b.facts?.length, `${b.id}: fallback and facts`);
  }
});

test("a story's screenshot follows its words; phone unless it is about a desktop surface", () => {
  assert.equal(sceneFor({ title: "Learn my part, Hum to find a hymn, and the admin console" }), "practice");
  assert.equal(sceneFor({ title: "Hymn recognition: \"This sounds like Amazing Grace — use the hymnbook version?\"" }), "hymnbook");
  assert.equal(sceneFor({ title: "Harmony: inner parts that move as lines" }), "app-parts");
  assert.equal(sceneFor({ title: "Bar lines that match the hymnbook: 3/4 and pickups detected" }), "app-staff");
  assert.equal(sceneFor({ title: "Shared folders for the choir" }), "shared-sheet");
  assert.equal(sceneFor({ title: "Something else entirely", facts: "the doh is spelled as the key signature" }), "app-solfa");
  assert.equal(sceneFor({ title: "Nothing matches" }), "app-staff");
  assert.equal(sceneFor({ title: "Learn my part", scene: "home" }), "home");
  assert.equal(viewportFor({ title: "Learn my part" }), "phone");
  assert.equal(viewportFor({ title: "A sidebar for the web app on desktop" }), "desktop");
  assert.equal(viewportFor({ title: "x", viewport: "desktop" }), "desktop");
});

test("merged PRs from local git history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-social-git-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "root");
    git("checkout", "-q", "-b", "feature");
    git("commit", "-q", "--allow-empty", "-m", "work");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "feature", "-m", "Merge pull request #42 from someone/feature\n\nLearn my part\n\nMore detail here.");
    git("merge", "-q", "--no-ff", "feature", "-m", "not a PR merge", "--allow-unrelated-histories");
    const prs = prsFromGit({ cwd: dir, since: new Date(Date.now() - 86_400_000) });
    assert.equal(prs.length, 1);
    assert.equal(prs[0].number, 42);
    assert.equal(prs[0].title, "Learn my part");
    assert.equal(prs[0].body, "More detail here.");
    assert.equal(prs[0].author, "someone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("merged PRs from the GitHub API: the default branch, merged ones only, since the date", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.headers.Authorization]);
    if (url.endsWith("/repos/o/r")) return { ok: true, json: async () => ({ default_branch: "main" }) };
    return { ok: true, json: async () => [
      { number: 3, title: "New", body: null, merged_at: ago(1), updated_at: ago(1), user: { login: "a" }, labels: [] },
      { number: 2, title: "Closed unmerged", merged_at: null, updated_at: ago(2) },
      { number: 1, title: "Old", body: "", merged_at: ago(30), updated_at: ago(30), user: { login: "a" }, labels: [] },
    ] };
  };
  const prs = await prsFromGitHub({ repo: "o/r", token: "tkn", since: new Date(ago(14)), fetchImpl });
  assert.deepEqual(prs.map((p) => p.number), [3]);
  assert.equal(calls[1][0], "https://api.github.com/repos/o/r/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=1");
  assert.equal(calls[0][1], "Bearer tkn");
  await assert.rejects(prsFromGitHub({ repo: "o/r", base: "main", since: new Date(), fetchImpl: async () => ({ ok: false, status: 403 }) }), /GitHub answered 403/);
});
