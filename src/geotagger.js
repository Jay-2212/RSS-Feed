import axios from "axios";

import { createLogger } from "./utils.js";

const DEFAULTS = {
  mode: "auto",
  model: "gemini-2.0-flash",
  timeoutMs: 20_000,
  maxRetries: 3,
  batchSize: 40
};

const VALID_CATEGORIES = new Set(["World", "National", "Trending", "WorthReading"]);

const COUNTRY_COORDINATES = {
  UNK: { lat: 0, lng: 0 },
  USA: { lat: 39.8283, lng: -98.5795 },
  IND: { lat: 20.5937, lng: 78.9629 },
  GBR: { lat: 55.3781, lng: -3.436 },
  CHN: { lat: 35.8617, lng: 104.1954 },
  RUS: { lat: 61.524, lng: 105.3188 },
  UKR: { lat: 48.3794, lng: 31.1656 },
  ISR: { lat: 31.0461, lng: 34.8516 },
  PSE: { lat: 31.9522, lng: 35.2332 },
  DEU: { lat: 51.1657, lng: 10.4515 },
  FRA: { lat: 46.2276, lng: 2.2137 },
  ITA: { lat: 41.8719, lng: 12.5674 },
  ESP: { lat: 40.4637, lng: -3.7492 },
  CAN: { lat: 56.1304, lng: -106.3468 },
  MEX: { lat: 23.6345, lng: -102.5528 },
  BRA: { lat: -14.235, lng: -51.9253 },
  AUS: { lat: -25.2744, lng: 133.7751 },
  JPN: { lat: 36.2048, lng: 138.2529 },
  KOR: { lat: 35.9078, lng: 127.7669 },
  ZAF: { lat: -30.5595, lng: 22.9375 },
  IRN: { lat: 32.4279, lng: 53.688 },
  TUR: { lat: 38.9637, lng: 35.2433 },
  SAU: { lat: 23.8859, lng: 45.0792 },
  ARE: { lat: 23.4241, lng: 53.8478 }
};

const CITY_COORDINATES = {
  washington: { lat: 38.9072, lng: -77.0369, country: "USA" },
  newyork: { lat: 40.7128, lng: -74.006, country: "USA" },
  london: { lat: 51.5074, lng: -0.1278, country: "GBR" },
  beijing: { lat: 39.9042, lng: 116.4074, country: "CHN" },
  moscow: { lat: 55.7558, lng: 37.6173, country: "RUS" },
  kyiv: { lat: 50.4501, lng: 30.5234, country: "UKR" },
  jerusalem: { lat: 31.7683, lng: 35.2137, country: "ISR" },
  gaza: { lat: 31.5018, lng: 34.4668, country: "PSE" },
  newdelhi: { lat: 28.6139, lng: 77.209, country: "IND" },
  mumbai: { lat: 19.076, lng: 72.8777, country: "IND" },
  tokyo: { lat: 35.6762, lng: 139.6503, country: "JPN" },
  paris: { lat: 48.8566, lng: 2.3522, country: "FRA" },
  berlin: { lat: 52.52, lng: 13.405, country: "DEU" }
};

const COUNTRY_ALIASES = {
  usa: "USA",
  us: "USA",
  america: "USA",
  unitedstates: "USA",
  india: "IND",
  ind: "IND",
  uk: "GBR",
  britain: "GBR",
  unitedkingdom: "GBR",
  england: "GBR",
  china: "CHN",
  russia: "RUS",
  ukraine: "UKR",
  israel: "ISR",
  palestine: "PSE",
  germany: "DEU",
  france: "FRA",
  italy: "ITA",
  spain: "ESP",
  canada: "CAN",
  mexico: "MEX",
  brazil: "BRA",
  australia: "AUS",
  japan: "JPN",
  korea: "KOR",
  iran: "IRN",
  turkey: "TUR",
  saudiarabia: "SAU",
  uae: "ARE",
  emirates: "ARE"
};

const KEYWORD_COUNTRY_MATCHERS = [
  { pattern: /\b(india|indian|new delhi|mumbai)\b/i, country: "IND" },
  { pattern: /\b(united states|u\.s\.|america|washington|new york)\b/i, country: "USA" },
  { pattern: /\b(uk|britain|england|london)\b/i, country: "GBR" },
  { pattern: /\b(china|beijing)\b/i, country: "CHN" },
  { pattern: /\b(russia|moscow)\b/i, country: "RUS" },
  { pattern: /\b(ukraine|kyiv)\b/i, country: "UKR" },
  { pattern: /\b(israel|jerusalem)\b/i, country: "ISR" },
  { pattern: /\b(gaza|palestine)\b/i, country: "PSE" },
  { pattern: /\b(japan|tokyo)\b/i, country: "JPN" },
  { pattern: /\b(germany|berlin)\b/i, country: "DEU" },
  { pattern: /\b(france|paris)\b/i, country: "FRA" },
  { pattern: /\b(australia)\b/i, country: "AUS" }
];

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function normalizeCountry(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "UNK";
  }

  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    return upper;
  }

  const alias = COUNTRY_ALIASES[normalizeToken(raw)];
  return alias || "UNK";
}

function resolveCityGeotag(cityRaw) {
  const token = normalizeToken(cityRaw);
  const cityMatch = CITY_COORDINATES[token];
  if (!cityMatch) {
    return null;
  }

  return {
    city: String(cityRaw || token).trim(),
    country: cityMatch.country,
    lat: cityMatch.lat,
    lng: cityMatch.lng
  };
}

function toCoordinate(country, city) {
  const cityGeotag = resolveCityGeotag(city);
  if (cityGeotag) {
    return cityGeotag;
  }

  const normalizedCountry = normalizeCountry(country);
  const countryCoord = COUNTRY_COORDINATES[normalizedCountry] || COUNTRY_COORDINATES.UNK;
  return {
    city: city ? String(city).trim() : null,
    country: normalizedCountry,
    lat: countryCoord.lat,
    lng: countryCoord.lng
  };
}

function clampConfidence(value, fallback = 0.55) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, parsed));
}

function hoursSince(publishedAt) {
  const parsed = new Date(publishedAt ?? "");
  if (Number.isNaN(parsed.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  const diffMs = Date.now() - parsed.getTime();
  return diffMs / (1000 * 60 * 60);
}

function fallbackCategory(article, country, confidence, aiCategory) {
  if (VALID_CATEGORIES.has(aiCategory)) {
    return aiCategory;
  }

  if (country === "IND") {
    return "National";
  }

  if ((article.sourceTier === 1 && hoursSince(article.publishedAt) <= 6) || confidence > 0.9) {
    return "Trending";
  }

  if (country !== "IND" && country !== "USA" && country !== "UNK") {
    return "World";
  }

  return "WorthReading";
}

function inferCountryFromText(text) {
  for (const matcher of KEYWORD_COUNTRY_MATCHERS) {
    if (matcher.pattern.test(text)) {
      return matcher.country;
    }
  }

  return "UNK";
}

function inferCityFromText(text) {
  const lower = text.toLowerCase();
  const cityMatchers = [
    { pattern: /\bwashington\b/i, token: "washington" },
    { pattern: /\bnew york\b/i, token: "newyork" },
    { pattern: /\blondon\b/i, token: "london" },
    { pattern: /\bbeijing\b/i, token: "beijing" },
    { pattern: /\bmoscow\b/i, token: "moscow" },
    { pattern: /\bkyiv\b/i, token: "kyiv" },
    { pattern: /\bjerusalem\b/i, token: "jerusalem" },
    { pattern: /\bgaza\b/i, token: "gaza" },
    { pattern: /\bnew delhi\b/i, token: "newdelhi" },
    { pattern: /\bmumbai\b/i, token: "mumbai" },
    { pattern: /\btokyo\b/i, token: "tokyo" },
    { pattern: /\bparis\b/i, token: "paris" },
    { pattern: /\bberlin\b/i, token: "berlin" }
  ];

  for (const matcher of cityMatchers) {
    if (matcher.pattern.test(text)) {
      return matcher.token;
    }
  }

  for (const city of Object.keys(CITY_COORDINATES)) {
    if (lower.includes(city)) {
      return city;
    }
  }

  return null;
}

function mockGeotag(article) {
  const text = `${article.title || ""} ${article.excerpt || ""}`;
  const inferredCountry = inferCountryFromText(text);
  const inferredCity = inferCityFromText(text);
  const geotag = toCoordinate(inferredCountry, inferredCity);
  const confidence = geotag.country === "UNK" ? 0.45 : 0.62;
  const category = fallbackCategory(article, geotag.country, confidence);

  return {
    ...article,
    geotag: geotag,
    category,
    geotagConfidence: confidence,
    geotagStatus: "mock"
  };
}

function extractJsonText(maybeText) {
  const text = String(maybeText ?? "").trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    return fenced[1];
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return null;
}

function parseGeminiResponsePayload(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const jsonCandidate = extractJsonText(text);
  if (!jsonCandidate) {
    return [];
  }

  try {
    const parsed = JSON.parse(jsonCandidate);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results;
  } catch {
    return [];
  }
}

function buildGeotagPrompt(batch) {
  const articles = batch.map((article) => ({
    id: article.id,
    source: article.sourceName,
    title: article.title,
    excerpt: article.excerpt
  }));

  return [
    "You are a strict geotagging engine.",
    "Return only JSON object with shape: {\"results\":[...]}",
    "For each article, return:",
    "- id (string)",
    "- country (ISO 3166-1 alpha-3, e.g. USA, IND, GBR)",
    "- city (string or null)",
    "- category (World | National | Trending | WorthReading)",
    "- confidence (0.0 to 1.0)",
    "- keywords (string array)",
    "If uncertain, set country to UNK and confidence below 0.6.",
    "",
    "ARTICLES:",
    JSON.stringify(articles, null, 2)
  ].join("\n");
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callGeminiGenerateContent(prompt, options) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    options.model
  )}:generateContent`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json"
    }
  };

  const client = options.httpClient || axios;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await client.post(endpoint, payload, {
        timeout: options.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": options.geminiApiKey
        }
      });
      return response.data;
    } catch (error) {
      const status = error?.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      const exhausted = attempt === options.maxRetries;

      if (!retryable || exhausted) {
        throw error;
      }

      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }

  return {};
}

function sanitizeSingleResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const id = String(result.id ?? "").trim();
  if (!id) {
    return null;
  }

  const cityValue = result.city === null ? null : String(result.city ?? "").trim() || null;
  return {
    id,
    country: normalizeCountry(result.country),
    city: cityValue,
    category: VALID_CATEGORIES.has(result.category) ? result.category : null,
    confidence: clampConfidence(result.confidence),
    keywords: Array.isArray(result.keywords)
      ? result.keywords.map((keyword) => String(keyword)).slice(0, 8)
      : []
  };
}

function toResultLookup(results) {
  const lookup = new Map();
  for (const raw of results) {
    const normalized = sanitizeSingleResult(raw);
    if (normalized) {
      lookup.set(normalized.id, normalized);
    }
  }
  return lookup;
}

function applyResultOrFallback(article, result, modeLabel) {
  if (!result) {
    return mockGeotag(article);
  }

  const geotag = toCoordinate(result.country, result.city);
  const category = fallbackCategory(article, geotag.country, result.confidence, result.category);

  return {
    ...article,
    geotag,
    category,
    geotagConfidence: result.confidence,
    geotagKeywords: result.keywords,
    geotagStatus: modeLabel
  };
}

function resolveMode(options) {
  if (options.mode === "mock") {
    return "mock";
  }
  if (options.mode === "live") {
    return "live";
  }
  return options.geminiApiKey ? "live" : "mock";
}

function chunkArticles(articles, size) {
  const chunks = [];
  for (let index = 0; index < articles.length; index += size) {
    chunks.push(articles.slice(index, index + size));
  }
  return chunks;
}

export async function geotagArticles(articles, rawOptions = {}) {
  const options = {
    ...DEFAULTS,
    ...rawOptions
  };
  const logger = options.logger ?? createLogger("geotagger");
  const mode = resolveMode(options);

  if (articles.length === 0) {
    return [];
  }

  if (mode === "mock") {
    const mocked = articles.map((article) => mockGeotag(article));
    logger.info("Geotagging completed in mock mode", {
      count: mocked.length
    });
    return mocked;
  }

  const chunks = chunkArticles(articles, Math.max(1, options.batchSize));
  const combined = [];

  for (const batch of chunks) {
    const prompt = buildGeotagPrompt(batch);
    let parsedResults = [];

    try {
      const response = await callGeminiGenerateContent(prompt, options);
      parsedResults = parseGeminiResponsePayload(response);
    } catch (error) {
      logger.warn("Gemini geotag batch failed; using fallback for batch", {
        message: error.message,
        batchSize: batch.length
      });
    }

    const lookup = toResultLookup(parsedResults);
    for (const article of batch) {
      const result = lookup.get(article.id);
      combined.push(applyResultOrFallback(article, result, "live"));
    }
  }

  logger.info("Geotagging completed", {
    mode: "live",
    count: combined.length,
    fallbackCount: combined.filter((article) => article.geotagStatus !== "live").length
  });

  return combined;
}
