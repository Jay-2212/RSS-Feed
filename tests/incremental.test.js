import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExistingIndex,
  loadPersistedSnapshot,
  mergeIncrementalArticles,
  splitArticlesByDifference
} from "../src/incremental.js";

test("splitArticlesByDifference keeps only unseen feed entries", () => {
  const existing = [
    {
      sourceId: "bbc-world",
      title: "Major policy shift in Europe",
      url: "https://example.com/story-a"
    },
    {
      sourceId: "guardian-world",
      title: "Conflict escalation in region",
      url: "https://example.com/story-b"
    }
  ];

  const fetched = [
    {
      sourceId: "bbc-world",
      title: "Major policy shift in Europe",
      url: "https://example.com/story-a?utm_source=rss"
    },
    {
      sourceId: "guardian-world",
      title: "Conflict escalation in region!",
      url: "https://example.com/story-b-duplicate"
    },
    {
      sourceId: "guardian-world",
      title: "Fresh diplomatic talks announced",
      url: "https://example.com/story-c"
    }
  ];

  const index = buildExistingIndex(existing);
  const delta = splitArticlesByDifference(fetched, index);

  assert.equal(delta.duplicateUrlCount, 1);
  assert.equal(delta.duplicateTitleCount, 1);
  assert.equal(delta.newArticles.length, 1);
  assert.equal(delta.newArticles[0].url, "https://example.com/story-c");
});

test("mergeIncrementalArticles prefers newer duplicates and prunes old records", () => {
  const existing = [
    {
      id: "old",
      sourceId: "bbc-world",
      sourceName: "BBC World",
      title: "Very old story",
      url: "https://example.com/old",
      excerpt: "Old",
      content: "Old",
      publishedAt: "2025-11-01T10:00:00.000Z",
      wordCount: 100,
      readTime: 1
    },
    {
      id: "shared-old",
      sourceId: "bbc-world",
      sourceName: "BBC World",
      title: "Shared story",
      url: "https://example.com/shared",
      excerpt: "Old shared excerpt",
      content: "Old shared content",
      publishedAt: "2026-02-20T10:00:00.000Z",
      wordCount: 150,
      readTime: 1
    }
  ];

  const incoming = [
    {
      id: "shared-new",
      sourceId: "bbc-world",
      sourceName: "BBC World",
      title: "Shared story",
      url: "https://example.com/shared?utm_campaign=daily",
      excerpt: "New shared excerpt",
      content: "New shared content with more detail",
      publishedAt: "2026-02-22T10:00:00.000Z",
      wordCount: 400,
      readTime: 2
    },
    {
      id: "new",
      sourceId: "guardian-world",
      sourceName: "The Guardian World",
      title: "New story",
      url: "https://example.com/new",
      excerpt: "Latest",
      content: "Latest content",
      publishedAt: "2026-02-23T08:00:00.000Z",
      wordCount: 220,
      readTime: 1
    }
  ];

  const merged = mergeIncrementalArticles(existing, incoming, {
    maxArticles: 10,
    retentionDays: 21,
    now: "2026-02-23T12:00:00.000Z"
  });

  assert.equal(merged.length, 2);
  assert.equal(merged[0].url, "https://example.com/new");
  assert.equal(merged[1].url, "https://example.com/shared");
  assert.equal(merged[1].id, "shared-new");
});

test("loadPersistedSnapshot hydrates persisted metrics and source metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rss-incremental-"));
  const dataPath = path.join(tempDir, "articles.json");
  const payload = {
    metadata: {
      geotagModeResolved: "live"
    },
    articles: [
      {
        id: "a1",
        sourceId: "ars-technica",
        sourceName: "Ars Technica",
        title: "Chipmaker reports growth",
        url: "https://example.com/ars/story",
        excerpt: "Summary",
        content: "Full content",
        publishedAt: "2026-02-22T16:00:00.000Z",
        metrics: {
          wordCount: 360,
          readTime: 2
        },
        geotag: {
          country: "usa",
          lat: 39.8,
          lng: -98.5
        },
        tags: ["AI"],
        priority: "high",
        signals: {
          conflict: false
        }
      }
    ]
  };

  await fs.writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const sourceMap = new Map([
    [
      "ars-technica",
      {
        tier: 2,
        region: "global",
        paywall: false
      }
    ]
  ]);

  const snapshot = await loadPersistedSnapshot(dataPath, { sourceMap });

  assert.equal(snapshot.metadata.geotagModeResolved, "live");
  assert.equal(snapshot.articles.length, 1);
  assert.equal(snapshot.articles[0].sourceTier, 2);
  assert.equal(snapshot.articles[0].wordCount, 360);
  assert.equal(snapshot.articles[0].readTime, 2);
  assert.equal(snapshot.articles[0].geotag.country, "USA");
  assert.equal(snapshot.articles[0].priority, "High");
});
