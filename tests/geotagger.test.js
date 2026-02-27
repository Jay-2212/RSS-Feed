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
    inceptionApiKey: ""
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "mock");
  assert.equal(result[0].geotag.country, "IND");
  assert.ok(["National", "Trending", "World", "WorthReading"].includes(result[0].category));
  assert.ok(Array.isArray(result[0].tags));
  assert.ok(["High", "Medium", "Low"].includes(result[0].priority));
  assert.equal(typeof result[0].signals?.conflict, "boolean");
});

test("geotagArticles parses live-mode Kimi JSON response", async () => {
  const articles = [sampleArticle({ id: "a1", title: "Talks continue in London" })];
  const httpClient = {
    async post() {
      return {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      id: "a1",
                      country: "GBR",
                      city: "London",
                      category: "World",
                      priority: "Medium",
                      conflictSignal: false,
                      confidence: 0.88,
                      tags: ["trade", "london", "diplomacy"]
                    }
                  ]
                })
              }
            }
          ]
        }
      };
    }
  };

  const result = await geotagArticles(articles, {
    mode: "live",
    model: "mercury-2",
    inceptionApiKey: "test-key",
    httpClient
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "live");
  assert.equal(result[0].geotag.country, "GBR");
  assert.equal(result[0].geotag.city, "London");
  assert.equal(result[0].category, "World");
  assert.equal(result[0].priority, "Medium");
  assert.equal(result[0].signals.conflict, false);
  assert.equal(result[0].geotagConfidence, 0.88);
  assert.deepEqual(result[0].tags, ["Trade", "London", "Diplomacy"]);
});

test("geotagArticles falls back to secondary model after 429", async () => {
  const articles = [sampleArticle({ id: "a2", title: "Policy talks in Berlin" })];
  const httpClient = {
    async post(_url, payload) {
      if (payload?.model === "mercury-primary") {
        const error = new Error("Rate limit");
        error.response = {
          status: 429,
          data: {
            error: {
              code: 429,
              type: "rate_limit_error",
              message: "Quota exceeded",
              details: []
            }
          },
          headers: {
            "retry-after": "0"
          }
        };
        throw error;
      }

      return {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      id: "a2",
                      country: "DEU",
                      city: "Berlin",
                      category: "World",
                      priority: "High",
                      conflictSignal: true,
                      confidence: 0.8,
                      tags: ["ceasefire", "berlin", "diplomacy"]
                    }
                  ]
                })
              }
            }
          ]
        }
      };
    }
  };

  const result = await geotagArticles(articles, {
    mode: "live",
    model: "mercury-primary",
    fallbackModels: ["mercury-secondary"],
    inceptionApiKey: "test-key",
    httpClient,
    maxRetries: 1
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "live");
  assert.equal(result[0].geotag.country, "DEU");
  assert.equal(result[0].priority, "High");
  assert.equal(result[0].signals.conflict, true);
  assert.deepEqual(result[0].tags, ["Ceasefire", "Berlin", "Diplomacy"]);
});

test("geotagArticles enforces maxApiBatches guard to control spend", async () => {
  const articles = [
    sampleArticle({ id: "b1", title: "Event in London" }),
    sampleArticle({ id: "b2", title: "Event in Tokyo" })
  ];

  let callCount = 0;
  const httpClient = {
    async post() {
      callCount += 1;
      return {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      id: "b1",
                      country: "GBR",
                      city: "London",
                      category: "World",
                      confidence: 0.9,
                      tags: ["diplomacy", "london"]
                    }
                  ]
                })
              }
            }
          ]
        }
      };
    }
  };

  const result = await geotagArticles(articles, {
    mode: "live",
    model: "mercury-2",
    inceptionApiKey: "test-key",
    httpClient,
    batchSize: 1,
    maxApiBatches: 1,
    maxRetries: 1
  });

  assert.equal(callCount, 1);
  assert.equal(result.length, 2);
  assert.equal(result[0].geotagStatus, "live");
  assert.equal(result[1].geotagStatus, "mock");
});

test("geotagArticles mock fallback infers country from broader aliases", async () => {
  const result = await geotagArticles(
    [
      sampleArticle({
        id: "fallback-pak",
        title: "Pakistan launches strikes on Afghan border targets",
        excerpt: "Officials in Lahore provided details."
      })
    ],
    {
      mode: "mock",
      kimiApiKey: ""
    }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].geotagStatus, "mock");
  assert.equal(result[0].geotag.country, "PAK");
  assert.ok(result[0].tags.includes("PAK"));
});
