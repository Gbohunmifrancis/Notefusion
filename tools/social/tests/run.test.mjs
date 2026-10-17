// A whole run with every outside call replaced: the dry run (what the workflow does until posting is turned
// on), and the posting path with a fake X client, which must record each story so it is never posted twice.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { journal, parseArgs, xCredentials } from "../run.mjs";
import { XError } from "../lib/x-api.mjs";
import { readHistory } from "../lib/history.mjs";

const NOW = new Date("2026-10-17T16:07:00Z");
const PRS = [
  { number: 105, title: "Learn my part, Hum to find a hymn", body: "Loop a few bars, slow them down.", mergedAt: "2026-10-16T20:00:00Z", author: "f" },
  { number: 104, title: "Four parts: a Hear row to mute or solo each voice", body: "", mergedAt: "2026-10-15T20:00:00Z", author: "f" },
  { number: 103, title: "Deploy the admin console on every merge", body: "", mergedAt: "2026-10-16T21:00:00Z", author: "f" },
];
const X_ENV = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_TOKEN_SECRET: "ts" };
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-social-run-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const offline = async () => { throw new Error("no network in this test"); };
function deps(extra = {}) {
  const shots = [];
  return {
    shots,
    env: {}, now: NOW, log: () => {}, fetch: offline,
    prsFromGitHub: async () => PRS,
    shoot: async ({ scene, viewport, theme, out }) => { shots.push({ scene, viewport, theme }); fs.writeFileSync(out, Buffer.from("PNG")); return { file: out, bytes: 3, type: "image/png" }; },
    ...extra,
  };
}

test("options", () => {
  assert.deepEqual(parseArgs(["--post", "--history", "h.json", "--local-git", "--topic", "#105"]), { post: true, dryRun: false, out: parseArgs([]).out, history: "h.json", localGit: "HEAD", topic: "#105" });
  assert.equal(parseArgs(["--local-git", "origin/main"]).localGit, "origin/main");
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
  assert.equal(xCredentials({ ...X_ENV, X_ACCESS_TOKEN: " " }), null);
  assert.ok(xCredentials(X_ENV));
});

test("the dry run: story, screenshot, template post, post.json; no network, no history", async () => {
  const d = deps();
  const out = path.join(dir, "out");
  const history = path.join(dir, "state", "x-history.json");
  const res = await journal({ out, history, post: true }, d); // --post without secrets is still a dry run
  assert.equal(res.status, "dry-run");
  assert.equal(res.exitCode, 0);
  const post = JSON.parse(fs.readFileSync(path.join(out, "post.json"), "utf8"));
  assert.equal(post.dryRun, true);
  assert.equal(post.story.id, "pr:105");
  assert.equal(post.scene, "practice");
  assert.equal(post.viewport, "phone");
  assert.equal(post.source, "template");
  assert.equal(post.text, "Shipped in NoteFusion: Learn my part, Hum to find a hymn.\n\n#buildinpublic");
  assert.ok(post.length <= 260);
  assert.match(post.altText, /Learn my part/);
  assert.ok(fs.existsSync(path.join(out, "shot.png")));
  assert.equal(fs.existsSync(history), false, "a dry run spends nothing");
  assert.deepEqual(d.shots, [{ scene: "practice", viewport: "phone", theme: "dark" }]);
});

test("nothing to say: a skip, not an error", async () => {
  const res = await journal({ out: dir }, deps({ prsFromGitHub: async () => [], now: NOW }));
  // The backlog still has items, so a backlog story is chosen.
  assert.equal(res.status, "dry-run");
  assert.match(res.post.story.id, /^backlog:/);
  const all = JSON.parse(fs.readFileSync(new URL("../backlog.json", import.meta.url), "utf8")).items;
  const history = path.join(dir, "h.json");
  fs.writeFileSync(history, JSON.stringify({ version: 1, posts: all.map((b) => ({ storyId: `backlog:${b.id}`, prs: [], status: "posted" })) }));
  const res2 = await journal({ out: dir, history }, deps({ prsFromGitHub: async () => [] }));
  assert.equal(res2.status, "skipped");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "post.json"), "utf8")).skipped, true);
});

function fakeX(createPost) {
  const calls = [];
  return {
    calls,
    xClient: () => ({
      uploadImage: async (bytes, o) => { calls.push(["upload", bytes.length, o.mimeType]); return { id: "m1" }; },
      setAltText: async (id, alt) => { calls.push(["alt", id, alt]); return true; },
      createPost: async (text, ids) => { calls.push(["create", text, ids]); return createPost(); },
    }),
  };
}

test("posting: upload, alt text, one create; the story is recorded and the next run picks another", async () => {
  const history = path.join(dir, "x-history.json");
  const x = fakeX(async () => ({ id: "1850000000000000001" }));
  const res = await journal({ out: dir, history, post: true }, deps({ env: { ...X_ENV, GITHUB_RUN_ID: "77" }, xClient: x.xClient }));
  assert.equal(res.status, "posted");
  assert.deepEqual(x.calls.map((c) => c[0]), ["upload", "alt", "create"]);
  assert.deepEqual(x.calls[2][2], ["m1"]);
  const posts = readHistory(history);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, "posted");
  assert.equal(posts[0].storyId, "pr:105");
  assert.equal(posts[0].tweetId, "1850000000000000001");
  assert.match(posts[0].runId, /^77-1-/);

  const x2 = fakeX(async () => ({ id: "1850000000000000002" }));
  const res2 = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: x2.xClient, now: new Date(NOW.getTime() + 2 * 86_400_000) }));
  assert.equal(res2.post.story.id, "pr:104", "the deploy PR is skipped, 105 is spent");
  assert.equal(res2.post.theme, "light", "the theme alternates");
  assert.equal(readHistory(history).length, 2);
});

test("an answer that may have posted spends the story and fails the run; a duplicate spends it quietly", async () => {
  const history = path.join(dir, "x-history.json");
  const unknown = fakeX(async () => { throw new XError("unknown", "X did not answer the post request; it may or may not have been posted."); });
  const r1 = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: unknown.xClient }));
  assert.equal(r1.status, "unknown");
  assert.equal(r1.exitCode, 1);
  assert.equal(readHistory(history)[0].status, "unknown");

  const dup = fakeX(async () => { throw new XError("duplicate", "duplicate content"); });
  const r2 = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: dup.xClient }));
  assert.equal(r2.post.story.id, "pr:104");
  assert.equal(r2.status, "duplicate");
  assert.equal(r2.exitCode, 0);

  const r3 = await journal({ out: dir, history }, deps());
  assert.match(r3.post.story.id, /^backlog:/, "both PRs are spent");
});

test("a rate limit or a refusal leaves the story for next time", async () => {
  const history = path.join(dir, "x-history.json");
  const limited = fakeX(async () => { throw new XError("rate_limited", "limited", { resetAt: "2026-10-17T17:00:00.000Z" }); });
  const r1 = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: limited.xClient }));
  assert.equal(r1.status, "rate-limited");
  assert.equal(r1.exitCode, 0);
  const refused = fakeX(async () => { throw new XError("auth", "X refused the post (403): read-only app"); });
  const r2 = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: refused.xClient }));
  assert.equal(r2.post.story.id, "pr:105", "still the same story");
  assert.equal(r2.exitCode, 1);
  assert.deepEqual(readHistory(history).map((p) => p.status), ["failed", "failed"]);
});

test("an upload that is rate-limited posts nothing and records nothing", async () => {
  const history = path.join(dir, "x-history.json");
  const x = { xClient: () => ({ uploadImage: async () => { throw new XError("rate_limited", "limited", { resetAt: null }); }, setAltText: async () => true, createPost: async () => assert.fail("must not post") }) };
  const r = await journal({ out: dir, history, post: true }, deps({ env: X_ENV, xClient: x.xClient }));
  assert.equal(r.status, "rate-limited");
  assert.equal(fs.existsSync(history), false);
});

test("posting without a history file is refused before anything is sent", async () => {
  await assert.rejects(journal({ out: dir, post: true }, deps({ env: X_ENV })), /--history is required/);
});
