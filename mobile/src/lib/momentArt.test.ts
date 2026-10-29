// The mirror of the drawing tests in web-site/tests/practice-moments.test.mjs, through the phone's SVG canvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOMENT_ART } from "./momentArt.ts";
import { svgCanvas, type Layer } from "./svgCanvas.ts";

const finite = (layers: Layer[]) => !/NaN|Infinity/.test(JSON.stringify(layers));
const texts = (layers: Layer[]) => layers.flatMap((l) => (l.kind === "svg" ? l.items.flatMap((i) => (i.kind === "text" ? [i.text] : [])) : []));

test("every moment draws its whole run at any values it is handed, without a number that is not one", () => {
  const cases: Record<string, Record<string, number | string>[]> = {
    stars: [{ stars: 1 }, { stars: 2 }, { stars: 3 }, {}],
    streak: [{ days: 1 }, { days: 2 }, { days: 365 }, {}],
    goal: [{ done: 5, target: 5 }, { done: 1, target: 1 }, { done: 2, target: 5 }, { done: 9, target: 3 }, {}],
    combo: [{ run: 5, perfect: 0 }, { run: 8, perfect: 1 }, { run: 32, perfect: 1 }, { run: 1 }, {}],
    musicbox: [{ label: "Unit done!" }, { label: "Grade done!" }, {}],
    doh: [{}],
  };
  assert.deepEqual(Object.keys(MOMENT_ART).sort(), Object.keys(cases).sort());
  for (const [name, piece] of Object.entries(MOMENT_ART)) {
    for (const values of cases[name]!) {
      let drawn = 0;
      for (let t = 0; t <= piece.ms / 1000; t += 1 / 30) {
        const c = svgCanvas();
        piece.draw(c, t, values);
        const layers = c.frame();
        assert.ok(finite(layers), `${name} at ${t.toFixed(2)}`);
        drawn += layers.length;
      }
      assert.ok(drawn > 0, name);
    }
  }
});

test("the moments say what they were handed, and Doh stands in the card as one of the art's own poses", () => {
  const said = (name: keyof typeof MOMENT_ART, values: Record<string, number | string>, t: number) => {
    const c = svgCanvas();
    MOMENT_ART[name].draw(c, t, values);
    return texts(c.frame());
  };
  assert.deepEqual(said("streak", { days: 12 }, 2.5), ["12", "day streak"]);
  assert.deepEqual(said("streak", { days: 1 }, 2.5), ["1", "day streak begun"]);
  assert.ok(said("combo", { run: 7, perfect: 0 }, 3).includes("×7"));
  assert.ok(said("combo", { run: 6, perfect: 1 }, 3).includes("Perfect run!"));
  assert.deepEqual(said("goal", { done: 3, target: 5 }, 2.5), ["3", "of 5 days", "This week"]);
  assert.ok(said("musicbox", { label: "Grade done!" }, 3).includes("Grade done!"));
  const doh = (t: number) => { const c = svgCanvas(); MOMENT_ART.doh.draw(c, t, {}); return c.frame().filter((l) => l.kind === "image").map((l) => (l.kind === "image" ? l.name : "")); };
  assert.deepEqual(doh(0.2), ["doh-wave"]);
  assert.deepEqual(doh(2), ["doh-cheer"]);
});

test("each piece's size and length are the web's", async () => {
  const { readFileSync } = await import("node:fs");
  const web = readFileSync(new URL("../../../web-site/assets/moment-art.js", import.meta.url), "utf8");
  for (const [name, p] of Object.entries(MOMENT_ART)) {
    const m = new RegExp(`${name}: \\{ width: (\\d+), height: (\\d+), ms: (\\d+)`).exec(web);
    assert.ok(m, name);
    assert.deepEqual([p.width, p.height, p.ms], [Number(m![1]), Number(m![2]), Number(m![3])], name);
  }
});
