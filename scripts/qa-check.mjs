import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTICLES_PATH = path.join(ROOT, "articles.json");
const LAST_UPDATED_PATH = path.join(ROOT, "lastUpdated.txt");
const MAX_ARTICLES_FILE_BYTES = 500_000;
const MAX_ARTICLES = 40;
const MIN_WORD_COUNT = 200;
const CLICKBAIT_REGEX =
  /(vs|versus|rumor|leaked|trailer|epic|destroyed|slammed|shocking|you won't believe)/i;

function parseIsoDate(value) {
  const parsed = new Date(value ?? "");
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assertCheck(condition, message, failures) {
  if (!condition) {
    failures.push(message);
  }
}

function warnCheck(condition, message, warnings) {
  if (!condition) {
    warnings.push(message);
  }
}

function summarizeList(label, entries) {
  if (entries.length === 0) {
    return `${label}: none`;
  }

  return `${label}: ${entries.length}\n${entries.map((entry) => `- ${entry}`).join("\n")}`;
}

async function run() {
  const failures = [];
  const warnings = [];

  const [articlesStat, lastUpdatedStat] = await Promise.all([
    fs.stat(ARTICLES_PATH),
    fs.stat(LAST_UPDATED_PATH)
  ]);

  assertCheck(
    articlesStat.size <= MAX_ARTICLES_FILE_BYTES,
    `articles.json is too large (${articlesStat.size} bytes > ${MAX_ARTICLES_FILE_BYTES} bytes)`,
    failures
  );
  warnCheck(
    lastUpdatedStat.size <= 128,
    `lastUpdated.txt appears unexpectedly large (${lastUpdatedStat.size} bytes)`,
    warnings
  );

  const [articlesRaw, lastUpdatedRaw] = await Promise.all([
    fs.readFile(ARTICLES_PATH, "utf8"),
    fs.readFile(LAST_UPDATED_PATH, "utf8")
  ]);

  let parsed;
  try {
    parsed = JSON.parse(articlesRaw);
  } catch (error) {
    failures.push(`articles.json is not valid JSON: ${error.message}`);
    parsed = null;
  }

  if (!parsed) {
    console.error(summarizeList("FAILURES", failures));
    process.exitCode = 1;
    return;
  }

  const metadata = parsed.metadata || {};
  const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  const lastUpdatedFileValue = lastUpdatedRaw.trim();

  assertCheck(typeof metadata === "object", "metadata object is missing", failures);
  assertCheck(Array.isArray(parsed.articles), "articles array is missing", failures);
  assertCheck(
    Number.isFinite(metadata.count) && metadata.count === articles.length,
    "metadata.count does not match articles array length",
    failures
  );
  assertCheck(articles.length <= MAX_ARTICLES, `articles length exceeds ${MAX_ARTICLES}`, failures);
  assertCheck(
    Array.isArray(metadata.sources) && metadata.sources.length > 0,
    "metadata.sources is missing or empty",
    failures
  );

  const metadataTimestamp = parseIsoDate(metadata.lastUpdated);
  const fileTimestamp = parseIsoDate(lastUpdatedFileValue);
  assertCheck(Boolean(metadataTimestamp), "metadata.lastUpdated is not a valid ISO timestamp", failures);
  assertCheck(Boolean(fileTimestamp), "lastUpdated.txt is not a valid ISO timestamp", failures);
  if (metadataTimestamp && fileTimestamp) {
    assertCheck(
      Math.abs(metadataTimestamp.getTime() - fileTimestamp.getTime()) < 5_000,
      "metadata.lastUpdated and lastUpdated.txt differ by more than 5 seconds",
      failures
    );
  }

  const lowWordCountIds = [];
  const clickbaitIds = [];
  const missingRequiredFields = [];
  let unknownGeotags = 0;

  for (const article of articles) {
    const required = [
      "id",
      "sourceId",
      "sourceName",
      "title",
      "excerpt",
      "url",
      "publishedAt",
      "geotag",
      "category",
      "metrics"
    ];

    for (const key of required) {
      if (!(key in article)) {
        missingRequiredFields.push(`${article.id || "(unknown)"} missing "${key}"`);
      }
    }

    if ((article.metrics?.wordCount ?? 0) < MIN_WORD_COUNT) {
      lowWordCountIds.push(article.id || "(unknown)");
    }
    if (CLICKBAIT_REGEX.test(article.title || "")) {
      clickbaitIds.push(article.id || "(unknown)");
    }
    if ((article.geotag?.country || "UNK") === "UNK") {
      unknownGeotags += 1;
    }
  }

  assertCheck(missingRequiredFields.length === 0, "Some articles are missing required fields", failures);
  assertCheck(
    lowWordCountIds.length === 0,
    `Found ${lowWordCountIds.length} articles below ${MIN_WORD_COUNT} words`,
    failures
  );
  assertCheck(clickbaitIds.length === 0, `Found ${clickbaitIds.length} clickbait-like titles`, failures);

  const unknownRatio = articles.length === 0 ? 0 : unknownGeotags / articles.length;
  warnCheck(
    unknownRatio < 0.7,
    `High unknown geotag ratio (${Math.round(unknownRatio * 100)}%)`,
    warnings
  );

  console.log(`QA_CHECK: articles=${articles.length} sizeBytes=${articlesStat.size}`);
  console.log(`QA_CHECK: geotagUnknownRatio=${(unknownRatio * 100).toFixed(1)}%`);
  console.log(summarizeList("WARNINGS", warnings));

  if (failures.length > 0) {
    console.error(summarizeList("FAILURES", failures));
    process.exitCode = 1;
    return;
  }

  console.log("QA_CHECK: PASS");
}

run().catch((error) => {
  console.error(`QA_CHECK: ERROR ${error.message}`);
  process.exitCode = 1;
});
