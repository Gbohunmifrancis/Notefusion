import { test } from "node:test";
import assert from "node:assert/strict";
import { choirCodeFromText, choirCodeFromUrl, normaliseChoirCode } from "./choirCode.ts";

test("a typed code is cleaned up the way the server reads it", () => {
  assert.equal(normaliseChoirCode("ab3k-7mqz"), "AB3K7MQZ");
  assert.equal(normaliseChoirCode(" AB3K 7MQZ "), "AB3K7MQZ");
  assert.equal(normaliseChoirCode("AB3K7MQ"), null); // too short
  assert.equal(normaliseChoirCode("AB3K7MQZZ"), null); // too long
  assert.equal(normaliseChoirCode(""), null);
});

test("the app's join link and the website's invite link both carry the code", () => {
  assert.equal(choirCodeFromUrl("notefusion://join/AB3K7MQZ"), "AB3K7MQZ");
  assert.equal(choirCodeFromUrl("notefusion:///join/ab3k7mqz?src=share"), "AB3K7MQZ");
  assert.equal(choirCodeFromUrl("https://notefusion.studio/app?join=AB3K7MQZ"), "AB3K7MQZ");
  assert.equal(choirCodeFromUrl("https://notefusion.studio/app/?utm=x&join=ab3k7mqz"), "AB3K7MQZ");
  assert.equal(choirCodeFromUrl("https://notefusion.studio/app/join/AB3K7MQZ"), "AB3K7MQZ");
});

test("other links are left alone", () => {
  assert.equal(choirCodeFromUrl("notefusion://listen?src=tile"), null);
  assert.equal(choirCodeFromUrl("notefusion://billing/return"), null);
  assert.equal(choirCodeFromUrl("https://evil.example/app?join=AB3K7MQZ"), null);
  assert.equal(choirCodeFromUrl("https://notefusion.studio/pricing?join=AB3K7MQZ"), null);
  assert.equal(choirCodeFromUrl(null), null);
});

test("a pasted invite message gives up its code", () => {
  assert.equal(
    choirCodeFromText("Join St Mary's Choir on NoteFusion: https://notefusion.studio/app?join=AB3K7MQZ"),
    "AB3K7MQZ",
  );
  assert.equal(choirCodeFromText("ab3k-7mqz"), "AB3K7MQZ");
});
