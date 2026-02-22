import test from "node:test";
import assert from "node:assert/strict";

import { extractSingleArticle } from "../src/extractor.js";

test("extractSingleArticle falls back safely when extraction fails", async () => {
  const article = {
    id: "a1",
    title: "Fallback article",
    url: "about:blank",
    excerpt: "This is fallback excerpt text.",
    content: "",
    wordCount: 0,
    readTime: 1
  };

  const extracted = await extractSingleArticle(article, {
    attemptTimeoutMs: 50,
    totalTimeoutMs: 100,
    enable12ftFallback: false,
    enableArchiveFallback: false
  });

  assert.equal(extracted.extractionMethod, "fallback");
  assert.equal(extracted.content, "");
  assert.ok(extracted.wordCount > 0);
});
