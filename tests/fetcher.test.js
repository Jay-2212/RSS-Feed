import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

import {
  dedupeByUrl,
  fetchSourceFeed,
  limitArticlesPerSource,
  normalizeFeedItem
} from "../src/fetcher.js";

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

test("fetchSourceFeed sends ETag headers and skips parsing on 304", async () => {
  const source = {
    id: "guardian-world",
    name: "The Guardian World",
    url: "https://example.com/feed.xml"
  };
  const feedCacheState = {
    updatedAt: null,
    sources: {
      "guardian-world": {
        etag: "W/\"etag-123\"",
        lastModified: "Mon, 23 Feb 2026 01:00:00 GMT"
      }
    }
  };

  const parser = {
    parseString() {
      throw new Error("parseString should not be called on 304");
    },
    parseURL() {
      throw new Error("parseURL should not be called on 304");
    }
  };

  const originalAxiosGet = axios.get;
  axios.get = async (_url, options = {}) => {
    assert.equal(options?.headers?.["If-None-Match"], "W/\"etag-123\"");
    assert.equal(
      options?.headers?.["If-Modified-Since"],
      "Mon, 23 Feb 2026 01:00:00 GMT"
    );

    return {
      status: 304,
      data: "",
      headers: {
        etag: "W/\"etag-456\"",
        "last-modified": "Mon, 23 Feb 2026 03:00:00 GMT"
      }
    };
  };

  try {
    const result = await fetchSourceFeed(source, {
      parser,
      feedCacheState,
      enableConditionalFetch: true
    });

    assert.deepEqual(result, []);
    assert.equal(feedCacheState.sources["guardian-world"].lastStatus, 304);
    assert.equal(feedCacheState.sources["guardian-world"].etag, "W/\"etag-456\"");
    assert.equal(
      feedCacheState.sources["guardian-world"].lastModified,
      "Mon, 23 Feb 2026 03:00:00 GMT"
    );
  } finally {
    axios.get = originalAxiosGet;
  }
});
