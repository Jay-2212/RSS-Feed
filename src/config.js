import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

import { AppError, parseInteger } from "./utils.js";

const ROOT_DIR = process.cwd();
const SOURCES_FILE = path.join(ROOT_DIR, "config", "sources.json");

const DEFAULTS = {
  maxSources: 0,
  maxArticlesPerSource: 20,
  extractionAttemptTimeoutMs: 8_000,
  extractionTotalTimeoutMs: 25_000,
  extractionMarkdownMaxChars: 5_000,
  extractionExcerptMaxChars: 300,
  extractionConcurrency: 3,
  mediaRefreshPerRun: 20,
  curationMaxArticles: 120,
  curationMinWordCount: 120,
  articleRetentionDays: 21,
  kimiModel: "kimi-k2-0905-preview",
  kimiFallbackModels: ["kimi-k2-turbo-preview", "kimi-for-coding"],
  kimiBaseUrl: "https://api.kimi.com/coding/v1",
  geotagMode: "auto",
  geotagBatchSize: 60,
  geotagMaxApiBatches: 0,
  geotagTimeoutMs: 20_000,
  geotagMaxRetries: 4,
  geotagRetryBaseDelayMs: 2_000,
  geotagRetryMaxDelayMs: 30_000,
  outputArticlesFile: "articles.json",
  outputLastUpdatedFile: "lastUpdated.txt",
  outputFeedStateFile: "feedState.json",
  feedConditionalFetch: true
};

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function getRuntimeConfig(options = {}) {
  const requireKimi = options.requireKimi ?? options.requireGemini ?? false;

  const config = {
    maxSources: parseInteger(process.env.MAX_SOURCES, DEFAULTS.maxSources),
    maxArticlesPerSource: parseInteger(
      process.env.MAX_ARTICLES_PER_SOURCE,
      DEFAULTS.maxArticlesPerSource
    ),
    extractionAttemptTimeoutMs: parseInteger(
      process.env.EXTRACTION_ATTEMPT_TIMEOUT_MS,
      DEFAULTS.extractionAttemptTimeoutMs
    ),
    extractionTotalTimeoutMs: parseInteger(
      process.env.EXTRACTION_TOTAL_TIMEOUT_MS,
      DEFAULTS.extractionTotalTimeoutMs
    ),
    extractionMarkdownMaxChars: parseInteger(
      process.env.EXTRACTION_MARKDOWN_MAX_CHARS,
      DEFAULTS.extractionMarkdownMaxChars
    ),
    extractionExcerptMaxChars: parseInteger(
      process.env.EXTRACTION_EXCERPT_MAX_CHARS,
      DEFAULTS.extractionExcerptMaxChars
    ),
    extractionConcurrency: parseInteger(
      process.env.EXTRACTION_CONCURRENCY,
      DEFAULTS.extractionConcurrency
    ),
    mediaRefreshPerRun: parseInteger(
      process.env.MEDIA_REFRESH_PER_RUN,
      DEFAULTS.mediaRefreshPerRun
    ),
    curationMaxArticles: parseInteger(
      process.env.CURATION_MAX_ARTICLES,
      DEFAULTS.curationMaxArticles
    ),
    curationMinWordCount: parseInteger(
      process.env.CURATION_MIN_WORD_COUNT,
      DEFAULTS.curationMinWordCount
    ),
    articleRetentionDays: parseInteger(
      process.env.ARTICLE_RETENTION_DAYS,
      DEFAULTS.articleRetentionDays
    ),
    geotagMode: process.env.GEOTAG_MODE || DEFAULTS.geotagMode,
    kimiFallbackModels:
      parseCsv(process.env.KIMI_FALLBACK_MODELS).length > 0
        ? parseCsv(process.env.KIMI_FALLBACK_MODELS)
        : DEFAULTS.kimiFallbackModels,
    geotagBatchSize: parseInteger(
      process.env.GEOTAG_BATCH_SIZE,
      DEFAULTS.geotagBatchSize
    ),
    geotagMaxApiBatches: parseInteger(
      process.env.GEOTAG_MAX_API_BATCHES,
      DEFAULTS.geotagMaxApiBatches
    ),
    geotagTimeoutMs: parseInteger(
      process.env.GEOTAG_TIMEOUT_MS,
      DEFAULTS.geotagTimeoutMs
    ),
    geotagMaxRetries: parseInteger(
      process.env.GEOTAG_MAX_RETRIES,
      DEFAULTS.geotagMaxRetries
    ),
    geotagRetryBaseDelayMs: parseInteger(
      process.env.GEOTAG_RETRY_BASE_DELAY_MS,
      DEFAULTS.geotagRetryBaseDelayMs
    ),
    geotagRetryMaxDelayMs: parseInteger(
      process.env.GEOTAG_RETRY_MAX_DELAY_MS,
      DEFAULTS.geotagRetryMaxDelayMs
    ),
    outputArticlesFile: process.env.OUTPUT_ARTICLES_FILE || DEFAULTS.outputArticlesFile,
    outputLastUpdatedFile:
      process.env.OUTPUT_LAST_UPDATED_FILE || DEFAULTS.outputLastUpdatedFile,
    outputFeedStateFile: process.env.OUTPUT_FEED_STATE_FILE || DEFAULTS.outputFeedStateFile,
    feedConditionalFetch: parseBoolean(
      process.env.FEED_CONDITIONAL_FETCH,
      DEFAULTS.feedConditionalFetch
    ),
    kimiModel: process.env.KIMI_MODEL || DEFAULTS.kimiModel,
    kimiBaseUrl: process.env.KIMI_BASE_URL || DEFAULTS.kimiBaseUrl,
    kimiApiKey: process.env.KIMI_CODE_API || process.env.KIMI_API_KEY || ""
  };

  if (requireKimi && !config.kimiApiKey) {
    throw new AppError(
      "KIMI_CODE_API is required for geotagging phases but is not set.",
      { code: "CONFIG_MISSING_KIMI_KEY" }
    );
  }

  return config;
}

export async function loadSourcesFile(filePath = SOURCES_FILE) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];

  if (sources.length === 0) {
    throw new AppError("No sources found in config/sources.json", {
      code: "CONFIG_EMPTY_SOURCES"
    });
  }

  return sources;
}

export function applySourceLimit(sources, maxSources) {
  if (!Number.isFinite(maxSources) || maxSources <= 0) {
    return [...sources];
  }
  return sources.slice(0, maxSources);
}
