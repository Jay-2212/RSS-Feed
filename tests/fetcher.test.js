import test from "node:test";
import assert from "node:assert/strict";

import { dedupeByUrl, limitArticlesPerSource, normalizeFeedItem } from "../src/fetcher.js";

const SOURCE = {
  id: "test",
  name: "Test Source",
  tier: 1,
  region: "global",
  paywall: false
};

test("limitArticlesPerSource enforces per-source cap", () => {
  const input = Array.from({ length: 15 }, (_, index) => ({ id: index + 1 }));
  const limited = limitArticlesPerSource(input, 10);
  assert.equal(limited.length, 10);
  assert.equal(limited[0].id, 1);
  assert.equal(limited.at(-1).id, 10);
});

test("dedupeByUrl removes normalized duplicates", () => {
  const articles = [
    { id: "1", url: "https://example.com/story?utm_source=x" },
    { id: "2", url: "https://example.com/story" },
    { id: "3", url: "https://example.com/other?ref=abc" }
  ];
  const deduped = dedupeByUrl(articles);

  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((article) => article.url),
    ["https://example.com/story", "https://example.com/other"]
  );
});

test("normalizeFeedItem maps feed entry into internal schema", () => {
  const item = {
    title: "Sample headline",
    link: "https://example.com/post?id=10&utm_medium=email",
    contentSnippet: "Preview text",
    pubDate: "2026-02-20T00:00:00.000Z"
  };

  const normalized = normalizeFeedItem(SOURCE, item, 0);
  assert.equal(normalized.sourceId, "test");
  assert.equal(normalized.title, "Sample headline");
  assert.equal(normalized.url, "https://example.com/post?id=10");
  assert.equal(normalized.excerpt, "Preview text");
  assert.equal(normalized.wordCount, 0);
});
