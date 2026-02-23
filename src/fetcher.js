import fs from "node:fs/promises";
import path from "node:path";

import axios from "axios";
import Parser from "rss-parser";

import {
  clampText,
  createLogger,
  normalizeUrl,
  stableArticleId,
  stripHtml,
  withTimeout
} from "./utils.js";

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const FEED_USER_AGENT = "Mozilla/5.0 (compatible; RSSNewsHub/1.0; +https://github.com)";
const EMPTY_FEED_STATE = {
  updatedAt: null,
  sources: {}
};

function toFeedStatePath(filePath, rootDir = process.cwd()) {
  if (!filePath) {
    return null;
  }
  return path.resolve(rootDir, filePath);
}

function normalizeFeedState(input) {
  if (!input || typeof input !== "object") {
    return { ...EMPTY_FEED_STATE };
  }

  const sources = input.sources && typeof input.sources === "object" ? input.sources : {};
  return {
    updatedAt: input.updatedAt || null,
    sources
  };
}

function buildConditionalHeaders(cacheEntry = {}) {
  const headers = {};
  if (cacheEntry.etag) {
    headers["If-None-Match"] = String(cacheEntry.etag);
  }
  if (cacheEntry.lastModified) {
    headers["If-Modified-Since"] = String(cacheEntry.lastModified);
  }
  return headers;
}

function upsertFeedStateEntry(feedState, sourceId, patch = {}) {
  if (!feedState || !sourceId) {
    return;
  }

  if (!feedState.sources || typeof feedState.sources !== "object") {
    feedState.sources = {};
  }

  const current = feedState.sources[sourceId] || {};
  feedState.sources[sourceId] = {
    ...current,
    ...patch
  };
}

function parseSourceHeader(headers, name) {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  const direct = headers[name];
  if (direct) {
    return String(direct);
  }

  const lowerName = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lowerName && value) {
      return String(value);
    }
  }

  return null;
}

async function requestFeedXml(source, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const conditionalHeaders = options.conditionalHeaders ?? {};

  const response = await axios.get(source.url, {
    timeout: timeoutMs,
    responseType: "text",
    maxRedirects: 5,
    validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    headers: {
      "User-Agent": FEED_USER_AGENT,
      Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      ...conditionalHeaders
    }
  });

  return {
    status: response.status,
    xml: String(response.data ?? ""),
    etag: parseSourceHeader(response.headers, "etag"),
    lastModified: parseSourceHeader(response.headers, "last-modified")
  };
}

export async function loadFeedCacheState(filePath, options = {}) {
  const logger = options.logger ?? createLogger("fetcher");
  const resolvedPath = toFeedStatePath(filePath, options.rootDir);
  if (!resolvedPath) {
    return { ...EMPTY_FEED_STATE };
  }

  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    return normalizeFeedState(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger.warn("Unable to load feed cache state; continuing with empty state", {
        filePath: resolvedPath,
        message: error.message
      });
    }
    return { ...EMPTY_FEED_STATE };
  }
}

export async function writeFeedCacheState(filePath, state, options = {}) {
  const resolvedPath = toFeedStatePath(filePath, options.rootDir);
  if (!resolvedPath) {
    return null;
  }

  const normalized = normalizeFeedState(state);
  normalized.updatedAt = new Date().toISOString();
  await fs.writeFile(resolvedPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return resolvedPath;
}

export function limitArticlesPerSource(items, maxItems) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) {
    return [...items];
  }
  return items.slice(0, maxItems);
}

function parseDate(value) {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function extractImageUrl(item) {
  if (item.enclosure?.url) {
    return item.enclosure.url;
  }

  const mediaContent = item["media:content"];
  if (mediaContent?.$?.url) {
    return mediaContent.$.url;
  }

  return null;
}

export function normalizeFeedItem(source, item, index) {
  const rawUrl = item.link || item.guid || "";
  const url = normalizeUrl(rawUrl);
  const title = clampText(item.title || "Untitled", 280);
  const excerptSeed = item.contentSnippet || item.summary || item.content || "";
  const excerpt = clampText(stripHtml(excerptSeed), 300);
  const publishedAt = parseDate(item.isoDate || item.pubDate || item.published);

  return {
    id: stableArticleId(url, `${source.id}-${index}-${title}`),
    sourceId: source.id,
    sourceName: source.name,
    sourceTier: source.tier ?? 3,
    sourceRegion: source.region ?? "global",
    sourcePaywall: source.paywall ?? false,
    title,
    url,
    excerpt,
    publishedAt,
    imageUrl: extractImageUrl(item),
    content: "",
    wordCount: 0,
    readTime: 1
  };
}

export function dedupeByUrl(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles) {
    const normalized = normalizeUrl(article.url);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push({ ...article, url: normalized });
  }

  return deduped;
}

export async function fetchSourceFeed(source, options = {}) {
  const parser = options.parser ?? new Parser();
  const logger = options.logger ?? createLogger("fetcher");
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxPerSource = options.maxPerSource ?? 10;
  const feedCacheState = options.feedCacheState ?? null;
  const enableConditionalFetch = options.enableConditionalFetch !== false;
  const cachedEntry =
    feedCacheState?.sources && typeof feedCacheState.sources === "object"
      ? feedCacheState.sources[source.id] || {}
      : {};
  const onSourceResult = options.onSourceResult;

  try {
    let feed;
    let status = 200;
    let etag = cachedEntry?.etag || null;
    let lastModified = cachedEntry?.lastModified || null;

    if (enableConditionalFetch) {
      const response = await withTimeout(
        () =>
          requestFeedXml(source, {
            timeoutMs,
            conditionalHeaders: buildConditionalHeaders(cachedEntry)
          }),
        timeoutMs,
        `Feed timeout for source '${source.id}'`
      );

      status = response.status;
      etag = response.etag || etag;
      lastModified = response.lastModified || lastModified;

      if (response.status === 304) {
        upsertFeedStateEntry(feedCacheState, source.id, {
          etag,
          lastModified,
          lastCheckedAt: new Date().toISOString(),
          lastStatus: 304
        });
        onSourceResult?.({
          sourceId: source.id,
          status: 304,
          itemCount: 0,
          notModified: true,
          failed: false
        });
        return [];
      }

      try {
        feed = await parser.parseString(response.xml);
      } catch {
        // Keep legacy parser fallback for malformed feeds.
        feed = await withTimeout(
          () => parser.parseURL(source.url),
          timeoutMs,
          `Feed fallback timeout for source '${source.id}'`
        );
      }
    } else {
      feed = await withTimeout(
        () => parser.parseURL(source.url),
        timeoutMs,
        `Feed timeout for source '${source.id}'`
      );
    }

    const rawItems = Array.isArray(feed.items) ? feed.items : [];
    const limited = limitArticlesPerSource(rawItems, maxPerSource);
    const normalizedItems = limited
      .map((item, index) => normalizeFeedItem(source, item, index))
      .filter((article) => Boolean(article.url));

    upsertFeedStateEntry(feedCacheState, source.id, {
      etag,
      lastModified,
      lastCheckedAt: new Date().toISOString(),
      lastFetchedAt: new Date().toISOString(),
      lastStatus: status,
      lastItemCount: rawItems.length
    });

    onSourceResult?.({
      sourceId: source.id,
      status,
      itemCount: rawItems.length,
      notModified: false,
      failed: false
    });

    return normalizedItems;
  } catch (error) {
    upsertFeedStateEntry(feedCacheState, source.id, {
      etag: cachedEntry?.etag || null,
      lastModified: cachedEntry?.lastModified || null,
      lastCheckedAt: new Date().toISOString(),
      lastStatus: "failed",
      lastError: error.message
    });

    onSourceResult?.({
      sourceId: source.id,
      status: "failed",
      itemCount: 0,
      notModified: false,
      failed: true
    });

    logger.warn("Failed to fetch source feed", {
      sourceId: source.id,
      message: error.message
    });
    return [];
  }
}

export async function fetchArticles(sources, options = {}) {
  const logger = options.logger ?? createLogger("fetcher");
  const maxPerSource = options.maxPerSource ?? 10;
  const parser = options.parser;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const feedCacheState = options.feedCacheState ?? null;
  const enableConditionalFetch = options.enableConditionalFetch !== false;
  const fetchStats =
    options.fetchStats && typeof options.fetchStats === "object" ? options.fetchStats : {};

  const tierSorted = [...sources].sort((a, b) => {
    const tierA = a.tier ?? 99;
    const tierB = b.tier ?? 99;
    return tierA - tierB;
  });

  const results = [];
  let unchangedSourceCount = 0;
  let failedSourceCount = 0;

  for (const source of tierSorted) {
    const articles = await fetchSourceFeed(source, {
      parser,
      logger,
      timeoutMs,
      maxPerSource,
      feedCacheState,
      enableConditionalFetch,
      onSourceResult(result) {
        if (result?.notModified) {
          unchangedSourceCount += 1;
        }
        if (result?.failed) {
          failedSourceCount += 1;
        }
      }
    });
    results.push(...articles);
  }

  const deduped = dedupeByUrl(results);
  fetchStats.sourceCount = tierSorted.length;
  fetchStats.unchangedSourceCount = unchangedSourceCount;
  fetchStats.failedSourceCount = failedSourceCount;
  fetchStats.fetchedCount = results.length;
  fetchStats.dedupedCount = deduped.length;

  logger.info("Fetched RSS articles", {
    sourceCount: tierSorted.length,
    fetchedCount: results.length,
    dedupedCount: deduped.length,
    unchangedSourceCount,
    failedSourceCount,
    conditionalFetch: enableConditionalFetch
  });

  return deduped;
}
