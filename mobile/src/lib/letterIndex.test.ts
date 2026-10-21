import { test } from "node:test";
import assert from "node:assert/strict";
import { letterOf, letterSections, railGeometry, railIndexAt, sectionCellLayouts } from "./letterIndex.ts";
import { searchHymns, titleKey, type PackHymn } from "./hymnPack.ts";

function hymn(title: string): PackHymn {
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    kind: "hymn",
    title,
    firstLine: "",
    tune: "",
    key: "C major",
    time: "4/4",
    tempo: 90,
    pickup: 0,
    credit: "",
    url: "",
    notes: [[60, 0, 1]],
    words: "",
    verses: [],
  };
}

test("a title files under the letter it sorts by, a number under #", () => {
  assert.equal(letterOf(titleKey("Abide with Me")), "A");
  assert.equal(letterOf(titleKey("‘Tis So Sweet to Trust in Jesus")), "T");
  assert.equal(letterOf(titleKey("Ô Sacred Head")), "O");
  assert.equal(letterOf(titleKey("10,000 Reasons")), "#");
  assert.equal(letterOf(""), "#");
});

test("the hymns, as the list sorts them, fall under A to Z with no empty letters", () => {
  const titles = ["Wesley's Hymn", "Abide with Me", "‘Tis So Sweet", "A Child of the King", "Be Thou My Vision", "Blessed Assurance"];
  const sections = letterSections(searchHymns(titles.map(hymn), ""), (h) => titleKey(h.title));
  assert.deepEqual(
    sections.map((s) => [s.letter, s.data.map((h) => h.title)]),
    [
      ["A", ["A Child of the King", "Abide with Me"]],
      ["B", ["Be Thou My Vision", "Blessed Assurance"]],
      ["T", ["‘Tis So Sweet"]],
      ["W", ["Wesley's Hymn"]],
    ],
  );
  assert.deepEqual(letterSections([], (h: PackHymn) => h.title), []);
});

test("the rail's letters share its height, at most a slot each, centred", () => {
  assert.deepEqual(railGeometry(400, 20, 16), { slot: 16, top: 40 });
  assert.deepEqual(railGeometry(200, 25, 16), { slot: 8, top: 0 });
  assert.deepEqual(railGeometry(0, 25, 16), { slot: 0, top: 0 });
});

test("a finger picks the letter under it, and holds the end it ran past", () => {
  const g = railGeometry(400, 20, 16); // letters from 40 to 360
  assert.equal(railIndexAt(41, g, 20), 0);
  assert.equal(railIndexAt(56, g, 20), 1);
  assert.equal(railIndexAt(359, g, 20), 19);
  assert.equal(railIndexAt(-30, g, 20), 0);
  assert.equal(railIndexAt(900, g, 20), 19);
  assert.equal(railIndexAt(10, { slot: 0, top: 0 }, 0), 0);
});

test("every cell's place: each group's header, its rows, a footer of no height, after the list's top", () => {
  const cells = sectionCellLayouts([2, 1], { top: 100, header: 30, row: 60 });
  assert.deepEqual(cells, [
    { length: 30, offset: 100 }, // A
    { length: 60, offset: 130 },
    { length: 60, offset: 190 },
    { length: 0, offset: 250 }, // A's footer
    { length: 30, offset: 250 }, // B
    { length: 60, offset: 280 },
    { length: 0, offset: 340 },
  ]);
});
