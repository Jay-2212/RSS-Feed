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

export function limitArticlesPerSource(items, maxItems) {
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

  try {
    const feed = await withTimeout(
      () => parser.parseURL(source.url),
      timeoutMs,
      `Feed timeout for source '${source.id}'`
    );

    const rawItems = Array.isArray(feed.items) ? feed.items : [];
    const limited = limitArticlesPerSource(rawItems, maxPerSource);
    return limited
      .map((item, index) => normalizeFeedItem(source, item, index))
      .filter((article) => Boolean(article.url));
  } catch (error) {
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

  const tierSorted = [...sources].sort((a, b) => {
    const tierA = a.tier ?? 99;
    const tierB = b.tier ?? 99;
    return tierA - tierB;
  });

  const results = [];

  for (const source of tierSorted) {
    const articles = await fetchSourceFeed(source, {
      parser,
      logger,
      timeoutMs,
      maxPerSource
    });
    results.push(...articles);
  }

  const deduped = dedupeByUrl(results);
  logger.info("Fetched RSS articles", {
    sourceCount: tierSorted.length,
    fetchedCount: results.length,
    dedupedCount: deduped.length
  });

  return deduped;
}
