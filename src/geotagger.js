import axios from "axios";

import { createLogger } from "./utils.js";

const DEFAULTS = {
  mode: "auto",
  model: "kimi-k2-0905-preview",
  fallbackModels: ["kimi-k2-turbo-preview", "kimi-for-coding"],
  kimiBaseUrl: "https://api.kimi.com/coding/v1",
  timeoutMs: 20_000,
  maxRetries: 4,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 30_000,
  batchSize: 60,
  maxApiBatches: 0
};

const VALID_CATEGORIES = new Set(["World", "National", "Trending", "WorthReading"]);
const VALID_PRIORITIES = new Set(["High", "Medium", "Low"]);

const CONFLICT_TEXT_REGEX =
  /\b(war|conflict|invasion|ceasefire|missile|airstrike|drone strike|hostage|military|front line|insurgency|shelling|attack)\b/i;

const TAG_BLACKLIST = new Set([
  "world",
  "national",
  "trending",
  "worthreading",
  "news",
  "latest",
  "breaking",
  "update",
  "headline",
  "story"
]);

const TAG_UPPERCASE_WORDS = new Set([
  "ai",
  "api",
  "usa",
  "ind",
  "gbr",
  "chn",
  "rus",
  "ukr",
  "isr",
  "pse",
  "deu",
  "fra",
  "ita",
  "esp",
  "can",
  "mex",
  "bra",
  "aus",
  "jpn",
  "kor",
  "zaf",
  "irn",
  "tur",
  "sau",
  "are",
  "pak",
  "afg",
  "syr",
  "sdn",
  "uga",
  "ven",
  "col",
  "nga",
  "egy",
  "uk",
  "eu",
  "un",
  "uae",
  "nato",
  "gdp",
  "ipo",
  "icc",
  "rbi"
]);

const TOPIC_TAG_MATCHERS = [
  { pattern: /\b(election|vote|ballot|poll)\b/i, tag: "elections" },
  { pattern: /\b(parliament|congress|senate|assembly)\b/i, tag: "legislature" },
  { pattern: /\b(court|judge|legal|lawsuit|supreme court)\b/i, tag: "law-and-justice" },
  { pattern: /\b(trade|tariff|export|import|sanction)\b/i, tag: "trade" },
  { pattern: /\b(inflation|gdp|economy|fiscal|budget|tax)\b/i, tag: "economy" },
  { pattern: /\b(stock|market|shares|investor)\b/i, tag: "markets" },
  { pattern: /\b(central bank|interest rate|federal reserve|rbi)\b/i, tag: "monetary-policy" },
  { pattern: /\b(startup|funding|venture|ipo)\b/i, tag: "startups" },
  { pattern: /\b(ai|artificial intelligence|machine learning|llm)\b/i, tag: "ai" },
  { pattern: /\b(cyber|hacker|malware|ransomware)\b/i, tag: "cybersecurity" },
  { pattern: /\b(climate|emission|carbon|heatwave|wildfire)\b/i, tag: "climate" },
  { pattern: /\b(energy|oil|gas|renewable|solar|wind)\b/i, tag: "energy" },
  { pattern: /\b(health|hospital|disease|virus|vaccine)\b/i, tag: "health" },
  { pattern: /\b(education|school|university|student)\b/i, tag: "education" },
  { pattern: /\b(immigration|migrant|refugee|asylum)\b/i, tag: "migration" },
  { pattern: /\b(war|conflict|military|strike|drone|ceasefire)\b/i, tag: "conflict" },
  { pattern: /\b(protest|demonstration|rally)\b/i, tag: "protests" },
  { pattern: /\b(crime|police|arrest|investigation)\b/i, tag: "crime" },
  { pattern: /\b(infrastructure|bridge|road|rail|metro|port)\b/i, tag: "infrastructure" },
  { pattern: /\b(agriculture|farmer|crop|monsoon)\b/i, tag: "agriculture" },
  { pattern: /\b(sports|cricket|football|olympic|tennis)\b/i, tag: "sports" },
  { pattern: /\b(culture|film|movie|music|art)\b/i, tag: "culture" }
];

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
  delhi: { lat: 28.7041, lng: 77.1025, country: "IND" },
  mumbai: { lat: 19.076, lng: 72.8777, country: "IND" },
  tokyo: { lat: 35.6762, lng: 139.6503, country: "JPN" },
  paris: { lat: 48.8566, lng: 2.3522, country: "FRA" },
  berlin: { lat: 52.52, lng: 13.405, country: "DEU" },
  lahore: { lat: 31.5497, lng: 74.3436, country: "PAK" },
  kabul: { lat: 34.5553, lng: 69.2075, country: "AFG" },
  damascus: { lat: 33.5138, lng: 36.2765, country: "SYR" },
  khartoum: { lat: 15.5007, lng: 32.5599, country: "SDN" },
  kampala: { lat: 0.3476, lng: 32.5825, country: "UGA" },
  caracas: { lat: 10.4806, lng: -66.9036, country: "VEN" }
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
  emirates: "ARE",
  pakistan: "PAK",
  pakistani: "PAK",
  afghanistan: "AFG",
  afghan: "AFG",
  syria: "SYR",
  syrian: "SYR",
  sudan: "SDN",
  sudanese: "SDN",
  uganda: "UGA",
  ugandan: "UGA",
  venezuela: "VEN",
  venezuelan: "VEN",
  colombia: "COL",
  colombian: "COL",
  nigeria: "NGA",
  nigerian: "NGA",
  egypt: "EGY",
  egyptian: "EGY"
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
  { pattern: /\b(australia)\b/i, country: "AUS" },
  { pattern: /\b(pakistan|lahore)\b/i, country: "PAK" },
  { pattern: /\b(afghanistan|kabul)\b/i, country: "AFG" },
  { pattern: /\b(syria|damascus)\b/i, country: "SYR" },
  { pattern: /\b(sudan|khartoum)\b/i, country: "SDN" },
  { pattern: /\b(uganda|kampala)\b/i, country: "UGA" },
  { pattern: /\b(venezuela|caracas)\b/i, country: "VEN" }
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

function normalizePriority(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (["high", "critical", "urgent", "severe"].includes(normalized)) {
    return "High";
  }
  if (["medium", "moderate", "important"].includes(normalized)) {
    return "Medium";
  }
  if (["low", "minor", "routine"].includes(normalized)) {
    return "Low";
  }

  return null;
}

function detectConflictSignal(article, tags = []) {
  const text = `${article.title || ""} ${article.excerpt || ""}`.toLowerCase();
  if (CONFLICT_TEXT_REGEX.test(text)) {
    return true;
  }
  return tags.some((tag) => /\b(conflict|war|ceasefire|military)\b/i.test(tag));
}

function inferPriority(article, category, confidence, tags = [], aiPriority = null) {
  const normalizedAiPriority = normalizePriority(aiPriority);
  if (normalizedAiPriority) {
    return normalizedAiPriority;
  }

  const conflict = detectConflictSignal(article, tags);
  if (conflict) {
    return "High";
  }

  if (category === "Trending" || (article.sourceTier === 1 && hoursSince(article.publishedAt) <= 10)) {
    return "High";
  }

  if (confidence < 0.5 || category === "WorthReading") {
    return "Low";
  }

  return "Medium";
}

function normalizeTag(value) {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 40) {
    return null;
  }
  if (TAG_BLACKLIST.has(cleaned)) {
    return null;
  }
  return cleaned;
}

function toDisplayTag(normalizedTag) {
  const words = String(normalizedTag)
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return null;
  }

  return words
    .map((word, index) => {
      if (TAG_UPPERCASE_WORDS.has(word)) {
        return word.toUpperCase();
      }

      if (index > 0 && ["and", "of", "for", "to", "in", "on"].includes(word)) {
        return word;
      }

      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function sanitizeTagList(tags, maxItems = 8) {
  const displayTags = [];
  const seen = new Set();
  for (const tagRaw of tags ?? []) {
    const tag = normalizeTag(tagRaw);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    const displayTag = toDisplayTag(tag);
    if (!displayTag) {
      continue;
    }
    displayTags.push(displayTag);
    if (displayTags.length >= maxItems) {
      break;
    }
  }
  return displayTags;
}

function extractFallbackTags(article, country, city) {
  const text = `${article.title || ""} ${article.excerpt || ""}`;
  const inferred = [];

  for (const matcher of TOPIC_TAG_MATCHERS) {
    if (matcher.pattern.test(text)) {
      inferred.push(matcher.tag);
    }
  }

  if (country && country !== "UNK") {
    inferred.push(String(country));
  }
  if (city) {
    inferred.push(city);
  }

  return sanitizeTagList(inferred);
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

  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  const candidates = [];
  for (let index = 0; index < words.length; index += 1) {
    candidates.push(words[index]);
    if (index + 1 < words.length) {
      candidates.push(`${words[index]}${words[index + 1]}`);
    }
    if (index + 2 < words.length) {
      candidates.push(`${words[index]}${words[index + 1]}${words[index + 2]}`);
    }
  }

  for (const candidate of candidates) {
    const alias = COUNTRY_ALIASES[candidate];
    if (alias) {
      return alias;
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
    { pattern: /\bdelhi\b/i, token: "delhi" },
    { pattern: /\bmumbai\b/i, token: "mumbai" },
    { pattern: /\btokyo\b/i, token: "tokyo" },
    { pattern: /\bparis\b/i, token: "paris" },
    { pattern: /\bberlin\b/i, token: "berlin" },
    { pattern: /\blahore\b/i, token: "lahore" },
    { pattern: /\bkabul\b/i, token: "kabul" },
    { pattern: /\bdamascus\b/i, token: "damascus" },
    { pattern: /\bkhartoum\b/i, token: "khartoum" },
    { pattern: /\bkampala\b/i, token: "kampala" },
    { pattern: /\bcaracas\b/i, token: "caracas" }
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
  const tags = extractFallbackTags(article, geotag.country, geotag.city);
  const priority = inferPriority(article, category, confidence, tags);
  const conflict = detectConflictSignal(article, tags);

  return {
    ...article,
    geotag: geotag,
    category,
    priority,
    signals: {
      conflict
    },
    geotagConfidence: confidence,
    geotagKeywords: tags,
    tags,
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

function parseModelResponsePayload(data) {
  const choiceContent = data?.choices?.[0]?.message?.content;
  const choiceText = Array.isArray(choiceContent)
    ? choiceContent
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .join("\n")
    : choiceContent;
  const text =
    choiceText ||
    data?.choices?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
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
    "You are a strict geotagging and topical-tagging engine for a news dashboard.",
    "Return only one JSON object with shape: {\"results\":[...]} and no prose.",
    "For each article return:",
    "- id (string)",
    "- country (ISO 3166-1 alpha-3, e.g. USA, IND, GBR; return UNK only if truly unclear)",
    "- city (string or null, specific city when present in article)",
    "- category (World | National | Trending | WorthReading)",
    "- priority (High | Medium | Low, based on global impact and urgency)",
    "- conflictSignal (boolean, true when article clearly relates to active conflict/war/security escalation)",
    "- confidence (0.0 to 1.0)",
    "- tags (array of 3-8 specific display-ready tags; use Title Case when possible)",
    "",
    "Tagging rules:",
    "- Prefer specific tags like 'trade', 'ceasefire', 'cybersecurity', 'elections', 'inflation'.",
    "- Avoid generic tags like 'news', 'world', 'politics', 'headline', 'update'.",
    "- Include one location tag when evident (city or country name).",
    "- Do not invent places; use UNK only when location cannot be inferred.",
    "- confidence below 0.6 when location confidence is weak.",
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

function extractApiErrorDetails(error) {
  const status = error?.response?.status ?? null;
  const headers = error?.response?.headers ?? {};
  const retryAfterRaw = headers["retry-after"] ?? headers["Retry-After"] ?? null;
  const retryAfterSeconds = Number.parseInt(retryAfterRaw, 10);
  const apiError = error?.response?.data?.error ?? {};
  const quotaFailure = Array.isArray(apiError?.details)
    ? apiError.details.find((detail) => String(detail?.["@type"] ?? "").includes("QuotaFailure"))
    : null;

  return {
    status,
    code: apiError.code ?? null,
    apiStatus: apiError.status ?? apiError.type ?? null,
    message: apiError.message || error.message,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    quotaViolations: Array.isArray(quotaFailure?.violations) ? quotaFailure.violations : []
  };
}

function computeBackoffMs(details, attempt, options) {
  if (Number.isFinite(details.retryAfterSeconds) && details.retryAfterSeconds > 0) {
    return Math.min(details.retryAfterSeconds * 1000, options.retryMaxDelayMs);
  }

  const exponential = options.retryBaseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponential, options.retryMaxDelayMs);
}

async function callKimiChatCompletions(prompt, options) {
  const baseUrl = String(options.kimiBaseUrl || DEFAULTS.kimiBaseUrl).replace(/\/+$/, "");
  const endpoint = `${baseUrl}/chat/completions`;
  const payload = {
    model: options.model,
    messages: [
      {
        role: "system",
        content: "You are a strict geotagging and topical tagging engine. Return JSON only."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 4096
  };

  const client = options.httpClient || axios;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await client.post(endpoint, payload, {
        timeout: options.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.kimiApiKey}`
        }
      });
      return response.data;
    } catch (error) {
      const details = extractApiErrorDetails(error);
      const status = details.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      const exhausted = attempt === options.maxRetries;

      if (!retryable || exhausted) {
        throw error;
      }

      const backoffMs = computeBackoffMs(details, attempt, options);
      await sleep(backoffMs);
    }
  }

  return {};
}

async function callKimiWithModelFallback(prompt, options, logger) {
  const models = [options.model, ...(options.fallbackModels ?? [])]
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model, index, array) => array.indexOf(model) === index);

  let lastError;

  for (const model of models) {
    try {
      const data = await callKimiChatCompletions(prompt, {
        ...options,
        model
      });
      return {
        data,
        modelUsed: model
      };
    } catch (error) {
      const details = extractApiErrorDetails(error);
      logger.warn("Kimi model request failed", {
        model,
        status: details.status,
        apiStatus: details.apiStatus,
        message: details.message,
        quotaViolations: details.quotaViolations
      });

      lastError = error;
      const retryableAcrossModels =
        details.status === 429 || details.status === 503 || details.status === 500;
      if (!retryableAcrossModels) {
        break;
      }
    }
  }

  throw lastError;
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
    priority: normalizePriority(result.priority),
    conflictSignal: Boolean(result.conflictSignal),
    confidence: clampConfidence(result.confidence),
    tags: sanitizeTagList(
      Array.isArray(result.tags)
        ? result.tags
        : Array.isArray(result.keywords)
          ? result.keywords
          : []
    )
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
  const fallbackTags = extractFallbackTags(article, geotag.country, geotag.city);
  const tags = sanitizeTagList(
    result.tags && result.tags.length > 0 ? result.tags : fallbackTags
  );
  const priority = inferPriority(article, category, result.confidence, tags, result.priority);
  const conflict = Boolean(result.conflictSignal) || detectConflictSignal(article, tags);

  return {
    ...article,
    geotag,
    category,
    priority,
    signals: {
      conflict
    },
    geotagConfidence: result.confidence,
    geotagKeywords: tags,
    tags,
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
  return options.kimiApiKey ? "live" : "mock";
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
  const modelUsageCounts = {};
  const effectiveMaxApiBatches =
    Number.isFinite(options.maxApiBatches) && options.maxApiBatches > 0
      ? options.maxApiBatches
      : Number.POSITIVE_INFINITY;

  for (const [batchIndex, batch] of chunks.entries()) {
    const prompt = buildGeotagPrompt(batch);
    let parsedResults = [];
    let modelUsedForBatch = null;

    if (batchIndex < effectiveMaxApiBatches) {
      try {
        const response = await callKimiWithModelFallback(prompt, options, logger);
        modelUsedForBatch = response.modelUsed;
        parsedResults = parseModelResponsePayload(response.data);
        if (modelUsedForBatch) {
          modelUsageCounts[modelUsedForBatch] = (modelUsageCounts[modelUsedForBatch] ?? 0) + 1;
        }
        if (parsedResults.length === 0) {
          logger.warn("Kimi response parsed but returned no usable geotag rows", {
            modelUsed: modelUsedForBatch,
            batchSize: batch.length
          });
        }
      } catch (error) {
        const details = extractApiErrorDetails(error);
        logger.warn("Kimi geotag batch failed; using fallback for batch", {
          status: details.status,
          apiStatus: details.apiStatus,
          message: details.message,
          quotaViolations: details.quotaViolations,
          batchSize: batch.length,
          configuredModel: options.model,
          fallbackModels: options.fallbackModels
        });
      }
    } else {
      logger.warn("Skipping Kimi batch due API cost guard", {
        batchIndex,
        batchSize: batch.length,
        maxApiBatches: options.maxApiBatches
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
    fallbackCount: combined.filter((article) => article.geotagStatus !== "live").length,
    modelUsageCounts,
    maxApiBatches: options.maxApiBatches,
    effectiveMaxApiBatches: Number.isFinite(effectiveMaxApiBatches)
      ? effectiveMaxApiBatches
      : "unlimited"
  });

  return combined;
}
