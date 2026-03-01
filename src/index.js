import { getRuntimeConfig, loadSourcesFile, applySourceLimit } from "./config.js";
import { curateArticles } from "./curator.js";
import { extractArticles } from "./extractor.js";
import { fetchArticles, loadFeedCacheState, writeFeedCacheState } from "./fetcher.js";
import { geotagArticles } from "./geotagger.js";
import {
  buildExistingIndex,
  loadPersistedSnapshot,
  mergeIncrementalArticles,
  splitArticlesByDifference
} from "./incremental.js";
import { buildPersistedOutput, writePersistedArtifacts, appendRunHistory } from "./persistence.js";
import { createLogger } from "./utils.js";

const logger = createLogger("pipeline");
const BROKEN_IMAGE_REGEX =
  /(1x1_spacer|grey-placeholder|placeholder|transparent|blank|pixel)/i;

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function needsMediaRefresh(article) {
  const imageUrl = String(article?.imageUrl || "").trim();
  const content = String(article?.content || "");

  if (!imageUrl) {
    return true;
  }

  return BROKEN_IMAGE_REGEX.test(imageUrl) || BROKEN_IMAGE_REGEX.test(content);
}

export async function runPhaseOneToThree() {
  const config = getRuntimeConfig();
  const loadedSources = await loadSourcesFile();
  const sources = applySourceLimit(loadedSources, config.maxSources);
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const feedCacheState = await loadFeedCacheState(config.outputFeedStateFile, { logger });
  const fetchStats = {};

  logger.info("Pipeline start", {
    sourcesConfigured: loadedSources.length,
    sourcesUsed: sources.length
  });

  const existingSnapshot = await loadPersistedSnapshot(config.outputArticlesFile, {
    sourceMap,
    logger
  });
  const existingArticles = existingSnapshot.articles;
  const mediaRepairCandidates = existingArticles
    .filter((article) => needsMediaRefresh(article))
    .slice(0, Math.max(0, config.mediaRefreshPerRun));

  let repairedExistingArticles = [];
  if (mediaRepairCandidates.length > 0) {
    repairedExistingArticles = await extractArticles(mediaRepairCandidates, {
      attemptTimeoutMs: config.extractionAttemptTimeoutMs,
      totalTimeoutMs: config.extractionTotalTimeoutMs,
      maxMarkdownChars: config.extractionMarkdownMaxChars,
      maxExcerptChars: config.extractionExcerptMaxChars,
      concurrency: Math.max(1, Math.min(3, config.extractionConcurrency)),
      logger
    });
  }

  const existingByUrl = new Map(existingArticles.map((article) => [article.url, article]));
  for (const repaired of repairedExistingArticles) {
    existingByUrl.set(repaired.url, repaired);
  }
  const effectiveExistingArticles = Array.from(existingByUrl.values());
  const existingIndex = buildExistingIndex(effectiveExistingArticles);

  const fetched = await fetchArticles(sources, {
    maxPerSource: config.maxArticlesPerSource,
    timeoutMs: config.extractionAttemptTimeoutMs,
    logger,
    feedCacheState,
    enableConditionalFetch: config.feedConditionalFetch,
    fetchStats
  });
  await writeFeedCacheState(config.outputFeedStateFile, feedCacheState, { logger });

  const delta = splitArticlesByDifference(fetched, existingIndex);

  let extracted = [];
  if (delta.newArticles.length > 0) {
    extracted = await extractArticles(delta.newArticles, {
      attemptTimeoutMs: config.extractionAttemptTimeoutMs,
      totalTimeoutMs: config.extractionTotalTimeoutMs,
      maxMarkdownChars: config.extractionMarkdownMaxChars,
      maxExcerptChars: config.extractionExcerptMaxChars,
      concurrency: config.extractionConcurrency,
      logger
    });
  } else {
    logger.info("No unseen URLs detected. Skipping extraction phase.");
  }

  const curatedNew = curateArticles(extracted, {
    maxArticles: 0,
    minWordCount: config.curationMinWordCount
  });

  logger.info("Pipeline completed through Phase 3", {
    fetched: fetched.length,
    unchangedSources: fetchStats.unchangedSourceCount ?? 0,
    failedSources: fetchStats.failedSourceCount ?? 0,
    duplicateByUrl: delta.duplicateUrlCount,
    duplicateByTitle: delta.duplicateTitleCount,
    newForExtraction: delta.newArticles.length,
    extracted: extracted.length,
    curatedNew: curatedNew.length,
    cachedExisting: effectiveExistingArticles.length,
    refreshedExistingMedia: repairedExistingArticles.length
  });

  return {
    metadata: {
      lastRun: new Date().toISOString(),
      sources: sources.map((source) => source.id),
      phase: "phase_3_complete",
      existingCount: effectiveExistingArticles.length,
      newCount: curatedNew.length,
      refreshedExistingMedia: repairedExistingArticles.length,
      unchangedSources: fetchStats.unchangedSourceCount ?? 0,
      failedSources: fetchStats.failedSourceCount ?? 0,
      duplicateByUrl: delta.duplicateUrlCount,
      duplicateByTitle: delta.duplicateTitleCount,
      previousGeotagModeResolved: existingSnapshot.metadata?.geotagModeResolved ?? "unknown"
    },
    articles: curatedNew,
    existingArticles: effectiveExistingArticles
  };
}

export async function runPhaseOneToFour() {
  const config = getRuntimeConfig();
  const phaseThreeOutput = await runPhaseOneToThree();

  let geotaggedArticles = [];
  let modelUsageCounts = {};

  if (phaseThreeOutput.articles.length > 0) {
    const result = await geotagArticles(phaseThreeOutput.articles, {
      mode: config.geotagMode,
      model: config.inceptionModel,
      fallbackModels: config.inceptionFallbackModels,
      inceptionBaseUrl: config.inceptionBaseUrl,
      inceptionApiKey: config.inceptionApiKey,
      geminiApiKey: config.geminiApiKey,
      geminiModel: config.geminiModel,
      geminiBaseUrl: config.geminiBaseUrl,
      batchSize: config.geotagBatchSize,
      maxApiBatches: config.geotagMaxApiBatches,
      timeoutMs: config.geotagTimeoutMs,
      maxRetries: config.geotagMaxRetries,
      retryBaseDelayMs: config.geotagRetryBaseDelayMs,
      retryMaxDelayMs: config.geotagRetryMaxDelayMs,
      logger
    });
    geotaggedArticles = result.articles;
    modelUsageCounts = result.modelUsageCounts;
  } else {
    logger.info("No new curated articles. Skipping geotag API phase.");
  }

  const mergedArticles = mergeIncrementalArticles(
    phaseThreeOutput.existingArticles,
    geotaggedArticles,
    {
      maxArticles: config.curationMaxArticles,
      retentionDays: config.articleRetentionDays
    }
  );

  const statusSet = new Set(
    geotaggedArticles.map((article) => article.geotagStatus).filter(Boolean)
  );
  const resolvedGeotagMode =
    geotaggedArticles.length === 0
      ? phaseThreeOutput.metadata?.previousGeotagModeResolved ?? "cached"
      : statusSet.size === 1
        ? Array.from(statusSet)[0]
        : statusSet.size === 0
          ? "none"
          : "mixed";

  const actuallyUsedModels = Object.keys(modelUsageCounts);
  const primaryModelUsed =
    actuallyUsedModels.length > 0
      ? actuallyUsedModels.join(", ")
      : resolvedGeotagMode === "mock"
        ? "mock"
        : config.inceptionModel;

  logger.info("Pipeline completed through Phase 4", {
    geotaggedNew: geotaggedArticles.length,
    retainedArticles: mergedArticles.length,
    geotagModeConfigured: config.geotagMode,
    geotagModeResolved: resolvedGeotagMode,
    modelUsed: primaryModelUsed,
    hasInceptionKey: Boolean(config.inceptionApiKey),
    hasGeminiKey: Boolean(config.geminiApiKey)
  });

  return {
    metadata: {
      ...phaseThreeOutput.metadata,
      phase: "phase_4_complete",
      geotagModeConfigured: config.geotagMode,
      geotagModeResolved: resolvedGeotagMode,
      geotagModel: primaryModelUsed
    },
    articles: mergedArticles
  };
}

export async function runPhaseOneToFive() {
  const config = getRuntimeConfig();
  const phaseFourOutput = await runPhaseOneToFour();
  const timestamp = new Date().toISOString();

  const persistedOutput = buildPersistedOutput(phaseFourOutput, {
    timestamp
  });

  const paths = await writePersistedArtifacts(persistedOutput, {
    articlesFilePath: config.outputArticlesFile,
    lastUpdatedFilePath: config.outputLastUpdatedFile
  });

  const runMetrics = {
    timestamp,
    phase: phaseFourOutput.metadata.phase,
    articlesPersisted: persistedOutput.metadata.count,
    geotaggedNew: phaseFourOutput.metadata.newCount,
    geotagModeConfigured: phaseFourOutput.metadata.geotagModeConfigured,
    geotagModeResolved: phaseFourOutput.metadata.geotagModeResolved,
    geotagModel: phaseFourOutput.metadata.geotagModel,
    fetched: phaseFourOutput.metadata.newCount + (phaseFourOutput.metadata.duplicateByUrl || 0),
    unchangedSources: phaseFourOutput.metadata.unchangedSources,
    failedSources: phaseFourOutput.metadata.failedSources,
    refreshedExistingMedia: phaseFourOutput.metadata.refreshedExistingMedia
  };

  await appendRunHistory(runMetrics, {
    runHistoryFilePath: config.outputRunHistoryFile
  });

  logger.info("Pipeline completed through Phase 5", {
    ...runMetrics,
    articlesPath: paths.articlesPath,
    lastUpdatedPath: paths.lastUpdatedPath
  });

  return persistedOutput;
}

async function main() {
  if (!hasFlag("--run")) {
    logger.info("Scaffold is ready. Run `npm run run:pipeline` to execute Phase 1-5 pipeline.");
    return;
  }

  const output = await runPhaseOneToFive();
  logger.info("Run summary", {
    curatedCount: output.articles.length
  });
}

main()
  .then(() => {
    if (hasFlag("--run")) {
      process.exit(0);
    }
  })
  .catch((error) => {
    logger.error("Pipeline failed", {
      message: error.message
    });
    process.exitCode = 1;
  });
