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
const LOW_QUALITY_IMAGE_PATH_REGEX =
  /(\/alternates\/SQUARE_(?:80|120|160)\b|\/thumbs?\/|\/thumbnail\/|\/small\/|\/tiny\/|\/news\/480\/cpsprodpb\/)/i;
const LOW_QUALITY_WIDTH_THRESHOLD = 640;
const ZERO_WIDTH_CHAR_REGEX = /[\u200b-\u200f\ufeff\u2060]/g;
const STORY_CONTINUES_LINE_REGEX = /^\s*Story continues below this ad\s*$/gim;
const READ_TIME_LINE_REGEX = /^\s*\d+\s*min\s+read.*$/gim;
const PUBLISHED_METADATA_LINE_REGEX = /^\s*Published\s*[-–].*$/gim;
const INDIAN_EXPRESS_PROMO_REGEX =
  /\nThe Express Global Desk at The Indian Express[\s\S]*$/i;

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

function parsePositiveInteger(rawValue) {
  const value = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function estimateImageWidth(url) {
  const source = String(url ?? "").trim();
  if (!source) {
    return null;
  }

  try {
    const parsed = new URL(source);
    const widthFromW = parsePositiveInteger(parsed.searchParams.get("w"));
    if (widthFromW) {
      return widthFromW;
    }

    const widthFromWidth = parsePositiveInteger(parsed.searchParams.get("width"));
    if (widthFromWidth) {
      return widthFromWidth;
    }

    const resizeMatch = String(parsed.searchParams.get("resize") || "").match(/^(\d+),(\d+)$/);
    if (resizeMatch) {
      return parsePositiveInteger(resizeMatch[1]);
    }

    const path480Match = parsed.pathname.match(/\/news\/(\d{2,4})\/cpsprodpb\//i);
    if (path480Match) {
      return parsePositiveInteger(path480Match[1]);
    }
  } catch {
    return null;
  }

  return null;
}

function isLikelyLowResolutionImage(url) {
  const source = String(url ?? "");
  if (LOW_QUALITY_IMAGE_PATH_REGEX.test(source)) {
    return true;
  }

  const width = estimateImageWidth(source);
  return Number.isFinite(width) && width > 0 && width < LOW_QUALITY_WIDTH_THRESHOLD;
}

function upgradeKnownImageUrl(rawUrl) {
  const source = String(rawUrl ?? "").trim();
  if (!source) {
    return null;
  }

  let upgraded = source;
  if (/th-i\.thgim\.com/i.test(upgraded)) {
    upgraded = upgraded.replace(
      /\/alternates\/SQUARE_(?:80|120|160)\//i,
      "/alternates/LANDSCAPE_1200/"
    );
  }

  try {
    const parsed = new URL(upgraded);

    const widthValue = parsePositiveInteger(parsed.searchParams.get("w"));
    if (widthValue && widthValue < 1200) {
      parsed.searchParams.set("w", "1200");
    }

    const widthParamValue = parsePositiveInteger(parsed.searchParams.get("width"));
    if (widthParamValue && widthParamValue < 1200) {
      parsed.searchParams.set("width", "1200");
    }

    const resizeMatch = String(parsed.searchParams.get("resize") || "").match(/^(\d+),(\d+)$/);
    if (resizeMatch) {
      const width = parsePositiveInteger(resizeMatch[1]);
      const height = parsePositiveInteger(resizeMatch[2]);
      if (width && height && width < 1200) {
        const scaledHeight = Math.max(1, Math.round((height * 1200) / width));
        parsed.searchParams.set("resize", `1200,${scaledHeight}`);
      }
    }

    return parsed.toString();
  } catch {
    return upgraded;
  }
}

function expandImageCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const expanded = [];
  const seen = new Set();

  for (const candidate of list) {
    const normalized = String(candidate ?? "").trim();
    if (!normalized) {
      continue;
    }

    const upgraded = upgradeKnownImageUrl(normalized);
    const variants = [normalized, upgraded].filter(Boolean);
    for (const variant of variants) {
      if (seen.has(variant)) {
        continue;
      }
      seen.add(variant);
      expanded.push(variant);
    }
  }

  return expanded;
}

function scoreImageCandidate(url) {
  const candidate = String(url ?? "").trim();
  if (!candidate) {
    return Number.NEGATIVE_INFINITY;
  }

  if (isLikelyPlaceholderImage(candidate)) {
    return -10_000;
  }

  let score = 0;
  const width = estimateImageWidth(candidate);
  if (width && width >= 1200) {
    score += 2_000;
  } else if (width && width >= 800) {
    score += 1_200;
  } else if (width && width >= LOW_QUALITY_WIDTH_THRESHOLD) {
    score += 800;
  } else if (width) {
    score -= 800;
  } else {
    score += 300;
  }

  if (isLikelyLowResolutionImage(candidate)) {
    score -= 1_000;
  } else {
    score += 500;
  }

  if (/\/alternates\/LANDSCAPE_1200\//i.test(candidate)) {
    score += 800;
  }
  if (/\/alternates\/SQUARE_80\//i.test(candidate)) {
    score -= 1_500;
  }

  return score;
}

function selectBestImageCandidate(candidates) {
  const expanded = expandImageCandidates(candidates);
  if (expanded.length === 0) {
    return null;
  }

  let best = expanded[0];
  let bestScore = scoreImageCandidate(best);

  for (let index = 1; index < expanded.length; index += 1) {
    const candidate = expanded[index];
    const score = scoreImageCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
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
  return selectBestImageCandidate(allCandidates);
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
    if (!currentSrc || scoreImageCandidate(best) > scoreImageCandidate(currentSrc) + 50) {
      $image.attr("src", best);
    }

    const srcsetCandidate = chooseUrlFromSrcset(
      $image.attr("srcset") || $image.attr("data-srcset"),
      pageUrl
    );
    if (srcsetCandidate) {
      const bestSrcsetCandidate = selectBestImageCandidate([srcsetCandidate]);
      if (bestSrcsetCandidate) {
        $image.attr("srcset", bestSrcsetCandidate);
      }
    }
  });

  const leadImage = selectBestImageCandidate([
    resolveHttpUrl(
      $("meta[property='og:image']").attr("content") ||
        $("meta[name='twitter:image']").attr("content") ||
        $("link[rel='image_src']").attr("href"),
      pageUrl
    )
  ]);

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

function isLikelyIndianExpressSource(article) {
  const sourceName = String(article?.sourceName ?? "").toLowerCase();
  const sourceId = String(article?.sourceId ?? "").toLowerCase();
  const url = String(article?.url ?? "").toLowerCase();

  return (
    sourceName.includes("indian express") ||
    sourceId.includes("indian-express") ||
    url.includes("indianexpress.com")
  );
}

function stripLeadingIndianExpressBreadcrumbs(markdown, article) {
  if (!isLikelyIndianExpressSource(article)) {
    return markdown;
  }

  const lines = String(markdown ?? "").split("\n");
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  let breadcrumbCount = 0;
  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      break;
    }

    const match = line.match(/^(\d+)\.\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/i);
    if (!match) {
      break;
    }

    const label = match[2].trim().toLowerCase();
    const link = match[3].trim().toLowerCase();
    const looksBreadcrumbLabel =
      /^(home|news|world|national|india|cities|opinion|business|technology|science|sports|us news|global|politics|explained)$/.test(
        label
      );
    const looksBreadcrumbUrl =
      link.includes("indianexpress.com/section/") || link === "https://indianexpress.com/";

    if (!looksBreadcrumbLabel && !looksBreadcrumbUrl) {
      break;
    }

    breadcrumbCount += 1;
    cursor += 1;
  }

  if (breadcrumbCount < 2) {
    return markdown;
  }

  if (cursor < lines.length && /^\d+\.\s+/.test(lines[cursor].trim())) {
    cursor += 1;
  }
  while (cursor < lines.length && !lines[cursor].trim()) {
    cursor += 1;
  }

  return lines.slice(cursor).join("\n");
}

function normalizeBrokenImageMarkdown(markdown) {
  return String(markdown ?? "")
    .replace(/!\[([^\]\n]{0,240})\s*\n\]\((https?:\/\/[^)\s]+(?:\?[^)\s]+)?)(?:\s+"[^"]*")?\)/g, "![$1]($2)")
    .replace(/!\[([^\]\n]{0,240})\]\s*\n\((https?:\/\/[^)\s]+(?:\?[^)\s]+)?)(?:\s+"[^"]*")?\)/g, "![$1]($2)");
}

export function cleanExtractedMarkdown(markdown, article = {}) {
  if (!markdown) {
    return "";
  }

  let cleaned = String(markdown)
    .replace(/\r\n/g, "\n")
    .replace(ZERO_WIDTH_CHAR_REGEX, "")
    .replace(STORY_CONTINUES_LINE_REGEX, "")
    .replace(READ_TIME_LINE_REGEX, "")
    .replace(PUBLISHED_METADATA_LINE_REGEX, "")
    .replace(INDIAN_EXPRESS_PROMO_REGEX, "")
    .replace(
      /^\s*-\s+\[\\?#?[^\]]+]\(https?:\/\/indianexpress\.com\/about\/[^)]+\)\s*$/gim,
      ""
    );

  cleaned = stripLeadingIndianExpressBreadcrumbs(cleaned, article);
  cleaned = normalizeBrokenImageMarkdown(cleaned);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function firstImageFromMarkdown(markdown, baseUrl) {
  const source = String(markdown ?? "");
  const matches = source.matchAll(/!\[[^\]]*]\(([^)\s]+)[^)]*\)/g);
  for (const match of matches) {
    const resolved = resolveHttpUrl(match?.[1], baseUrl);
    if (!resolved || isLikelyPlaceholderImage(resolved)) {
      continue;
    }
    return selectBestImageCandidate([resolved]);
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

  return selectBestImageCandidate(candidates);
}

function formatExtractionResult(article, parsed, method, options, context = {}) {
  const htmlFallback = context.html || "";
  const leadImage = context.leadImage || null;
  const markdown = cleanExtractedMarkdown(markdownFromParsedArticle(parsed), article);
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
