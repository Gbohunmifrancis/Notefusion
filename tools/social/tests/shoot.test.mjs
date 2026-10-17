// The screenshot's ingredients that need no browser: the demo sheets and the static server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graceSheet, hundredthResult, serveSite } from "../lib/shoot.mjs";
import { SCENES } from "../lib/scenes.mjs";

test("Amazing Grace comes from its hymn page, labelled in solfa by the site's own engine", () => {
  const g = graceSheet();
  assert.equal(g.title, "Amazing Grace");
  assert.equal(g.timeSignature, "3/4");
  assert.match(g.musicXml, /<score-partwise/);
  assert.deepEqual(g.notes.slice(0, 3).map((n) => n.solfa), ["s", "d", "m"]);
  assert.equal(g.notes[0].octaveMark, ",");
});

test("the Old Hundredth fixture has four parts and a hymnbook match, and no audio", () => {
  const r = hundredthResult();
  assert.deepEqual(Object.keys(r.parts).sort(), ["alto", "bass", "soprano", "tenor"]);
  assert.equal(r.hymnMatch.kind, "score");
  assert.ok(!("midiBase64" in r) && !("audioPreviewBase64" in r));
});

test("no scene is the admin console, and every one has alt text", () => {
  for (const [name, s] of Object.entries(SCENES)) {
    assert.doesNotMatch(s.path, /admin|console/, name);
    assert.ok(s.alt.length > 40 && s.alt.length <= 1000, name);
  }
});

test("the site is served as Vercel serves it: /x/ and /x are /x/index.html", async () => {
  const { server, origin } = await serveSite();
  try {
    for (const p of ["/", "/hymns/", "/hymns/identify", "/app/sheet/?s=x"]) {
      const res = await fetch(origin + p);
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get("content-type"), /text\/html/);
    }
    assert.equal((await fetch(origin + "/assets/choir.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal((await fetch(origin + "/nope")).status, 404);
    assert.equal((await fetch(origin + "/..%2f..%2fetc/passwd")).status, 403, "nothing outside web-site/");
  } finally {
    server.close();
  }
});
