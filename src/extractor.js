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
const PLACEHOLDER_IMAGE_REGEX =
  /(1x1|spacer|pixel|placeholder|blank|transparent|default-image|grey-placeholder)/i;

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

function resolveHttpUrl(rawUrl, baseUrl = "") {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLikelyPlaceholderImage(url) {
  return PLACEHOLDER_IMAGE_REGEX.test(String(url ?? "").toLowerCase());
}

function chooseUrlFromSrcset(rawSrcset, baseUrl) {
  const srcset = String(rawSrcset ?? "").trim();
  if (!srcset) {
    return null;
  }

  const candidates = srcset
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawCandidate, descriptorRaw] = entry.split(/\s+/, 2);
      const url = resolveHttpUrl(rawCandidate, baseUrl);
      if (!url) {
        return null;
      }

      const descriptor = String(descriptorRaw || "").trim().toLowerCase();
      const widthMatch = descriptor.match(/^(\d+)w$/);
      const densityMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/);
      const score = widthMatch
        ? Number.parseInt(widthMatch[1], 10)
        : densityMatch
          ? Number.parseFloat(densityMatch[1]) * 1_000
          : 1;

      return { url, score };
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
}

function chooseBestImageCandidate($image, baseUrl) {
  const directSrc = resolveHttpUrl($image.attr("src"), baseUrl);
  const srcsetCandidate = chooseUrlFromSrcset(
    $image.attr("srcset") || $image.attr("data-srcset"),
    baseUrl
  );

  const lazyCandidates = [
    $image.attr("data-src"),
    $image.attr("data-original"),
    $image.attr("data-lazy-src"),
    $image.attr("data-src-template"),
    $image.attr("data-image-url"),
    $image.attr("data-url"),
    $image.attr("data-full-src"),
    $image.attr("data-zoom-src")
  ]
    .map((candidate) => resolveHttpUrl(candidate, baseUrl))
    .filter(Boolean);

  const allCandidates = [directSrc, srcsetCandidate, ...lazyCandidates].filter(Boolean);
  if (allCandidates.length === 0) {
    return null;
  }

  const nonPlaceholder = allCandidates.find((candidate) => !isLikelyPlaceholderImage(candidate));
  return nonPlaceholder || allCandidates[0];
}

function preprocessPublisherHtml(html, pageUrl) {
  const $ = cheerio.load(String(html ?? ""));

  $("img").each((_index, element) => {
    const $image = $(element);
    const best = chooseBestImageCandidate($image, pageUrl);
    if (!best) {
      return;
    }

    const currentSrc = resolveHttpUrl($image.attr("src"), pageUrl);
    if (!currentSrc || isLikelyPlaceholderImage(currentSrc)) {
      $image.attr("src", best);
    }

    const srcsetCandidate = chooseUrlFromSrcset(
      $image.attr("srcset") || $image.attr("data-srcset"),
      pageUrl
    );
    if (srcsetCandidate) {
      $image.attr("srcset", srcsetCandidate);
    }
  });

  const leadImage = resolveHttpUrl(
    $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("link[rel='image_src']").attr("href"),
    pageUrl
  );

  return {
    html: $.html(),
    leadImage
  };
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

function firstImageFromMarkdown(markdown, baseUrl) {
  const source = String(markdown ?? "");
  const matches = source.matchAll(/!\[[^\]]*]\(([^)\s]+)[^)]*\)/g);
  for (const match of matches) {
    const resolved = resolveHttpUrl(match?.[1], baseUrl);
    if (!resolved || isLikelyPlaceholderImage(resolved)) {
      continue;
    }
    return resolved;
  }
  return null;
}

function fallbackImageFromHtml(html, baseUrl) {
  const $ = cheerio.load(String(html ?? ""));
  let fallback = null;

  $("img").each((_index, element) => {
    if (fallback) {
      return;
    }

    const best = chooseBestImageCandidate($(element), baseUrl);
    if (!best || isLikelyPlaceholderImage(best)) {
      return;
    }
    fallback = best;
  });

  return fallback;
}

function chooseArticleImage(article, markdown, html, leadImage, baseUrl) {
  const existing = resolveHttpUrl(article?.imageUrl, baseUrl);
  const fromMarkdown = firstImageFromMarkdown(markdown, baseUrl);
  const fromHtml = fallbackImageFromHtml(html, baseUrl);
  const candidates = [existing, fromMarkdown, leadImage, fromHtml].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  const nonPlaceholder = candidates.find((candidate) => !isLikelyPlaceholderImage(candidate));
  return nonPlaceholder || candidates[0];
}

function formatExtractionResult(article, parsed, method, options, context = {}) {
  const htmlFallback = context.html || "";
  const leadImage = context.leadImage || null;
  const markdown = markdownFromParsedArticle(parsed);
  const content = clampText(markdown, options.maxMarkdownChars);

  const fallbackExcerpt = fallbackExcerptFromHtml(htmlFallback);
  const excerptSeed =
    parsed?.excerpt || article.excerpt || stripHtml(parsed?.textContent) || fallbackExcerpt;
  const excerpt = clampText(excerptSeed, options.maxExcerptChars);

  const wordCount = calculateWordCount(content || excerpt);
  const imageUrl = chooseArticleImage(article, content, htmlFallback, leadImage, article.url);

  return {
    ...article,
    excerpt: excerpt || article.excerpt,
    imageUrl,
    content,
    wordCount,
    readTime: estimateReadTime(wordCount),
    extractionMethod: method
  };
}

async function directReadabilityAttempt(article, attemptTimeoutMs, options) {
  const html = await fetchHtml(article.url, attemptTimeoutMs);
  const prepared = preprocessPublisherHtml(html, article.url);
  const parsed = parseReadableFromHtml(prepared.html, article.url);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on direct fetch", {
      code: "EXTRACTION_READABILITY_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "direct", options, prepared);
}

async function twelveFtAttempt(article, attemptTimeoutMs, options) {
  const proxyUrl = `https://12ft.io/api/proxy?url=${encodeURIComponent(article.url)}`;
  const html = await fetchHtml(proxyUrl, attemptTimeoutMs);
  const prepared = preprocessPublisherHtml(html, article.url);
  const parsed = parseReadableFromHtml(prepared.html, article.url);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on 12ft proxy", {
      code: "EXTRACTION_12FT_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "12ft", options, prepared);
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
  const prepared = preprocessPublisherHtml(archiveHtml, finalUrl);
  const parsed = parseReadableFromHtml(prepared.html, finalUrl);
  if (!parsed?.textContent) {
    throw new AppError("Readability failed on archive.today", {
      code: "EXTRACTION_ARCHIVE_EMPTY"
    });
  }

  return formatExtractionResult(article, parsed, "archive.today", options, prepared);
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
