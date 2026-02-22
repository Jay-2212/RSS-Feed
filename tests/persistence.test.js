import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildPersistedOutput, writePersistedArtifacts } from "../src/persistence.js";

test("buildPersistedOutput normalizes schema and metadata", () => {
  const output = buildPersistedOutput(
    {
      metadata: {
        geotagModeConfigured: "auto",
        geotagModeResolved: "mock",
        geotagModel: "gemini-2.0-flash"
      },
      articles: [
        {
          id: "a1",
          sourceId: "nyt-world",
          sourceName: "NYT World",
          title: "World policy update",
          excerpt: "Summary",
          content: "Longer content text",
          url: "https://example.com/story",
          imageUrl: null,
          publishedAt: "2026-02-22T16:00:00.000Z",
          geotag: { country: "usa", city: "Washington", lat: 38.9, lng: -77.03 },
          category: "World",
          wordCount: 450,
          readTime: 2
        }
      ]
    },
    { timestamp: "2026-02-22T16:20:00.000Z" }
  );

  assert.equal(output.metadata.count, 1);
  assert.equal(output.metadata.phase, "phase_5_complete");
  assert.deepEqual(output.metadata.sources, ["nyt-world"]);
  assert.equal(output.articles[0].geotag.country, "USA");
  assert.equal(output.articles[0].metrics.wordCount, 450);
  assert.equal(output.articles[0].metrics.readTime, 2);
});

test("writePersistedArtifacts writes articles and timestamp files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rss-feed-"));
  const output = {
    metadata: {
      lastUpdated: "2026-02-22T16:30:00.000Z",
      count: 0,
      sources: []
    },
    articles: []
  };

  const paths = await writePersistedArtifacts(output, {
    rootDir: tempDir,
    articlesFilePath: "articles.json",
    lastUpdatedFilePath: "lastUpdated.txt"
  });

  const articlesContent = await fs.readFile(paths.articlesPath, "utf8");
  const updatedContent = await fs.readFile(paths.lastUpdatedPath, "utf8");

  assert.ok(articlesContent.includes("\"metadata\""));
  assert.equal(updatedContent.trim(), "2026-02-22T16:30:00.000Z");
});
