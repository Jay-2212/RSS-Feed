import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { loadFeedCacheState, writeFeedCacheState } from "../src/fetcher.js";

test("loadFeedCacheState returns empty state when file is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rss-feed-cache-"));
  const filePath = path.join(tempDir, "missing-feed-state.json");

  const state = await loadFeedCacheState(filePath);
  assert.deepEqual(state, {
    updatedAt: null,
    sources: {}
  });
});

test("writeFeedCacheState persists source headers and loadFeedCacheState reads them back", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rss-feed-cache-"));
  const filePath = path.join(tempDir, "feed-state.json");

  await writeFeedCacheState(filePath, {
    updatedAt: null,
    sources: {
      "guardian-world": {
        etag: "W/\"etag-123\"",
        lastModified: "Mon, 23 Feb 2026 01:00:00 GMT",
        lastStatus: 200
      }
    }
  });

  const loaded = await loadFeedCacheState(filePath);
  assert.equal(loaded.sources["guardian-world"].etag, "W/\"etag-123\"");
  assert.equal(
    loaded.sources["guardian-world"].lastModified,
    "Mon, 23 Feb 2026 01:00:00 GMT"
  );
  assert.equal(loaded.sources["guardian-world"].lastStatus, 200);
  assert.ok(loaded.updatedAt);
});
