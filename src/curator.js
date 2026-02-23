import { calculateWordCount } from "./utils.js";

export const CLICKBAIT_REGEX =
  /(vs|versus|rumor|leaked|trailer|epic|destroyed|slammed|shocking|you won't believe)/i;
export const QUESTION_BAIT_REGEX = /\?$/;
export const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}]/u;
export const VALUE_KEYWORDS_REGEX =
  /(acquisition|regulation|policy|announcement|breakthrough|crisis|treaty|sanctions)/i;

const SOURCE_TIER_WEIGHTS = {
  1: 30,
  2: 20,
  3: 10
};

const DEFAULT_OPTIONS = {
  maxArticles: 120,
  minWordCount: 120,
  excludePatterns: [CLICKBAIT_REGEX]
};

export function calculateScore(article) {
  let score = 0;
  score += SOURCE_TIER_WEIGHTS[article.sourceTier] ?? 0;

  const wordCount = article.wordCount ?? calculateWordCount(article.content || article.excerpt);

  if (wordCount > 2000) {
    score += 20;
  } else if (wordCount > 800) {
    score += 10;
  } else if (wordCount < 300) {
    score -= 50;
  }

  if (CLICKBAIT_REGEX.test(article.title || "")) {
    score -= 100;
  }
  if (QUESTION_BAIT_REGEX.test(article.title || "")) {
    score -= 30;
  }
  if (EMOJI_REGEX.test(article.title || "")) {
    score -= 20;
  }
  if (VALUE_KEYWORDS_REGEX.test(article.title || "")) {
    score += 15;
  }

  return score;
}

export function isExcludedByPatterns(article, excludePatterns) {
  const title = article.title || "";
  return excludePatterns.some((pattern) => pattern.test(title));
}

export function curateArticles(articles, rawOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };
  const excludePatterns = options.excludePatterns ?? DEFAULT_OPTIONS.excludePatterns;

  const scored = articles
    .filter((article) => Boolean(article.url) && Boolean(article.title))
    .map((article) => {
      const wordCount = article.wordCount ?? calculateWordCount(article.content || article.excerpt);
      const score = calculateScore({ ...article, wordCount });
      return { ...article, wordCount, score };
    })
    .filter((article) => article.wordCount >= options.minWordCount)
    .filter((article) => !isExcludedByPatterns(article, excludePatterns));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  if (!Number.isFinite(options.maxArticles) || options.maxArticles <= 0) {
    return scored;
  }

  return scored.slice(0, options.maxArticles);
}
