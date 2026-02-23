import fs from "node:fs/promises";

import {
  calculateWordCount,
  estimateReadTime,
  normalizeUrl,
  stableArticleId
} from "./utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 21;
const DEFAULT_TITLE_DEDUPE_WINDOW_HOURS = 72;
const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with"
]);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toTimestamp(value, fallback = 0) {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.getTime();
}

function toIsoTimestamp(value, fallback = new Date().toISOString()) {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function sanitizeGeotag(geotag) {
  return {
    country: String(geotag?.country ?? "UNK")
      .trim()
      .toUpperCase(),
    city: geotag?.city ? String(geotag.city).trim() : null,
    lat: toFiniteNumber(geotag?.lat, 0),
    lng: toFiniteNumber(geotag?.lng, 0)
  };
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeSignals(signals) {
  return {
    conflict: Boolean(signals?.conflict)
  };
}

function sanitizePriority(priority) {
  const normalized = String(priority ?? "")
    .trim()
    .toLowerCase();
  if (["high", "critical", "urgent"].includes(normalized)) {
    return "High";
  }
  if (["low", "minor", "routine"].includes(normalized)) {
    return "Low";
  }
  return "Medium";
}

function getWordCount(article) {
  const direct = Number.parseInt(article?.wordCount, 10);
  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const metrics = Number.parseInt(article?.metrics?.wordCount, 10);
  if (Number.isFinite(metrics) && metrics >= 0) {
    return metrics;
  }

  return calculateWordCount(article?.content || article?.excerpt || "");
}

function getReadTime(article, wordCount) {
  const direct = Number.parseInt(article?.readTime, 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const metrics = Number.parseInt(article?.metrics?.readTime, 10);
  if (Number.isFinite(metrics) && metrics > 0) {
    return metrics;
  }

  return estimateReadTime(wordCount);
}

function qualityScore(article) {
  const wordCount = getWordCount(article);
  const contentLength = String(article?.content || "").length;
  const excerptLength = String(article?.excerpt || "").length;
  const hasGeotag = Boolean(article?.geotag && article.geotag.country && article.geotag.country !== "UNK");
  const hasImage = Boolean(article?.imageUrl);
  const conflictSignal = Boolean(article?.signals?.conflict);

  return (
    Math.min(1_500, wordCount) +
    Math.min(2_000, contentLength / 2) +
    Math.min(300, excerptLength / 4) +
    (hasGeotag ? 80 : 0) +
    (hasImage ? 20 : 0) +
    (conflictSignal ? 30 : 0)
  );
}

function choosePreferredArticle(current, candidate) {
  const currentPublished = toTimestamp(current.publishedAt, 0);
  const candidatePublished = toTimestamp(candidate.publishedAt, 0);

  if (candidatePublished > currentPublished) {
    return candidate;
  }
  if (currentPublished > candidatePublished) {
    return current;
  }

  return qualityScore(candidate) >= qualityScore(current) ? candidate : current;
}

export function normalizeTitleFingerprint(title) {
  const cleaned = String(title ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token))
    .slice(0, 12);

  return tokens.join(" ");
}

function titleKey(article) {
  const sourceId = String(article?.sourceId ?? "").trim().toLowerCase();
  const normalizedTitle = normalizeTitleFingerprint(article?.title);
  if (!sourceId || !normalizedTitle) {
    return null;
  }

  return `${sourceId}:${normalizedTitle}`;
}

export function hydratePersistedArticle(article, sourceMeta = {}) {
  const url = normalizeUrl(article?.url);
  if (!url) {
    return null;
  }

  const wordCount = getWordCount(article);
  const readTime = getReadTime(article, wordCount);
  const publishedAt = toIsoTimestamp(article?.publishedAt);
  const fallbackSeed = `${article?.sourceId || "unknown"}-${publishedAt}-${article?.title || "untitled"}`;

  return {
    id: String(article?.id || stableArticleId(url, fallbackSeed)),
    sourceId: String(article?.sourceId || ""),
    sourceName: String(article?.sourceName || sourceMeta.name || ""),
    sourceTier: sourceMeta.tier ?? 3,
    sourceRegion: sourceMeta.region ?? "global",
    sourcePaywall: sourceMeta.paywall ?? false,
    title: String(article?.title || "").trim(),
    url,
    excerpt: String(article?.excerpt || "").trim(),
    publishedAt,
    imageUrl: article?.imageUrl ? String(article.imageUrl).trim() : null,
    content: String(article?.content || "").trim(),
    wordCount,
    readTime,
    geotag: sanitizeGeotag(article?.geotag),
    category: String(article?.category || "WorthReading").trim(),
    priority: sanitizePriority(article?.priority),
    signals: sanitizeSignals(article?.signals),
    tags: sanitizeTags(article?.tags),
    geotagStatus: "cached"
  };
}

export function hydratePersistedArticles(articles, sourceMap = new Map()) {
  const safeArticles = Array.isArray(articles) ? articles : [];
  const hydrated = [];

  for (const article of safeArticles) {
    const sourceMeta = sourceMap.get(article?.sourceId) ?? {};
    const normalized = hydratePersistedArticle(article, sourceMeta);
    if (normalized) {
      hydrated.push(normalized);
    }
  }

  return hydrated;
}

export async function loadPersistedSnapshot(filePath, options = {}) {
  const logger = options.logger;
  const sourceMap = options.sourceMap ?? new Map();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const hydrated = hydratePersistedArticles(parsed?.articles, sourceMap);

    return {
      metadata: parsed?.metadata ?? {},
      articles: hydrated
    };
  } catch (error) {
    if (error.code !== "ENOENT" && logger?.warn) {
      logger.warn("Unable to load persisted snapshot, starting from empty cache", {
        filePath,
        message: error.message
      });
    }
    return {
      metadata: {},
      articles: []
    };
  }
}

export function buildExistingIndex(existingArticles) {
  const knownUrls = new Set();
  const knownTitleKeys = new Set();

  for (const article of existingArticles) {
    const url = normalizeUrl(article?.url);
    if (url) {
      knownUrls.add(url);
    }

    const key = titleKey(article);
    if (key) {
      knownTitleKeys.add(key);
    }
  }

  return {
    knownUrls,
    knownTitleKeys
  };
}

export function splitArticlesByDifference(fetchedArticles, existingIndex) {
  const knownUrls = existingIndex?.knownUrls ?? new Set();
  const knownTitleKeys = existingIndex?.knownTitleKeys ?? new Set();

  const newArticles = [];
  let duplicateUrls = 0;
  let duplicateTitles = 0;

  for (const article of fetchedArticles) {
    const url = normalizeUrl(article?.url);
    const key = titleKey(article);

    if (url && knownUrls.has(url)) {
      duplicateUrls += 1;
      continue;
    }

    if (key && knownTitleKeys.has(key)) {
      duplicateTitles += 1;
      continue;
    }

    newArticles.push(article);
  }

  return {
    newArticles,
    duplicateUrlCount: duplicateUrls,
    duplicateTitleCount: duplicateTitles
  };
}

export function mergeIncrementalArticles(existingArticles, newArticles, options = {}) {
  const maxArticles = options.maxArticles ?? 0;
  const retentionDays =
    Number.isFinite(options.retentionDays) && options.retentionDays >= 0
      ? options.retentionDays
      : DEFAULT_RETENTION_DAYS;
  const titleDedupeWindowHours =
    Number.isFinite(options.titleDedupeWindowHours) && options.titleDedupeWindowHours > 0
      ? options.titleDedupeWindowHours
      : DEFAULT_TITLE_DEDUPE_WINDOW_HOURS;

  const combined = [...(Array.isArray(newArticles) ? newArticles : []), ...(Array.isArray(existingArticles) ? existingArticles : [])];
  const byUrl = new Map();

  for (const article of combined) {
    const url = normalizeUrl(article?.url);
    if (!url) {
      continue;
    }

    const candidate = { ...article, url };
    const current = byUrl.get(url);
    if (!current) {
      byUrl.set(url, candidate);
      continue;
    }

    byUrl.set(url, choosePreferredArticle(current, candidate));
  }

  let deduped = Array.from(byUrl.values());
  deduped.sort((a, b) => {
    const timeA = toTimestamp(a.publishedAt, 0);
    const timeB = toTimestamp(b.publishedAt, 0);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return qualityScore(b) - qualityScore(a);
  });

  const byTitle = new Map();
  const withoutNearDupes = [];

  for (const article of deduped) {
    const key = titleKey(article);
    if (!key) {
      withoutNearDupes.push(article);
      continue;
    }

    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, article);
      withoutNearDupes.push(article);
      continue;
    }

    const currentTs = toTimestamp(existing.publishedAt, 0);
    const candidateTs = toTimestamp(article.publishedAt, 0);
    const delta = Math.abs(currentTs - candidateTs);
    const dedupeWindowMs = titleDedupeWindowHours * 60 * 60 * 1000;

    if (delta > dedupeWindowMs) {
      withoutNearDupes.push(article);
      continue;
    }

    const preferred = choosePreferredArticle(existing, article);
    if (preferred === existing) {
      continue;
    }

    byTitle.set(key, preferred);
    const index = withoutNearDupes.indexOf(existing);
    if (index >= 0) {
      withoutNearDupes[index] = preferred;
    } else {
      withoutNearDupes.push(preferred);
    }
  }

  const now = toTimestamp(options.now ?? new Date().toISOString(), Date.now());
  const cutoff = retentionDays > 0 ? now - retentionDays * DAY_MS : Number.NEGATIVE_INFINITY;
  let pruned = withoutNearDupes.filter(
    (article) => toTimestamp(article.publishedAt, now) >= cutoff
  );

  pruned.sort((a, b) => {
    const timeA = toTimestamp(a.publishedAt, 0);
    const timeB = toTimestamp(b.publishedAt, 0);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return qualityScore(b) - qualityScore(a);
  });

  if (Number.isFinite(maxArticles) && maxArticles > 0) {
    pruned = pruned.slice(0, maxArticles);
  }

  return pruned;
}
