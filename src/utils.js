import crypto from "node:crypto";

export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "APP_ERROR";
    this.cause = options.cause;
  }
}

export function createLogger(scope = "app") {
  function format(level, message, meta) {
    const timestamp = new Date().toISOString();
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${scope}] [${level}] ${message}${suffix}`;
  }

  return {
    info(message, meta) {
      console.log(format("INFO", message, meta));
    },
    warn(message, meta) {
      console.warn(format("WARN", message, meta));
    },
    error(message, meta) {
      console.error(format("ERROR", message, meta));
    }
  };
}

export function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampText(text, maxChars) {
  if (!text) {
    return "";
  }

  return String(text).slice(0, maxChars).trim();
}

export function stripHtml(html) {
  if (!html) {
    return "";
  }

  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateWordCount(text) {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

export function estimateReadTime(wordCount, wordsPerMinute = 220) {
  if (!Number.isFinite(wordCount) || wordCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(wordCount / wordsPerMinute));
}

export function hashFromString(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

export function stableArticleId(url, fallbackSeed = "") {
  const seed = url || fallbackSeed || crypto.randomUUID();
  return hashFromString(seed).slice(0, 16);
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  try {
    const parsed = new URL(rawUrl);
    const blockedParams = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ocid",
      "ref"
    ]);

    for (const param of blockedParams) {
      parsed.searchParams.delete(param);
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(rawUrl).trim();
  }
}

export function withTimeout(promiseFactory, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new AppError(timeoutMessage ?? "Operation timed out", {
          code: "TIMEOUT"
        })
      );
    }, timeoutMs);
  });

  return Promise.race([promiseFactory(), timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export async function mapWithConcurrency(items, worker, concurrency = 4) {
  const safeConcurrency = Math.max(1, concurrency);
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  }

  const tasks = Array.from({ length: safeConcurrency }, () => runWorker());
  await Promise.all(tasks);
  return results;
}
