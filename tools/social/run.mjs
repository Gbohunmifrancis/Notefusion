#!/usr/bin/env node
// The NoteFusion build journal on X: one post per run about what shipped (or an evergreen angle), with a real
// screenshot of the product against demo data. See docs/SOCIAL.md.
//
//   node tools/social/run.mjs                       dry run: draft + screenshot into tools/social/out/
//   node tools/social/run.mjs --post --history S    post for real (needs the four X_* secrets), recording in S
//
// Options:
//   --post               post to X. Without it (or without every X secret) the run is a dry run.
//   --dry-run            never post, whatever else is given
//   --history FILE       x-history.json (read to avoid repeats; written only when posting)
//   --out DIR            where post.json and shot.png go (default tools/social/out)
//   --local-git [REF]    read merged PRs from `git log --merges` on REF (default HEAD), not the GitHub API
//   --repo OWNER/NAME    default $GITHUB_REPOSITORY;  --base BRANCH  default: the repository's default branch
//   --topic TEXT         a backlog id, "pr:N" / "#N", or free text to write about instead
//   --scene NAME --viewport phone|desktop --theme dark|light   override the screenshot
// Environment: GITHUB_TOKEN, GEMINI_API_KEY, GEMINI_MODEL, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN,
//   X_ACCESS_TOKEN_SECRET, X_INCLUDE_LINKS=true (allow a notefusion.studio link; such posts cost more on X),
//   PW_CHROMIUM_PATH (a Chromium to use instead of Playwright's own). In a sandbox whose HTTPS proxy the
//   browser cannot use, run Node with NODE_USE_ENV_PROXY=1 and the CDN files are fetched through Node.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { selectStory, prsFromGitHub, prsFromGit, LOOKBACK_DAYS } from "./lib/stories.mjs";
import { sceneFor, viewportFor, SCENES } from "./lib/scenes.mjs";
import { writePost } from "./lib/compose.mjs";
import { validatePost } from "./lib/validate.mjs";
import { readHistory, recordPost } from "./lib/history.mjs";
import { xClient, XError } from "./lib/x-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

export function parseArgs(argv) {
  const o = { post: false, dryRun: false, out: path.join(HERE, "out") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === "--post") o.post = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--history") o.history = val();
    else if (a === "--out") o.out = val();
    else if (a === "--local-git") o.localGit = argv[i + 1] && !argv[i + 1].startsWith("--") ? val() : "HEAD";
    else if (a === "--repo") o.repo = val();
    else if (a === "--base") o.base = val();
    else if (a === "--topic") o.topic = val();
    else if (a === "--scene") o.scene = val();
    else if (a === "--viewport") o.viewport = val();
    else if (a === "--theme") o.theme = val();
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

export function xCredentials(env) {
  const c = { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessTokenSecret: env.X_ACCESS_TOKEN_SECRET };
  return Object.values(c).every((v) => v && String(v).trim()) ? c : null;
}

/** GitHub Actions: a line for the run's summary page and the step's outputs. No-ops elsewhere. */
function actions(env) {
  return {
    output(name, value) { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`); },
    summary(md) { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n"); },
  };
}

/**
 * One run. Everything that touches the outside world comes in `deps`, so the tests can run it without a network.
 * Resolves { status, exitCode, post } where status is skipped | dry-run | posted | duplicate | unknown | rate-limited | failed.
 */
export async function journal(opts, deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((s) => console.log(s));
  const now = deps.now ?? new Date();
  const fetchImpl = deps.fetch ?? fetch;
  const gh = actions(env);
  fs.mkdirSync(opts.out, { recursive: true });
  const postFile = path.join(opts.out, "post.json");
  const save = (obj) => fs.writeFileSync(postFile, JSON.stringify(obj, null, 2) + "\n");

  const creds = xCredentials(env);
  const dryRun = opts.dryRun || !opts.post || !creds;
  if (opts.post && !creds) log("::warning::X secrets are missing (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET): dry run.");
  if (!dryRun && !opts.history) throw new Error("--history is required to post (it is how a story is never posted twice).");

  let history = readHistory(opts.history);
  const backlog = JSON.parse(fs.readFileSync(path.join(HERE, "backlog.json"), "utf8")).items;

  // 1. The story.
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const prs = opts.localGit
    ? (deps.prsFromGit ?? prsFromGit)({ cwd: ROOT, ref: opts.localGit, since })
    : await (deps.prsFromGitHub ?? prsFromGitHub)({ repo: opts.repo || env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, base: opts.base, since, fetchImpl });
  log(`Read ${prs.length} merged pull requests since ${since.toISOString().slice(0, 10)}; ${history.length} earlier posts.`);
  const story = selectStory({ prs, backlog, history, now, topic: opts.topic });
  if (!story) {
    save({ skipped: true, reason: "Nothing new shipped and the backlog is used up.", date: now.toISOString() });
    log("Nothing to post: no unposted pull request and no backlog item left.");
    gh.summary("### X journal\nNothing to post this time: no new pull request, and the backlog is used up.");
    return { status: "skipped", exitCode: 0 };
  }
  log(`Story: ${story.id} — ${story.title}`);

  // 2. The screenshot.
  const scene = opts.scene || sceneFor(story);
  if (!SCENES[scene]) throw new Error(`Unknown scene "${scene}". Scenes: ${Object.keys(SCENES).join(", ")}`);
  const viewport = opts.viewport || viewportFor(story);
  const theme = opts.theme || (history.length % 2 ? "light" : "dark");
  const shot = await deps.shoot({ scene, viewport, theme, out: path.join(opts.out, "shot.png"), executablePath: env.PW_CHROMIUM_PATH, relayCdn: !!(env.HTTPS_PROXY || env.https_proxy) });
  const altText = SCENES[scene].alt;
  log(`Screenshot: ${scene} (${viewport}, ${theme}) → ${shot.file}, ${Math.round(shot.bytes / 1024)} KB`);

  // 3. The words.
  const allowLink = String(env.X_INCLUDE_LINKS || "").toLowerCase() === "true";
  const written = await (deps.writePost ?? writePost)(story, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, sceneAlt: altText, allowLink, fetchImpl, sleep: deps.sleep, log });
  const record = {
    dryRun, date: now.toISOString(),
    story: { id: story.id, kind: story.kind, title: story.title, prs: story.prs },
    scene, viewport, theme, image: path.basename(shot.file), altText,
    text: written.text, length: written.text ? validatePost(written.text, { allowLink, facts: story.facts }).length : null,
    source: written.source, model: written.model ?? null, attempts: written.attempts,
  };
  save(record);
  if (!written.text) {
    log("::error::No post passed the checks, not even the template. Nothing was posted; see post.json.");
    return { status: "failed", exitCode: 1, post: record };
  }
  log(`Post (${record.source}${record.model ? `, ${record.model}` : ""}, ${record.length} chars):\n${written.text}`);

  if (dryRun) {
    gh.summary(`### X journal (dry run)\n**Story:** ${story.id} — ${story.title}\n\n**Scene:** ${scene} (${viewport}, ${theme})\n\n**Post** (${record.source}, ${record.length}/260):\n\n${written.text.split("\n").map((l) => "> " + l).join("\n")}\n\nThe screenshot is in the run's artifact.`);
    return { status: "dry-run", exitCode: 0, post: record };
  }

  // 4. Post. The upload can be repeated; the post cannot, so the story is claimed before it is sent.
  const x = (deps.xClient ?? xClient)({ credentials: creds, fetchImpl, log });
  const runId = `${env.GITHUB_RUN_ID || "local"}-${env.GITHUB_RUN_ATTEMPT || "1"}-${crypto.randomUUID().slice(0, 8)}`;
  const entry = { runId, date: now.toISOString(), storyId: story.id, prs: story.prs, scene, text: written.text, status: "pending" };
  const finish = (fields) => {
    history = recordPost(opts.history, history, { ...entry, ...fields });
    gh.output("state_changed", "true");
  };
  let media;
  try {
    media = await x.uploadImage(fs.readFileSync(shot.file), { mimeType: shot.type, filename: path.basename(shot.file) });
    await x.setAltText(media.id, altText);
  } catch (e) {
    if (e instanceof XError && e.kind === "rate_limited") {
      log(`::warning::X rate-limited the upload; nothing posted. The limit resets ${e.resetAt || "later"}.`);
      return { status: "rate-limited", exitCode: 0, post: record };
    }
    log(`::error::The screenshot could not be uploaded: ${e.message}. Nothing was posted.`);
    return { status: "failed", exitCode: 1, post: record };
  }
  finish({}); // pending: if this run dies now, the story is still spent
  try {
    const { id } = await x.createPost(written.text, [media.id]);
    finish({ status: "posted", tweetId: id, url: `https://x.com/i/web/status/${id}` });
    log(`Posted: https://x.com/i/web/status/${id}`);
    gh.output("tweet_id", id);
    gh.summary(`### X journal\nPosted [${id}](https://x.com/i/web/status/${id}) about ${story.id}.\n\n${written.text.split("\n").map((l) => "> " + l).join("\n")}`);
    return { status: "posted", exitCode: 0, post: { ...record, tweetId: id } };
  } catch (e) {
    const kind = e instanceof XError ? e.kind : "unknown";
    if (kind === "duplicate") {
      finish({ status: "duplicate", error: e.message });
      log(`::warning::${e.message} The story is marked as used.`);
      return { status: "duplicate", exitCode: 0, post: record };
    }
    if (kind === "rate_limited") {
      finish({ status: "failed", error: `rate limited until ${e.resetAt || "later"}` });
      log(`::warning::X rate-limited the post; nothing posted. The limit resets ${e.resetAt || "later"}.`);
      return { status: "rate-limited", exitCode: 0, post: record };
    }
    if (kind === "unknown") {
      finish({ status: "unknown", error: e.message });
      log(`::error::${e.message} Check the account: the story is marked as used so it is not posted twice.`);
      return { status: "unknown", exitCode: 1, post: record };
    }
    finish({ status: "failed", error: e.message });
    log(`::error::${e.message}`);
    return { status: "failed", exitCode: 1, post: record };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { shoot } = await import("./lib/shoot.mjs");
  const res = await journal(opts, { shoot });
  process.exitCode = res.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`::error::${e.stack || e.message}`); process.exit(1); });
}
