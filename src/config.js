import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

import { AppError, parseInteger } from "./utils.js";

const ROOT_DIR = process.cwd();
const SOURCES_FILE = path.join(ROOT_DIR, "config", "sources.json");

const DEFAULTS = {
  maxSources: 9,
  maxArticlesPerSource: 10,
  extractionAttemptTimeoutMs: 8_000,
  extractionTotalTimeoutMs: 25_000,
  extractionMarkdownMaxChars: 5_000,
  extractionExcerptMaxChars: 300,
  extractionConcurrency: 3,
  curationMaxArticles: 40,
  curationMinWordCount: 200,
  geminiModel: "gemini-2.0-flash",
  geotagMode: "auto",
  geotagBatchSize: 40,
  geotagTimeoutMs: 20_000,
  geotagMaxRetries: 3,
  outputArticlesFile: "articles.json",
  outputLastUpdatedFile: "lastUpdated.txt"
};

export function getRuntimeConfig(options = {}) {
  const requireGemini = options.requireGemini ?? false;

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
    curationMaxArticles: parseInteger(
      process.env.CURATION_MAX_ARTICLES,
      DEFAULTS.curationMaxArticles
    ),
    curationMinWordCount: parseInteger(
      process.env.CURATION_MIN_WORD_COUNT,
      DEFAULTS.curationMinWordCount
    ),
    geotagMode: process.env.GEOTAG_MODE || DEFAULTS.geotagMode,
    geotagBatchSize: parseInteger(
      process.env.GEOTAG_BATCH_SIZE,
      DEFAULTS.geotagBatchSize
    ),
    geotagTimeoutMs: parseInteger(
      process.env.GEOTAG_TIMEOUT_MS,
      DEFAULTS.geotagTimeoutMs
    ),
    geotagMaxRetries: parseInteger(
      process.env.GEOTAG_MAX_RETRIES,
      DEFAULTS.geotagMaxRetries
    ),
    outputArticlesFile: process.env.OUTPUT_ARTICLES_FILE || DEFAULTS.outputArticlesFile,
    outputLastUpdatedFile:
      process.env.OUTPUT_LAST_UPDATED_FILE || DEFAULTS.outputLastUpdatedFile,
    geminiModel: process.env.GEMINI_MODEL || DEFAULTS.geminiModel,
    geminiApiKey: process.env.GEMINI_API_KEY || ""
  };

  if (requireGemini && !config.geminiApiKey) {
    throw new AppError(
      "GEMINI_API_KEY is required for geotagging phases but is not set.",
      { code: "CONFIG_MISSING_GEMINI_KEY" }
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
  return sources.slice(0, maxSources);
}
