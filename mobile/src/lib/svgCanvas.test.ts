import { test } from "node:test";
import assert from "node:assert/strict";
import { multiply, svgCanvas, type PathItem, type SvgLayer } from "./svgCanvas.ts";

const first = (c: ReturnType<typeof svgCanvas>) => c.frame()[0] as SvgLayer;

test("a path is written in the card's coordinates, through the transform it was drawn under", () => {
  const c = svgCanvas();
  c.translate(10, 20); c.scale(2, 2);
  c.beginPath(); c.rect(0, 0, 5, 5); c.fillStyle = "red"; c.fill();
  const item = first(c).items[0] as PathItem;
  assert.equal(item.d, "M10 20L20 20L20 30L10 30Z");
  assert.equal(item.fill, "red");
  assert.equal(item.opacity, 1);
});

test("save and restore keep the transform, the alpha and the clip; a stroke thickens with the scale", () => {
  const c = svgCanvas();
  c.save(); c.scale(3, 3); c.globalAlpha *= 0.5; c.beginPath(); c.rect(0, 0, 1, 1); c.clip();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(1, 0); c.lineWidth = 2; c.stroke();
  c.restore();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(1, 0); c.stroke();
  const [inside, outside] = first(c).items as PathItem[];
  assert.equal(inside!.strokeWidth, 6);
  assert.equal(inside!.opacity, 0.5);
  assert.equal(inside!.clip, first(c).clips[0]!.id);
  assert.equal(first(c).clips[0]!.d, "M0 0L3 0L3 3L0 3Z");
  assert.equal(outside!.d, "M0 0L1 0");
  assert.equal(outside!.opacity, 1);
  assert.equal(outside!.clip, undefined);
});

test("a full circle is four cubic curves that come back to where they began", () => {
  const c = svgCanvas();
  c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
  const d = (first(c).items[0] as PathItem).d;
  assert.equal(d.match(/C/g)!.length, 4);
  assert.ok(d.startsWith("M10 0"));
  assert.ok(d.endsWith(" 10 0"));
});

test("a gradient keeps the transform it was filled under; a picture starts a layer of its own", () => {
  const c = svgCanvas();
  c.translate(5, 0);
  const g = c.createLinearGradient(0, 0, 0, 10); g.addColorStop(0, "#fff"); g.addColorStop(1, "#000");
  c.beginPath(); c.rect(0, 0, 1, 1); c.fillStyle = g; c.fill();
  c.drawImage("doh-wave", -1, -2, 3, 4);
  c.beginPath(); c.rect(0, 0, 1, 1); c.fillStyle = "#123"; c.fill();
  const layers = c.frame();
  assert.deepEqual(layers.map((l) => l.kind), ["svg", "image", "svg"]);
  const svg = layers[0] as SvgLayer;
  assert.equal((svg.items[0] as PathItem).fill, `url(#${svg.gradients[0]!.id})`);
  assert.deepEqual(svg.gradients[0]!.matrix, [1, 0, 0, 1, 5, 0]);
  assert.deepEqual(layers[1], { kind: "image", name: "doh-wave", x: -1, y: -2, width: 3, height: 4, matrix: [1, 0, 0, 1, 5, 0], opacity: 1 });
});

test("matrices compose as canvas calls do: the later call applies first", () => {
  assert.deepEqual(multiply([1, 0, 0, 1, 10, 0], [2, 0, 0, 2, 0, 0]), [2, 0, 0, 2, 10, 0]);
  assert.deepEqual(multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 10, 0]), [2, 0, 0, 2, 20, 0]);
});
