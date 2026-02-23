import test from "node:test";
import assert from "node:assert/strict";

import { cleanExtractedMarkdown, extractSingleArticle } from "../src/extractor.js";

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

test("cleanExtractedMarkdown removes breadcrumb noise and malformed image blocks", () => {
  const raw = `
1. [News](https://indianexpress.com/)
2. [World](https://indianexpress.com/section/world/)
3. [US News](https://indianexpress.com/section/world/us-news/)
4. Sample headline

## Lead section

3 min readFeb 23, 2026 07:17 AM IST First published on: Feb 23, 2026 at 07:07 AM IST

Story continues below this ad

In her address, the principle of _Ahimsa_\u200B was mentioned.

![France Gisele Pelicot Book
](https://images.indianexpress.com/2026/02/US-2-20.jpg?resize=720,405)

Published - February 23, 2026 06:59 am IST
`;

  const cleaned = cleanExtractedMarkdown(raw, {
    sourceName: "Indian Express World",
    sourceId: "indian-express-world",
    url: "https://indianexpress.com/section/world/us-news/sample-article/"
  });

  assert.doesNotMatch(cleaned, /^\d+\.\s+\[News]/m);
  assert.doesNotMatch(cleaned, /Story continues below this ad/i);
  assert.doesNotMatch(cleaned, /\d+\s*min\s+read/i);
  assert.doesNotMatch(cleaned, /^Published\s*-/im);
  assert.doesNotMatch(cleaned, /\u200b/);
  assert.match(
    cleaned,
    /!\[France Gisele Pelicot Book]\(https:\/\/images\.indianexpress\.com\/2026\/02\/US-2-20\.jpg\?resize=720,405\)/
  );
  assert.match(cleaned, /_Ahimsa_/);
});
