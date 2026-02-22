import test from "node:test";
import assert from "node:assert/strict";

import { geotagArticles } from "../src/geotagger.js";

function sampleArticle(overrides = {}) {
  return {
    id: overrides.id ?? "article-1",
    sourceName: overrides.sourceName ?? "Test Source",
    sourceTier: overrides.sourceTier ?? 1,
    title: overrides.title ?? "Policy update in India",
    excerpt: overrides.excerpt ?? "Officials in New Delhi announced a policy change.",
    publishedAt: overrides.publishedAt ?? "2026-02-22T10:00:00.000Z"
  };
}

test("geotagArticles uses mock mode when no key is present", async () => {
  const articles = [sampleArticle()];
  const result = await geotagArticles(articles, {
    mode: "auto",
    geminiApiKey: ""
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "mock");
  assert.equal(result[0].geotag.country, "IND");
  assert.ok(["National", "Trending", "World", "WorthReading"].includes(result[0].category));
});

test("geotagArticles parses live-mode Gemini JSON response", async () => {
  const articles = [sampleArticle({ id: "a1", title: "Talks continue in London" })];
  const httpClient = {
    async post() {
      return {
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          id: "a1",
                          country: "GBR",
                          city: "London",
                          category: "World",
                          confidence: 0.88,
                          keywords: ["diplomacy"]
                        }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        }
      };
    }
  };

  const result = await geotagArticles(articles, {
    mode: "live",
    model: "gemini-test",
    geminiApiKey: "test-key",
    httpClient
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "live");
  assert.equal(result[0].geotag.country, "GBR");
  assert.equal(result[0].geotag.city, "London");
  assert.equal(result[0].category, "World");
  assert.equal(result[0].geotagConfidence, 0.88);
});
