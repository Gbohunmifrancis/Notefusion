// x-history.json: every post the journal made or tried to make, newest last. It lives on the orphan branch
// x-journal-state (never main, which would deploy the site); the workflow checks that branch out into a
// worktree, the run reads and writes the file there, and the workflow commits and pushes it.
import fs from "node:fs";
import path from "node:path";

export function readHistory(file) {
  if (!file || !fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(json.posts)) throw new Error(`${file} has no "posts" array.`);
  return json.posts;
}

export function writeHistory(file, posts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, posts }, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Adds or replaces (by `runId`) one entry and saves at once, so a crash later in the run cannot lose it. */
export function recordPost(file, posts, entry) {
  const next = posts.filter((p) => p.runId !== entry.runId).concat([entry]);
  writeHistory(file, next);
  return next;
}
