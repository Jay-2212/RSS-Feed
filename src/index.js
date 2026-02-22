import { getRuntimeConfig, loadSourcesFile, applySourceLimit } from "./config.js";
import { curateArticles } from "./curator.js";
import { extractArticles } from "./extractor.js";
import { fetchArticles } from "./fetcher.js";
import { geotagArticles } from "./geotagger.js";
import { buildPersistedOutput, writePersistedArtifacts } from "./persistence.js";
import { createLogger } from "./utils.js";

const logger = createLogger("pipeline");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

export async function runPhaseOneToThree() {
  const config = getRuntimeConfig();
  const loadedSources = await loadSourcesFile();
  const sources = applySourceLimit(loadedSources, config.maxSources);

  logger.info("Pipeline start", {
    sourcesConfigured: loadedSources.length,
    sourcesUsed: sources.length
  });

  const fetched = await fetchArticles(sources, {
    maxPerSource: config.maxArticlesPerSource,
    timeoutMs: config.extractionAttemptTimeoutMs,
    logger
  });

  const extracted = await extractArticles(fetched, {
    attemptTimeoutMs: config.extractionAttemptTimeoutMs,
    totalTimeoutMs: config.extractionTotalTimeoutMs,
    maxMarkdownChars: config.extractionMarkdownMaxChars,
    maxExcerptChars: config.extractionExcerptMaxChars,
    concurrency: config.extractionConcurrency,
    logger
  });

  const curated = curateArticles(extracted, {
    maxArticles: config.curationMaxArticles,
    minWordCount: config.curationMinWordCount
  });

  logger.info("Pipeline completed through Phase 3", {
    fetched: fetched.length,
    extracted: extracted.length,
    curated: curated.length
  });

  return {
    metadata: {
      lastRun: new Date().toISOString(),
      sources: sources.map((source) => source.id),
      phase: "phase_3_complete"
    },
    articles: curated
  };
}

export async function runPhaseOneToFour() {
  const config = getRuntimeConfig();
  const phaseThreeOutput = await runPhaseOneToThree();

  const geotaggedArticles = await geotagArticles(phaseThreeOutput.articles, {
    mode: config.geotagMode,
    model: config.geminiModel,
    fallbackModels: config.geminiFallbackModels,
    geminiApiKey: config.geminiApiKey,
    batchSize: config.geotagBatchSize,
    maxApiBatches: config.geotagMaxApiBatches,
    timeoutMs: config.geotagTimeoutMs,
    maxRetries: config.geotagMaxRetries,
    retryBaseDelayMs: config.geotagRetryBaseDelayMs,
    retryMaxDelayMs: config.geotagRetryMaxDelayMs,
    logger
  });

  const statusSet = new Set(geotaggedArticles.map((article) => article.geotagStatus));
  const resolvedGeotagMode =
    statusSet.size === 1 ? Array.from(statusSet)[0] : statusSet.size === 0 ? "none" : "mixed";

  logger.info("Pipeline completed through Phase 4", {
    geotagged: geotaggedArticles.length,
    geotagModeConfigured: config.geotagMode,
    geotagModeResolved: resolvedGeotagMode,
    hasGeminiKey: Boolean(config.geminiApiKey)
  });

  return {
    metadata: {
      ...phaseThreeOutput.metadata,
      phase: "phase_4_complete",
      geotagModeConfigured: config.geotagMode,
      geotagModeResolved: resolvedGeotagMode,
      geotagModel: config.geminiModel
    },
    articles: geotaggedArticles
  };
}

export async function runPhaseOneToFive() {
  const config = getRuntimeConfig();
  const phaseFourOutput = await runPhaseOneToFour();
  const persistedOutput = buildPersistedOutput(phaseFourOutput, {
    timestamp: new Date().toISOString()
  });

  const paths = await writePersistedArtifacts(persistedOutput, {
    articlesFilePath: config.outputArticlesFile,
    lastUpdatedFilePath: config.outputLastUpdatedFile
  });

  logger.info("Pipeline completed through Phase 5", {
    articlesPersisted: persistedOutput.metadata.count,
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
