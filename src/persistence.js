import fs from "node:fs/promises";
import path from "node:path";

import { calculateWordCount, clampText, estimateReadTime } from "./utils.js";

const CATEGORY_FALLBACK = "WorthReading";
const VALID_CATEGORIES = new Set(["World", "National", "Trending", "WorthReading"]);
const VALID_PRIORITIES = new Set(["High", "Medium", "Low"]);
const TAG_BLACKLIST = new Set([
  "world",
  "national",
  "trending",
  "worthreading",
  "news",
  "latest",
  "update"
]);
const TAG_UPPERCASE_WORDS = new Set([
  "ai",
  "api",
  "usa",
  "ind",
  "gbr",
  "chn",
  "rus",
  "ukr",
  "isr",
  "pse",
  "deu",
  "fra",
  "ita",
  "esp",
  "can",
  "mex",
  "bra",
  "aus",
  "jpn",
  "kor",
  "zaf",
  "irn",
  "tur",
  "sau",
  "are",
  "pak",
  "afg",
  "syr",
  "sdn",
  "uga",
  "ven",
  "col",
  "nga",
  "egy",
  "uk",
  "eu",
  "un",
  "uae",
  "nato",
  "gdp",
  "ipo",
  "icc",
  "rbi"
]);

function toIsoTimestamp(value, fallback) {
  const parsed = new Date(value ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function sanitizeCategory(value) {
  const category = String(value ?? "").trim();
  return VALID_CATEGORIES.has(category) ? category : CATEGORY_FALLBACK;
}

function sanitizePriority(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["high", "critical", "urgent", "severe"].includes(normalized)) {
    return "High";
  }
  if (["low", "minor", "routine"].includes(normalized)) {
    return "Low";
  }
  if (["medium", "moderate", "important"].includes(normalized)) {
    return "Medium";
  }

  const direct = String(value ?? "").trim();
  return VALID_PRIORITIES.has(direct) ? direct : "Medium";
}

function normalizeTag(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 3 || normalized.length > 40) {
    return null;
  }
  if (TAG_BLACKLIST.has(normalized)) {
    return null;
  }
  return normalized;
}

function toDisplayTag(normalizedTag) {
  const words = String(normalizedTag)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return null;
  }

  return words
    .map((word, index) => {
      if (TAG_UPPERCASE_WORDS.has(word)) {
        return word.toUpperCase();
      }

      if (index > 0 && ["and", "of", "for", "to", "in", "on"].includes(word)) {
        return word;
      }

      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function sanitizeTags(tags) {
  const safe = [];
  const seen = new Set();
  const list = Array.isArray(tags) ? tags : [];

  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    const displayTag = toDisplayTag(tag);
    if (!displayTag) {
      continue;
    }
    safe.push(displayTag);
    if (safe.length >= 8) {
      break;
    }
  }

  return safe;
}

function sanitizeGeotag(geotag) {
  const country = String(geotag?.country ?? "UNK")
    .trim()
    .toUpperCase();
  const cityRaw = geotag?.city;
  const city = cityRaw === null || cityRaw === undefined ? null : String(cityRaw).trim() || null;

  return {
    country: country || "UNK",
    city,
    lat: toNumber(geotag?.lat, 0),
    lng: toNumber(geotag?.lng, 0)
  };
}

function sanitizeSignals(signals) {
  return {
    conflict: Boolean(signals?.conflict)
  };
}

function sanitizeMetrics(article) {
  const contentWordCount = calculateWordCount(article.content || article.excerpt || "");
  const wordCount = Number.isFinite(article.wordCount) ? article.wordCount : contentWordCount;
  const safeWordCount = Math.max(0, wordCount);
  const readTime = Number.isFinite(article.readTime)
    ? Math.max(1, article.readTime)
    : estimateReadTime(safeWordCount);

  return {
    wordCount: safeWordCount,
    readTime
  };
}

function sanitizeArticle(article, timestamp) {
  const tagsFromSource = Array.isArray(article.tags)
    ? article.tags
    : Array.isArray(article.geotagKeywords)
      ? article.geotagKeywords
      : [];

  return {
    id: String(article.id ?? ""),
    sourceId: String(article.sourceId ?? ""),
    sourceName: String(article.sourceName ?? ""),
    title: clampText(article.title ?? "", 280),
    excerpt: clampText(article.excerpt ?? "", 300),
    content: clampText(article.content ?? "", 5_000),
    url: String(article.url ?? ""),
    imageUrl: article.imageUrl ? String(article.imageUrl) : null,
    publishedAt: toIsoTimestamp(article.publishedAt, timestamp),
    geotag: sanitizeGeotag(article.geotag),
    category: sanitizeCategory(article.category),
    priority: sanitizePriority(article.priority),
    signals: sanitizeSignals(article.signals),
    tags: sanitizeTags(tagsFromSource),
    metrics: sanitizeMetrics(article)
  };
}

export function buildPersistedOutput(phaseFourOutput, options = {}) {
  const timestamp = toIsoTimestamp(options.timestamp, new Date().toISOString());
  const rawArticles = Array.isArray(phaseFourOutput?.articles) ? phaseFourOutput.articles : [];
  const articles = rawArticles.map((article) => sanitizeArticle(article, timestamp));
  const sourceIds = Array.from(
    new Set(articles.map((article) => article.sourceId).filter((value) => Boolean(value)))
  );

  return {
    metadata: {
      lastUpdated: timestamp,
      count: articles.length,
      sources: sourceIds,
      phase: "phase_5_complete",
      geotagModeConfigured: phaseFourOutput?.metadata?.geotagModeConfigured ?? "auto",
      geotagModeResolved: phaseFourOutput?.metadata?.geotagModeResolved ?? "unknown",
      geotagModel: phaseFourOutput?.metadata?.geotagModel ?? null
    },
    articles
  };
}

export async function writePersistedArtifacts(output, options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const articlesFilePath = options.articlesFilePath ?? "articles.json";
  const lastUpdatedFilePath = options.lastUpdatedFilePath ?? "lastUpdated.txt";
  const articlesPath = path.resolve(rootDir, articlesFilePath);
  const lastUpdatedPath = path.resolve(rootDir, lastUpdatedFilePath);

  const payload = `${JSON.stringify(output, null, 2)}\n`;
  const timestamp = `${output?.metadata?.lastUpdated ?? new Date().toISOString()}\n`;

  await fs.writeFile(articlesPath, payload, "utf8");
  await fs.writeFile(lastUpdatedPath, timestamp, "utf8");

  return {
    articlesPath,
    lastUpdatedPath
  };
}
