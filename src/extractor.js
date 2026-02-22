import axios from "axios";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { JSDOM, VirtualConsole } from "jsdom";

import {
  AppError,
  calculateWordCount,
  clampText,
  createLogger,
  estimateReadTime,
  mapWithConcurrency,
  stripHtml,
  withTimeout
} from "./utils.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; RSSNewsHub/1.0; +https://github.com)";

const DEFAULT_OPTIONS = {
  attemptTimeoutMs: 8_000,
  totalTimeoutMs: 25_000,
  maxMarkdownChars: 5_000,
  maxExcerptChars: 300,
  concurrency: 3,
  enable12ftFallback: true,
  enableArchiveFallback: true,
  logFallbackDetails: false
};

function buildTurndownService() {
  return new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced"
  });
}

async function fetchHtml(url, timeoutMs) {
  const response = await axios.get(url, {
    timeout: timeoutMs,
    responseType: "text",
    maxRedirects: 5,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml"
    }
  });

  return String(response.data ?? "");
}

function parseReadableFromHtml(html, url) {
  try {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {
      // Ignore css/parser noise from malformed publisher stylesheets.
    });

    const dom = new JSDOM(html, { url, virtualConsole });
    const reader = new Readability(dom.window.document);
    return reader.parse();
  } catch (error) {
    throw new AppError("Failed to parse article DOM", {
      code: "EXTRACTION_DOM_PARSE_FAILED",
      cause: error
    });
  }
}

function fallbackExcerptFromHtml(html) {
  const $ = cheerio.load(html);
  const paragraphs = $("p")
    .map((_, element) => $(element).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return stripHtml(paragraphs);
}

function markdownFromParsedArticle(parsed) {
  const turndown = buildTurndownService();
  const contentHtml = parsed?.content || `<p>${parsed?.textContent || ""}</p>`;
  return turndown.turndown(contentHtml);
}

function formatExtractionResult(article, parsed, method, options, htmlFallback = "") {
  const markdown = markdownFromParsedArticle(parsed);
  const content = clampText(markdown, options.maxMarkdownChars);

  const fallbackExcerpt = fallbackExcerptFromHtml(htmlFallback);
  const excerptSeed =
    parsed?.excerpt || article.excerpt || stripHtml(parsed?.textContent) || fallbackExcerpt;
  const excerpt = clampText(excerptSeed, options.maxExcerptChars);

  const wordCount = calculateWordCount(content || excerpt);
  return {
    ...article,
    excerpt: excerpt || article.excerpt,
    content,
    wordCount,
    readTime: estimateReadTime(wordCount),
    extractionMethod: method
  };
}

async function directReadabilityAttempt(article, attemptTimeoutMs, options) {
  const html = await fetchHtml(article.url, attemptTimeoutMs);
  const parsed = parseReadableFromHtml(html, article.url);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on direct fetch", {
      code: "EXTRACTION_READABILITY_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "direct", options, html);
}

async function twelveFtAttempt(article, attemptTimeoutMs, options) {
  const proxyUrl = `https://12ft.io/api/proxy?url=${encodeURIComponent(article.url)}`;
  const html = await fetchHtml(proxyUrl, attemptTimeoutMs);
  const parsed = parseReadableFromHtml(html, article.url);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on 12ft proxy", {
      code: "EXTRACTION_12FT_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "12ft", options, html);
}

async function archiveTodayAttempt(article, attemptTimeoutMs, options) {
  const submitUrl = `https://archive.today/?run=1&url=${encodeURIComponent(article.url)}`;
  const submitResponse = await axios.get(submitUrl, {
    timeout: attemptTimeoutMs,
    responseType: "text",
    maxRedirects: 5,
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  const finalUrl =
    submitResponse.request?.res?.responseUrl && submitResponse.request.res.responseUrl !== submitUrl
      ? submitResponse.request.res.responseUrl
      : submitUrl;

  const html = String(submitResponse.data ?? "");
  const archiveHtml = finalUrl === submitUrl ? html : await fetchHtml(finalUrl, attemptTimeoutMs);
  const parsed = parseReadableFromHtml(archiveHtml, finalUrl);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on archive.today", {
      code: "EXTRACTION_ARCHIVE_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "archive.today", options, archiveHtml);
}

function buildAttemptChain(options) {
  const attempts = [
    { name: "direct", handler: directReadabilityAttempt }
  ];

  if (options.enable12ftFallback) {
    attempts.push({ name: "12ft", handler: twelveFtAttempt });
  }

  if (options.enableArchiveFallback) {
    attempts.push({ name: "archive.today", handler: archiveTodayAttempt });
  }

  return attempts;
}

function fallbackExtraction(article) {
  const wordCount = calculateWordCount(article.excerpt || "");
  return {
    ...article,
    content: "",
    wordCount,
    readTime: estimateReadTime(wordCount),
    extractionMethod: "fallback",
    extractionFailures: []
  };
}

export async function extractSingleArticle(article, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const logger = options.logger ?? createLogger("extractor");
  const chain = buildAttemptChain(options);
  const startedAt = Date.now();

  const failures = [];

  for (const attempt of chain) {
    const elapsed = Date.now() - startedAt;
    const remainingBudget = options.totalTimeoutMs - elapsed;
    if (remainingBudget <= 0) {
      break;
    }

    const timeoutForAttempt = Math.min(options.attemptTimeoutMs, remainingBudget);
    try {
      const extracted = await withTimeout(
        () => attempt.handler(article, timeoutForAttempt, options),
        timeoutForAttempt,
        `${attempt.name} attempt timed out`
      );
      return extracted;
    } catch (error) {
      failures.push({
        attempt: attempt.name,
        message: error.message
      });
    }
  }

  if (options.logFallbackDetails) {
    logger.warn("Extraction fallback used", {
      articleId: article.id,
      url: article.url,
      failures
    });
  }

  const fallback = fallbackExtraction(article);
  fallback.extractionFailures = failures;
  return fallback;
}

export async function extractArticles(articles, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const logger = options.logger ?? createLogger("extractor");

  const extracted = await mapWithConcurrency(
    articles,
    async (article) => extractSingleArticle(article, { ...options, logger }),
    options.concurrency
  );

  logger.info("Completed content extraction", {
    inputCount: articles.length,
    outputCount: extracted.length,
    fallbackCount: extracted.filter((article) => article.extractionMethod === "fallback").length
  });

  return extracted;
}
