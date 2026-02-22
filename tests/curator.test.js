import test from "node:test";
import assert from "node:assert/strict";

import { calculateScore, curateArticles } from "../src/curator.js";

function makeArticle(overrides = {}) {
  return {
    id: overrides.id ?? "article-1",
    sourceTier: overrides.sourceTier ?? 1,
    title: overrides.title ?? "Policy update announced",
    url: overrides.url ?? "https://example.com/a",
    content: overrides.content ?? "word ".repeat(900),
    excerpt: overrides.excerpt ?? "short excerpt",
    wordCount: overrides.wordCount ?? 900,
    publishedAt: overrides.publishedAt ?? "2026-02-21T10:00:00.000Z"
  };
}

test("calculateScore penalizes clickbait heavily", () => {
  const stable = makeArticle({ title: "Major policy announcement released" });
  const clickbait = makeArticle({ title: "Rumor: you won't believe this shocking leak" });

  const stableScore = calculateScore(stable);
  const clickbaitScore = calculateScore(clickbait);

  assert.ok(stableScore > clickbaitScore);
  assert.ok(clickbaitScore <= stableScore - 100);
});

test("curateArticles filters low word-count articles and ranks by score", () => {
  const lowWordCount = makeArticle({
    id: "low",
    title: "Important policy",
    url: "https://example.com/low",
    wordCount: 120
  });

  const highValue = makeArticle({
    id: "high",
    title: "Sanctions policy announcement",
    url: "https://example.com/high",
    wordCount: 2500
  });

  const medium = makeArticle({
    id: "medium",
    title: "General world update",
    url: "https://example.com/medium",
    wordCount: 850
  });

  const curated = curateArticles([lowWordCount, medium, highValue], {
    maxArticles: 40,
    minWordCount: 200
  });

  assert.equal(curated.length, 2);
  assert.equal(curated[0].id, "high");
  assert.equal(curated[1].id, "medium");
});
